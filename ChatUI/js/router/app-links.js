/**
 * app-links.js - Public href builders and native-navigation click detection.
 */

const IS_EMBEDDED = new URLSearchParams(window.location.search).get('embedded') === '1';

function encodeWorkspaceSegments(workspacePath = '/') {
  const raw = String(workspacePath || '/').trim();
  if (!raw || raw === '/') return '';
  return raw
    .replace(/^\/+|\/+$/g, '')
    .split('/')
    .filter(Boolean)
    .map(segment => encodeURIComponent(segment))
    .join('/');
}

export function buildNewChatHref() {
  return IS_EMBEDDED ? '/chat-ui' : '/';
}

export function buildChatHref(chatId = null) {
  if (!chatId) return buildNewChatHref();
  return IS_EMBEDDED
    ? `/chat-ui/chat/${encodeURIComponent(chatId)}`
    : `/chat/${encodeURIComponent(chatId)}`;
}

export function buildWorkspaceHref(workspacePath = '/') {
  const encoded = encodeWorkspaceSegments(workspacePath);
  return encoded ? `/workspace/${encoded}` : '/workspace';
}

export function buildMessageHref(chatId, messageId = '') {
  const base = buildChatHref(chatId);
  return messageId ? `${base}#message=${encodeURIComponent(messageId)}` : base;
}

export function isUnmodifiedPrimaryNavigation(event) {
  return Boolean(
    event &&
    event.button === 0 &&
    !event.defaultPrevented &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.shiftKey &&
    !event.altKey
  );
}

export function isInternalAppUrl(url) {
  if (!(url instanceof URL) || url.origin !== window.location.origin) return false;
  const path = url.pathname || '/';
  if (path === '/' || path === '/chat-ui' || path === '/workspace') return true;
  return path.startsWith('/chat/') || path.startsWith('/chat-ui/chat/') || path.startsWith('/workspace/');
}

export function isEmbeddedApp() {
  return IS_EMBEDDED;
}
