let captureOwner = null;

function normalizeCapture(options) {
  if (typeof options === 'boolean') return options;
  return Boolean(options?.capture);
}

export function createLifecycleScope(label = 'module') {
  const listeners = [];
  const cleanups = [];
  let disposed = false;
  let suspended = false;
  let capturing = false;
  let originalAdd = null;

  function recordCleanup(cleanup) {
    if (typeof cleanup === 'function') cleanups.push(cleanup);
    return cleanup;
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

    try {
      return await work();
    } finally {
      EventTarget.prototype.addEventListener = originalAdd;
      originalAdd = null;
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
  }

  async function dispose() {
    if (disposed) return;
    disposed = true;
    if (capturing && originalAdd) {
      EventTarget.prototype.addEventListener = originalAdd;
      originalAdd = null;
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
    get listenerCount() { return listeners.length; }
  };
  return api;
}
