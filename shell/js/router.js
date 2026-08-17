const TODO_PATH = '/todo-list-ui';
const CHAT_HOME_PATH = '/chat-ui';
const CHAT_PREFIX = '/chat-ui/chat/';
const WORKSPACE_ROOT_PATH = '/workspace';
const LAST_CHAT_KEY = 'mahdi-shell:last-chat-route';

function cleanPath(pathname) {
  const path = pathname || '/';
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path;
}

function parseMessageId(hash = '') {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  try {
    const value = new URLSearchParams(raw).get('message');
    return value && value.length <= 512 ? value : null;
  } catch (_) {
    return null;
  }
}

function decodeWorkspacePublicPath(path) {
  if (path === WORKSPACE_ROOT_PATH) return { workspacePath: '/', invalid: false };
  if (!path.startsWith(`${WORKSPACE_ROOT_PATH}/`)) return null;
  const encodedSegments = path.slice(WORKSPACE_ROOT_PATH.length + 1).split('/');
  if (encodedSegments.some(segment => !segment)) return { workspacePath: null, invalid: true };
  try {
    const segments = encodedSegments.map(segment => decodeURIComponent(segment));
    if (segments.some(segment => !segment || segment.includes('/'))) return { workspacePath: null, invalid: true };
    return { workspacePath: `/${segments.join('/')}`, invalid: false };
  } catch (_) {
    return { workspacePath: null, invalid: true };
  }
}

export function buildChatPublicPath(chatId, messageId = null) {
  const base = chatId ? `${CHAT_PREFIX}${encodeURIComponent(chatId)}` : CHAT_HOME_PATH;
  return chatId && messageId ? `${base}#message=${encodeURIComponent(messageId)}` : base;
}

export function buildWorkspacePublicPath(workspacePath = '/') {
  const raw = String(workspacePath || '/').trim();
  if (!raw || raw === '/') return WORKSPACE_ROOT_PATH;
  const segments = raw.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  return `${WORKSPACE_ROOT_PATH}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
}

export function parseShellRoute(pathname = window.location.pathname, hash = window.location.hash) {
  const path = cleanPath(pathname);
  if (path === '/' || path === '') {
    return { app: 'todo', surface: 'todo', path: TODO_PATH, chatId: null, messageId: null, workspacePath: null, needsReplace: true };
  }
  if (path === TODO_PATH) {
    return { app: 'todo', surface: 'todo', path: TODO_PATH, chatId: null, messageId: null, workspacePath: null, needsReplace: false };
  }
  if (path === CHAT_HOME_PATH) {
    return { app: 'chat', surface: 'chat', path: CHAT_HOME_PATH, chatId: null, messageId: null, workspacePath: null, needsReplace: false };
  }
  if (path.startsWith(CHAT_PREFIX)) {
    const encoded = path.slice(CHAT_PREFIX.length);
    if (encoded && !encoded.includes('/')) {
      try {
        const chatId = decodeURIComponent(encoded);
        if (chatId) {
          const messageId = parseMessageId(hash);
          const canonicalPath = buildChatPublicPath(chatId);
          return { app: 'chat', surface: 'chat', path: canonicalPath, chatId, messageId, workspacePath: null, needsReplace: canonicalPath !== path };
        }
      } catch (_) {}
    }
  }

  const workspace = decodeWorkspacePublicPath(path);
  if (workspace) {
    const canonical = workspace.invalid ? path : buildWorkspacePublicPath(workspace.workspacePath);
    return {
      app: 'chat',
      surface: 'workspace',
      path: canonical,
      chatId: null,
      messageId: null,
      workspacePath: workspace.workspacePath,
      invalidWorkspacePath: workspace.invalid,
      needsReplace: !workspace.invalid && canonical !== path
    };
  }

  return { app: 'todo', surface: 'todo', path: TODO_PATH, chatId: null, messageId: null, workspacePath: null, needsReplace: true };
}

function routeUrl(route) {
  if (route?.surface === 'chat' && route.chatId && route.messageId) return buildChatPublicPath(route.chatId, route.messageId);
  return route?.path || TODO_PATH;
}

function readStoredChatPath() {
  try {
    const stored = localStorage.getItem(LAST_CHAT_KEY);
    if (!stored) return null;
    const route = parseShellRoute(stored, '');
    return route.app === 'chat' && route.surface === 'chat' && !route.needsReplace ? route.path : null;
  } catch (_) {
    return null;
  }
}

function persistLastChatPath(path) {
  try { localStorage.setItem(LAST_CHAT_KEY, path); }
  catch (_) {}
}

export function createShellRouter(onRoute) {
  let currentRoute = parseShellRoute();
  let lastChatPath = readStoredChatPath();

  function rememberRouteIfConversation(route) {
    if (route?.app !== 'chat' || route.surface !== 'chat') return;
    lastChatPath = route.path;
    persistLastChatPath(lastChatPath);
  }

  function emit(route, source) {
    currentRoute = route;
    rememberRouteIfConversation(route);
    onRoute?.(route, { source });
  }

  function write(path, { replace = false, source = 'shell' } = {}) {
    const url = new URL(path, window.location.origin);
    const route = parseShellRoute(url.pathname, url.hash);
    const method = replace ? 'replaceState' : 'pushState';
    if (`${window.location.pathname}${window.location.hash}` !== routeUrl(route)) {
      window.history[method]({ shellRoute: route.path }, '', routeUrl(route));
    }
    emit(route, source);
    return route;
  }

  function start() {
    const route = parseShellRoute();
    if (route.needsReplace || `${window.location.pathname}${window.location.hash}` !== routeUrl(route)) {
      window.history.replaceState({ shellRoute: route.path }, '', routeUrl(route));
    }
    emit({ ...route, needsReplace: false }, 'startup');
  }

  function goTodo() { return write(TODO_PATH, { source: 'rail' }); }
  function goChat() { return write(lastChatPath || CHAT_HOME_PATH, { source: 'rail' }); }

  function handleChatChildRoute(payload = {}) {
    const surface = payload.surface === 'workspace' ? 'workspace' : 'chat';
    const historyMode = payload.historyMode === 'replace' ? 'replace' : 'push';
    const url = surface === 'workspace'
      ? buildWorkspacePublicPath(payload.workspacePath || '/')
      : buildChatPublicPath(typeof payload.chatId === 'string' && payload.chatId ? payload.chatId : null, payload.messageId || null);

    const parsedUrl = new URL(url, window.location.origin);
    const route = parseShellRoute(parsedUrl.pathname, parsedUrl.hash);
    if (surface === 'chat') {
      lastChatPath = route.path;
      persistLastChatPath(lastChatPath);
    }

    if (currentRoute.app !== 'chat') return route;
    if (routeUrl(currentRoute) === routeUrl(route) && currentRoute.surface === route.surface) return currentRoute;

    window.history[historyMode === 'replace' ? 'replaceState' : 'pushState']({ shellRoute: route.path }, '', routeUrl(route));
    emit(route, 'child');
    return route;
  }

  function rememberChatFromReady(chatId) {
    if (lastChatPath) return lastChatPath;
    lastChatPath = buildChatPublicPath(chatId || null);
    persistLastChatPath(lastChatPath);
    return lastChatPath;
  }

  function getLastChatRoute() { return parseShellRoute(lastChatPath || CHAT_HOME_PATH, ''); }

  window.addEventListener('popstate', () => {
    const route = parseShellRoute();
    if (route.needsReplace) window.history.replaceState({ shellRoute: route.path }, '', routeUrl(route));
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