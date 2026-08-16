/**
 * todo-bridge-client.js - Correlated Chat -> Shell -> Todo RPC client.
 */

const SHELL_CHANNEL = 'mahdi-app-shell';
const SHELL_VERSION = 1;
const IS_EMBEDDED = new URLSearchParams(window.location.search).get('embedded') === '1' && window.parent !== window;
const MAX_TODO_RPC_CHARS = 64 * 1024;
const WAKE_TIMEOUT_MS = 35_000;
const READ_TIMEOUT_MS = 20_000;
const MUTATION_TIMEOUT_MS = 60_000;
const LATE_RESULT_TTL_MS = 2 * 60_000;
const MUTATION_TOOLS = new Set([
  'todo_create_tasks', 'todo_update_tasks', 'todo_delete_tasks',
  'todo_create_projects', 'todo_update_projects', 'todo_delete_projects',
  'todo_create_tags', 'todo_update_tags', 'todo_delete_tags',
  'todo_update_workspace'
]);

let initialized = false;
let supported = false;
const pending = new Map();
const lateWatch = new Map();

function randomId() {
  if (globalThis.crypto?.randomUUID) return `todo-rpc:${crypto.randomUUID()}`;
  return `todo-rpc:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}

function abortError(message = 'Todo request was stopped.', dispatched = false) {
  let error;
  if (typeof DOMException !== 'undefined') error = new DOMException(message, 'AbortError');
  else { error = new Error(message); error.name = 'AbortError'; }
  try { error.todoDispatched = Boolean(dispatched); } catch (_) {}
  return error;
}

function rpcError(code, message, details = {}) {
  const error = new Error(message);
  error.name = 'TodoRpcError';
  error.code = code;
  error.details = details;
  return error;
}

function fits(value) {
  try { return JSON.stringify(value).length <= MAX_TODO_RPC_CHARS; }
  catch (_) { return false; }
}

function post(type, payload = {}) {
  if (!IS_EMBEDDED || !fits({ type, payload })) return false;
  window.parent.postMessage({
    channel: SHELL_CHANNEL,
    version: SHELL_VERSION,
    app: 'chat',
    type,
    payload
  }, window.location.origin);
  return true;
}

function validShellMessage(event) {
  if (!IS_EMBEDDED || event.origin !== window.location.origin || event.source !== window.parent) return false;
  const message = event.data;
  if (!message || typeof message !== 'object') return false;
  if (message.channel !== SHELL_CHANNEL || message.version !== SHELL_VERSION || message.app !== 'shell') return false;
  if (typeof message.type !== 'string' || message.type.length > 80) return false;
  return fits(message);
}

function setSupported(next) {
  const value = Boolean(next && IS_EMBEDDED);
  if (supported === value) return;
  supported = value;
  window.dispatchEvent(new CustomEvent('todo-bridge-support-changed', { detail: { supported } }));
}

function retainLate(requestId) {
  const existing = lateWatch.get(requestId);
  if (existing) clearTimeout(existing);
  const timeout = setTimeout(() => lateWatch.delete(requestId), LATE_RESULT_TTL_MS);
  lateWatch.set(requestId, timeout);
}

function finishPending(requestId, callback) {
  const record = pending.get(requestId);
  if (!record) return false;
  pending.delete(requestId);
  clearTimeout(record.timeoutId);
  record.signal?.removeEventListener('abort', record.onAbort);
  callback(record);
  return true;
}

function handleResponse(payload) {
  const requestId = String(payload?.requestId || '');
  if (!requestId) return;
  const result = payload?.result && typeof payload.result === 'object'
    ? payload.result
    : { ok: false, error: { code: 'INTERNAL_TODO_ERROR', message: 'Todo returned an invalid result.' }, meta: { mutationOccurred: false } };

  if (finishPending(requestId, record => record.resolve({ requestId, result }))) return;
  if (lateWatch.has(requestId)) {
    clearTimeout(lateWatch.get(requestId));
    lateWatch.delete(requestId);
  }
  // Also surface unmatched responses after a Chat iframe reload. The replay guard
  // keeps the request receipt in sessionStorage and can reconcile it by requestId.
  window.dispatchEvent(new CustomEvent('todo-tool-late-result', { detail: { requestId, result } }));
}

export function initializeTodoBridgeClient() {
  if (!IS_EMBEDDED || initialized) return false;
  initialized = true;
  window.addEventListener('message', event => {
    if (!validShellMessage(event)) return;
    const message = event.data;
    const payload = message.payload && typeof message.payload === 'object' ? message.payload : {};
    if (message.type === 'shell:todo-rpc-capabilities') {
      setSupported(payload.supported === true && payload.version === 'todo-rpc-v1');
    } else if (message.type === 'shell:todo-tool-dispatched') {
      const requestId = String(payload.requestId || '');
      const record = pending.get(requestId);
      if (record) {
        record.todoDispatched = true;
        clearTimeout(record.timeoutId);
        const executionTimeoutMs = MUTATION_TOOLS.has(record.functionName) ? MUTATION_TIMEOUT_MS : READ_TIMEOUT_MS;
        record.timeoutId = setTimeout(() => {
          retainLate(requestId);
          finishPending(requestId, current => current.reject(rpcError(
            'BRIDGE_TIMEOUT',
            `Todo ${MUTATION_TOOLS.has(current.functionName) ? 'mutation' : 'read'} did not return before the execution timeout.`,
            { requestId, dispatched: true }
          )));
        }, executionTimeoutMs);
      }
    } else if (message.type === 'shell:todo-tool-response') {
      handleResponse(payload);
    }
  });
  return true;
}

export function isTodoBridgeSupported() {
  return Boolean(IS_EMBEDDED && supported);
}

export function getTodoProviderCapabilities() {
  return { todo: isTodoBridgeSupported() };
}

export function createTodoRequestId() {
  let id = randomId();
  while (pending.has(id) || lateWatch.has(id)) id = randomId();
  return id;
}

export function invokeTodoTool({ requestId, functionName, args = {}, signal = null } = {}) {
  if (!isTodoBridgeSupported()) {
    return Promise.reject(rpcError('TODO_UNAVAILABLE', 'The combined-app Todo RPC bridge is unavailable.'));
  }
  const id = String(requestId || createTodoRequestId());
  if (pending.has(id) || lateWatch.has(id)) {
    return Promise.reject(rpcError('INVALID_ARGUMENT', 'Todo RPC request ID collision.', { requestId: id }));
  }
  if (signal?.aborted) return Promise.reject(abortError('Todo request was stopped before dispatch.', false));

  const payload = { requestId: id, functionName: String(functionName || ''), args: args || {} };
  if (!fits({ channel: SHELL_CHANNEL, version: SHELL_VERSION, app: 'chat', type: 'chatui:todo-tool-request', payload })) {
    return Promise.reject(rpcError('RESULT_TOO_LARGE', 'Todo request exceeds the 64 KiB RPC limit.'));
  }

  return new Promise((resolve, reject) => {
    const record = {
      requestId: id,
      functionName,
      signal,
      resolve,
      reject,
      timeoutId: null,
      onAbort: null,
      shellSent: false,
      todoDispatched: false
    };
    record.onAbort = () => {
      const mayHaveDispatched = record.shellSent;
      if (mayHaveDispatched) {
        post('chatui:todo-tool-cancel', { requestId: id });
        retainLate(id);
      }
      finishPending(id, current => current.reject(abortError('Todo request was stopped.', mayHaveDispatched)));
    };
    if (signal) signal.addEventListener('abort', record.onAbort, { once: true });
    record.timeoutId = setTimeout(() => {
      if (record.shellSent) post('chatui:todo-tool-cancel', { requestId: id });
      retainLate(id);
      finishPending(id, current => current.reject(rpcError(
        'BRIDGE_TIMEOUT',
        'Todo did not become ready and dispatch the request before the readiness timeout.',
        { requestId: id, dispatched: current.shellSent }
      )));
    }, WAKE_TIMEOUT_MS);
    pending.set(id, record);

    if (!post('chatui:todo-tool-request', payload)) {
      finishPending(id, current => current.reject(rpcError('TODO_UNAVAILABLE', 'Todo request could not be sent to the Shell.')));
      return;
    }
    record.shellSent = true;
  });
}
