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

export function buildChatPublicPath(chatId) {
  return chatId ? `${CHAT_PREFIX}${encodeURIComponent(chatId)}` : CHAT_HOME_PATH;
}

export function buildWorkspacePublicPath(workspacePath = '/') {
  const raw = String(workspacePath || '/').trim();
  if (!raw || raw === '/') return WORKSPACE_ROOT_PATH;
  const segments = raw.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
  return `${WORKSPACE_ROOT_PATH}/${segments.map(segment => encodeURIComponent(segment)).join('/')}`;
}

export function parseShellRoute(pathname = window.location.pathname) {
  const path = cleanPath(pathname);
  if (path === '/' || path === '') {
    return { app: 'todo', surface: 'todo', path: TODO_PATH, chatId: null, workspacePath: null, needsReplace: true };
  }
  if (path === TODO_PATH) {
    return { app: 'todo', surface: 'todo', path: TODO_PATH, chatId: null, workspacePath: null, needsReplace: false };
  }
  if (path === CHAT_HOME_PATH) {
    return { app: 'chat', surface: 'chat', path: CHAT_HOME_PATH, chatId: null, workspacePath: null, needsReplace: false };
  }
  if (path.startsWith(CHAT_PREFIX)) {
    const encoded = path.slice(CHAT_PREFIX.length);
    if (encoded && !encoded.includes('/')) {
      try {
        const chatId = decodeURIComponent(encoded);
        if (chatId) {
          const canonical = buildChatPublicPath(chatId);
          return { app: 'chat', surface: 'chat', path: canonical, chatId, workspacePath: null, needsReplace: canonical !== path };
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
      workspacePath: workspace.workspacePath,
      invalidWorkspacePath: workspace.invalid,
      needsReplace: !workspace.invalid && canonical !== path
    };
  }

  return { app: 'todo', surface: 'todo', path: TODO_PATH, chatId: null, workspacePath: null, needsReplace: true };
}

function readStoredChatPath() {
  try {
    const stored = localStorage.getItem(LAST_CHAT_KEY);
    if (!stored) return null;
    const route = parseShellRoute(stored);
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
  let currentRoute = parseShellRoute(window.location.pathname);
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

  function handleChatChildRoute(payload = {}) {
    const surface = payload.surface === 'workspace' ? 'workspace' : 'chat';
    const historyMode = payload.historyMode === 'replace' ? 'replace' : 'push';
    const path = surface === 'workspace'
      ? buildWorkspacePublicPath(payload.workspacePath || '/')
      : buildChatPublicPath(typeof payload.chatId === 'string' && payload.chatId ? payload.chatId : null);

    if (surface === 'chat') {
      lastChatPath = path;
      persistLastChatPath(path);
    }

    const route = parseShellRoute(path);
    if (currentRoute.app !== 'chat') return route;
    if (currentRoute.path === route.path && currentRoute.surface === route.surface) return currentRoute;

    window.history[historyMode === 'replace' ? 'replaceState' : 'pushState']({ shellRoute: route.path }, '', route.path);
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
