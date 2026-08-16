const STARTUP_TIMEOUT_MS = 25000;

const FRAME_CONFIG = Object.freeze({
  todo: {
    frameId: 'todo-frame',
    panelId: 'todo-frame-panel',
    src: '/TodoList-ui/index.html?embedded=1',
    expectedPath: '/TodoList-ui/index.html'
  },
  chat: {
    frameId: 'chat-frame',
    panelId: 'chat-frame-panel',
    src: '/ChatUI/embedded.html?embedded=1',
    expectedPath: '/ChatUI/embedded.html'
  }
});

function addRetryToken(src) {
  const url = new URL(src, window.location.origin);
  url.searchParams.set('retry', String(Date.now()));
  return `${url.pathname}${url.search}`;
}

export function createFrameManager({ onStateChange } = {}) {
  const records = new Map();

  for (const [app, config] of Object.entries(FRAME_CONFIG)) {
    const frame = document.getElementById(config.frameId);
    const panel = document.getElementById(config.panelId);
    if (!frame || !panel) throw new Error(`Missing ${app} frame shell elements.`);
    records.set(app, {
      app,
      ...config,
      frame,
      panel,
      state: 'NOT_CREATED',
      readyPayload: null,
      queue: [],
      timeoutId: null,
      hasLoadedEvent: false,
      stateWaiters: new Set(),
      readyPromise: null
    });
  }

  function notifyStateWaiters(record) {
    for (const waiter of [...record.stateWaiters]) {
      try { waiter(record.state, record.readyPayload); } catch (_) {}
    }
  }

  function updatePanel(record, state, detail = '') {
    record.state = state;
    record.panel.dataset.frameState = state.toLowerCase().replace('_', '-');
    const detailEl = record.panel.querySelector('.frame-error-detail');
    if (detailEl) detailEl.textContent = detail ? ` ${detail}` : '';
    onStateChange?.(record.app, state, detail);
    notifyStateWaiters(record);
  }

  function clearTimeoutFor(record) {
    if (!record.timeoutId) return;
    window.clearTimeout(record.timeoutId);
    record.timeoutId = null;
  }

  function armTimeout(record) {
    clearTimeoutFor(record);
    record.timeoutId = window.setTimeout(() => {
      if (record.state === 'READY') return;
      markFailed(record.app, 'The application did not report ready state in time.');
    }, STARTUP_TIMEOUT_MS);
  }

  function verifyExpectedLocation(record) {
    try {
      const childUrl = new URL(record.frame.contentWindow.location.href);
      return childUrl.origin === window.location.origin && childUrl.pathname === record.expectedPath;
    } catch (_) {
      return false;
    }
  }

  function handleLoad(record) {
    if (!record.hasLoadedEvent) {
      record.hasLoadedEvent = true;
      if (record.state !== 'READY') {
        updatePanel(record, 'LOADING');
        armTimeout(record);
      }
      return;
    }

    if (!verifyExpectedLocation(record)) {
      markFailed(record.app, 'The iframe navigated away from its application.');
      return;
    }

    record.readyPayload = null;
    updatePanel(record, 'LOADING');
    armTimeout(record);
  }

  function start(app, { retry = false } = {}) {
    const record = records.get(app);
    if (!record) return false;
    if (!retry && record.state !== 'NOT_CREATED') return false;

    clearTimeoutFor(record);
    record.readyPayload = null;
    record.hasLoadedEvent = false;
    updatePanel(record, 'LOADING');
    armTimeout(record);
    record.frame.src = retry ? addRetryToken(record.src) : record.src;
    return true;
  }

  function startAll() {
    for (const app of records.keys()) start(app);
  }

  function markReady(app, payload = {}) {
    const record = records.get(app);
    if (!record) return false;
    clearTimeoutFor(record);
    record.readyPayload = payload;
    updatePanel(record, 'READY');
    const pending = record.queue.splice(0);
    for (const message of pending) {
      record.frame.contentWindow?.postMessage(message, window.location.origin);
    }
    return true;
  }

  function markFailed(app, detail = 'Startup failed.') {
    const record = records.get(app);
    if (!record) return;
    clearTimeoutFor(record);
    record.readyPayload = null;
    updatePanel(record, 'FAILED', detail);
  }

  function retry(app) {
    const record = records.get(app);
    if (!record || record.state !== 'FAILED') return false;
    return start(app, { retry: true });
  }

  function send(app, message) {
    const record = records.get(app);
    if (!record) return false;
    if (record.state !== 'READY') {
      record.queue.push(message);
      return false;
    }
    record.frame.contentWindow?.postMessage(message, window.location.origin);
    return true;
  }

  function sendNow(app, message) {
    const record = records.get(app);
    if (!record || record.state !== 'READY') return false;
    record.frame.contentWindow?.postMessage(message, window.location.origin);
    return true;
  }

  function waitForReadyOrFailed(record, timeoutMs) {
    if (record.state === 'READY' || record.state === 'FAILED') {
      return Promise.resolve({ state: record.state, payload: record.readyPayload });
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timeoutId);
        record.stateWaiters.delete(onState);
        resolve(value);
      };
      const onState = state => {
        if (state === 'READY' || state === 'FAILED') finish({ state, payload: record.readyPayload });
      };
      const timeoutId = window.setTimeout(() => {
        if (settled) return;
        settled = true;
        record.stateWaiters.delete(onState);
        reject(new Error(`${record.app} did not become ready before the readiness timeout.`));
      }, timeoutMs);
      record.stateWaiters.add(onState);
    });
  }

  function ensureReady(app, { timeoutMs = 30000, retryFailed = true } = {}) {
    const record = records.get(app);
    if (!record) return Promise.reject(new Error(`Unknown application frame: ${app}`));
    if (record.state === 'READY') return Promise.resolve(record.readyPayload || {});
    if (record.readyPromise) return record.readyPromise;

    const promise = (async () => {
      let retried = false;
      const deadline = Date.now() + timeoutMs;
      while (true) {
        if (record.state === 'READY') return record.readyPayload || {};
        const remainingMs = deadline - Date.now();
        if (remainingMs <= 0) throw new Error(`${app} did not become ready before the readiness timeout.`);
        if (record.state === 'NOT_CREATED') start(app);
        else if (record.state === 'FAILED') {
          if (!retryFailed || retried) throw new Error(`${app} is unavailable.`);
          retried = true;
          start(app, { retry: true });
        }

        const outcome = await waitForReadyOrFailed(record, remainingMs);
        if (outcome.state === 'READY') return outcome.payload || {};
        if (!retryFailed || retried) throw new Error(`${app} failed to start.`);
        retried = true;
        start(app, { retry: true });
      }
    })();

    record.readyPromise = promise;
    promise.finally(() => {
      if (record.readyPromise === promise) record.readyPromise = null;
    }).catch(() => {});
    return promise;
  }

  function activate(app) {
    for (const [id, record] of records) {
      const active = id === app;
      record.panel.dataset.shellActive = active ? 'true' : 'false';
      record.panel.setAttribute('aria-hidden', active ? 'false' : 'true');
      record.panel.inert = !active;
      if (!active) record.panel.setAttribute('inert', '');
      else record.panel.removeAttribute('inert');
      record.frame.tabIndex = active ? 0 : -1;
    }
  }

  function appFromWindow(source) {
    for (const [app, record] of records) {
      if (record.frame.contentWindow === source) return app;
    }
    return null;
  }

  function getState(app) { return records.get(app)?.state || 'NOT_CREATED'; }
  function getReadyPayload(app) { return records.get(app)?.readyPayload || null; }

  for (const record of records.values()) {
    record.frame.addEventListener('load', () => handleLoad(record));
  }
  document.querySelectorAll('[data-frame-retry]').forEach(button => {
    button.addEventListener('click', () => retry(button.dataset.frameRetry));
  });

  return {
    startAll,
    markReady,
    markFailed,
    retry,
    send,
    sendNow,
    ensureReady,
    activate,
    appFromWindow,
    getState,
    getReadyPayload
  };
}
