import { TodoDbSchema } from './db-schema.js';

export const TodoDb = (() => {
  let openPromise = null;

  function request(requestObject) {
    return new Promise((resolve, reject) => {
      requestObject.addEventListener('success', () => resolve(requestObject.result), { once: true });
      requestObject.addEventListener('error', () => reject(requestObject.error || new Error('IndexedDB request failed.')), { once: true });
    });
  }

  function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
      transaction.addEventListener('complete', () => resolve(), { once: true });
      transaction.addEventListener('abort', () => reject(transaction.error || new Error('IndexedDB transaction aborted.')), { once: true });
      transaction.addEventListener('error', () => reject(transaction.error || new Error('IndexedDB transaction failed.')), { once: true });
    });
  }

  function open() {
    if (openPromise) return openPromise;
    openPromise = new Promise((resolve, reject) => {
      const schema = TodoDbSchema;
      const openRequest = indexedDB.open(schema.NAME, schema.VERSION);
      openRequest.addEventListener('upgradeneeded', event => {
        schema.upgrade(openRequest.result, event.oldVersion, openRequest.transaction);
      });
      openRequest.addEventListener('success', () => {
        const db = openRequest.result;
        db.addEventListener('versionchange', () => {
          db.close();
          openPromise = null;
        });
        resolve(db);
      }, { once: true });
      openRequest.addEventListener('error', () => {
        openPromise = null;
        reject(openRequest.error || new Error('Could not open TodoListDB.'));
      }, { once: true });
      openRequest.addEventListener('blocked', () => {
        console.warn('TodoListDB upgrade is blocked by another open tab.');
      });
    });
    return openPromise;
  }

  async function withTransaction(storeNames, mode, work) {
    const db = await open();
    const names = Array.isArray(storeNames) ? storeNames : [storeNames];
    const tx = db.transaction(names, mode);
    const done = transactionDone(tx);
    try {
      const result = await work(tx);
      await done;
      return result;
    } catch (error) {
      try { tx.abort(); } catch (_) {}
      try { await done; } catch (_) {}
      throw error;
    }
  }

  function close() {
    if (!openPromise) return;
    openPromise.then(db => db.close()).catch(() => {});
    openPromise = null;
  }

  return { open, close, request, transactionDone, withTransaction };
})();
