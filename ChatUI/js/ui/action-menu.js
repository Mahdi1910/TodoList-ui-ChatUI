/**
 * action-menu.js — One shared popup-menu primitive for ChatUI three-dot actions.
 */

let activeAnchor = null;
let initialized = false;

function getMenu() {
  return document.getElementById('action-menu');
}

function initializeIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

export function isActionMenuOpen() {
  return !!getMenu()?.classList.contains('show');
}

export function closeActionMenu({ restoreFocus = false } = {}) {
  const menu = getMenu();
  if (!menu) return;
  menu.classList.remove('show');
  menu.setAttribute('hidden', '');
  menu.replaceChildren();
  if (activeAnchor) activeAnchor.setAttribute('aria-expanded', 'false');
  const anchor = activeAnchor;
  activeAnchor = null;
  if (restoreFocus) anchor?.focus?.();
}
function positionMenu(menu, anchor) {
  const rect = anchor.getBoundingClientRect();
  const gap = 6;
  const viewportPadding = 8;
  const width = menu.offsetWidth || 180;
  const height = menu.offsetHeight || 0;
  let left = rect.right - width;
  let top = rect.bottom + gap;

  left = Math.max(viewportPadding, Math.min(left, window.innerWidth - width - viewportPadding));
  if (top + height > window.innerHeight - viewportPadding) {
    top = Math.max(viewportPadding, rect.top - height - gap);
  }
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function createMenuItem(item) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `action-menu-item${item.danger ? ' danger' : ''}`;
  button.setAttribute('role', 'menuitem');
  button.disabled = !!item.disabled;
  if (item.id) button.id = item.id;
  button.innerHTML = `${item.icon ? `<i data-lucide="${item.icon}"></i>` : ''}<span>${item.label}</span>`;
  if (item.disabled && item.disabledReason) button.title = item.disabledReason;
  button.addEventListener('click', async event => {
    event.stopPropagation();
    if (button.disabled) return;
    closeActionMenu();
    try { await item.onSelect?.(); }
    catch (error) {
      console.error('Action menu command failed:', error);
      alert('Action failed: ' + (error?.message || 'Unknown error'));
    }
  });
  return button;
}

export function openActionMenu(anchor, items = []) {
  const menu = getMenu();
  if (!menu || !anchor) return;
  if (menu.classList.contains('show') && activeAnchor === anchor) {
    closeActionMenu({ restoreFocus: true });
    return;
  }
  closeActionMenu();
  activeAnchor = anchor;
  anchor.setAttribute('aria-haspopup', 'menu');
  anchor.setAttribute('aria-expanded', 'true');
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Actions');
  menu.replaceChildren(...items.map(createMenuItem));
  menu.removeAttribute('hidden');
  menu.classList.add('show');
  positionMenu(menu, anchor);
  initializeIcons();
  menu.querySelector('.action-menu-item:not(:disabled)')?.focus();
}
export function initActionMenu() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('pointerdown', event => {
    const menu = getMenu();
    if (!menu?.classList.contains('show')) return;
    if (menu.contains(event.target) || activeAnchor?.contains?.(event.target)) return;
    closeActionMenu();
  });
  document.addEventListener('keydown', event => {
    const menu = getMenu();
    if (!menu?.classList.contains('show')) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      closeActionMenu({ restoreFocus: true });
      return;
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [...menu.querySelectorAll('.action-menu-item:not(:disabled)')];
    if (!buttons.length) return;
    event.preventDefault();
    const current = buttons.indexOf(document.activeElement);
    const delta = event.key === 'ArrowDown' ? 1 : -1;
    buttons[(current + delta + buttons.length) % buttons.length].focus();
  });
}
