/**
 * backup-restore-ui.js — Settings UI for full local ChatUI backup and restore.
 */

import { runtime } from '../state/store.js';
import { createFullBackup, prepareFullBackupRestore } from '../storage/backup-restore.js';
import { restorePreparedBackup } from '../storage/backup-restore-transaction.js';

let initialized = false;
let operationActive = false;

function elements() {
  return {
    createButton: document.getElementById('create-full-backup-btn'),
    restoreButton: document.getElementById('restore-full-backup-btn'),
    fileInput: document.getElementById('restore-backup-file-input'),
    status: document.getElementById('backup-restore-status')
  };
}

function formatBytes(bytes) {
  const size = Math.max(0, Number(bytes) || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 ** 2) return `${(size / 1024).toFixed(1)} KB`;
  if (size < 1024 ** 3) return `${(size / (1024 ** 2)).toFixed(1)} MB`;
  return `${(size / (1024 ** 3)).toFixed(2)} GB`;
}

function setStatus(message, type = '') {
  const status = elements().status;
  if (!status) return;
  status.textContent = message || '';
  status.classList.toggle('is-success', type === 'success');
  status.classList.toggle('is-error', type === 'error');
}

function setBusy(active, createLabel = 'Create Backup', restoreLabel = 'Restore Backup') {
  operationActive = active;
  const { createButton, restoreButton, fileInput } = elements();
  if (createButton) {
    createButton.disabled = active;
    createButton.textContent = active && createLabel !== 'Create Backup' ? createLabel : 'Create Backup';
  }
  if (restoreButton) {
    restoreButton.disabled = active;
    restoreButton.textContent = active && restoreLabel !== 'Restore Backup' ? restoreLabel : 'Restore Backup';
  }
  if (fileInput) fileInput.disabled = active;
}

function currentActivityBlocker() {
  if (runtime.isGenerating) return 'Wait for the current assistant generation to finish or stop it first.';
  if (runtime.isRecordingAudio || runtime.isStoppingAudioRecording) return 'Finish or cancel the current audio recording first.';
  if (runtime.isVoiceModeActive) return 'Exit Voice Mode before creating or restoring a backup.';
  return '';
}

function downloadBackup(result) {
  const url = URL.createObjectURL(result.blob);
  try {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = result.fileName;
    anchor.style.display = 'none';
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  }
}

async function handleCreateBackup() {
  if (operationActive) return;
  const blocker = currentActivityBlocker();
  if (blocker) {
    setStatus(blocker, 'error');
    return;
  }

  setBusy(true, 'Preparing backup…');
  setStatus('Preparing backup… Large attachments and cached audio can take a little time.');
  try {
    const result = await createFullBackup();
    downloadBackup(result);
    setStatus(`Backup created — ${formatBytes(result.byteSize)}. Keep this file private because it may contain API keys.`, 'success');
  } catch (error) {
    console.error('Backup creation failed:', error);
    setStatus(`Backup failed: ${error?.message || error}`, 'error');
  } finally {
    setBusy(false);
  }
}

function restoreSummary(prepared) {
  const count = name => Number(prepared.counts?.[name]) || 0;
  return [
    `${count('projects')} projects`,
    `${count('chats')} chats`,
    `${count('messages')} messages`,
    `${count('attachments')} attachments`,
    `${count('workspaceNodes')} Workspace items`
  ].join(', ');
}

async function handleSelectedRestoreFile(file) {
  if (!file || operationActive) return;
  const blocker = currentActivityBlocker();
  if (blocker) {
    setStatus(blocker, 'error');
    return;
  }

  setBusy(true, 'Create Backup', 'Checking backup…');
  setStatus('Checking backup before making any changes…');
  try {
    const prepared = await prepareFullBackupRestore(file);
    const created = new Date(prepared.createdAt);
    const confirmed = window.confirm(
      `Restore this ChatUI backup?\n\n` +
      `Backup: ${created.toLocaleString()}\n` +
      `${restoreSummary(prepared)}\n\n` +
      `This will replace the current local ChatUI data in this browser. ` +
      `The selected backup has already passed validation. Continue?`
    );
    if (!confirmed) {
      setStatus('Restore cancelled. Current ChatUI data was not changed.');
      return;
    }

    setBusy(true, 'Create Backup', 'Restoring…');
    setStatus('Restoring backup… Do not close this tab.');
    await restorePreparedBackup(prepared);
    setStatus('Restore completed. Reloading ChatUI…', 'success');
    window.location.reload();
  } catch (error) {
    console.error('Backup restore failed:', error);
    setStatus(`Restore failed: ${error?.message || error}`, 'error');
  } finally {
    const input = elements().fileInput;
    if (input) input.value = '';
    setBusy(false);
  }
}

export function initBackupRestoreUI() {
  if (initialized) return;
  initialized = true;
  const { createButton, restoreButton, fileInput } = elements();

  createButton?.addEventListener('click', () => void handleCreateBackup());
  restoreButton?.addEventListener('click', () => {
    if (operationActive) return;
    const blocker = currentActivityBlocker();
    if (blocker) {
      setStatus(blocker, 'error');
      return;
    }
    fileInput?.click();
  });
  fileInput?.addEventListener('change', event => {
    const file = event.target.files?.[0] || null;
    if (file) void handleSelectedRestoreFile(file);
  });
}
