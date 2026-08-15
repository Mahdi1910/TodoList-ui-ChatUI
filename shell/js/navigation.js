import { buildChatHomePath, parseShellRoute, routeToPath } from './router.js';

const LAST_CHAT_ROUTE_KEY = 'combined-shell:last-chat-route';

export function rememberRoute(route) {
  if (route?.app !== 'chat') return;
  try { sessionStorage.setItem(LAST_CHAT_ROUTE_KEY, routeToPath(route)); }
  catch (_) {}
}

export function getRememberedChatRoute() {
  let value = '';
  try { value = sessionStorage.getItem(LAST_CHAT_ROUTE_KEY) || ''; }
  catch (_) { return buildChatHomePath(); }
  const route = parseShellRoute(value);
  return route.app === 'chat' ? routeToPath(route) : buildChatHomePath();
}

export function syncShellNavigation(route) {
  const todoLinks = document.querySelectorAll('[data-shell-route="todo"]');
  const chatLinks = document.querySelectorAll('[data-shell-route="chat"]');
  const chatHref = route?.app === 'chat' ? routeToPath(route) : getRememberedChatRoute();

  todoLinks.forEach(link => {
    const active = route?.app === 'todo';
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });

  chatLinks.forEach(link => {
    const active = route?.app === 'chat';
    link.href = chatHref;
    link.classList.toggle('is-active', active);
    if (active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  });
}

export function shouldHandleSpaClick(event, anchor) {
  if (!anchor || event.defaultPrevented) return false;
  if (event.button !== 0) return false;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
  if (anchor.target && anchor.target !== '_self') return false;
  if (anchor.hasAttribute('download')) return false;
  const url = new URL(anchor.href, window.location.href);
  return url.origin === window.location.origin;
}

export function initShellNavigation({ onNavigate, onOpenSettings }) {
  const clickHandler = event => {
    const anchor = event.target.closest('a[data-shell-app-link]');
    if (anchor && shouldHandleSpaClick(event, anchor)) {
      const url = new URL(anchor.href, window.location.href);
      const target = parseShellRoute(url.pathname);
      if (target.app !== 'unknown' && typeof onNavigate === 'function') {
        event.preventDefault();
        void onNavigate(url.pathname, { source: 'shell-link' });
        return;
      }
    }

    const settings = event.target.closest('[data-shell-settings]');
    if (settings && typeof onOpenSettings === 'function') {
      event.preventDefault();
      onOpenSettings(settings);
    }
  };

  document.addEventListener('click', clickHandler);
  return () => document.removeEventListener('click', clickHandler);
}
