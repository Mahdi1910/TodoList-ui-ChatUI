const SHELL_CHANNEL = 'mahdi-app-shell';
const SHELL_VERSION = 1;
const IS_EMBEDDED = new URLSearchParams(window.location.search).get('embedded') === '1';
let initialized = false;

function postToShell(type, payload = {}) {
  if (!IS_EMBEDDED || window.parent === window) return;
  window.parent.postMessage({
    channel: SHELL_CHANNEL,
    version: SHELL_VERSION,
    app: 'chat',
    type,
    payload
  }, window.location.origin);
}

function getAppearance(state) {
  return {
    theme: state?.theme === 'light' ? 'light' : 'dark',
    accentColor: typeof state?.accentColor === 'string' ? state.accentColor : '#10A37F'
  };
}

function validShellMessage(event) {
  if (event.origin !== window.location.origin || event.source !== window.parent) return false;
  const message = event.data;
  if (!message || typeof message !== 'object') return false;
  if (message.channel !== SHELL_CHANNEL || message.version !== SHELL_VERSION || message.app !== 'shell') return false;
  if (typeof message.type !== 'string' || message.type.length > 80) return false;
  try { return JSON.stringify(message).length <= 32 * 1024; }
  catch (_) { return false; }
}

function installExternalLinkPolicy() {
  document.addEventListener('click', event => {
    const anchor = event.target.closest?.('a[href]');
    if (!anchor || anchor.hasAttribute('download')) return;
    const rawHref = anchor.getAttribute('href') || '';
    if (!rawHref || rawHref.startsWith('#')) return;

    let url;
    try { url = new URL(anchor.href, window.location.href); }
    catch (_) { return; }

    if (!['http:', 'https:'].includes(url.protocol)) return;
    event.preventDefault();
    const opened = window.open(url.href, '_blank', 'noopener,noreferrer');
    if (opened) opened.opener = null;
  }, true);
}

function observeTitle() {
  const title = document.querySelector('title');
  if (!title) return;
  const report = () => postToShell('app:title', { title: document.title || 'ChatUI' });
  new MutationObserver(report).observe(title, { childList: true, characterData: true, subtree: true });
}

function observeAppearance(getState) {
  let scheduled = false;
  const report = () => {
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      postToShell('app:appearance', getAppearance(getState()));
    });
  };
  new MutationObserver(report).observe(document.documentElement, { attributes: true, attributeFilter: ['style', 'class'] });
  window.addEventListener('workspace:theme-changed', report);
}

export function initChatEmbeddedBridge({ navigateChat, openSettings, getState }) {
  if (!IS_EMEDDED_SAFE() || initialized) return false;
  initialized = true;

  installExternalLinkPolicy();
  observeTitle();
  observeAppearance(getState);

  window.addEventListener('message', async event => {
    if (!validShellMessage(event)) return;
    const message = event.data;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};

    try {
      switch (message.type) {
        case 'shell:navigate-chat': {
          const chatId = payload.chatId == null ? null : String(payload.chatId);
          if (chatId && chatId.length > 512) throw new Error('Requested chat ID is too long.');
          await navigateChat(chatId);
          postToShell('app:navigation-complete', {
            requestId: payload.requestId || null,
            chatId: getState()?.activeChatId || null
          });
          break;
        }
        case 'shell:open-settings':
          openSettings();
          postToShell('app:settings-opened', { requestId: payload.requestId || null });
          break;
        case 'shell:request-appearance':
          postToShell('app:appearance', getAppearance(getState()));
          break;
        case 'shell:active':
          document.documentElement.dataset.shellActive = 'true';
          break;
        case 'shell:inactive':
          document.documentElement.dataset.shellActive = 'false';
          break;
        default:
          break;
      }
    } catch (error) {
      postToShell('app:command-error', {
        requestId: payload.requestId || null,
        command: message.type,
        message: error instanceof Error ? error.message : String(error || 'Command failed')
      });
    }
  });

  const state = getState();
  postToShell('app:ready', {
    currentChatId: state?.activeChatId || null,
    title: document.title || 'ChatUI',
    appearance: getAppearance(state),
    capabilities: ['navigate-chat', 'open-settings', 'appearance', 'persistent-media']
  });
  return true;
}

function IS_EMEDDED_SAFE() {
  return IS_EMBEDDED && window.parent !== window;
}
