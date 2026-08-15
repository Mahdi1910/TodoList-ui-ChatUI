/**
 * attachments.js — File Selection, Drag/Drop, Pill Previews & Attachment Management
 */

import { runtime, setRuntime } from '../state/store.js';
import { updateComposerButtons } from './composer.js';
import { escapeHtml } from '../utils/dom.js';
import {
  GEMINI_ATTACHMENT_SUPPORT_SUMMARY,
  getAttachmentPresentation,
  getGeminiAttachmentMimeType,
  isGeminiSupportedAttachment
} from './attachment-types.js';

export const MAX_ATTACHMENT_FILE_SIZE_BYTES = 20 * 1024 * 1024;
export const MAX_TOTAL_ATTACHMENT_SIZE_BYTES = 30 * 1024 * 1024;

let dragDropInitialized = false;
let fileDragDepth = 0;

function normalizeAttachmentFile(file) {
  if (!file) return file;
  const normalizedType = getGeminiAttachmentMimeType(file);
  if (!normalizedType || normalizedType === file.type || typeof File === 'undefined') return file;

  try {
    return new File([file], file.name, {
      type: normalizedType,
      lastModified: Number(file.lastModified) || Date.now()
    });
  } catch (_) {
    return file;
  }
}

export function getAttachmentTotalBytes(files = []) {
  return (files || []).reduce((total, file) => {
    const size = Number(file?.size);
    return total + (Number.isFinite(size) && size > 0 ? size : 0);
  }, 0);
}

export function getRemainingAttachmentBytes(files = []) {
  return Math.max(0, MAX_TOTAL_ATTACHMENT_SIZE_BYTES - getAttachmentTotalBytes(files));
}

function getAttachmentValidationError(file, existingFiles = []) {
  if (!file) return 'The selected attachment is unavailable.';

  const name = file.name || 'Attachment';
  if (!isGeminiSupportedAttachment(file)) {
    return `File "${name}" is not a supported Gemini attachment format. Supported inputs include HTML, CSS, JavaScript, JSON, XML, CSV, RTF, PDF, text/source files, supported images, audio, and video.`;
  }

  const size = Number(file.size) || 0;
  if (size > MAX_ATTACHMENT_FILE_SIZE_BYTES) {
    return `File "${name}" exceeds the maximum allowed size of 20MB.`;
  }

  if (getAttachmentTotalBytes(existingFiles) + size > MAX_TOTAL_ATTACHMENT_SIZE_BYTES) {
    return `Adding "${name}" would exceed the maximum combined attachment size of 30MB for one message.`;
  }

  return '';
}

export function validateAttachmentFile(file, existingFiles = [], options = {}) {
  const error = getAttachmentValidationError(file, existingFiles);
  if (error && options.showAlert !== false) alert(error);
  return { valid: !error, error };
}

// Backward-compatible boolean validator for any existing callers.
export function validateFile(file, existingFiles = runtime.attachedFiles) {
  return validateAttachmentFile(file, existingFiles).valid;
}

export function validateAttachmentSet(files = [], options = {}) {
  const accepted = [];
  for (const file of files || []) {
    const result = validateAttachmentFile(file, accepted, { showAlert: false });
    if (!result.valid) {
      if (options.showAlert !== false) alert(result.error);
      return { valid: false, error: result.error };
    }
    accepted.push(file);
  }
  return { valid: true, error: '' };
}

export function tryAddAttachmentFile(file, options = {}) {
  const normalizedFile = normalizeAttachmentFile(file);
  const result = validateAttachmentFile(normalizedFile, runtime.attachedFiles, options);
  if (!result.valid) return false;

  setRuntime({ attachedFiles: [...runtime.attachedFiles, normalizedFile] });
  if (options.refresh !== false) {
    updateFilePreviewsUI();
    updateComposerButtons();
  }
  return true;
}

function addAttachmentFiles(files, onFileAttachedCallback = null) {
  const incomingFiles = Array.from(files || []);
  if (incomingFiles.length === 0) return false;

  let addedAny = false;
  incomingFiles.forEach(file => {
    if (tryAddAttachmentFile(file, { refresh: false })) addedAny = true;
  });

  updateFilePreviewsUI();
  updateComposerButtons();

  if (addedAny && onFileAttachedCallback) onFileAttachedCallback();
  return addedAny;
}

