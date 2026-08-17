/**
 * search.js — Debounced contextual chat search with grouped message excerpts.
 */

import { state } from '../state/store.js';
import { loadChat } from '../chat/chat.js';
import { openChatAtMessage } from '../chat/message-navigation.js';
import { searchConversationMatches } from '../storage/search.js';
import { buildChatHref, buildMessageHref, isUnmodifiedPrimaryNavigation } from '../router/app-links.js';

const SEARCH_DEBOUNCE_MS = 200;
let searchTimer = null;
let searchSequence = 0;
let activeSearchController = null;

function closeSearchModal(searchModal) {
  searchSequence += 1;
  window.clearTimeout(searchTimer);
  activeSearchController?.abort();
  activeSearchController = null;
  searchModal?.classList.add('hidden');
}

function appendHighlightedText(container, text, ranges = []) {
  const safeText = String(text || '');
  const ordered = [...ranges]
    .filter(range => Number.isInteger(range.start) && Number.isInteger(range.end) && range.end > range.start)
    .sort((a, b) => a.start - b.start);
  let cursor = 0;
  for (const range of ordered) {
    const start = Math.max(cursor, Math.min(safeText.length, range.start));
    const end = Math.max(start, Math.min(safeText.length, range.end));
    if (start > cursor) container.appendChild(document.createTextNode(safeText.slice(cursor, start)));
    if (end > start) {
      const mark = document.createElement('mark');
      mark.textContent = safeText.slice(start, end);
      container.appendChild(mark);
    }
    cursor = end;
  }
  if (cursor < safeText.length) container.appendChild(document.createTextNode(safeText.slice(cursor)));
}

function titleRanges(title, query) {
  if (!query) return [];
  const lower = String(title || '').toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  const index = lower.indexOf(needle);
  return index === -1 ? [] : [{ start: index, end: index + query.length }];
}

function titleRank(title, query) {
  if (!query) return 4;
  const value = String(title || '').toLocaleLowerCase();
  const needle = query.toLocaleLowerCase();
  if (value === needle) return 0;
  if (value.startsWith(needle)) return 1;
  if (value.includes(needle)) return 2;
  return 3;
}

function roleLabel(role) {
  return role === 'assistant' ? 'Assistant' : 'You';
}

function createExcerptLink(chat, excerpt, query, searchModal, updateSidebarCallback) {
  const link = document.createElement('a');
  link.className = 'search-message-hit';
  link.href = buildMessageHref(chat.id, excerpt.messageId);
  const role = document.createElement('span');
  role.className = 'search-message-role';
  role.textContent = roleLabel(excerpt.role);
  const text = document.createElement('span');
  text.className = 'search-message-excerpt';
  appendHighlightedText(text, excerpt.text, excerpt.matchRanges || []);
  link.append(role, text);
  link.addEventListener('click', event => {
    if (!isUnmodifiedPrimaryNavigation(event)) return;
    event.preventDefault();
    closeSearchModal(searchModal);
    void openChatAtMessage(chat.id, excerpt.messageId, updateSidebarCallback, { historyMode: 'push' });
  });
  return link;
}

function createGroup(chat, group, query, searchModal, updateSidebarCallback, index) {
  const wrapper = document.createElement('section');
  wrapper.className = 'search-result-group';

  const header = document.createElement('div');
  header.className = 'search-result-group-header';
  const panelId = `search-result-panel-${index}`;
  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'search-result-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', panelId);

  const chevron = document.createElement('i');
  chevron.setAttribute('data-lucide', 'chevron-right');
  const title = document.createElement('span');
  title.className = 'search-result-title';
  appendHighlightedText(title, chat.title || 'Untitled chat', titleRanges(chat.title, query));
  const count = document.createElement('span');
  count.className = 'search-result-count';
  const messageCount = group?.messageMatchCount || 0;
  count.textContent = messageCount > 0 ? `${messageCount} match${messageCount === 1 ? '' : 'es'}` : 'Title match';
  toggle.append(chevron, title, count);

  const open = document.createElement('a');
  open.className = 'search-result-open';
  open.href = buildChatHref(chat.id);
  open.textContent = 'Open';
  open.addEventListener('click', event => {
    if (!isUnmodifiedPrimaryNavigation(event)) return;
    event.preventDefault();
    closeSearchModal(searchModal);
    void loadChat(chat.id, updateSidebarCallback, { historyMode: 'push' });
  });
  header.append(toggle, open);

  const panel = document.createElement('div');
  panel.id = panelId;
  panel.className = 'search-result-panel hidden';
  if (group?.excerpts?.length) {
    group.excerpts.forEach(excerpt => panel.appendChild(createExcerptLink(chat, excerpt, query, searchModal, updateSidebarCallback)));
    if (group.truncated) {
      const note = document.createElement('div');
      note.className = 'search-result-truncated';
      note.textContent = 'More matching messages exist in this chat.';
      panel.appendChild(note);
    }
  } else {
    const note = document.createElement('div');
    note.className = 'search-title-only';
    note.textContent = 'The chat title matches your search.';
    panel.appendChild(note);
  }

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    panel.classList.toggle('hidden', expanded);
    chevron.setAttribute('data-lucide', expanded ? 'chevron-right' : 'chevron-down');
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  });

  wrapper.append(header, panel);
  return wrapper;
}

