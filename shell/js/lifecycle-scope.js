let captureOwner = null;

function normalizeCapture(options) {
  if (typeof options === 'boolean') return options;
  return Boolean(options?.capture);
}

export function createLifecycleScope(label = 'module') {
  const listeners = [];
  const intervals = [];
  const cleanups = [];
  let disposed = false;
  let suspended = false;
  let capturing = false;
  let originalAdd = null;
  let originalRemove = null;
  let originalSetInterval = null;
  let originalClearInterval = null;

  function recordCleanup(cleanup) {
    if (typeof cleanup === 'function') cleanups.push(cleanup);
    return cleanup;
  }

  function matchingListener(record, target, type, listener, options) {
    return record.target === target && record.type === type && record.listener === listener && record.capture === normalizeCapture(options);
  }

  async function capture(work) {
    if (disposed) throw new Error(`${label} lifecycle scope is already disposed.`);
    if (capturing) return work();
    if (captureOwner && captureOwner !== api) {
      throw new Error(`Cannot capture ${label} listeners while another module lifecycle is capturing.`);
    }

    captureOwner = api;
    capturing = true;
    originalAdd = EventTarget.prototype.addEventListener;
    originalRemove = EventTarget.prototype.removeEventListener;
    originalSetInterval = window.setInterval.bind(window);
    originalClearInterval = window.clearInterval.bind(window);

    EventTarget.prototype.addEventListener = function(type, listener, options) {
      originalAdd.call(this, type, listener, options);
      listeners.push({
        target: this,
        type,
        listener,
        options,
        capture: normalizeCapture(options),
        attached: true
      });
    };

    EventTarget.prototype.removeEventListener = function(type, listener, options) {
      originalRemove.call(this, type, listener, options);
      const record = [...listeners].reverse().find(item => matchingListener(item, this, type, listener, options) && item.attached);
      if (record) record.attached = false;
    };

    window.setInterval = function(callback, delay, ...args) {
      const id = originalSetInterval(callback, delay, ...args);
      intervals.push({ callback, delay, args, id, active: true, resumeOnActivate: false });
      return id;
    };

    window.clearInterval = function(id) {
      const record = intervals.find(item => item.id === id && item.active);
      if (record) {
        record.active = false;
        record.resumeOnActivate = false;
      }
      return originalClearInterval(id);
    };

    try {
      return await work();
    } finally {
      EventTarget.prototype.addEventListener = originalAdd;
      EventTarget.prototype.removeEventListener = originalRemove;
      window.setInterval = originalSetInterval;
      window.clearInterval = originalClearInterval;
      originalAdd = null;
      originalRemove = null;
      originalSetInterval = null;
      originalClearInterval = null;
      capturing = false;
      if (captureOwner === api) captureOwner = null;
    }
  }

  function suspend() {
    if (disposed || suspended) return;
    suspended = true;
    for (let i = listeners.length - 1; i >= 0; i -= 1) {
      const record = listeners[i];
      if (!record.attached) continue;
      try { record.target.removeEventListener(record.type, record.listener, record.capture); }
      catch (_) {}
      record.attached = false;
    }
    for (const record of intervals) {
      if (!record.active) continue;
      window.clearInterval(record.id);
      record.active = false;
      record.resumeOnActivate = true;
    }
  }

  function resume() {
    if (disposed || !suspended) return;
    suspended = false;
    for (const record of listeners) {
      if (record.attached) continue;
      try {
        record.target.addEventListener(record.type, record.listener, record.options);
        record.attached = true;
      } catch (error) {
        console.warn(`[${label}] could not restore ${record.type} listener:`, error);
      }
    }
    for (const record of intervals) {
      if (!record.resumeOnActivate) continue;
      record.id = window.setInterval(record.callback, record.delay, ...record.args);
      record.active = true;
      record.resumeOnActivate = false;
    }
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    if (capturing) {
      if (originalAdd) EventTarget.prototype.addEventListener = originalAdd;
      if (originalRemove) EventTarget.prototype.removeEventListener = originalRemove;
      if (originalSetInterval) window.setInterval = originalSetInterval;
      if (originalClearInterval) window.clearInterval = originalClearInterval;
      originalAdd = null;
      originalRemove = null;
      originalSetInterval = null;
      originalClearInterval = null;
      capturing = false;
      if (captureOwner === api) captureOwner = null;
    }

    for (let i = cleanups.length - 1; i >= 0; i -= 1) {
      try { await cleanups[i](); }
      catch (error) { console.warn(`[${label}] cleanup failed:`, error); }
    }
    cleanups.length = 0;

    for (let i = listeners.length - 1; i >= 0; i -= 1) {
      const record = listeners[i];
      if (!record.attached) continue;
      try { record.target.removeEventListener(record.type, record.listener, record.capture); }
      catch (_) {}
      record.attached = false;
    }
    listeners.length = 0;

    for (const record of intervals) {
      if (record.active) window.clearInterval(record.id);
      record.active = false;
      record.resumeOnActivate = false;
    }
    intervals.length = 0;
    suspended = true;
  }

  const api = {
    capture,
    recordCleanup,
    suspend,
    resume,
    dispose,
    get disposed() { return disposed; },
    get suspended() { return suspended; },
    get listenerCount() { return listeners.length; },
    get intervalCount() { return intervals.length; }
  };
  return api;
}
