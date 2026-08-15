import { loadApplicationModule, resetModuleImport } from './module-registry.js';
import {
  parseShellRoute,
  routeToPath,
  isSameApplication,
  buildTodoPath
} from './router.js';
import {
  initShellNavigation,
  rememberRoute,
  syncShellNavigation
} from './navigation.js';

const host = document.getElementById('shell-module-host');
const statusRoot = document.getElementById('shell-status-root');

let activeInstance = null;
let activeRoute = null;
let switching = false;
let queuedTransition = null;

function showStatus(message = '', { error = false } = {}) {
  if (!statusRoot) return;
  statusRoot.replaceChildren();
  if (!message) return;
  const card = document.createElement('div');
  card.className = 'shell-status-card';
  card.setAttribute('role', error ? 'alert' : 'status');
  card.textContent = message;
  statusRoot.appendChild(card);
}

function showLoading(appId) {
  if (!host) return;
  host.innerHTML = `<div class="shell-loading" role="status">Loading ${appId === 'chat' ? 'ChatUI' : 'To-Do'}…</div>`;
}

function setTitle(title) {
  document.title = String(title || 'TodoList + ChatUI');
}

function applyShellAppearance(appearance = null) {
  if (!appearance || typeof appearance !== 'object') return;
  const shell = document.documentElement.style;
  if (appearance.accent) shell.setProperty('--shell-accent', appearance.accent);
  if (appearance.theme === 'light') {
    shell.setProperty('--shell-bg', '#f5f5f7');
    shell.setProperty('--shell-panel', '#ffffff');
    shell.setProperty('--shell-text', '#1d1d1f');
    shell.setProperty('--shell-muted', '#707078');
    shell.setProperty('--shell-border', 'rgba(0, 0, 0, .1)');
    shell.setProperty('--shell-hover', 'rgba(0, 0, 0, .05)');
  } else if (appearance.theme === 'dark') {
    shell.setProperty('--shell-bg', '#121214');
    shell.setProperty('--shell-panel', '#1c1c1e');
    shell.setProperty('--shell-text', '#ffffff');
    shell.setProperty('--shell-muted', 'rgba(255, 255, 255, .65)');
    shell.setProperty('--shell-border', 'rgba(255, 255, 255, .1)');
    shell.setProperty('--shell-hover', 'rgba(255, 255, 255, .08)');
  }
}

function writeHistory(path, { replace = false } = {}) {
  const current = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (current === path) return;
  window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
}

function hardNavigate(path) {
  window.location.assign(path);
}

async function mountRoute(route) {
  if (!host) throw new Error('Shell module host is missing.');
  showLoading(route.app);
  showStatus('');

  const namespace = await loadApplicationModule(route.app);
  const instance = await namespace.mount({
    host,
    route,
    shell: {
      navigate(path, options = {}) {
        return transitionToPath(path, {
          ...options,
          source: options.source || 'module'
        });
      },
      setTitle,
      reportFatalError(error) {
        console.error(`[${route.app}] fatal module error:`, error);
        showStatus(error?.message || `${route.app} failed.`, { error: true });
      },
      notifyAppearance: applyShellAppearance,
      getActiveRoute() { return activeRoute; }
    }
  });

  if (!instance || typeof instance !== 'object') {
    throw new Error(`${route.app} module did not return a mounted lifecycle instance.`);
  }
  activeInstance = instance;
  activeRoute = route;
  rememberRoute(route);
  syncShellNavigation(route);
  applyShellAppearance(instance.getAppearance?.());
  return instance;
}

async function approvedToLeave(targetRoute) {
  if (!activeInstance?.prepareDeactivate) return true;
  const decision = await activeInstance.prepareDeactivate({ targetRoute });
  if (decision === false) return false;
  if (decision && typeof decision === 'object' && decision.allow === false) return false;
  return true;
}

