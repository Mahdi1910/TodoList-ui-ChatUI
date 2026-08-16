const SHELL_CHANNEL = 'mahdi-app-shell';
const SHELL_VERSION = 1;
const IS_EMBEDDED = new URLSearchParams(window.location.search).get('embedded') === '1';
const NORMAL_MESSAGE_LIMIT = 32 * 1024;
const TODO_RPC_LIMIT = 64 * 1024;
const TODO_RPC_TYPES = new Set(['shell:todo-tool-request', 'shell:todo-tool-cancel', 'todo:tool-response']);
let initialized = false;

export function isTodoEmbeddedMode() {
  return IS_EMBEDDED && window.parent !== window;
}

function messageLimit(type) {
  return TODO_RPC_TYPES.has(type) ? TODO_RPC_LIMIT : NORMAL_MESSAGE_LIMIT;
}

function fitsMessage(message, type = '') {
  try { return JSON.stringify(message).length <= messageLimit(type || message?.type); }
  catch (_) { return false; }
}

export function postTodoShellMessage(type, payload = {}) {
  if (!isTodoEmbeddedMode()) return false;
  const message = {
    channel: SHELL_CHANNEL,
    version: SHELL_VERSION,
    app: 'todo',
    type,
    payload
  };
  if (!fitsMessage(message, type)) return false;
  window.parent.postMessage(message, window.location.origin);
  return true;
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
  return fitsMessage(message, message.type);
}

function readAppearance(appState) {
  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue('--accent-color').trim();
  return {
    theme: appState?.theme === 'light' ? 'light' : 'dark',
    accentColor: /^#[0-9a-f]{6}$/i.test(accent) ? accent : (appState?.theme === 'light' ? '#0071e3' : '#0a84ff')
  };
}

function oversizedResult(requestId) {
  return {
    requestId,
    result: {
      ok: false,
      overview: { message: 'Todo result exceeded the RPC response limit.', affectedCount: 0 },
      error: {
        code: 'RESULT_TOO_LARGE',
        message: 'Todo result exceeded the 64 KiB RPC response limit. Narrow or paginate the request.',
        details: {}
      },
      meta: { mutationOccurred: false }
    }
  };
}

export function initializeTodoEmbeddedBridge({ settingsComponent, appState, todoToolExecutor }) {
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

  window.addEventListener('message', async event => {
    if (!validShellMessage(event)) return;
    const message = event.data;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};

    try {
      switch (message.type) {
        case 'shell:todo-tool-request': {
          if (!todoToolExecutor?.executeRequest) throw new Error('Todo tool executor is unavailable.');
          const requestId = String(payload.requestId || '');
          const result = await todoToolExecutor.executeRequest(payload);
          const responsePayload = { requestId, result };
          if (!postTodoShellMessage('todo:tool-response', responsePayload)) {
            postTodoShellMessage('todo:tool-response', oversizedResult(requestId));
          }
          break;
        }
        case 'shell:todo-tool-cancel':
          todoToolExecutor?.cancelRequest?.(String(payload.requestId || ''));
          break;
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
      if (message.type === 'shell:todo-tool-request') {
        postTodoShellMessage('todo:tool-response', {
          requestId: String(payload.requestId || ''),
          result: {
            ok: false,
            overview: { message: 'Todo tool request failed.', affectedCount: 0 },
            error: {
              code: 'INTERNAL_TODO_ERROR',
              message: error instanceof Error ? error.message : String(error || 'Todo tool request failed.'),
              details: {}
            },
            meta: { mutationOccurred: false }
          }
        });
        return;
      }
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
    capabilities: ['open-settings', 'appearance', 'todo-tools-v1']
  });
  return true;
}
