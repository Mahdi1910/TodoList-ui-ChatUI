/**
 * chat-controls.js — Right sidebar and active-chat header actions.
 */

import { state } from '../state/store.js';
import { clearActiveChatMessages, exportActiveChat, deleteChat, renameChat } from '../chat/conversation.js';
import { openActionMenu, closeActionMenu, isActionMenuOpen } from './action-menu.js';
import { captureSelectedReadText, getSelectedReadText } from '../voice/read-selection.js';
import { readSelectedText } from '../voice/read-aloud.js';

export function initRightSidebarUI(updateSidebarCallback = null) {
  const toggleBtn = document.getElementById('toggle-right-sidebar-btn');
  const rightSidebar = document.getElementById('right-sidebar');
  const closeBtn = document.getElementById('close-right-sidebar-btn');
  const appContainer = document.querySelector('.app-container');
  const optionsBtn = document.getElementById('chat-options-header-btn');

  const clearBtn = document.getElementById('right-sidebar-clear-chat-btn');
  const exportBtn = document.getElementById('right-sidebar-export-chat-btn');
  const deleteBtn = document.getElementById('right-sidebar-delete-chat-btn');

  if (!rightSidebar) return;

  let closeSequence = 0;
  let clearCloseTransition = null;

  const cancelCloseTransition = () => {
    if (!clearCloseTransition) return;
    clearCloseTransition();
    clearCloseTransition = null;
  };

  const finalizeClosedState = sequence => {
    if (sequence !== closeSequence || !rightSidebar.classList.contains('collapsed')) return;
    cancelCloseTransition();
    appContainer?.classList.remove('right-sidebar-open');

    requestAnimationFrame(() => {
      toggleBtn?.focus({ preventScroll: true });
      rightSidebar.setAttribute('inert', '');
      rightSidebar.setAttribute('aria-hidden', 'true');
    });
  };

  const waitForCloseTransition = sequence => {
    const finish = event => {
      if (event.target !== rightSidebar) return;
      if (event.type === 'transitionend' && event.propertyName !== 'transform') return;
      finalizeClosedState(sequence);
    };

    rightSidebar.addEventListener('transitionend', finish);
    rightSidebar.addEventListener('transitioncancel', finish);
    const fallbackId = window.setTimeout(() => finalizeClosedState(sequence), 400);
    clearCloseTransition = () => {
      window.clearTimeout(fallbackId);
      rightSidebar.removeEventListener('transitionend', finish);
      rightSidebar.removeEventListener('transitioncancel', finish);
    };
  };

  const closeRightSidebar = () => {
    if (rightSidebar.classList.contains('collapsed')) return;
    closeSequence += 1;
    const sequence = closeSequence;
    cancelCloseTransition();
    rightSidebar.classList.add('collapsed');
    toggleBtn?.setAttribute('aria-expanded', 'false');
    toggleBtn?.classList.remove('active');
    waitForCloseTransition(sequence);
  };

  const openRightSidebar = () => {
    if (!rightSidebar.classList.contains('collapsed')) {
      closeBtn?.focus({ preventScroll: true });
      return;
    }

    closeSequence += 1;
    cancelCloseTransition();
    closeActionMenu();
    rightSidebar.removeAttribute('inert');
    rightSidebar.setAttribute('aria-hidden', 'false');
    appContainer?.classList.add('right-sidebar-open');
    rightSidebar.classList.remove('collapsed');
    toggleBtn?.setAttribute('aria-expanded', 'true');
    toggleBtn?.classList.add('active');
    closeBtn?.focus({ preventScroll: true });
  };

  const toggleRightSidebar = event => {
    event?.stopPropagation();
    if (rightSidebar.classList.contains('collapsed')) openRightSidebar();
    else closeRightSidebar();
  };

  toggleBtn?.addEventListener('click', toggleRightSidebar);
  closeBtn?.addEventListener('click', closeRightSidebar);

  document.addEventListener('click', event => {
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    if (rightSidebar.classList.contains('collapsed')) return;
    if (rightSidebar.contains(event.target) || toggleBtn?.contains(event.target)) return;
    closeRightSidebar();
  });

  const currentChat = () => state.chats.find(chat => chat.id === state.activeChatId) || null;
  const handleClear = () => clearActiveChatMessages(updateSidebarCallback);
  const handleExport = () => exportActiveChat();
  const handleRename = () => {
    const chat = currentChat();
    if (chat) renameChat(chat);
  };
  const handleDelete = () => {
    const chat = currentChat();
    if (!chat) {
      alert('No active chat to delete.');
      return;
    }
    if (confirm('Are you sure you want to delete this chat?')) {
      deleteChat(chat.id, updateSidebarCallback);
      closeRightSidebar();
    }
  };

  optionsBtn?.addEventListener('pointerdown', () => captureSelectedReadText());
  optionsBtn?.addEventListener('click', event => {
    event.stopPropagation();
    captureSelectedReadText();
    const chat = currentChat();
    const selectedText = getSelectedReadText();
    const items = [];

    if (window.matchMedia('(max-width: 767px)').matches) {
      items.push(
        { label: 'Controls', icon: 'panel-right', onSelect: openRightSidebar },
        { type: 'separator' }
      );
    }

    items.push(
      { label: 'Rename Chat', icon: 'pencil', disabled: !chat, onSelect: handleRename },
      { label: 'Export Chat', icon: 'download', disabled: !chat, onSelect: handleExport },
      { label: 'Clear Messages', icon: 'eraser', disabled: !chat, onSelect: handleClear },
      {
        label: 'Read Selected Text', icon: 'volume-2',
        disabled: !selectedText,
        disabledReason: 'Select text from the conversation first.',
        onSelect: () => readSelectedText(selectedText)
      },
      { label: 'Delete Chat', icon: 'trash-2', danger: true, disabled: !chat, onSelect: handleDelete }
    );

    openActionMenu(optionsBtn, items);
  });

  clearBtn?.addEventListener('click', handleClear);
  exportBtn?.addEventListener('click', handleExport);
  deleteBtn?.addEventListener('click', handleDelete);

  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape' || isActionMenuOpen()) return;
    if (!rightSidebar.classList.contains('collapsed')) closeRightSidebar();
  });
}
