import { TodoDb } from './db.js';

export const TodoRepositories = (() => {
  const db = () => TodoDb;

  function store(tx, storeName) {
    return tx.objectStore(storeName);
  }

  function get(tx, storeName, key) {
    return db().request(store(tx, storeName).get(key));
  }

  function getAll(tx, storeName) {
    return db().request(store(tx, storeName).getAll());
  }

  function getAllByIndex(tx, storeName, indexName, key) {
    return db().request(store(tx, storeName).index(indexName).getAll(key));
  }

  function put(tx, storeName, value) {
    return db().request(store(tx, storeName).put(value));
  }

  function add(tx, storeName, value) {
    return db().request(store(tx, storeName).add(value));
  }

  function remove(tx, storeName, key) {
    return db().request(store(tx, storeName).delete(key));
  }

  function clear(tx, storeName) {
    return db().request(store(tx, storeName).clear());
  }

  async function putMany(tx, storeName, values = []) {
    for (const value of values) await put(tx, storeName, value);
  }

  async function deleteMany(tx, storeName, keys = []) {
    for (const key of keys) await remove(tx, storeName, key);
  }

  function deleteByIndex(tx, storeName, indexName, key) {
    return new Promise((resolve, reject) => {
      const cursorRequest = store(tx, storeName).index(indexName).openKeyCursor(IDBKeyRange.only(key));
      cursorRequest.addEventListener('error', () => reject(cursorRequest.error || new Error(`Could not delete ${storeName} relations.`)), { once: true });
      cursorRequest.addEventListener('success', () => {
        const cursor = cursorRequest.result;
        if (!cursor) {
          resolve();
          return;
        }
        const deleteRequest = store(tx, storeName).delete(cursor.primaryKey);
        deleteRequest.addEventListener('error', () => reject(deleteRequest.error || new Error(`Could not delete ${storeName} relation.`)), { once: true });
        deleteRequest.addEventListener('success', () => cursor.continue(), { once: true });
      });
    });
  }

  async function replaceRelations(tx, storeName, indexName, ownerKey, rows = []) {
    await deleteByIndex(tx, storeName, indexName, ownerKey);
    await putMany(tx, storeName, rows);
  }

  return {
    store,
    get,
    getAll,
    getAllByIndex,
    put,
    add,
    remove,
    clear,
    putMany,
    deleteMany,
    deleteByIndex,
    replaceRelations
  };
})();
