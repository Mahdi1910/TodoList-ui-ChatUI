import { createFrameManager } from './frame-manager.js';
import { createFrameBridge } from './frame-bridge.js';
import { createShellRouter, parseShellRoute } from './router.js';

const navTodo = document.getElementById('shell-nav-todo');
const navChat = document.getElementById('shell-nav-chat');
const settingsButton = document.getElementById('shell-open-settings');
const chatStatus = document.getElementById('shell-chat-status');
const toast = document.getElementById('shell-toast');
const shellStage = document.getElementById('shell-stage');

let activeApp = 'todo';
const appearances = new Map();
const titles = new Map([['todo', 'To-Do'], ['chat', 'ChatUI']]);
let toastTimer = null;
let viewportSyncFrame = 0;
let lastChatKeyboardOcclusion = -1;

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
  document.title = titles.get(activeApp) || (activeApp === 'chat' ? 'ChatUI' : 'To-Do');
}

function updateNavigationState() {
  navTodo?.setAttribute('aria-current', activeApp === 'todo' ? 'page' : 'false');
  navChat?.setAttribute('aria-current', activeApp === 'chat' ? 'page' : 'false');
  settingsButton?.setAttribute('aria-label', `Open ${activeApp === 'chat' ? 'ChatUI' : 'To-Do'} settings`);
  if (settingsButton) settingsButton.disabled = frameManager.getState(activeApp) !== 'READY';
}

const frameManager = createFrameManager({
  onStateChange(app, state) {
    if (app === 'chat') chatStatus?.classList.toggle('visible', state === 'FAILED');
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
      if (current.app === 'chat') {
        bridge.navigateChatRoute(current, 'ready-sync');
      } else {
        const lastPath = router.rememberChatFromReady(payload.currentChatId || null);
        bridge.navigateChatRoute(parseShellRoute(lastPath), 'ready-sync');
      }
      syncChatViewportInsets(true);
    }

    if (app === activeApp) {
      applyShellAppearance(app);
      updateTitle();
      updateNavigationState();
    }
  },
  onError(app, payload) {
    if (app === activeApp) showToast(`${app === 'chat' ? 'ChatUI' : 'To-Do'} failed to start: ${payload.message || 'unknown error'}`);
  },
  onCommandError(app, payload) {
    showToast(`${app === 'chat' ? 'ChatUI' : 'To-Do'}: ${payload.message || 'command failed'}`);
  },
  onCommandTimeout(app, command) {
    showToast(`${app === 'chat' ? 'ChatUI' : 'To-Do'} did not respond to ${command}.`);
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

function getChatKeyboardOcclusion() {
  if (!window.matchMedia('(max-width: 768px)').matches || !shellStage) return 0;
  const viewport = window.visualViewport;
  if (!viewport) return 0;
  const stageBottom = shellStage.getBoundingClientRect().bottom;
  const visibleBottom = viewport.offsetTop + viewport.height;
  const occlusion = Math.max(0, stageBottom - visibleBottom);
  // Ignore small browser-chrome/rounding changes. A software keyboard creates a
  // much larger occlusion and should move ChatUI's composer, not the shell rail.
  return occlusion >= 80 ? Math.round(occlusion) : 0;
}

function syncChatViewportInsets(force = false) {
  const keyboardOcclusionBottom = getChatKeyboardOcclusion();
  if (!force && keyboardOcclusionBottom === lastChatKeyboardOcclusion) return;
  lastChatKeyboardOcclusion = keyboardOcclusionBottom;
  bridge.setViewportInsets('chat', { keyboardOcclusionBottom });
}

function scheduleChatViewportSync() {
  if (viewportSyncFrame) return;
  viewportSyncFrame = window.requestAnimationFrame(() => {
    viewportSyncFrame = 0;
    syncChatViewportInsets();
  });
}

function activateRoute(route, meta = {}) {
  const previousApp = activeApp;
  activeApp = route.app;

  if (meta.source === 'rail') {
    (activeApp === 'chat' ? navChat : navTodo)?.focus({ preventScroll: true });
  }

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

  if (route.app === 'chat' && meta.source !== 'child') {
    bridge.navigateChatRoute(route, meta.source || 'shell');
  }
  scheduleChatViewportSync();
}

router = createShellRouter(activateRoute);

navTodo?.addEventListener('click', () => router.goTodo());
navChat?.addEventListener('click', () => router.goChat());
settingsButton?.addEventListener('click', () => {
  if (frameManager.getState(activeApp) !== 'READY') {
    showToast(`${activeApp === 'chat' ? 'ChatUI' : 'To-Do'} is still loading.`);
    return;
  }
  bridge.openSettings(activeApp);
});

window.visualViewport?.addEventListener('resize', scheduleChatViewportSync);
window.visualViewport?.addEventListener('scroll', scheduleChatViewportSync);
window.addEventListener('resize', scheduleChatViewportSync);
window.addEventListener('orientationchange', scheduleChatViewportSync);

router.start();
frameManager.startAll();
scheduleChatViewportSync();
