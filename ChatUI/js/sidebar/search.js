/**
 * search.js — Debounced title and IndexedDB message-text search.
 */

import { state } from '../state/store.js';
import { loadChat } from '../chat/chat.js';
import { searchMessageChatIds } from '../storage/storage.js';
import { escapeHtml } from '../utils/dom.js';

const SEARCH_DEBOUNCE_MS = 200;
let searchTimer = null;
let searchSequence = 0;

export function initSearchUI(updateSidebarCallback = null) {
  const openSearchBtn = document.getElementById('open-search-btn');
  const searchModal = document.getElementById('search-modal');
  const closeSearchModalBtn = document.getElementById('close-search-modal-btn');
  const searchModalInput = document.getElementById('search-modal-input');
  const searchResultsList = document.getElementById('search-results-list');

  if (!searchModal) return;

  if (openSearchBtn) {
    openSearchBtn.addEventListener('click', () => {
      searchModal.classList.remove('hidden');
      if (searchModalInput) {
        searchModalInput.value = '';
        searchModalInput.focus();
      }
      void renderSearchResults('', searchResultsList, searchModal, updateSidebarCallback);
    });
  }

  if (closeSearchModalBtn) {
    closeSearchModalBtn.addEventListener('click', () => {
      searchSequence += 1;
      window.clearTimeout(searchTimer);
      searchModal.classList.add('hidden');
    });
  }

  if (searchModalInput && searchResultsList) {
    searchModalInput.addEventListener('input', event => {
      const query = event.target.value.trim().toLowerCase();
      window.clearTimeout(searchTimer);
      const requestedSequence = ++searchSequence;
      searchTimer = window.setTimeout(() => {
        void renderSearchResults(query, searchResultsList, searchModal, updateSidebarCallback, requestedSequence);
      }, SEARCH_DEBOUNCE_MS);
    });
  }
}

function getChatMessageLabel(chat, messageMatchCount = 0) {
  if (chat.messagesLoaded === true) {
    const count = chat.messages.length;
    return `${count} message${count === 1 ? '' : 's'}`;
  }
  if (Number.isSafeInteger(Number(chat.messageCount)) && Number(chat.messageCount) >= 0) {
    const count = Number(chat.messageCount);
    return `${count} message${count === 1 ? '' : 's'}`;
  }
  if (messageMatchCount > 0) {
    return `${messageMatchCount} matching message${messageMatchCount === 1 ? '' : 's'}`;
  }
  return 'Messages not loaded';
}

async function renderSearchResults(query, searchResultsList, searchModal, updateSidebarCallback, requestedSequence = ++searchSequence) {
  if (!searchResultsList) return;

  let messageChatIds = new Set();
  let matchCounts = {};

  if (query) {
    searchResultsList.innerHTML = '<div class="search-no-results">Searching conversations…</div>';
    try {
      const result = await searchMessageChatIds(query);
      if (requestedSequence !== searchSequence || searchModal.classList.contains('hidden')) return;
      messageChatIds = new Set(result.chatIds || []);
      matchCounts = result.matchCounts || {};
    } catch (error) {
      if (requestedSequence !== searchSequence) return;
      console.error('Message-text search failed:', error);
    }
  }

  if (requestedSequence !== searchSequence) return;
  searchResultsList.innerHTML = '';

  const matchedChats = state.chats.filter(chat => {
    if (!query) return true;
    const titleMatch = String(chat.title || '').toLowerCase().includes(query);
    return titleMatch || messageChatIds.has(chat.id);
  });

  if (matchedChats.length === 0) {
    searchResultsList.innerHTML = '<div class="search-no-results">No matching conversations found</div>';
    return;
  }

  matchedChats.forEach(chat => {
    const item = document.createElement('div');
    item.className = 'search-result-item';

    item.innerHTML = `
      <i data-lucide="message-square" class="search-result-icon"></i>
      <div class="search-result-content">
        <div class="search-result-title">${escapeHtml(chat.title)}</div>
        <div class="search-result-count">${escapeHtml(getChatMessageLabel(chat, matchCounts[chat.id] || 0))}</div>
      </div>
    `;

    item.onclick = () => {
      searchSequence += 1;
      searchModal.classList.add('hidden');
      void loadChat(chat.id, updateSidebarCallback, { historyMode: 'push' });
    };

    searchResultsList.appendChild(item);
  });

  if (typeof lucide !== 'undefined' && lucide.createIcons) {
    lucide.createIcons();
  }
}
