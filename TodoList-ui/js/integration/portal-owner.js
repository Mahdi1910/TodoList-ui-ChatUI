import { AppState } from '../state.js';

const TODO_PORTAL_SELECTOR = '[data-module-owner="todo"]';
const trackedPortals = new Set();

function currentTheme() {
  return AppState.theme === 'light' ? 'light' : 'dark';
}

export function markTodoBodyPortal(node) {
  if (!node) return node;
  node.dataset.moduleOwner = 'todo';
  node.dataset.todoBodyPortal = '';
  node.setAttribute('data-theme', currentTheme());
  trackedPortals.add(node);
  return node;
}

export function unmarkTodoBodyPortal(node, { remove = false } = {}) {
  if (!node) return;
  trackedPortals.delete(node);
  if (remove) node.remove();
}

export function syncTodoBodyPortalTheme(theme = currentTheme()) {
  const normalized = theme === 'light' ? 'light' : 'dark';
  for (const node of [...trackedPortals]) {
    if (!node?.isConnected) {
      trackedPortals.delete(node);
      continue;
    }
    node.setAttribute('data-theme', normalized);
  }
  document.querySelectorAll(TODO_PORTAL_SELECTOR).forEach(node => {
    node.setAttribute('data-theme', normalized);
    trackedPortals.add(node);
  });
}

export function removeAllTodoBodyPortals() {
  for (const node of [...trackedPortals]) {
    try { node?.remove(); } catch (_) {}
  }
  trackedPortals.clear();
  document.querySelectorAll(TODO_PORTAL_SELECTOR).forEach(node => node.remove());
}

export function getTodoBodyPortalCount() {
  return document.querySelectorAll(TODO_PORTAL_SELECTOR).length;
}
