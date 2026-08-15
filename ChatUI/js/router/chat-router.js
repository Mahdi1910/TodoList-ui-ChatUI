/**
 * chat-router.js - Framework-free URL routing for persisted ChatUI conversations.
 */

const CHAT_ROUTE_PREFIX = '/chat/';

export function parseChatRoute(pathname = window.location.pathname) {
  const path = pathname || '/';
  if (path === '/' || path === '') return { type: 'home', chatId: null };
  if (!path.startsWith(CHAT_ROUTE_PREFIX)) return { type: 'unknown', chatId: null };

  const encodedId = path.slice(CHAT_ROUTE_PREFIX.length);
  if (!encodedId || encodedId.includes('/')) return { type: 'unknown', chatId: null };

  try {
    const chatId = decodeURIComponent(encodedId);
    return chatId ? { type: 'chat', chatId } : { type: 'unknown', chatId: null };
  } catch (error) {
    return { type: 'unknown', chatId: null };
  }
}

export function buildChatPath(chatId) {
  if (!chatId) return '/';
  return `${CHAT_ROUTE_PREFIX}${encodeURIComponent(chatId)}`;
}

function writeRoute(method, path, state = {}) {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === path) return;
  window.history[method]({ ...state }, '', path);
}

export function pushChatRoute(chatId) {
  writeRoute('pushState', buildChatPath(chatId), { chatId });
}

export function replaceChatRoute(chatId) {
  writeRoute('replaceState', buildChatPath(chatId), { chatId });
}

export function pushHomeRoute() {
  writeRoute('pushState', '/', { chatId: null });
}

export function replaceHomeRoute() {
  writeRoute('replaceState', '/', { chatId: null });
}

export function initChatRouter(onRouteChange) {
  if (typeof onRouteChange !== 'function') return () => {};
  const handlePopState = () => onRouteChange(parseChatRoute());
  window.addEventListener('popstate', handlePopState);
  return () => window.removeEventListener('popstate', handlePopState);
}