async function leaveActiveModule(targetPath) {
  if (!activeInstance) return true;
  const leaving = activeInstance;
  try {
    await leaving.beforeLeave?.({ targetRoute: parseShellRoute(targetPath) });
    await leaving.unmount?.();
    activeInstance = null;
    activeRoute = null;
    return true;
  } catch (error) {
    console.error('Application cleanup failed; using hard-navigation fallback.', error);
    showStatus('The current application could not close cleanly. Reloading the requested application for safety…', { error: true });
    hardNavigate(targetPath);
    return false;
  }
}

async function performTransition(pathname, options = {}) {
  const requested = parseShellRoute(pathname);
  let route = requested;
  let replace = Boolean(options.replace);

  if (requested.app === 'unknown') {
    console.warn('Unknown combined application route:', requested.rejectedPath);
    showStatus('That address is not recognized. Returning to To-Do.', { error: true });
    route = parseShellRoute(buildTodoPath());
    replace = true;
  }

  if (requested.type === 'root' || requested.legacy) replace = true;
  const canonicalPath = routeToPath(route);

  if (!activeInstance) {
    if (options.source !== 'popstate') writeHistory(canonicalPath, { replace: true });
    else if (window.location.pathname !== canonicalPath) writeHistory(canonicalPath, { replace: true });
    try {
      await mountRoute(route);
    } catch (error) {
      resetModuleImport(route.app);
      console.error(`Failed to mount ${route.app}:`, error);
      host.innerHTML = '';
      showStatus(`${route.app === 'chat' ? 'ChatUI' : 'To-Do'} could not start: ${error?.message || error}`, { error: true });
    }
    return;
  }

  if (isSameApplication(activeRoute, route)) {
    if (options.source !== 'popstate') writeHistory(canonicalPath, { replace });
    activeRoute = route;
    rememberRoute(route);
    syncShellNavigation(route);
    if (!options.handledByModule) {
      try { await activeInstance.handleRoute?.(route, { source: options.source || 'shell' }); }
      catch (error) {
        console.error('Active application route handling failed:', error);
        showStatus(`Could not open this route: ${error?.message || error}`, { error: true });
      }
    }
    return;
  }

  const previousPath = activeRoute ? routeToPath(activeRoute) : buildTodoPath();
  const allowed = await approvedToLeave(route);
  if (!allowed) {
    if (options.source === 'popstate') writeHistory(previousPath, { replace: true });
    syncShellNavigation(activeRoute);
    return;
  }

  const left = await leaveActiveModule(canonicalPath);
  if (!left) return;

  if (options.source !== 'popstate') writeHistory(canonicalPath, { replace });
  try {
    await mountRoute(route);
  } catch (error) {
    resetModuleImport(route.app);
    console.error(`Failed to mount ${route.app}:`, error);
    showStatus(`${route.app === 'chat' ? 'ChatUI' : 'To-Do'} could not start: ${error?.message || error}`, { error: true });
  }
}

export async function transitionToPath(pathname, options = {}) {
  const url = new URL(pathname, window.location.href);
  const request = { pathname: url.pathname, options };
  if (switching) {
    queuedTransition = request;
    return;
  }
  switching = true;
  try {
    let current = request;
    while (current) {
      queuedTransition = null;
      await performTransition(current.pathname, current.options);
      current = queuedTransition;
    }
  } finally {
    switching = false;
  }
}

function openActiveSettings(trigger) {
  try { activeInstance?.openSettings?.(trigger); }
  catch (error) {
    console.error('Could not open active application settings:', error);
    showStatus('Settings could not be opened.', { error: true });
  }
}

function init() {
  if (!host) throw new Error('Shell module host is missing.');

  initShellNavigation({
    onNavigate: (path, options) => transitionToPath(path, options),
    onOpenSettings: openActiveSettings
  });

  window.addEventListener('popstate', () => {
    void transitionToPath(window.location.pathname, { source: 'popstate' });
  });

  void transitionToPath(window.location.pathname, { replace: true, source: 'startup' });
}

init();
