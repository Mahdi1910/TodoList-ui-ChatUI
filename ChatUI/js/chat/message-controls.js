/**
 * message-controls.js - Message toolbar and inline editing UI.
 */

import { state, runtime } from '../state/store.js';
import { copyTextToClipboard } from '../utils/dom.js';
import { readAssistantMessage } from '../voice/read-aloud.js';

let activeEditCancel = null;

function initializeIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function resolveFreshContext(chatRef, msgObj) {
  const chat = state.chats.find(item => item.id === chatRef?.id) || null;
  const message = chat?.messages?.find(item => item.id === msgObj?.id) || null;
  return { chat, message };
}

function createEditControl(msgObj, row, chatRef, callbacks, renderMessage) {
  activeEditCancel?.();
  const { onEditSaveCallback, onRegenerateCallback, onDeleteCallback } = callbacks;
  const editor = document.createElement('div');
  editor.className = 'message-edit-container';
  const textarea = document.createElement('textarea');
  textarea.className = 'message-edit-input';
  textarea.value = msgObj.content || '';
  textarea.setAttribute('aria-label', 'Edit message');
  textarea.rows = Math.max(2, Math.min(8, (textarea.value.match(/\n/g) || []).length + 2));
  const actions = document.createElement('div');
  actions.className = 'message-edit-actions';
  actions.innerHTML = `
    <button type="button" class="message-edit-cancel toolbar-btn" title="Cancel edit" aria-label="Cancel edit">Cancel</button>
    <button type="button" class="message-edit-save toolbar-btn" title="Save edit" aria-label="Save edit">Save</button>`;
  editor.append(textarea, actions);
  row.replaceChildren(editor);
  textarea.focus();
  textarea.setSelectionRange(textarea.value.length, textarea.value.length);

  const cancel = () => {
    if (activeEditCancel === cancel) activeEditCancel = null;
    const fresh = resolveFreshContext(chatRef, msgObj);
    if (!fresh.chat || !fresh.message) { row.remove(); return; }
    const restored = renderMessage(fresh.message, fresh.chat, onRegenerateCallback, onDeleteCallback, onEditSaveCallback);
    row.replaceWith(restored);
    initializeIcons();
  };
  activeEditCancel = cancel;
  actions.querySelector('.message-edit-cancel').onclick = cancel;
  actions.querySelector('.message-edit-save').onclick = async () => {
    const content = textarea.value.trim();
    if (!content && msgObj.role === 'user' && !(msgObj.attachments?.length)) {
      textarea.setCustomValidity('A user request cannot be empty.');
      textarea.reportValidity();
      return;
    }
    textarea.setCustomValidity('');
    const saveButton = actions.querySelector('.message-edit-save');
    saveButton.disabled = true;
    try {
      const updated = await onEditSaveCallback?.(chatRef, msgObj, content);
      if (!updated) return;
      if (activeEditCancel) activeEditCancel = null;
      const fresh = resolveFreshContext(chatRef, updated);
      const restored = renderMessage(fresh.message, fresh.chat, onRegenerateCallback, onDeleteCallback, onEditSaveCallback);
      row.replaceWith(restored);
      initializeIcons();
    } catch (error) {
      console.error('Failed to save message edit:', error);
      alert('Failed to save message edit: ' + error.message);
    } finally {
      saveButton.disabled = false;
    }
  };
}

export function appendMessageToolbar(row, msgObj, chatRef, callbacks, renderMessage) {
  const { onRegenerateCallback, onDeleteCallback, onEditSaveCallback } = callbacks;
  const toolbar = document.createElement('div');
  toolbar.className = 'message-toolbar';
  const canRead = msgObj.role === 'assistant' && ['completed', 'interrupted'].includes(msgObj.status) && !!msgObj.content?.trim();
  const readButton = canRead
    ? `<button class="toolbar-btn read-msg-btn" data-read-message-id="${msgObj.id || ''}" title="Read aloud" aria-label="Read answer aloud" aria-pressed="false"><i data-lucide="volume-2"></i></button>`
    : '';
  toolbar.innerHTML = `
    <button class="toolbar-btn copy-msg-btn" title="Copy text" aria-label="Copy message"><i data-lucide="copy"></i></button>
    <button class="toolbar-btn delete-msg-btn" title="Delete message" aria-label="Delete message"><i data-lucide="trash-2"></i></button>
    <button class="toolbar-btn edit-msg-btn" title="Edit message" aria-label="Edit message"><i data-lucide="pencil"></i></button>
    <button class="toolbar-btn regenerate-msg-btn" title="Regenerate response" aria-label="Regenerate response"><i data-lucide="rotate-cw"></i></button>
    ${readButton}`;
  row.appendChild(toolbar);

  const copyBtn = toolbar.querySelector('.copy-msg-btn');
  copyBtn.onclick = async () => {
    const fresh = resolveFreshContext(chatRef, msgObj);
    if (!fresh.message) { copyBtn.title = 'Message unavailable'; return; }
    const copied = await copyTextToClipboard(fresh.message.content || '');
    if (!copied) { copyBtn.title = 'Copy failed'; return; }
    copyBtn.title = 'Copied!';
    copyBtn.innerHTML = '<i data-lucide="check"></i>';
    initializeIcons();
    setTimeout(() => {
      copyBtn.title = 'Copy text';
      copyBtn.innerHTML = '<i data-lucide="copy"></i>';
      initializeIcons();
    }, 2000);
  };

  toolbar.querySelector('.delete-msg-btn').onclick = () => {
    if (chatRef && onDeleteCallback) onDeleteCallback(chatRef, msgObj, row);
  };

  toolbar.querySelector('.edit-msg-btn').onclick = () => {
    if (runtime.isGenerating || !chatRef || !onEditSaveCallback) return;
    const fresh = resolveFreshContext(chatRef, msgObj);
    if (!fresh.chat || !fresh.message) return;
    createEditControl(fresh.message, row, fresh.chat, callbacks, renderMessage);
  };

  toolbar.querySelector('.regenerate-msg-btn').onclick = () => {
    if (runtime.isGenerating || !chatRef) return;
    onRegenerateCallback?.(chatRef, msgObj);
  };

  const readBtn = toolbar.querySelector('.read-msg-btn');
  if (readBtn) {
    readBtn.onclick = async () => {
      const fresh = resolveFreshContext(chatRef, msgObj);
      if (!fresh.chat || !fresh.message) return;
      await readAssistantMessage(fresh.chat.id, fresh.message.id, row);
    };
  }
}
