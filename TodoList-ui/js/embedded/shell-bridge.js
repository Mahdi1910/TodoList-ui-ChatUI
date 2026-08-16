const SHELL_CHANNEL = 'mahdi-app-shell';
const SHELL_VERSION = 1;
const IS_EMBEDDED = new URLSearchParams(window.location.search).get('embedded') === '1';
let initialized = false;

export function isTodoEmbeddedMode() {
  return IS_EMBEDDED && window.parent !== window;
}

export function postTodoShellMessage(type, payload = {}) {
  if (!isTodoEmbeddedMode()) return;
  window.parent.postMessage({
    channel: SHELL_CHANNEL,
    version: SHELL_VERSION,
    app: 'todo',
    type,
    payload
  }, window.location.origin);
}

function prepareEmbeddedLayout() {
  if (!isTodoEmbeddedMode()) return;
  document.documentElement.classList.add('todo-embedded');
  const style = document.createElement('style');
  style.id = 'todo-embedded-shell-style';
  style.textContent = `
    html.todo-embedded .primary-rail,
    html.todo-embedded .mobile-bottom-nav { display: none !important; }
    html.todo-embedded .secondary-sidebar { left: 0 !important; }
    @media (max-width: 768px) {
      html.todo-embedded .secondary-sidebar { padding-bottom: env(safe-area-inset-bottom, 16px) !important; }
      html.todo-embedded .fab-add-task { bottom: 24px !important; }
      html.todo-embedded .workspace-content { padding-bottom: 90px !important; }
    }
  `;
  document.head.appendChild(style);
}

prepareEmbeddedLayout();

function validShellMessage(event) {
  if (event.origin !== window.location.origin || event.source !== window.parent) return false;
  const message = event.data;
  if (!message || typeof message !== 'object') return false;
  if (message.channel !== SHELL_CHANNEL || message.version !== SHELL_VERSION || message.app !== 'shell') return false;
  if (typeof message.type !== 'string' || message.type.length > 80) return false;
  try { return JSON.stringify(message).length <= 32 * 1024; }
  catch (_) { return false; }
}

function readAppearance(appState) {
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue('--accent-color').trim();
  return {
    theme: appState?.theme === 'light' ? 'light' : 'dark',
    accentColor: /^#[0-9a-f]{6}$/i.test(accent) ? accent : (appState?.theme === 'light' ? '#0071e3' : '#0a84ff')
  };
}

export function initializeTodoEmbeddedBridge({ settingsComponent, appState }) {
  if (!isTodoEmbeddedMode() || initialized) return false;
  initialized = true;

  const reportAppearance = () => postTodoShellMessage('app:appearance', readAppearance(appState));
  const titleElement = document.querySelector('title');
  if (titleElement) {
    new MutationObserver(() => postTodoShellMessage('app:title', { title: document.title || 'To-Do' }))
      .observe(titleElement, { childList: true, characterData: true, subtree: true });
  }
  new MutationObserver(reportAppearance)
    .observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });

  window.addEventListener('message', event => {
    if (!validShellMessage(event)) return;
    const message = event.data;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};

    try {
      switch (message.type) {
        case 'shell:open-settings':
          settingsComponent.openModal(null);
          postTodoShellMessage('app:settings-opened', { requestId: payload.requestId || null });
          break;
        case 'shell:request-appearance':
          reportAppearance();
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
      postTodoShellMessage('app:command-error', {
        requestId: payload.requestId || null,
        command: message.type,
        message: error instanceof Error ? error.message : String(error || 'Command failed')
      });
    }
  });

  postTodoShellMessage('app:ready', {
    title: 'To-Do',
    appearance: readAppearance(appState),
    capabilities: ['open-settings', 'appearance']
  });
  return true;
}
