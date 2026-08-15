export const ModalFocusManager = (() => {
  const records = new WeakMap();
  const stack = [];
  let initialized = false;

  function setInert(modal, value) {
    if (!modal) return;
    modal.inert = Boolean(value);
    if (value) modal.setAttribute('inert', '');
    else modal.removeAttribute('inert');
  }

  function focusable(modal) {
    const selector = 'button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href],[tabindex]:not([tabindex="-1"])';
    return [...modal.querySelectorAll(selector)].filter(el =>
      !el.hidden && !el.closest('[hidden]') && !el.closest('[inert]') && el.offsetParent !== null
    );
  }

  function resolve(value) {
    if (typeof value === 'function') value = value();
    if (typeof value === 'string') value = document.querySelector(value);
    if (!value || !value.isConnected || typeof value.focus !== 'function' || value.closest?.('[inert]')) return null;
    return value;
  }

  function register(modal, fallbackFocus = null) {
    if (!modal) return null;
    const record = records.get(modal) || { modal, returnFocus: null, parentModal: null, pendingFrame: null, fallbackFocus: null };
    if (fallbackFocus) record.fallbackFocus = fallbackFocus;
    records.set(modal, record);
    if (modal.getAttribute('aria-hidden') !== 'false' && !modal.classList.contains('active')) {
      modal.setAttribute('aria-hidden', 'true');
      setInert(modal, true);
    }
    return record;
  }

  function top() { return stack.at(-1) || null; }

  function cancelFrame(record) {
    if (record?.pendingFrame != null) cancelAnimationFrame(record.pendingFrame);
    if (record) record.pendingFrame = null;
  }

  function open(modal, { trigger = null, initialFocus = null, fallbackFocus = null } = {}) {
    const record = register(modal, fallbackFocus);
    if (!record) return false;
    cancelFrame(record);
    record.returnFocus = resolve(trigger) || resolve(document.activeElement);
    record.parentModal = top() && top() !== modal ? top() : null;
    if (fallbackFocus) record.fallbackFocus = fallbackFocus;
    const existing = stack.indexOf(modal);
    if (existing >= 0) stack.splice(existing, 1);
    stack.push(modal);
    setInert(modal, false);
    modal.setAttribute('aria-hidden', 'false');
    modal.classList.add('active');
    record.pendingFrame = requestAnimationFrame(() => {
      record.pendingFrame = null;
      if (top() !== modal || modal.inert || modal.getAttribute('aria-hidden') === 'true') return;
      const target = resolve(initialFocus);
      if (target && modal.contains(target)) target.focus();
      else focusable(modal)[0]?.focus();
      if (record.parentModal) setInert(record.parentModal, true);
    });
    return true;
  }

  function close(modal, { fallbackFocus = null } = {}) {
    const record = records.get(modal) || register(modal, fallbackFocus);
    if (!record) return false;
    cancelFrame(record);
    const index = stack.lastIndexOf(modal);
    if (index >= 0) stack.splice(index, 1);
    modal.classList.remove('active');
    if (record.parentModal) setInert(record.parentModal, false);
    let target = resolve(record.returnFocus) || resolve(fallbackFocus) || resolve(record.fallbackFocus);
    if (!target && record.parentModal?.classList.contains('active')) target = focusable(record.parentModal)[0] || null;
    if (!target) target = resolve('#btn-toggle-sidebar') || resolve('#btn-open-add-task');
    target?.focus();
    if (modal.contains(document.activeElement)) {
      const emergency = resolve('#btn-toggle-sidebar') || resolve('#btn-open-add-task');
      emergency?.focus();
    }
    if (modal.contains(document.activeElement)) return false;
    modal.setAttribute('aria-hidden', 'true');
    setInert(modal, true);
    record.returnFocus = null;
    record.parentModal = null;
    return true;
  }

  function handleTab(event) {
    if (event.key !== 'Tab') return;
    const modal = top();
    if (!modal || modal.inert) return;
    const items = focusable(modal);
    if (!items.length) return;
    const first = items[0];
    const last = items.at(-1);
    if (!modal.contains(document.activeElement)) {
      event.preventDefault();
      first.focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function init() {
    if (initialized) return;
    initialized = true;
    document.querySelectorAll('.modal-overlay[role="dialog"]').forEach(modal => register(modal));
    document.addEventListener('keydown', handleTab, true);
  }

  return { init, register, open, close, getTopModal: top, setInert };
})();
