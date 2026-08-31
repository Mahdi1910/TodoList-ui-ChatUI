import { createFrameManager } from './frame-manager.js';
import { createFrameBridge } from './frame-bridge.js';
import { createShellRouter, parseShellRoute } from './router.js';

const APP_META = Object.freeze({
  todo: { label: 'To-Do', navId: 'shell-nav-todo', statusId: null },
  chat: { label: 'ChatUI', navId: 'shell-nav-chat', statusId: 'shell-chat-status' },
  diary: { label: 'Diary', navId: 'shell-nav-diary', statusId: 'shell-diary-status' }
});

const navItems = new Map(Object.entries(APP_META).map(([app, meta]) => [app, document.getElementById(meta.navId)]));
const settingsButton = document.getElementById('shell-open-settings');
const toast = document.getElementById('shell-toast');
const shellStage = document.getElementById('shell-stage');

let activeApp = 'todo';
const appearances = new Map();
const titles = new Map(Object.entries(APP_META).map(([app, meta]) => [app, meta.label]));
let toastTimer = null;
let viewportSyncFrame = 0;
let lastKeyboardOcclusion = -1;

function appLabel(app) {
  return APP_META[app]?.label || app;
}

function showToast(message) {
  if (!toast) return;
  if (toastTimer) window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = window.setTimeout(() => { toast.hidden = true; }, 3200);
}

function applyShellAppearance(app) {
  const appearance = appearances.get(app) || {};
  const theme = appearance.theme === 'light' ? 'light' : 'dark';
  const accent = /^#[0-9a-f]{6}$/i.test(appearance.accentColor || '') ? appearance.accentColor : (theme === 'light' ? '#0071e3' : '#0a84ff');
  document.documentElement.dataset.shellTheme = theme;
  document.documentElement.style.setProperty('--shell-accent', accent);
  if (theme === 'light') {
    document.documentElement.style.setProperty('--shell-bg', '#f5f5f7');
    document.documentElement.style.setProperty('--shell-nav-bg', '#ffffff');
    document.documentElement.style.setProperty('--shell-text', '#1d1d1f');
    document.documentElement.style.setProperty('--shell-muted', '#73737a');
    document.documentElement.style.setProperty('--shell-border', 'rgba(0,0,0,.1)');
    document.documentElement.style.setProperty('--shell-hover', 'rgba(0,0,0,.05)');
    document.documentElement.style.setProperty('--shell-active', `${accent}1a`);
  } else {
    document.documentElement.style.setProperty('--shell-bg', '#121214');
    document.documentElement.style.setProperty('--shell-nav-bg', '#1c1c1e');
    document.documentElement.style.setProperty('--shell-text', '#ffffff');
    document.documentElement.style.setProperty('--shell-muted', 'rgba(255,255,255,.62)');
    document.documentElement.style.setProperty('--shell-border', 'rgba(255,255,255,.1)');
    document.documentElement.style.setProperty('--shell-hover', 'rgba(255,255,255,.08)');
    document.documentElement.style.setProperty('--shell-active', `${accent}26`);
  }
}

function updateTitle() {
  document.title = titles.get(activeApp) || appLabel(activeApp);
}

function updateNavigationState() {
  for (const [app, nav] of navItems) nav?.setAttribute('aria-current', activeApp === app ? 'page' : 'false');
  settingsButton?.setAttribute('aria-label', `Open ${appLabel(activeApp)} settings`);
  if (settingsButton) settingsButton.disabled = frameManager.getState(activeApp) !== 'READY';
}

const frameManager = createFrameManager({
  onStateChange(app, state) {
    const status = document.getElementById(APP_META[app]?.statusId || '');
    status?.classList.toggle('visible', state === 'FAILED');
    if (app === activeApp) updateNavigationState();
  }
});

