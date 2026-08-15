/**
 * delete.js - Destructive persistence operations.
 */

import { state, setState } from '../state/store.js';
import { DB_NAME, openDatabase, getRequestPromise, waitForTransaction, closeDatabaseConnection } from './database.js';
import { LEGACY_STORAGE_KEY, MIGRATED_FLAG_KEY } from './migration.js';
import { enqueueCoreWrite, waitForCoreWrites } from './write-coordinator.js';

export function deleteMessageRecord(messageId) {
  if (!messageId) return Promise.reject(new Error('Cannot delete a message without an ID.'));
  return enqueueCoreWrite(async () => {
    const db = await openDatabase();
    const readTx = db.transaction('attachments', 'readonly');
    const readTransactionDone = waitForTransaction(readTx);
    const attachments = await getRequestPromise(readTx.objectStore('attachments').index('messageId').getAll(messageId));
    await readTransactionDone;

    const deleteTx = db.transaction(['messages', 'attachments', 'readAudio'], 'readwrite');
    const deleteTransactionDone = waitForTransaction(deleteTx);
    deleteTx.objectStore('messages').delete(messageId);
    deleteTx.objectStore('readAudio').delete(messageId);
    const attachStore = deleteTx.objectStore('attachments');
    (attachments || []).forEach(attachment => attachStore.delete(attachment.id));
    return deleteTransactionDone.catch(err => {
      console.error('deleteMessageRecord transaction failed:', err);
      throw err;
    });
  });
}

// Delete Chat, its messages, and its attachments from IndexedDB.
export function deleteChatRecord(chatId) {
  if (!chatId) return Promise.reject(new Error('Cannot delete a chat without an ID.'));
  return enqueueCoreWrite(async () => {
    const db = await openDatabase();

    const messageTx = db.transaction('messages', 'readonly');
    const messageTransactionDone = waitForTransaction(messageTx);
    const messages = await getRequestPromise(messageTx.objectStore('messages').index('chatId').getAll(chatId));
    await messageTransactionDone;

    const messageIds = (messages || []).map(message => message.id);
    const attachmentIds = [];
    if (messageIds.length > 0) {
      const attachmentTx = db.transaction('attachments', 'readonly');
      const attachmentTransactionDone = waitForTransaction(attachmentTx);
      const attachIndex = attachmentTx.objectStore('attachments').index('messageId');
      const attachmentRequests = messageIds.map(messageId => attachIndex.getAll(messageId));
      const attachmentGroups = await Promise.all(attachmentRequests.map(getRequestPromise));
      await attachmentTransactionDone;
      attachmentGroups.flat().forEach(attachment => attachmentIds.push(attachment.id));
    }

    const deleteTx = db.transaction(['chats', 'messages', 'attachments', 'readAudio'], 'readwrite');
    const deleteTransactionDone = waitForTransaction(deleteTx);
    deleteTx.objectStore('chats').delete(chatId);
    const msgStore = deleteTx.objectStore('messages');
    const attachStore = deleteTx.objectStore('attachments');
    const readAudioStore = deleteTx.objectStore('readAudio');
    messageIds.forEach(messageId => msgStore.delete(messageId));
    attachmentIds.forEach(attachmentId => attachStore.delete(attachmentId));
    const readAudioCursor = readAudioStore.index('chatId').openCursor(IDBKeyRange.only(chatId));
    readAudioCursor.onsuccess = () => {
      const cursor = readAudioCursor.result;
      if (!cursor) return;
      cursor.delete();
      cursor.continue();
    };
    return deleteTransactionDone.catch(err => {
      console.error('deleteChatRecord transaction failed:', err);
      throw err;
    });
  });
}

// Delete Project record and unassign associated chats in one valid IndexedDB transaction.
export function deleteProjectRecord(projectId, updatedAt = Date.now()) {
  if (!projectId) return Promise.reject(new Error('Cannot delete a project without an ID.'));
  return enqueueCoreWrite(async () => {
    const db = await openDatabase();
    const tx = db.transaction(['projects', 'chats'], 'readwrite');
    const transactionDone = waitForTransaction(tx);
    const projectStore = tx.objectStore('projects');
    const chatStore = tx.objectStore('chats');
    projectStore.delete(projectId);

    const request = chatStore.index('projectId').getAll(projectId);
    request.onsuccess = () => {
      (request.result || []).forEach(chat => {
        chatStore.put({ ...chat, projectId: null, updatedAt });
      });
    };
    return transactionDone.catch(err => {
      console.error('deleteProjectRecord transaction failed:', err);
      throw err;
    });
  });
}

// Destructive "Remove Everything" action in Settings -> General.
// Deleting ChatUI_DB also removes the dedicated Workspace stores without coupling chat/project deletes to Workspace.
export async function removeAllData() {
  // Let any already-started core mutation settle before deleting the database.
  await waitForCoreWrites();

  // 1. Close open DB connection
  await closeDatabaseConnection();

  // 2. Delete IndexedDB database safely
  await new Promise((resolve, reject) => {
    const req = indexedDB.deleteDatabase(DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error || new Error('Database deletion failed'));
    req.onblocked = () => {
      reject(new Error('Database deletion is blocked by an active connection or open browser tab. Please close other tabs and try again.'));
    };
  });

  // 3. Clear ChatUI LocalStorage keys
  localStorage.removeItem(LEGACY_STORAGE_KEY);
  localStorage.removeItem(MIGRATED_FLAG_KEY);
  localStorage.removeItem('gemini_text_api_key');
  localStorage.removeItem('gemini_text_base_url');
  localStorage.removeItem('gemini_voice_api_key');
  localStorage.removeItem('gemini_voice_base_url');

  // 4. Reset in-memory state
  setState({
    projects: [],
    chats: [],
    activeChatId: null,
    activeProjectId: null,
    currentModel: '3.7 Flash',
    thinkingLevel: 'medium',
    theme: 'dark',
    accentColor: '#2563EB',
    tools: { googleSearch: false, urlContext: false, codeExecution: false, workspace: false },
    api: { textApiKey: '', textBaseUrl: '', voiceApiKey: '', voiceBaseUrl: '' },
    audioRead: { voiceName: 'Zephyr', retentionDays: 7 }
  });

  // 5. Hard reload to fresh empty app state
  window.location.reload();
}
