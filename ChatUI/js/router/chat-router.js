/**
 * chat-router.js - Framework-free, base-path-aware ChatUI route helpers.
 */

let activeBasePath = '/chat-ui';
let navigationAdapter = null;
let titleAdapter = null;
let ownsHistory = true;

function normalizeBasePath(value) {
  let base = String(value || '/chat-ui').trim() || '/chat-ui';
  if (!base.startsWith('/')) base = `/${base}`;
  base = base.replace(/\/+$/, '');
  return base || '/';
}

export function configureChatRouter({ basePath = '/chat-ui', navigate = null, setTitle = null, ownHistory = true } = {}) {
  activeBasePath = normalizeBasePath(basePath);
  navigationAdapter = typeof navigate === 'function' ? navigate : null;
  titleAdapter = typeof setTitle === 'function' ? setTitle : null;
  ownsHistory = Boolean(ownHistory);
}

export function resetChatRouterConfiguration() {
  activeBasePath = '/chat-ui';
  navigationAdapter = null;
  titleAdapter = null;
  ownsHistory = true;
}

export function getChatBasePath() {
  return activeBasePath;
}

export function parseChatRoute(pathname = window.location.pathname, basePath = activeBasePath) {
  const base = normalizeBasePath(basePath);
  const path = String(pathname || base).replace(/\/+$/, '') || '/';
  if (path === base) return { type: 'home', chatId: null };

  const prefix = `${base}/chat/`;
  if (!path.startsWith(prefix)) return { type: 'unknown', chatId: null };
  const encodedId = path.slice(prefix.length);
  if (!encodedId || encodedId.includes('/')) return { type: 'unknown', chatId: null };

  try {
    const chatId = decodeURIComponent(encodedId);
    return chatId ? { type: 'chat', chatId } : { type: 'unknown', chatId: null };
  } catch (_) {
    return { type: 'unknown', chatId: null };
  }
}

export function buildChatPath(chatId, basePath = activeBasePath) {
  const base = normalizeBasePath(basePath);
  if (!chatId) return base;
  return `${base}/chat/${encodeURIComponent(String(chatId))}`;
}

function writeRoute(method, path, state = {}) {
  if (navigationAdapter) {
    void navigationAdapter(path, {
      replace: method === 'replaceState',
      handledByModule: true,
      source: 'chat-route',
      state
    });
    return;
  }
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
  writeRoute('pushState', buildChatPath(null), { chatId: null });
}

export function replaceHomeRoute() {
  writeRoute('replaceState', buildChatPath(null), { chatId: null });
}

export function setChatDocumentTitle(title) {
  const value = String(title || 'ChatUI');
  if (titleAdapter) titleAdapter(value);
  else document.title = value;
}

export function initChatRouter(onRouteChange) {
  if (!ownsHistory || typeof onRouteChange !== 'function') return () => {};
  const handlePopState = () => onRouteChange(parseChatRoute());
  window.addEventListener('popstate', handlePopState);
  return () => window.removeEventListener('popstate', handlePopState);
}
