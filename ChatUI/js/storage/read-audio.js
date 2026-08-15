/**
 * read-audio.js — Lazy IndexedDB persistence for completed Read Aloud WAV files.
 */

import { openDatabase, getRequestPromise, waitForTransaction } from './database.js';

const STORE = 'readAudio';
const DAY_MS = 24 * 60 * 60 * 1000;

export function buildReadAudioExpiresAt(generatedAt, retentionDays) {
  const days = Number(retentionDays);
  if (days === -1) return null;
  if (!Number.isInteger(days) || days < 0) return null;
  return Number(generatedAt) + (days * DAY_MS);
}

export async function getReadAudio(messageId) {
  if (!messageId) return null;
  const db = await openDatabase();
  const tx = db.transaction(STORE, 'readonly');
  const done = waitForTransaction(tx);
  const record = await getRequestPromise(tx.objectStore(STORE).get(messageId));
  await done;
  return record || null;
}

export async function putReadAudio(record) {
  if (!record?.messageId || !(record.data instanceof Blob)) {
    throw new Error('Read audio cache record is missing its message ID or WAV Blob.');
  }
  const db = await openDatabase();
  const tx = db.transaction(STORE, 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(STORE).put(record);
  await done;
  return record;
}

export async function deleteReadAudio(messageId) {
  if (!messageId) return;
  const db = await openDatabase();
  const tx = db.transaction(STORE, 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(STORE).delete(messageId);
  await done;
}

export async function deleteReadAudioForMessages(messageIds = []) {
  const ids = [...new Set((messageIds || []).filter(Boolean))];
  if (ids.length === 0) return;
  const db = await openDatabase();
  const tx = db.transaction(STORE, 'readwrite');
  const done = waitForTransaction(tx);
  const store = tx.objectStore(STORE);
  ids.forEach(id => store.delete(id));
  await done;
}

export async function deleteReadAudioForChat(chatId) {
  if (!chatId) return;
  const db = await openDatabase();
  const readTx = db.transaction(STORE, 'readonly');
  const readDone = waitForTransaction(readTx);
  const records = await getRequestPromise(readTx.objectStore(STORE).index('chatId').getAll(chatId));
  await readDone;
  if (!records?.length) return;

  const deleteTx = db.transaction(STORE, 'readwrite');
  const deleteDone = waitForTransaction(deleteTx);
  const store = deleteTx.objectStore(STORE);
  records.forEach(record => store.delete(record.messageId));
  await deleteDone;
}

export async function cleanupExpiredReadAudio(now = Date.now()) {
  const db = await openDatabase();
  const tx = db.transaction(STORE, 'readwrite');
  const done = waitForTransaction(tx);
  const store = tx.objectStore(STORE);
  const index = store.index('expiresAt');
  let removed = 0;

  await new Promise((resolve, reject) => {
    const request = index.openCursor(IDBKeyRange.upperBound(Number(now)));
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) { resolve(); return; }
      cursor.delete();
      removed += 1;
      cursor.continue();
    };
  });
  await done;
  return removed;
}
export async function applyReadAudioRetentionPolicy(retentionDays, now = Date.now()) {
  const days = Number(retentionDays);
  if (days !== -1 && (!Number.isInteger(days) || days < 0)) {
    throw new Error('Audio retention must be -1 or a non-negative whole number of days.');
  }

  const db = await openDatabase();
  const readTx = db.transaction(STORE, 'readonly');
  const readDone = waitForTransaction(readTx);
  const records = await getRequestPromise(readTx.objectStore(STORE).getAll());
  await readDone;
  if (!records?.length) return { updated: 0, removed: 0 };

  const tx = db.transaction(STORE, 'readwrite');
  const done = waitForTransaction(tx);
  const store = tx.objectStore(STORE);
  let updated = 0;
  let removed = 0;

  records.forEach(record => {
    const expiresAt = buildReadAudioExpiresAt(record.generatedAt || now, days);
    if (expiresAt !== null && expiresAt <= now) {
      store.delete(record.messageId);
      removed += 1;
      return;
    }
    store.put({ ...record, expiresAt });
    updated += 1;
  });
  await done;
  return { updated, removed };
}
