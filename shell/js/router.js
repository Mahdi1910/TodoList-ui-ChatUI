const TODO_PATH = '/todo-list-ui';
const CHAT_HOME_PATH = '/chat-ui';
const CHAT_PREFIX = '/chat-ui/chat/';
const LAST_CHAT_KEY = 'mahdi-shell:last-chat-route';

function cleanPath(pathname) {
  const path = pathname || '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

export function buildChatPublicPath(chatId) {
  return chatId ? `${CHAT_PREFIX}${encodeURIComponent(chatId)}` : CHAT_HOME_PATH;
}

export function parseShellRoute(pathname = window.location.pathname) {
  const path = cleanPath(pathname);
  if (path === '/' || path === '') return { app: 'todo', path: TODO_PATH, chatId: null, needsReplace: true };
  if (path === TODO_PATH) return { app: 'todo', path: TODO_PATH, chatId: null, needsReplace: false };
  if (path === CHAT_HOME_PATH) return { app: 'chat', path: CHAT_HOME_PATH, chatId: null, needsReplace: false };
  if (path.startsWith(CHAT_PREFIX)) {
    const encoded = path.slice(CHAT_PREFIX.length);
    if (encoded && !encoded.includes('/')) {
      try {
        const chatId = decodeURIComponent(encoded);
        if (chatId) return { app: 'chat', path: buildChatPublicPath(chatId), chatId, needsReplace: false };
      } catch (_) {}
    }
  }
  return { app: 'todo', path: TODO_PATH, chatId: null, needsReplace: true };
}

function readStoredChatPath() {
  try {
    const stored = localStorage.getItem(LAST_CHAT_KEY);
    if (!stored) return null;
    const route = parseShellRoute(stored);
    return route.app === 'chat' && !route.needsReplace ? route.path : null;
  } catch (_) {
    return null;
  }
}

function persistLastChatPath(path) {
  try { localStorage.setItem(LAST_CHAT_KEY, path); }
  catch (_) {}
}

export function createShellRouter(onRoute) {
  let currentRoute = parseShellRoute(window.location.pathname);
  let lastChatPath = readStoredChatPath();

  function rememberRouteIfChat(route) {
    if (route?.app !== 'chat') return;
    lastChatPath = route.path;
    persistLastChatPath(lastChatPath);
  }

  function emit(route, source) {
    currentRoute = route;
    rememberRouteIfChat(route);
    onRoute?.(route, { source });
  }

  function write(path, { replace = false, source = 'shell' } = {}) {
    const route = parseShellRoute(path);
    const method = replace ? 'replaceState' : 'pushState';
    const currentPath = window.location.pathname;
    if (currentPath !== route.path) window.history[method]({ shellRoute: route.path }, '', route.path);
    emit(route, source);
    return route;
  }

  function start() {
    const route = parseShellRoute(window.location.pathname);
    if (route.needsReplace || window.location.pathname !== route.path) {
      window.history.replaceState({ shellRoute: route.path }, '', route.path);
    }
    emit({ ...route, needsReplace: false }, 'startup');
  }

  function goTodo() {
    return write(TODO_PATH, { source: 'rail' });
  }

  function goChat() {
    return write(lastChatPath || CHAT_HOME_PATH, { source: 'rail' });
  }

  function handleChatChildRoute(chatId, historyMode = 'push') {
    const path = buildChatPublicPath(chatId || null);
    lastChatPath = path;
    persistLastChatPath(path);

    if (currentRoute.app !== 'chat') return parseShellRoute(path);
    if (currentRoute.path === path) return currentRoute;

    const replace = historyMode === 'replace';
    const route = parseShellRoute(path);
    window.history[replace ? 'replaceState' : 'pushState']({ shellRoute: path }, '', path);
    emit(route, 'child');
    return route;
  }

  function rememberChatFromReady(chatId) {
    if (lastChatPath) return lastChatPath;
    lastChatPath = buildChatPublicPath(chatId || null);
    persistLastChatPath(lastChatPath);
    return lastChatPath;
  }

  function getLastChatRoute() {
    return parseShellRoute(lastChatPath || CHAT_HOME_PATH);
  }

  window.addEventListener('popstate', () => {
    const route = parseShellRoute(window.location.pathname);
    if (route.needsReplace) {
      window.history.replaceState({ shellRoute: route.path }, '', route.path);
    }
    emit({ ...route, needsReplace: false }, 'popstate');
  });

  return {
    start,
    goTodo,
    goChat,
    handleChatChildRoute,
    rememberChatFromReady,
    getLastChatRoute,
    getCurrentRoute: () => currentRoute
  };
}
