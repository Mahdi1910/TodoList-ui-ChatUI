const TODO_PATH = '/todo-list-ui';
const CHAT_PATH = '/chat-ui';
const CHAT_ROUTE_PREFIX = `${CHAT_PATH}/chat/`;

function safeDecode(value) {
  try { return decodeURIComponent(value); }
  catch (_) { return ''; }
}

export function buildTodoPath() {
  return TODO_PATH;
}

export function buildChatHomePath() {
  return CHAT_PATH;
}

export function buildChatPath(chatId) {
  if (!chatId) return CHAT_PATH;
  return `${CHAT_ROUTE_PREFIX}${encodeURIComponent(String(chatId))}`;
}

export function routeToPath(route) {
  if (!route || route.app === 'unknown') return TODO_PATH;
  if (route.app === 'todo') return TODO_PATH;
  if (route.app === 'chat' && route.type === 'chat') return buildChatPath(route.chatId);
  if (route.app === 'chat') return CHAT_PATH;
  return TODO_PATH;
}

export function parseShellRoute(pathname = window.location.pathname) {
  const path = String(pathname || '/').replace(/\/+$/, '') || '/';

  if (path === '/') {
    return { app: 'todo', type: 'root', canonicalPath: TODO_PATH };
  }
  if (path === TODO_PATH) {
    return { app: 'todo', type: 'todo-home', canonicalPath: TODO_PATH };
  }
  if (path === CHAT_PATH) {
    return { app: 'chat', type: 'chat-home', chatId: null, canonicalPath: CHAT_PATH };
  }
  if (path.startsWith(CHAT_ROUTE_PREFIX)) {
    const encodedId = path.slice(CHAT_ROUTE_PREFIX.length);
    if (!encodedId || encodedId.includes('/')) {
      return { app: 'unknown', type: 'unknown', canonicalPath: TODO_PATH, rejectedPath: path };
    }
    const chatId = safeDecode(encodedId);
    if (!chatId) {
      return { app: 'unknown', type: 'unknown', canonicalPath: TODO_PATH, rejectedPath: path };
    }
    return { app: 'chat', type: 'chat', chatId, canonicalPath: buildChatPath(chatId) };
  }

  // Temporary compatibility for links created by the standalone ChatUI before
  // the combined shell existed. The shell canonicalizes these immediately.
  if (path === '/chat') {
    return { app: 'chat', type: 'chat-home', chatId: null, canonicalPath: CHAT_PATH, legacy: true };
  }
  if (path.startsWith('/chat/')) {
    const encodedId = path.slice('/chat/'.length);
    if (encodedId && !encodedId.includes('/')) {
      const chatId = safeDecode(encodedId);
      if (chatId) return { app: 'chat', type: 'chat', chatId, canonicalPath: buildChatPath(chatId), legacy: true };
    }
  }

  return { app: 'unknown', type: 'unknown', canonicalPath: TODO_PATH, rejectedPath: path };
}

export function isSameApplication(a, b) {
  return Boolean(a && b && a.app === b.app && a.app !== 'unknown');
}
