/**
 * database.js - IndexedDB connection, schema, and transaction primitives.
 */

export const DB_NAME = 'ChatUI_DB';
export const DB_VERSION = 3;

let dbPromise = null;

export function openDatabase() {
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = event => {
      const db = event.target.result;

      // 1. Projects Store
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }

      // 2. Chats Store
      if (!db.objectStoreNames.contains('chats')) {
        const chatsStore = db.createObjectStore('chats', { keyPath: 'id' });
        chatsStore.createIndex('projectId', 'projectId', { unique: false });
      }

      // 3. Messages Store
      if (!db.objectStoreNames.contains('messages')) {
        const msgStore = db.createObjectStore('messages', { keyPath: 'id' });
        msgStore.createIndex('chatId', 'chatId', { unique: false });
      }

      // 4. Attachments Store (Blob storage)
      if (!db.objectStoreNames.contains('attachments')) {
        const attachStore = db.createObjectStore('attachments', { keyPath: 'id' });
        attachStore.createIndex('messageId', 'messageId', { unique: false });
      }

      // 5. Settings Store
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'id' });
      }

      // 6. Read Aloud Audio Cache (lazy Blob storage)
      if (!db.objectStoreNames.contains('readAudio')) {
        const readAudioStore = db.createObjectStore('readAudio', { keyPath: 'messageId' });
        readAudioStore.createIndex('chatId', 'chatId', { unique: false });
        readAudioStore.createIndex('expiresAt', 'expiresAt', { unique: false });
      }

      // 7. Workspace node metadata. parentKey uses a stable root sentinel so the
      // unique compound index also protects top-level siblings, not only nested ones.
      if (!db.objectStoreNames.contains('workspaceNodes')) {
        const workspaceNodeStore = db.createObjectStore('workspaceNodes', { keyPath: 'id' });
        workspaceNodeStore.createIndex('parentId', 'parentId', { unique: false });
        workspaceNodeStore.createIndex('parentName', ['parentKey', 'nameKey'], { unique: true });
        workspaceNodeStore.createIndex('type', 'type', { unique: false });
        workspaceNodeStore.createIndex('updatedAt', 'updatedAt', { unique: false });
      }

      // 8. Workspace Markdown file contents, kept separate so directory metadata stays lazy.
      if (!db.objectStoreNames.contains('workspaceFiles')) {
        db.createObjectStore('workspaceFiles', { keyPath: 'nodeId' });
      }
    };

    request.onsuccess = event => {
      const db = event.target.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    request.onblocked = () => {
      dbPromise = null;
      reject(new Error('IndexedDB open is blocked by another active connection. Close other ChatUI tabs and retry.'));
    };
    request.onerror = event => {
      console.error('IndexedDB open error:', event.target.error);
      dbPromise = null;
      reject(event.target.error);
    };
  });

  return dbPromise;
}

export function getRequestPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function waitForTransaction(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error('IndexedDB transaction failed'));
    tx.onabort = () => reject(tx.error || new Error('IndexedDB transaction aborted'));
  });
}

export async function closeDatabaseConnection() {
  if (!dbPromise) return;
  try {
    const db = await dbPromise;
    db.close();
  } catch (error) {
    console.warn('Error closing DB before delete:', error);
  } finally {
    dbPromise = null;
  }
}
