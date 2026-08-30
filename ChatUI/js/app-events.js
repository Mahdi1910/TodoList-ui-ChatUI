/**
 * app-events.js - Typed-by-convention application event boundary.
 *
 * Browser CustomEvent remains the transport, but feature modules should use the
 * helpers here instead of sharing string event names and ad-hoc payloads.
 */

export const APP_EVENTS = Object.freeze({
  WORKSPACE_CHANGED: 'workspace:changed',
  WORKSPACE_THEME_CHANGED: 'workspace:theme-changed',
  CHAT_VIEW_OPENED: 'chat:view-opened'
});

function canUseWindowEvents() {
  return typeof window !== 'undefined' && typeof CustomEvent !== 'undefined';
}

export function emitAppEvent(name, detail = {}) {
  if (!canUseWindowEvents()) return false;
  window.dispatchEvent(new CustomEvent(name, { detail }));
  return true;
}

export function subscribeAppEvent(name, listener, options = undefined) {
  if (typeof window === 'undefined' || typeof window.addEventListener !== 'function' || typeof listener !== 'function') {
    return () => {};
  }
  window.addEventListener(name, listener, options);
  return () => window.removeEventListener(name, listener, options);
}

export function emitWorkspaceChanged(detail = {}) {
  return emitAppEvent(APP_EVENTS.WORKSPACE_CHANGED, detail);
}

export function onWorkspaceChanged(listener) {
  return subscribeAppEvent(APP_EVENTS.WORKSPACE_CHANGED, listener);
}

export function emitWorkspaceThemeChanged(theme) {
  return emitAppEvent(APP_EVENTS.WORKSPACE_THEME_CHANGED, { theme });
}

export function onWorkspaceThemeChanged(listener) {
  return subscribeAppEvent(APP_EVENTS.WORKSPACE_THEME_CHANGED, listener);
}

export function emitChatViewOpened(detail = {}) {
  return emitAppEvent(APP_EVENTS.CHAT_VIEW_OPENED, detail);
}

export function onChatViewOpened(listener) {
  return subscribeAppEvent(APP_EVENTS.CHAT_VIEW_OPENED, listener);
}
