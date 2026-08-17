import { createShellMessage, isProtocolMessage, safeRequestId } from './protocol.js';

const NORMAL_MESSAGE_LIMIT = 32 * 1024;
const TODO_RPC_LIMIT = 64 * 1024;
const TODO_RPC_TYPES = new Set([
  'chatui:todo-tool-request',
  'chatui:todo-tool-cancel',
  'todo:tool-response',
  'shell:todo-tool-request',
  'shell:todo-tool-cancel',
  'shell:todo-tool-response',
  'shell:todo-tool-dispatched'
]);

function messageLimit(type) {
  return TODO_RPC_TYPES.has(type) ? TODO_RPC_LIMIT : NORMAL_MESSAGE_LIMIT;
}

function validPayloadSize(data) {
  try { return JSON.stringify(data).length <= messageLimit(data?.type); }
  catch (_) { return false; }
}

function toolFailure(code, message, details = {}, meta = {}) {
  const mutationOccurred = Boolean(meta.mutationOccurred);
  const affectedCount = Math.max(0, Number(meta.affectedCount) || 0);
  return {
    ok: false,
    overview: { message, affectedCount },
    error: { code, message, details },
    meta: { ...meta, mutationOccurred, affectedCount }
  };
}

export function createFrameBridge(frameManager, callbacks = {}) {
  const pendingSettings = new Map();
  const cancelledTodoRequests = new Set();

  function send(app, type, payload = {}) {
    return frameManager.send(app, createShellMessage(type, payload));
  }

  function sendNow(app, type, payload = {}) {
    return frameManager.sendNow(app, createShellMessage(type, payload));
  }

  function navigateChatRoute(route = {}, source = 'shell') {
    const requestId = safeRequestId('navigate');
    const surface = route.surface === 'workspace' ? 'workspace' : 'chat';
    send('chat', 'shell:navigate-chat', {
      requestId,
      surface,
      chatId: surface === 'chat' ? (route.chatId || null) : null,
      messageId: surface === 'chat' ? (route.messageId || null) : null,
      workspacePath: surface === 'workspace' ? (route.workspacePath || '/') : null,
      invalidWorkspacePath: Boolean(route.invalidWorkspacePath),
      source
    });
    return requestId;
  }

  function navigateChat(chatId, source = 'shell') {
    return navigateChatRoute({ surface: 'chat', chatId: chatId || null }, source);
  }

  function setActive(app, active) {
    send(app, active ? 'shell:active' : 'shell:inactive', { active });
  }

  function requestAppearance(app) {
    send(app, 'shell:request-appearance', {});
  }

  function openSettings(app) {
    const requestId = safeRequestId('settings');
    send(app, 'shell:open-settings', { requestId });
    const timeoutId = window.setTimeout(() => {
      if (!pendingSettings.has(requestId)) return;
      pendingSettings.delete(requestId);
      callbacks.onCommandTimeout?.(app, 'settings');
    }, 2000);
    pendingSettings.set(requestId, timeoutId);
    return requestId;
  }

  function sendTodoResultToChat(requestId, result) {
    const payload = { requestId: String(requestId || ''), result };
    const message = createShellMessage('shell:todo-tool-response', payload);
    if (!validPayloadSize(message)) {
      const mutationOccurred = Boolean(result?.meta?.mutationOccurred);
      const affectedCount = Math.max(0, Number(result?.overview?.affectedCount ?? result?.meta?.affectedCount) || 0);
      payload.result = toolFailure(
        'RESULT_TOO_LARGE',
        'Todo result exceeded the 64 KiB Shell RPC limit. Narrow or paginate the request.',
        { originalCode: result?.error?.code || null, mutationOccurred },
        { mutationOccurred, affectedCount }
      );
    }
    frameManager.send('chat', createShellMessage('shell:todo-tool-response', payload));
  }

  async function handleTodoRequest(payload) {
    const requestId = String(payload?.requestId || '');
    if (!requestId) return;
    try {
      const ready = await frameManager.ensureReady('todo', { timeoutMs: 30000, retryFailed: true });
      if (cancelledTodoRequests.has(requestId)) {
        cancelledTodoRequests.delete(requestId);
        sendTodoResultToChat(requestId, toolFailure('REQUEST_ABORTED', 'Todo request was stopped before dispatch.'));
        return;
      }
      const capabilities = Array.isArray(ready?.capabilities) ? ready.capabilities : [];
      if (!capabilities.includes('todo-tools-v1')) {
        sendTodoResultToChat(requestId, toolFailure('TODO_UNAVAILABLE', 'Todo loaded without the required todo-tools-v1 capability.'));
        return;
      }
      const sent = sendNow('todo', 'shell:todo-tool-request', payload);
      if (!sent) {
        sendTodoResultToChat(requestId, toolFailure('TODO_UNAVAILABLE', 'Todo became unavailable before the request could be dispatched.'));
        return;
      }
      send('chat', 'shell:todo-tool-dispatched', { requestId });
    } catch (error) {
      cancelledTodoRequests.delete(requestId);
      sendTodoResultToChat(requestId, toolFailure('TODO_UNAVAILABLE', error instanceof Error ? error.message : 'Todo could not be started.'));
    }
  }

  function handleTodoCancel(payload) {
    const requestId = String(payload?.requestId || '');
    if (!requestId) return;
    cancelledTodoRequests.add(requestId);
    if (frameManager.getState('todo') === 'READY') {
      sendNow('todo', 'shell:todo-tool-cancel', { requestId });
    }
    window.setTimeout(() => cancelledTodoRequests.delete(requestId), 2 * 60 * 1000);
  }

  window.addEventListener('message', event => {
    if (event.origin !== window.location.origin) return;
    const app = frameManager.appFromWindow(event.source);
    if (!app) return;
    const message = event.data;
    if (!isProtocolMessage(message) || message.app !== app || !validPayloadSize(message)) return;

    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};

    switch (message.type) {
      case 'app:ready':
        frameManager.markReady(app, payload);
        callbacks.onReady?.(app, payload);
        if (app === 'chat') sendNow('chat', 'shell:todo-rpc-capabilities', { supported: true, version: 'todo-rpc-v1' });
        break;
      case 'app:error':
        frameManager.markFailed(app, String(payload.message || payload.stage || 'Application startup failed.'));
        callbacks.onError?.(app, payload);
        break;
      case 'app:command-error': callbacks.onCommandError?.(app, payload); break;
      case 'app:appearance': callbacks.onAppearance?.(app, payload); break;
      case 'app:title': callbacks.onTitle?.(app, payload); break;
      case 'chatui:route-change': if (app === 'chat') callbacks.onChatRouteChange?.(payload); break;
      case 'chatui:todo-tool-request': if (app === 'chat') void handleTodoRequest(payload); break;
      case 'chatui:todo-tool-cancel': if (app === 'chat') handleTodoCancel(payload); break;
      case 'todo:tool-response':
        if (app === 'todo') {
          cancelledTodoRequests.delete(String(payload.requestId || ''));
          sendTodoResultToChat(payload.requestId, payload.result);
        }
        break;
      case 'app:settings-opened': {
        const timeoutId = pendingSettings.get(payload.requestId);
        if (timeoutId) window.clearTimeout(timeoutId);
        pendingSettings.delete(payload.requestId);
        callbacks.onSettingsOpened?.(app, payload);
        break;
      }
      case 'app:navigation-complete': callbacks.onNavigationComplete?.(app, payload); break;
      default: break;
    }
  });

  return { navigateChat, navigateChatRoute, setActive, requestAppearance, openSettings };
}