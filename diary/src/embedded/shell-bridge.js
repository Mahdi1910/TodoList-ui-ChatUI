const SHELL_CHANNEL = 'mahdi-app-shell';
const SHELL_VERSION = 1;
const MESSAGE_LIMIT = 32 * 1024;
const IS_EMBEDDED = new URLSearchParams(window.location.search).get('embedded') === '1' && window.parent !== window;
let initialized = false;

function fitsMessage(value) {
  try { return JSON.stringify(value).length <= MESSAGE_LIMIT; }
  catch (_) { return false; }
}

function postToShell(type, payload = {}) {
  if (!IS_EMBEDDED) return false;
  const message = { channel: SHELL_CHANNEL, version: SHELL_VERSION, app: 'diary', type, payload };
  if (!fitsMessage(message)) return false;
  window.parent.postMessage(message, window.location.origin);
  return true;
}

function validShellMessage(event) {
  if (!IS_EMBEDDED || event.origin !== window.location.origin || event.source !== window.parent) return false;
  const message = event.data;
  return !!message && typeof message === 'object'
    && message.channel === SHELL_CHANNEL
    && message.version === SHELL_VERSION
    && message.app === 'shell'
    && typeof message.type === 'string'
    && message.type.length <= 80
    && fitsMessage(message);
}

function readAppearance() {
  const root = document.documentElement;
  const style = getComputedStyle(root);
  const rawAccent = style.getPropertyValue('--accent').trim();
  return {
    theme: root.getAttribute('data-theme') === 'light' ? 'light' : 'dark',
    accentColor: /^#[0-9a-f]{6}$/i.test(rawAccent) ? rawAccent : '#6366f1'
  };
}

function prepareEmbeddedLayout() {
  if (!IS_EMBEDDED) return;
  document.documentElement.classList.add('diary-embedded');
  if (document.getElementById('diary-embedded-shell-style')) return;
  const link = document.createElement('link');
  link.id = 'diary-embedded-shell-style';
  link.rel = 'stylesheet';
  link.href = new URL('../../css/embedded.css', import.meta.url).href;
  document.head.appendChild(link);
}

function applyViewportInsets(payload = {}) {
  const rawBottom = Number(payload.keyboardOcclusionBottom);
  const bottom = Number.isFinite(rawBottom) ? Math.max(0, Math.min(2000, Math.round(rawBottom))) : 0;
  const root = document.documentElement;
  root.style.setProperty('--shell-keyboard-occlusion-bottom', `${bottom}px`);
  root.dataset.shellKeyboardOpen = bottom > 0 ? 'true' : 'false';
}

prepareEmbeddedLayout();

export function isDiaryEmbeddedMode() {
  return IS_EMBEDDED;
}

export function initDiaryEmbeddedBridge({ openSettings, onActive } = {}) {
  if (!IS_EMBEDDED || initialized) return null;
  initialized = true;
  let readyReported = false;

  const reportAppearance = () => postToShell('app:appearance', readAppearance());
  const title = document.querySelector('title');
  if (title) {
    new MutationObserver(() => postToShell('app:title', { title: document.title || 'Diary' }))
      .observe(title, { childList: true, characterData: true, subtree: true });
  }
  new MutationObserver(reportAppearance)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme', 'data-accent', 'style'] });

  window.addEventListener('message', async event => {
    if (!validShellMessage(event)) return;
    const message = event.data;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
    try {
      switch (message.type) {
        case 'shell:active':
          document.documentElement.dataset.shellActive = 'true';
          await onActive?.();
          break;
        case 'shell:inactive':
          document.documentElement.dataset.shellActive = 'false';
          break;
        case 'shell:request-appearance':
          reportAppearance();
          break;
        case 'shell:viewport-insets':
          applyViewportInsets(payload);
          break;
        case 'shell:open-settings':
          openSettings?.();
          postToShell('app:settings-opened', { requestId: payload.requestId || null });
          break;
        default:
          break;
      }
    } catch (error) {
      postToShell('app:command-error', {
        requestId: payload.requestId || null,
        command: message.type,
        message: error instanceof Error ? error.message : String(error || 'Diary command failed')
      });
    }
  });

  applyViewportInsets();

  return {
    reportReady() {
      if (readyReported) return;
      readyReported = true;
      postToShell('app:ready', {
        title: 'Diary',
        appearance: readAppearance(),
        capabilities: ['open-settings', 'appearance', 'persistent-media', 'viewport-insets', 'android-lifecycle']
      });
    },
    reportError(error, stage = 'startup') {
      postToShell('app:error', {
        stage,
        message: error instanceof Error ? error.message : String(error || 'Diary failed to start')
      });
    },
    reportAppearance
  };
}