let router;
const bridge = createFrameBridge(frameManager, {
  onReady(app, payload) {
    if (payload.appearance) appearances.set(app, payload.appearance);
    if (payload.title) titles.set(app, payload.title);
    bridge.requestAppearance(app);

    if (app === 'chat') {
      const current = router.getCurrentRoute();
      if (current.app === 'chat') bridge.navigateChatRoute(current, 'ready-sync');
      else bridge.navigateChatRoute(parseShellRoute(router.rememberChatFromReady(payload.currentChatId || null)), 'ready-sync');
    }

    if (app === 'chat' || app === 'diary') syncViewportInsetsFor(app, true);
    if (app === activeApp) {
      applyShellAppearance(app);
      updateTitle();
      updateNavigationState();
    }
  },
  onError(app, payload) {
    if (app === activeApp) showToast(`${appLabel(app)} failed to start: ${payload.message || 'unknown error'}`);
  },
  onCommandError(app, payload) {
    showToast(`${appLabel(app)}: ${payload.message || 'command failed'}`);
  },
  onCommandTimeout(app, command) {
    showToast(`${appLabel(app)} did not respond to ${command}.`);
  },
  onChatRouteChange(payload) {
    router.handleChatChildRoute(payload);
  },
  onAppearance(app, payload) {
    appearances.set(app, payload);
    if (app === activeApp) applyShellAppearance(app);
  },
  onTitle(app, payload) {
    if (typeof payload.title !== 'string' || !payload.title.trim()) return;
    titles.set(app, payload.title.slice(0, 160));
    if (app === activeApp) updateTitle();
  },
  onSettingsOpened() {
    if (toast) toast.hidden = true;
  }
});

function getKeyboardOcclusion() {
  if (!window.matchMedia('(max-width: 768px)').matches || !shellStage) return 0;
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  const stageBottom = shellStage.getBoundingClientRect().bottom;
  const visibleBottom = viewport.offsetTop + viewport.height;
  const occlusion = Math.max(0, stageBottom - visibleBottom);
  return occlusion >= 80 ? Math.round(occlusion) : 0;
}

function syncViewportInsetsFor(app, force = false) {
  const keyboardOcclusionBottom = getKeyboardOcclusion();
  if (!force && keyboardOcclusionBottom === lastKeyboardOcclusion) return;
  if (frameManager.getState(app) === 'READY') bridge.setViewportInsets(app, { keyboardOcclusionBottom });
}

function syncPersistentViewportInsets(force = false) {
  const keyboardOcclusionBottom = getKeyboardOcclusion();
  if (!force && keyboardOcclusionBottom === lastKeyboardOcclusion) return;
  lastKeyboardOcclusion = keyboardOcclusionBottom;
  for (const app of ['chat', 'diary']) {
    if (frameManager.getState(app) === 'READY') bridge.setViewportInsets(app, { keyboardOcclusionBottom });
  }
}

function scheduleViewportSync() {
  if (viewportSyncFrame) return;
  viewportSyncFrame = window.requestAnimationFrame(() => {
    viewportSyncFrame = 0;
    syncPersistentViewportInsets();
  });
}

function activateRoute(route, meta = {}) {
  const previousApp = activeApp;
  activeApp = route.app;

  if (meta.source === 'rail') navItems.get(activeApp)?.focus({ preventScroll: true });
  frameManager.activate(activeApp);
  if (previousApp !== activeApp) {
    bridge.setActive(previousApp, false);
    bridge.setActive(activeApp, true);
  } else {
    bridge.setActive(activeApp, true);
  }

  updateNavigationState();
  applyShellAppearance(activeApp);
  updateTitle();
  if (route.app === 'chat' && meta.source !== 'child') bridge.navigateChatRoute(route, meta.source || 'shell');
  scheduleViewportSync();
}

router = createShellRouter(activateRoute);

navItems.get('todo')?.addEventListener('click', () => router.goTodo());
navItems.get('chat')?.addEventListener('click', () => router.goChat());
navItems.get('diary')?.addEventListener('click', () => router.goDiary());
settingsButton?.addEventListener('click', () => {
  if (frameManager.getState(activeApp) !== 'READY') {
    showToast(`${appLabel(activeApp)} is still loading.`);
    return;
  }
  bridge.openSettings(activeApp);
});

// Preserve the existing native Android contract: the APK may call the top-level
// window.handleAndroidBack(). When Diary is active, delegate synchronously to
// its same-origin iframe; otherwise allow Android to perform its default action.
window.handleAndroidBack = function() {
  if (activeApp !== 'diary') return false;
  try {
    const handler = frameManager.getFrame('diary')?.contentWindow?.handleAndroidBack;
    return typeof handler === 'function' ? Boolean(handler()) : false;
  } catch (_) {
    return false;
  }
};

window.visualViewport?.addEventListener('resize', scheduleViewportSync);
window.visualViewport?.addEventListener('scroll', scheduleViewportSync);
window.addEventListener('resize', scheduleViewportSync);
window.addEventListener('orientationchange', scheduleViewportSync);

router.start();
frameManager.startAll();
scheduleViewportSync();
