/**
 * message-navigation.js - Open a chat and focus one stable message target.
 */

import { loadChat } from './conversation.js';
import { pushChatMessageRoute, replaceChatMessageRoute } from '../router/chat-router.js';

let highlightTimer = null;

export function parseMessageFragment(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return '';
  const params = new URLSearchParams(raw);
  const value = params.get('message');
  if (!value || value.length > 512) return '';
  return value;
}

export function focusMessageTarget(messageId, { smooth = true } = {}) {
  if (!messageId) return false;
  const row = [...document.querySelectorAll('.message-row[data-message-id]')]
    .find(item => item.dataset.messageId === messageId);
  if (!row) return false;

  if (highlightTimer) window.clearTimeout(highlightTimer);
  document.querySelectorAll('.message-row.search-target-highlight').forEach(item => item.classList.remove('search-target-highlight'));
  row.scrollIntoView({ block: 'center', behavior: smooth ? 'smooth' : 'auto' });
  row.classList.add('search-target-highlight');
  highlightTimer = window.setTimeout(() => {
    row.classList.remove('search-target-highlight');
    highlightTimer = null;
  }, 1800);
  return true;
}

export async function openChatAtMessage(chatId, messageId, updateSidebarCallback = null, options = {}) {
  const historyMode = options.historyMode === 'replace' ? 'replace' : 'push';
  const chat = await loadChat(chatId, updateSidebarCallback, { historyMode: 'none' });
  if (!chat) return null;
  if (historyMode === 'replace') replaceChatMessageRoute(chatId, messageId);
  else pushChatMessageRoute(chatId, messageId);
  requestAnimationFrame(() => focusMessageTarget(messageId));
  return chat;
}