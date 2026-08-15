/**
 * backup-restore-transaction.js — Atomic write phase for a validated full backup.
 * Called only after Settings has validated the file and the user has confirmed replacement.
 */

import { openDatabase, waitForTransaction } from './database.js';
import { waitForCoreWrites } from './write-coordinator.js';
import {
  CHATUI_BACKUP_FORMAT,
  CHATUI_BACKUP_FORMAT_VERSION,
  BackupRestoreError,
  applyRestoredBrowserStorage
} from './backup-restore.js';

function fail(code, message, cause = null) {
  throw new BackupRestoreError(code, message, cause);
}

export async function restorePreparedBackup(preparedBackup) {
  if (!preparedBackup || preparedBackup.format !== CHATUI_BACKUP_FORMAT || preparedBackup.formatVersion !== CHATUI_BACKUP_FORMAT_VERSION) {
    fail('INVALID_BACKUP', 'Prepared restore data is invalid or unsupported.');
  }

  await waitForCoreWrites();
  const db = await openDatabase();
  const currentStoreNames = Array.from(db.objectStoreNames);
  const preparedStoreNames = new Set(preparedBackup.storeNames || []);
  if (currentStoreNames.some(name => !preparedStoreNames.has(name))) {
    fail('SCHEMA_CHANGED', 'ChatUI database schema changed while the backup was being checked. Reload ChatUI and try again.');
  }

  let tx = null;
  try {
    tx = db.transaction(currentStoreNames, 'readwrite');
    const done = waitForTransaction(tx);

    for (const name of currentStoreNames) tx.objectStore(name).clear();
    for (const name of currentStoreNames) {
      const store = tx.objectStore(name);
      for (const record of preparedBackup.stores[name] || []) store.put(record);
    }

    await done;
  } catch (error) {
    try { tx?.abort(); } catch (_) {}
    if (error instanceof BackupRestoreError) throw error;
    if (error?.name === 'QuotaExceededError') {
      fail('QUOTA_EXCEEDED', 'The backup is larger than the browser storage available for ChatUI. The restore transaction was rolled back.', error);
    }
    if (error?.name === 'ConstraintError') {
      fail('CONSTRAINT_ERROR', 'The backup violates a ChatUI database constraint. The restore transaction was rolled back.', error);
    }
    fail('RESTORE_FAILED', `ChatUI could not restore this backup: ${error?.message || error}`, error);
  }

  applyRestoredBrowserStorage(preparedBackup.browserStorage || {});
  return { restored: true, counts: { ...preparedBackup.counts }, createdAt: preparedBackup.createdAt };
}
