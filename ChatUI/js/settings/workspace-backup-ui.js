/**
 * workspace-backup-ui.js - Settings controls for Workspace-only ZIP backup.
 */

import {
  buildWorkspaceBackup,
  restoreWorkspaceBackup,
  workspaceBackupFilename
} from '../workspace/workspace-backup.js';
import { openWorkspacePath } from '../workspace/workspace-ui.js';

function setStatus(message, type = '') {
  const status = document.getElementById('workspace-backup-status');
  if (!status) return;
  status.textContent = message || '';
  status.classList.toggle('is-success', type === 'success');
  status.classList.toggle('is-error', type === 'error');
}

function setBusy(busy) {
  ['create-workspace-backup-btn', 'restore-workspace-backup-btn'].forEach(id => {
    const button = document.getElementById(id);
    if (button) button.disabled = busy;
  });
}

function downloadBytes(bytes, filename) {
  const blob = new Blob([bytes], { type: 'application/zip' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function currentPublicWorkspacePath() {
  let pathname = '';
  try {
    const targetWindow = window.parent !== window ? window.parent : window;
    pathname = targetWindow.location.pathname || '';
  } catch (_) {
    pathname = window.location.pathname || '';
  }

  if (pathname === '/workspace' || pathname === '/workspace/') return '/';
  if (!pathname.startsWith('/workspace/')) return null;
  const encoded = pathname.slice('/workspace/'.length).split('/');
  if (encoded.some(segment => !segment)) return null;
  try {
    return `/${encoded.map(segment => decodeURIComponent(segment)).join('/')}`;
  } catch (_) {
    return null;
  }
}

async function reconcileWorkspaceRouteAfterRestore() {
  const routedPath = currentPublicWorkspacePath();
  if (routedPath == null) return;
  const reopened = await openWorkspacePath(routedPath, { historyMode: 'replace' });
  if (!reopened) await openWorkspacePath('/', { historyMode: 'replace' });
}

async function createBackup() {
  setBusy(true);
  setStatus('Creating Workspace backup…');
  try {
    const result = await buildWorkspaceBackup();
    downloadBytes(result.bytes, workspaceBackupFilename());
    const size = result.sizeBytes < 1024 * 1024
      ? `${Math.max(1, Math.round(result.sizeBytes / 1024))} KiB`
      : `${(result.sizeBytes / 1024 / 1024).toFixed(1)} MiB`;
    setStatus(`Workspace backup created: ${result.fileCount} Markdown file${result.fileCount === 1 ? '' : 's'}, ${result.nodeCount} item${result.nodeCount === 1 ? '' : 's'}, ${size}.`, 'success');
  } catch (error) {
    console.error('Workspace backup failed:', error);
    setStatus(`Workspace backup failed: ${error?.message || 'Unknown error'}`, 'error');
  } finally {
    setBusy(false);
  }
}

async function restoreBackup(file) {
  if (!file) return;
  const confirmed = window.confirm('Restore this Workspace backup? The ZIP will be fully validated first. If validation succeeds, only the current Workspace will be replaced. Chats, settings, API configuration, attachments, and Todo data will remain unchanged.');
  if (!confirmed) return;

  setBusy(true);
  setStatus('Validating Workspace backup…');
  try {
    const result = await restoreWorkspaceBackup(file);
    await reconcileWorkspaceRouteAfterRestore();
    setStatus(`Workspace restored: ${result.fileCount} Markdown file${result.fileCount === 1 ? '' : 's'} and ${result.nodeCount} total item${result.nodeCount === 1 ? '' : 's'}.`, 'success');
  } catch (error) {
    console.error('Workspace restore failed:', error);
    setStatus(`Workspace restore rejected: ${error?.message || 'Unknown error'}`, 'error');
  } finally {
    setBusy(false);
  }
}

export function initWorkspaceBackupUI() {
  const createButton = document.getElementById('create-workspace-backup-btn');
  const restoreButton = document.getElementById('restore-workspace-backup-btn');
  const fileInput = document.getElementById('restore-workspace-backup-file-input');

  createButton?.addEventListener('click', () => void createBackup());
  restoreButton?.addEventListener('click', () => fileInput?.click());
  fileInput?.addEventListener('change', event => {
    const file = event.target.files?.[0] || null;
    event.target.value = '';
    void restoreBackup(file);
  });
}