export function updateFilePreviewsUI() {
  const composerBar = document.getElementById('composer-bar') || document.querySelector('.composer-bar');
  let previewContainer = document.getElementById('composer-file-previews');

  if (!previewContainer && composerBar) {
    previewContainer = document.createElement('div');
    previewContainer.id = 'composer-file-previews';
    previewContainer.className = 'composer-file-previews';
    composerBar.parentElement.insertBefore(previewContainer, composerBar);
  }

  if (previewContainer) {
    previewContainer.innerHTML = '';
    runtime.attachedFiles.forEach((file, index) => {
      const pill = document.createElement('div');
      pill.className = 'file-pill';
      const presentation = getAttachmentPresentation(file);

      pill.innerHTML = `
        <i data-lucide="${presentation.icon}" class="file-pill-icon"></i>
        <span class="file-pill-title">${escapeHtml(file.name)}</span>
        <button class="file-pill-remove" title="Remove attachment">
          <i data-lucide="x" class="file-pill-remove-icon"></i>
        </button>
      `;

      pill.querySelector('.file-pill-remove').onclick = () => {
        setRuntime({ attachedFiles: runtime.attachedFiles.filter((_, i) => i !== index) });
        updateFilePreviewsUI();
        updateComposerButtons();
      };

      previewContainer.appendChild(pill);
    });

    if (typeof lucide !== 'undefined' && lucide.createIcons) {
      lucide.createIcons();
    }
  }
}

function isFileDrag(event) {
  const types = Array.from(event?.dataTransfer?.types || []);
  return types.includes('Files');
}

function getOrCreateDropOverlay() {
  let overlay = document.getElementById('attachment-drop-overlay');
  if (overlay) return overlay;

  overlay = document.createElement('div');
  overlay.id = 'attachment-drop-overlay';
  overlay.className = 'attachment-drop-overlay hidden';
  overlay.setAttribute('aria-hidden', 'true');

  const card = document.createElement('div');
  card.className = 'attachment-drop-card';

  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', 'upload-cloud');
  icon.className = 'attachment-drop-icon';

  const label = document.createElement('div');
  label.className = 'attachment-drop-label';
  label.textContent = 'Drop files to attach';

  const hint = document.createElement('div');
  hint.className = 'attachment-drop-hint';
  hint.textContent = GEMINI_ATTACHMENT_SUPPORT_SUMMARY;

  card.append(icon, label, hint);
  overlay.appendChild(card);
  document.body.appendChild(overlay);

  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  return overlay;
}

function setDropOverlayVisible(visible) {
  if (!visible) {
    document.getElementById('attachment-drop-overlay')?.classList.add('hidden');
    return;
  }
  getOrCreateDropOverlay().classList.remove('hidden');
}

function initAttachmentDragDrop(onFileAttachedCallback = null) {
  if (dragDropInitialized) return;
  dragDropInitialized = true;

  const clearDragState = () => {
    fileDragDepth = 0;
    setDropOverlayVisible(false);
  };

  document.addEventListener('dragenter', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    fileDragDepth += 1;
    setDropOverlayVisible(true);
  });

  document.addEventListener('dragover', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'copy';
    setDropOverlayVisible(true);
  });

  document.addEventListener('dragleave', () => {
    if (fileDragDepth === 0) return;
    fileDragDepth = Math.max(0, fileDragDepth - 1);
    if (fileDragDepth === 0) setDropOverlayVisible(false);
  });

  document.addEventListener('drop', event => {
    if (!isFileDrag(event)) return;
    event.preventDefault();
    event.stopPropagation();
    clearDragState();
    addAttachmentFiles(event.dataTransfer?.files || [], onFileAttachedCallback);
  });

  document.addEventListener('dragend', clearDragState);
  window.addEventListener('blur', clearDragState);
}

export function initAttachmentListeners(attachFileBtn, fileInput, onFileAttachedCallback = null) {
  if (attachFileBtn && fileInput) {
    attachFileBtn.addEventListener('click', () => {
      fileInput.click();
    });

    fileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files || []);
      if (files.length === 0) return;

      addAttachmentFiles(files, onFileAttachedCallback);
      fileInput.value = '';
    });
  }

  initAttachmentDragDrop(onFileAttachedCallback);
}
