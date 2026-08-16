import { createShellMessage, isProtocolMessage, safeRequestId } from './protocol.js';

function validPayloadSize(data) {
  try { return JSON.stringify(data).length <= 32 * 1024; }
  catch (_) { return false; }
}

export function createFrameBridge(frameManager, callbacks = {}) {
  const pendingSettings = new Map();

  function send(app, type, payload = {}) {
    return frameManager.send(app, createShellMessage(type, payload));
  }

  function navigateChat(chatId, source = 'shell') {
    const requestId = safeRequestId('navigate');
    send('chat', 'shell:navigate-chat', { requestId, chatId: chatId || null, source });
    return requestId;
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
        break;
      case 'app:error':
        frameManager.markFailed(app, String(payload.message || payload.stage || 'Application startup failed.'));
        callbacks.onError?.(app, payload);
        break;
      case 'app:command-error':
        callbacks.onCommandError?.(app, payload);
        break;
      case 'app:appearance':
        callbacks.onAppearance?.(app, payload);
        break;
      case 'app:title':
        callbacks.onTitle?.(app, payload);
        break;
      case 'chatui:route-change':
        if (app === 'chat') callbacks.onChatRouteChange?.(payload);
        break;
      case 'app:settings-opened': {
        const timeoutId = pendingSettings.get(payload.requestId);
        if (timeoutId) window.clearTimeout(timeoutId);
        pendingSettings.delete(payload.requestId);
        callbacks.onSettingsOpened?.(app, payload);
        break;
      }
      case 'app:navigation-complete':
        callbacks.onNavigationComplete?.(app, payload);
        break;
      default:
        break;
    }
  });

  return { navigateChat, setActive, requestAppearance, openSettings };
}
