/**
 * message-controls.js - Message toolbar and inline editing UI.
 */

import { state, runtime } from '../state/store.js';
import { copyTextToClipboard } from '../utils/dom.js';
import { readAssistantMessage } from '../voice/read-aloud.js';

let activeEditCancel = null;
let activeOverflowMenu = null;
let overflowGlobalListenersInstalled = false;

function initializeIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function resolveFreshContext(chatRef, msgObj) {
  const chat = state.chats.find(item => item.id === chatRef?.id) || null;
  const message = chat?.messages?.find(item => item.id === msgObj?.id) || null;
  return { chat, message };
}

function closeOverflowMenu({ restoreFocus = false } = {}) {
  const active = activeOverflowMenu;
  if (!active) return;
  active.menu.classList.add('hidden');
  active.button.setAttribute('aria-expanded', 'false');
  activeOverflowMenu = null;
  if (restoreFocus && active.button.isConnected) active.button.focus();
}

function ensureOverflowGlobalListeners() {
  if (overflowGlobalListenersInstalled) return;
  overflowGlobalListenersInstalled = true;
  document.addEventListener('click', event => {
    if (!activeOverflowMenu) return;
    if (activeOverflowMenu.menu.contains(event.target) || activeOverflowMenu.button.contains(event.target)) return;
    closeOverflowMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && activeOverflowMenu) {
      event.preventDefault();
      closeOverflowMenu({ restoreFocus: true });
    }
  });
}

function createEditControl(msgObj, row, chatRef, callbacks, renderMessage) {
  closeOverflowMenu();
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

function makeMenuItem({ className, icon, label, danger = false }) {
  return `<button type="button" class="message-menu-item ${className}${danger ? ' danger' : ''}" role="menuitem"><i data-lucide="${icon}"></i><span>${label}</span></button>`;
}

export function appendMessageToolbar(row, msgObj, chatRef, callbacks, renderMessage) {
  ensureOverflowGlobalListeners();
  const { onRegenerateCallback, onDeleteCallback, onEditSaveCallback } = callbacks;
  const toolbar = document.createElement('div');
  toolbar.className = 'message-toolbar';
  const isAssistant = msgObj.role === 'assistant';
  const canRead = isAssistant && ['completed', 'interrupted'].includes(msgObj.status) && !!msgObj.content?.trim();
  const readButton = canRead
    ? `<button class="toolbar-btn read-msg-btn" data-read-message-id="${msgObj.id || ''}" title="Read aloud" aria-label="Read answer aloud" aria-pressed="false"><i data-lucide="volume-2"></i></button>`
    : '';
  const primaryRoleAction = isAssistant
    ? `<button class="toolbar-btn regenerate-msg-btn" title="Regenerate response" aria-label="Regenerate response"><i data-lucide="rotate-cw"></i></button>`
    : `<button class="toolbar-btn edit-msg-btn" title="Edit message" aria-label="Edit message"><i data-lucide="pencil"></i></button>`;
  const overflowActions = isAssistant
    ? [
        makeMenuItem({ className: 'edit-msg-menu-item', icon: 'pencil', label: 'Edit message' }),
        makeMenuItem({ className: 'delete-msg-menu-item', icon: 'trash-2', label: 'Delete message', danger: true })
      ].join('')
    : [
        makeMenuItem({ className: 'regenerate-msg-menu-item', icon: 'rotate-cw', label: 'Regenerate response' }),
        makeMenuItem({ className: 'delete-msg-menu-item', icon: 'trash-2', label: 'Delete message', danger: true })
      ].join('');

  toolbar.innerHTML = `
    <button class="toolbar-btn copy-msg-btn" title="Copy text" aria-label="Copy message"><i data-lucide="copy"></i></button>
    ${readButton}
    ${primaryRoleAction}
    <button class="toolbar-btn message-more-btn" title="More actions" aria-label="More message actions" aria-haspopup="menu" aria-expanded="false"><i data-lucide="more-horizontal"></i></button>
    <div class="message-more-menu hidden" role="menu" aria-label="More message actions">${overflowActions}</div>`;
  row.appendChild(toolbar);

  const copyBtn = toolbar.querySelector('.copy-msg-btn');
  const moreBtn = toolbar.querySelector('.message-more-btn');
  const moreMenu = toolbar.querySelector('.message-more-menu');

  const handleDelete = () => {
    closeOverflowMenu();
    if (chatRef && onDeleteCallback) onDeleteCallback(chatRef, msgObj, row);
  };

  const handleEdit = () => {
    closeOverflowMenu();
    if (runtime.isGenerating || !chatRef || !onEditSaveCallback) return;
    const fresh = resolveFreshContext(chatRef, msgObj);
    if (!fresh.chat || !fresh.message) return;
    createEditControl(fresh.message, row, fresh.chat, callbacks, renderMessage);
  };

  const handleRegenerate = () => {
    closeOverflowMenu();
    if (runtime.isGenerating || !chatRef) return;
    onRegenerateCallback?.(chatRef, msgObj);
  };

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

  toolbar.querySelector('.edit-msg-btn')?.addEventListener('click', handleEdit);
  toolbar.querySelector('.regenerate-msg-btn')?.addEventListener('click', handleRegenerate);
  toolbar.querySelector('.edit-msg-menu-item')?.addEventListener('click', handleEdit);
  toolbar.querySelector('.regenerate-msg-menu-item')?.addEventListener('click', handleRegenerate);
  toolbar.querySelector('.delete-msg-menu-item')?.addEventListener('click', handleDelete);

  moreBtn.addEventListener('click', event => {
    event.stopPropagation();
    if (activeOverflowMenu?.menu === moreMenu) {
      closeOverflowMenu();
      return;
    }
    closeOverflowMenu();
    moreMenu.classList.remove('hidden');
    moreBtn.setAttribute('aria-expanded', 'true');
    activeOverflowMenu = { menu: moreMenu, button: moreBtn };
  });

  moreMenu.addEventListener('click', event => event.stopPropagation());
  moreMenu.addEventListener('keydown', event => {
    const items = [...moreMenu.querySelectorAll('.message-menu-item:not(:disabled)')];
    const index = items.indexOf(document.activeElement);
    let nextIndex = index;
    if (event.key === 'ArrowDown') nextIndex = Math.min(items.length - 1, index + 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(0, index - 1);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = items.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      closeOverflowMenu({ restoreFocus: true });
      return;
    } else return;
    event.preventDefault();
    items[Math.max(0, nextIndex)]?.focus();
  });

  moreBtn.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    moreBtn.click();
    moreMenu.querySelector('.message-menu-item:not(:disabled)')?.focus();
  });

  const readBtn = toolbar.querySelector('.read-msg-btn');
  if (readBtn) {
    readBtn.onclick = async () => {
      const fresh = resolveFreshContext(chatRef, msgObj);
      if (!fresh.chat || !fresh.message) return;
      await readAssistantMessage(fresh.chat.id, fresh.message.id, row);
    };
  }
}
