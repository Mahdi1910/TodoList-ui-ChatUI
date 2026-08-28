/**
 * press-actions.js — Long-press/right-click/keyboard access to sidebar row menus.
 */

export const SIDEBAR_LONG_PRESS_MS = 500;
export const SIDEBAR_LONG_PRESS_MOVE_PX = 10;
const SUPPRESS_FOLLOWUP_CLICK_MS = 900;

export function bindSidebarActionPress(target, onOpen) {
  if (!target || typeof onOpen !== 'function') return () => {};

  let pressTimer = null;
  let suppressClickTimer = null;
  let activePointerId = null;
  let startX = 0;
  let startY = 0;
  let suppressNextClick = false;
  let lastOpenedAt = 0;

  const cancelPress = () => {
    if (pressTimer) window.clearTimeout(pressTimer);
    pressTimer = null;
    activePointerId = null;
  };

  const clearClickSuppression = () => {
    if (suppressClickTimer) window.clearTimeout(suppressClickTimer);
    suppressClickTimer = null;
    suppressNextClick = false;
  };

  const armClickSuppression = () => {
    clearClickSuppression();
    suppressNextClick = true;
    suppressClickTimer = window.setTimeout(clearClickSuppression, SUPPRESS_FOLLOWUP_CLICK_MS);
  };

  const openMenu = event => {
    lastOpenedAt = Date.now();
    onOpen(event);
  };

  const onPointerDown = event => {
    if (event.pointerType === 'mouse' || event.button !== 0) return;
    cancelPress();
    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
    pressTimer = window.setTimeout(() => {
      pressTimer = null;
      armClickSuppression();
      openMenu(event);
    }, SIDEBAR_LONG_PRESS_MS);
  };

  const onPointerMove = event => {
    if (activePointerId == null || event.pointerId !== activePointerId) return;
    const distance = Math.hypot(event.clientX - startX, event.clientY - startY);
    if (distance > SIDEBAR_LONG_PRESS_MOVE_PX) cancelPress();
  };

  const onPointerEnd = event => {
    if (activePointerId == null || event.pointerId !== activePointerId) return;
    cancelPress();
  };

  const onClickCapture = event => {
    if (!suppressNextClick) return;
    clearClickSuppression();
    event.preventDefault();
    event.stopImmediatePropagation();
  };

  const onContextMenu = event => {
    event.preventDefault();
    cancelPress();
    if (event.pointerType === 'touch') armClickSuppression();
    if (Date.now() - lastOpenedAt < 700) return;
    openMenu(event);
  };

  const onKeyDown = event => {
    if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10')) return;
    event.preventDefault();
    openMenu(event);
  };

  target.addEventListener('pointerdown', onPointerDown);
  target.addEventListener('pointermove', onPointerMove);
  target.addEventListener('pointerup', onPointerEnd);
  target.addEventListener('pointercancel', onPointerEnd);
  target.addEventListener('click', onClickCapture, true);
  target.addEventListener('contextmenu', onContextMenu);
  target.addEventListener('keydown', onKeyDown);

  return () => {
    cancelPress();
    clearClickSuppression();
    target.removeEventListener('pointerdown', onPointerDown);
    target.removeEventListener('pointermove', onPointerMove);
    target.removeEventListener('pointerup', onPointerEnd);
    target.removeEventListener('pointercancel', onPointerEnd);
    target.removeEventListener('click', onClickCapture, true);
    target.removeEventListener('contextmenu', onContextMenu);
    target.removeEventListener('keydown', onKeyDown);
  };
}
