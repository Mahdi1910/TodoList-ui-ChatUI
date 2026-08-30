import assert from 'node:assert/strict';
import 'fake-indexeddb/auto';

if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    readAsDataURL(blob) {
      blob.arrayBuffer().then(buffer => {
        this.result = `data:${blob.type || 'application/octet-stream'};base64,${Buffer.from(buffer).toString('base64')}`;
        this.onload?.();
      }).catch(error => {
        this.error = error;
        this.onerror?.();
      });
    }
  };
}

if (typeof globalThis.atob === 'undefined') {
  globalThis.atob = value => Buffer.from(value, 'base64').toString('binary');
}

const localValues = new Map();
globalThis.localStorage = {
  getItem: key => localValues.has(String(key)) ? localValues.get(String(key)) : null,
  setItem: (key, value) => localValues.set(String(key), String(value)),
  removeItem: key => localValues.delete(String(key)),
  clear: () => localValues.clear()
};

const { openDatabase, waitForTransaction } = await import('../ChatUI/js/storage/database.js');
const { createFullBackup, validateFullBackup } = await import('../ChatUI/js/storage/backup-restore.js');
const { restorePreparedBackup } = await import('../ChatUI/js/storage/backup-restore-transaction.js');

async function writeStore(name, records) {
  const db = await openDatabase();
  const tx = db.transaction([name], 'readwrite');
  const done = waitForTransaction(tx);
  const store = tx.objectStore(name);
  for (const record of records) store.put(record);
  await done;
}

async function clearAllStores() {
  const db = await openDatabase();
  const names = Array.from(db.objectStoreNames);
  const tx = db.transaction(names, 'readwrite');
  const done = waitForTransaction(tx);
  for (const name of names) tx.objectStore(name).clear();
  await done;
}

async function getAll(name) {
  const db = await openDatabase();
  const tx = db.transaction([name], 'readonly');
  const store = tx.objectStore(name);
  const request = store.getAll();
  const result = await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
  await waitForTransaction(tx);
  return result;
}

await clearAllStores();
localStorage.setItem('chatui_temp_performance_diagnostics_v1', 'fixture-diagnostics');

await writeStore('projects', [{ id: 'project-1', name: 'Project 1' }]);
await writeStore('chats', [{ id: 'chat-1', projectId: 'project-1', title: 'Chat 1', messagesLoaded: false }]);
await writeStore('messages', [
  { id: 'message-user', chatId: 'chat-1', sequence: 0, role: 'user', content: 'Hello' },
  { id: 'message-assistant', chatId: 'chat-1', sequence: 1, role: 'assistant', status: 'completed', content: 'Hi' }
]);
await writeStore('attachments', [{
  id: 'attachment-1',
  messageId: 'message-user',
  name: 'note.txt',
  type: 'text/plain',
  size: 3,
  data: new Blob(['abc'], { type: 'text/plain' })
}]);
await writeStore('settings', [{ id: 'app', theme: 'dark', currentModel: '3.7 Flash' }]);
await writeStore('readAudio', [{
  messageId: 'message-assistant',
  chatId: 'chat-1',
  data: new Blob(['pcm'], { type: 'audio/pcm' })
}]);
await writeStore('workspaceNodes', [
  { id: 'workspace-dir', type: 'directory', parentId: null, parentKey: '__workspace_root__', nameKey: 'docs', name: 'Docs', updatedAt: 1 },
  { id: 'workspace-file', type: 'file', parentId: 'workspace-dir', parentKey: 'workspace-dir', nameKey: 'note.md', name: 'note.md', updatedAt: 2 }
]);
await writeStore('workspaceFiles', [{ nodeId: 'workspace-file', content: '# Workspace note', updatedAt: 2 }]);

const backup = await createFullBackup();
assert.ok(backup.byteSize > 0, 'full backup must produce data');
const parsedEnvelope = JSON.parse(await backup.blob.text());
const prepared = await validateFullBackup(parsedEnvelope);
assert.equal(prepared.counts.projects, 1);
assert.equal(prepared.counts.messages, 2);
assert.equal(prepared.counts.attachments, 1);
assert.equal(prepared.counts.workspaceNodes, 2);
assert.equal(await prepared.stores.attachments[0].data.text(), 'abc', 'attachment Blob must survive backup encoding and decoding');
assert.equal(await prepared.stores.readAudio[0].data.text(), 'pcm', 'Read Aloud Blob must survive backup encoding and decoding');

await clearAllStores();
localStorage.setItem('chatui_temp_performance_diagnostics_v1', 'changed-after-backup');
await writeStore('projects', [{ id: 'temporary-project', name: 'Temporary' }]);

const restored = await restorePreparedBackup(prepared);
assert.equal(restored.restored, true);
assert.deepEqual((await getAll('projects')).map(item => item.id), ['project-1'], 'restore must replace current project data');
assert.deepEqual((await getAll('chats')).map(item => item.id), ['chat-1']);
assert.equal((await getAll('messages')).length, 2);
assert.equal(await (await getAll('attachments'))[0].data.text(), 'abc');
assert.equal((await getAll('workspaceFiles'))[0].content, '# Workspace note');
assert.equal(localStorage.getItem('chatui_temp_performance_diagnostics_v1'), 'fixture-diagnostics', 'browser storage included in backup must be restored');

const badPrepared = {
  ...prepared,
  stores: {
    ...prepared.stores,
    workspaceNodes: [
      ...prepared.stores.workspaceNodes,
      { id: 'workspace-duplicate', type: 'directory', parentId: null, parentKey: '__workspace_root__', nameKey: 'docs', name: 'Duplicate Docs', updatedAt: 3 }
    ]
  }
};

await clearAllStores();
await writeStore('projects', [{ id: 'sentinel-project', name: 'Must survive failed restore' }]);
await assert.rejects(
  restorePreparedBackup(badPrepared),
  error => error?.code === 'CONSTRAINT_ERROR' || error?.code === 'RESTORE_FAILED',
  'a restore that violates a database constraint must fail'
);
assert.deepEqual(
  (await getAll('projects')).map(item => item.id),
  ['sentinel-project'],
  'failed restore must roll back the transaction instead of leaving partially replaced data'
);

console.log('IndexedDB full backup/restore integration verification passed.');
