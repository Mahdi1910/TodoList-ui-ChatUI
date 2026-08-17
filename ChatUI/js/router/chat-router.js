/**
 * chat-router.js - Framework-free routing for Chat conversations and Workspace paths.
 */

import { buildWorkspaceHref } from './app-links.js';

const CHAT_ROUTE_PREFIX = '/chat/';
const IS_EMBEDDED = new URLSearchParams(window.location.search).get('embedded') === '1';
const SHELL_CHANNEL = 'mahdi-app-shell';
const SHELL_VERSION = 1;

function parseMessageId(hash = window.location.hash) {
  const raw = String(hash || '').replace(/^#/, '');
  if (!raw) return null;
  const value = new URLSearchParams(raw).get('message');
  return value && value.length <= 512 ? value : null;
}

function parseWorkspaceRoute(path) {
  if (path === '/workspace' || path === '/workspace/') {
    return { type: 'workspace', surface: 'workspace', chatId: null, messageId: null, workspacePath: '/', invalidWorkspacePath: false };
  }
  if (!path.startsWith('/workspace/')) return null;
  const encoded = path.slice('/workspace/'.length).split('/');
  if (encoded.some(segment => !segment)) {
    return { type: 'workspace', surface: 'workspace', chatId: null, messageId: null, workspacePath: null, invalidWorkspacePath: true };
  }
  try {
    const segments = encoded.map(segment => decodeURIComponent(segment));
    if (segments.some(segment => !segment || segment.includes('/'))) throw new Error('Invalid Workspace route segment.');
    return { type: 'workspace', surface: 'workspace', chatId: null, messageId: null, workspacePath: `/${segments.join('/')}`, invalidWorkspacePath: false };
  } catch (_) {
    return { type: 'workspace', surface: 'workspace', chatId: null, messageId: null, workspacePath: null, invalidWorkspacePath: true };
  }
}

export function parseChatRoute(pathname = window.location.pathname, hash = window.location.hash) {
  const path = pathname || '/';
  const workspace = parseWorkspaceRoute(path);
  if (workspace) return workspace;
  if (path === '/' || path === '') return { type: 'home', surface: 'chat', chatId: null, messageId: null, workspacePath: null };
  if (!path.startsWith(CHAT_ROUTE_PREFIX)) return { type: 'unknown', surface: 'chat', chatId: null, messageId: null, workspacePath: null };

  const encodedId = path.slice(CHAT_ROUTE_PREFIX.length);
  if (!encodedId || encodedId.includes('/')) return { type: 'unknown', surface: 'chat', chatId: null, messageId: null, workspacePath: null };

  try {
    const chatId = decodeURIComponent(encodedId);
    return chatId
      ? { type: 'chat', surface: 'chat', chatId, messageId: parseMessageId(hash), workspacePath: null }
      : { type: 'unknown', surface: 'chat', chatId: null, messageId: null, workspacePath: null };
  } catch (_) {
    return { type: 'unknown', surface: 'chat', chatId: null, messageId: null, workspacePath: null };
  }
}

export function buildChatPath(chatId, messageId = null) {
  if (!chatId) return '/';
  const base = `${CHAT_ROUTE_PREFIX}${encodeURIComponent(chatId)}`;
  return messageId ? `${base}#message=${encodeURIComponent(messageId)}` : base;
}

function postEmbeddedRoute(route, method) {
  if (!IS_EMBEDDED || window.parent === window) return;
  window.parent.postMessage({
    channel: SHELL_CHANNEL,
    version: SHELL_VERSION,
    app: 'chat',
    type: 'chatui:route-change',
    payload: {
      surface: route.surface === 'workspace' ? 'workspace' : 'chat',
      chatId: route.surface === 'chat' ? (route.chatId || null) : null,
      messageId: route.surface === 'chat' ? (route.messageId || null) : null,
      workspacePath: route.surface === 'workspace' ? (route.workspacePath || '/') : null,
      historyMode: method === 'replaceState' ? 'replace' : 'push'
    }
  }, window.location.origin);
}

function writeRoute(method, path, state = {}, embeddedRoute = null) {
  if (IS_EMBEDDED) {
    postEmbeddedRoute(embeddedRoute || parseChatRoute(path), method);
    return;
  }
  const current = `${window.location.pathname}${window.location.hash}`;
  if (current === path) return;
  window.history[method]({ ...state }, '', path);
}

export function pushChatRoute(chatId) {
  writeRoute('pushState', buildChatPath(chatId), { chatId }, { surface: 'chat', chatId, messageId: null });
}

export function replaceChatRoute(chatId) {
  writeRoute('replaceState', buildChatPath(chatId), { chatId }, { surface: 'chat', chatId, messageId: null });
}

export function pushChatMessageRoute(chatId, messageId) {
  writeRoute('pushState', buildChatPath(chatId, messageId), { chatId, messageId }, { surface: 'chat', chatId, messageId });
}

export function replaceChatMessageRoute(chatId, messageId) {
  writeRoute('replaceState', buildChatPath(chatId, messageId), { chatId, messageId }, { surface: 'chat', chatId, messageId });
}

export function pushHomeRoute() {
  writeRoute('pushState', '/', { chatId: null }, { surface: 'chat', chatId: null, messageId: null });
}

export function replaceHomeRoute() {
  writeRoute('replaceState', '/', { chatId: null }, { surface: 'chat', chatId: null, messageId: null });
}

export function pushWorkspaceRoute(workspacePath = '/') {
  writeRoute('pushState', buildWorkspaceHref(workspacePath), { workspacePath }, { surface: 'workspace', workspacePath });
}

export function replaceWorkspaceRoute(workspacePath = '/') {
  writeRoute('replaceState', buildWorkspaceHref(workspacePath), { workspacePath }, { surface: 'workspace', workspacePath });
}

export function initChatRouter(onRouteChange) {
  if (IS_EMBEDDED || typeof onRouteChange !== 'function') return () => {};
  const handlePopState = () => onRouteChange(parseChatRoute());
  window.addEventListener('popstate', handlePopState);
  return () => window.removeEventListener('popstate', handlePopState);
}

export function isEmbeddedChatRouter() {
  return IS_EMBEDDED;
}