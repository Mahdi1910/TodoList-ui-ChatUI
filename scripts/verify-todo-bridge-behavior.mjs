import assert from 'node:assert/strict';

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this.detail = options.detail;
    }
  };
}

class FakeWindow extends EventTarget {
  constructor() {
    super();
    this.location = { search: '?embedded=1', origin: 'https://chatui.test' };
    this.parent = {
      messages: [],
      postMessage: (message, targetOrigin) => {
        this.parent.messages.push({ message, targetOrigin });
      }
    };
  }
}

const fakeWindow = new FakeWindow();
globalThis.window = fakeWindow;

function shellMessage(type, payload = {}, overrides = {}) {
  const event = new Event('message');
  Object.defineProperties(event, {
    origin: { value: overrides.origin || fakeWindow.location.origin },
    source: { value: overrides.source || fakeWindow.parent },
    data: {
      value: {
        channel: 'mahdi-app-shell',
        version: 1,
        app: 'shell',
        type,
        payload
      }
    }
  });
  fakeWindow.dispatchEvent(event);
}

const bridge = await import('../ChatUI/js/todo/todo-bridge-client.js');
assert.equal(bridge.initializeTodoBridgeClient(), true, 'embedded Todo bridge must initialize');
assert.equal(bridge.isTodoBridgeSupported(), false, 'Todo must begin unavailable until Shell advertises capability');

shellMessage('shell:todo-rpc-capabilities', { supported: true, version: 'todo-rpc-v1' }, { origin: 'https://evil.test' });
assert.equal(bridge.isTodoBridgeSupported(), false, 'messages from the wrong origin must be ignored');

shellMessage('shell:todo-rpc-capabilities', { supported: true, version: 'todo-rpc-v1' });
assert.equal(bridge.isTodoBridgeSupported(), true, 'valid Shell capability message must enable Todo RPC');

const request = bridge.invokeTodoTool({
  requestId: 'rpc-success',
  functionName: 'todo_create_tasks',
  args: { tasks: [{ title: 'Test task' }] }
});
const sentRequest = fakeWindow.parent.messages.at(-1);
assert.equal(sentRequest.targetOrigin, fakeWindow.location.origin, 'Todo RPC must post only to the current origin');
assert.equal(sentRequest.message.type, 'chatui:todo-tool-request');
assert.equal(sentRequest.message.payload.requestId, 'rpc-success');

shellMessage('shell:todo-tool-dispatched', { requestId: 'rpc-success' });
shellMessage('shell:todo-tool-response', {
  requestId: 'rpc-success',
  result: { ok: true, data: { created: ['task-1'] }, meta: { mutationOccurred: true } }
});
const response = await request;
assert.equal(response.requestId, 'rpc-success');
assert.equal(response.result.ok, true);
assert.deepEqual(response.result.data.created, ['task-1']);

await assert.rejects(
  bridge.invokeTodoTool({
    requestId: 'rpc-large',
    functionName: 'todo_create_tasks',
    args: { text: 'x'.repeat(70 * 1024) }
  }),
  error => error?.name === 'TodoRpcError' && error?.code === 'RESULT_TOO_LARGE',
  'oversized requests must be rejected before dispatch'
);

const collisionController = new AbortController();
const firstCollision = bridge.invokeTodoTool({
  requestId: 'rpc-collision',
  functionName: 'todo_find_tasks',
  args: {},
  signal: collisionController.signal
});
await assert.rejects(
  bridge.invokeTodoTool({ requestId: 'rpc-collision', functionName: 'todo_find_tasks', args: {} }),
  error => error?.name === 'TodoRpcError' && error?.code === 'INVALID_ARGUMENT',
  'duplicate live request IDs must be rejected'
);
collisionController.abort();
await assert.rejects(firstCollision, error => error?.name === 'AbortError');

let lateResult = null;
fakeWindow.addEventListener('todo-tool-late-result', event => { lateResult = event.detail; }, { once: true });
const abortController = new AbortController();
const abortedRequest = bridge.invokeTodoTool({
  requestId: 'rpc-abort',
  functionName: 'todo_update_tasks',
  args: { tasks: [{ id: 'task-1', title: 'Changed' }] },
  signal: abortController.signal
});
abortController.abort();
await assert.rejects(
  abortedRequest,
  error => error?.name === 'AbortError' && error?.todoDispatched === true,
  'aborting after Shell dispatch must report that the mutation may already have been sent'
);
assert.equal(fakeWindow.parent.messages.at(-1).message.type, 'chatui:todo-tool-cancel', 'abort must send a cancel message');

shellMessage('shell:todo-tool-response', {
  requestId: 'rpc-abort',
  result: { ok: true, data: { updated: ['task-1'] }, meta: { mutationOccurred: true } }
});
assert.equal(lateResult?.requestId, 'rpc-abort', 'late mutation results must be surfaced for reconciliation');
assert.equal(lateResult?.result?.ok, true);

console.log('Todo bridge behavioral protocol verification passed.');