function combineMatches(query, contentResult) {
  const byChatId = new Map((contentResult?.chats || []).map(group => [group.chatId, group]));
  return state.chats
    .filter(chat => {
      if (!query) return true;
      return String(chat.title || '').toLocaleLowerCase().includes(query.toLocaleLowerCase()) || byChatId.has(chat.id);
    })
    .map(chat => ({ chat, group: byChatId.get(chat.id) || null, rank: titleRank(chat.title, query) }))
    .sort((a, b) => {
      if (a.rank !== b.rank) return a.rank - b.rank;
      const countDiff = (b.group?.messageMatchCount || 0) - (a.group?.messageMatchCount || 0);
      if (countDiff !== 0) return countDiff;
      return (b.chat.updatedAt || 0) - (a.chat.updatedAt || 0);
    })
    .slice(0, 50);
}

async function renderSearchResults(query, list, modal, updateSidebarCallback, requestedSequence) {
  if (!list) return;
  activeSearchController?.abort();
  activeSearchController = new AbortController();
  const controller = activeSearchController;

  let contentResult = { chats: [], totalMatchingMessages: 0, truncated: false };
  if (query) {
    list.innerHTML = '<div class="search-no-results">Searching conversations…</div>';
    try {
      contentResult = await searchConversationMatches(query, { signal: controller.signal });
    } catch (error) {
      if (error?.name !== 'AbortError') console.error('Message-text search failed:', error);
      if (error?.name === 'AbortError') return;
    }
  }

  if (requestedSequence !== searchSequence || modal.classList.contains('hidden')) return;
  const combined = combineMatches(query, contentResult);
  list.replaceChildren();
  if (!combined.length) {
    list.innerHTML = '<div class="search-no-results">No matching conversations found</div>';
    return;
  }

  const summary = document.createElement('div');
  summary.className = 'search-results-summary';
  summary.textContent = query
    ? `${combined.length} chat${combined.length === 1 ? '' : 's'} · ${contentResult.totalMatchingMessages} matching message${contentResult.totalMatchingMessages === 1 ? '' : 's'}${contentResult.truncated ? ' · limited results' : ''}`
    : `${combined.length} recent chat${combined.length === 1 ? '' : 's'}`;
  list.appendChild(summary);

  combined.forEach(({ chat, group }, index) => {
    list.appendChild(createGroup(chat, group, query, modal, updateSidebarCallback, index));
  });
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

export function initSearchUI(updateSidebarCallback = null) {
  const openSearchBtn = document.getElementById('open-search-btn');
  const searchModal = document.getElementById('search-modal');
  const closeSearchModalBtn = document.getElementById('close-search-modal-btn');
  const searchModalInput = document.getElementById('search-modal-input');
  const searchResultsList = document.getElementById('search-results-list');
  if (!searchModal) return;

  openSearchBtn?.addEventListener('click', () => {
    searchModal.classList.remove('hidden');
    if (searchModalInput) {
      searchModalInput.value = '';
      searchModalInput.focus();
    }
    const requestedSequence = ++searchSequence;
    void renderSearchResults('', searchResultsList, searchModal, updateSidebarCallback, requestedSequence);
  });

  closeSearchModalBtn?.addEventListener('click', () => closeSearchModal(searchModal));
  searchModal.addEventListener('click', event => {
    if (event.target === searchModal) closeSearchModal(searchModal);
  });

  if (searchModalInput && searchResultsList) {
    searchModalInput.addEventListener('input', event => {
      const query = event.target.value.trim();
      window.clearTimeout(searchTimer);
      activeSearchController?.abort();
      const requestedSequence = ++searchSequence;
      searchTimer = window.setTimeout(() => {
        void renderSearchResults(query, searchResultsList, searchModal, updateSidebarCallback, requestedSequence);
      }, SEARCH_DEBOUNCE_MS);
    });
  }
}