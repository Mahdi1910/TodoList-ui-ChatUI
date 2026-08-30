import assert from 'node:assert/strict';

if (typeof globalThis.CustomEvent === 'undefined') {
  globalThis.CustomEvent = class CustomEvent extends Event {
    constructor(type, options = {}) {
      super(type);
      this.detail = options.detail;
    }
  };
}

if (typeof globalThis.window === 'undefined') {
  class FakeWindow extends EventTarget {
    constructor() {
      super();
      this.location = { search: '', origin: 'https://chatui.test' };
      this.parent = this;
    }
  }
  globalThis.window = new FakeWindow();
}

const { state, setState } = await import('../ChatUI/js/state/store.js');
const { streamChat } = await import('../ChatUI/js/api/gemini.js');

setState({
  currentModel: '3.7 Flash',
  thinkingLevel: 'medium',
  tools: { googleSearch: false, urlContext: false, codeExecution: false, workspace: false, todo: false },
  api: {
    ...state.api,
    activeTextProfileId: 'mode-1',
    textProfiles: [
      { id: 'mode-1', name: 'Mode 1', textApiKey: 'fixture-key', textApiKeys: [{ key: 'fixture-key' }], textApiKeyIndex: 0, textBaseUrl: 'https://gemini.test' },
      { id: 'mode-2', name: 'Mode 2', textApiKey: '', textApiKeys: [], textApiKeyIndex: 0, textBaseUrl: '' }
    ],
    textApiKey: 'fixture-key',
    textApiKeys: [{ key: 'fixture-key' }],
    textApiKeyIndex: 0,
    textBaseUrl: 'https://gemini.test'
  }
}, { source: 'fixture.setup' });

const encoder = new TextEncoder();
function streamingResponse(chunks) {
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    }
  }), { status: 200, headers: { 'content-type': 'text/event-stream' } });
}

const sse = [
  'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"Hel"}]}}]}\n',
  'data: {not-json}\n',
  'data: {"candidates":[{"content":{"role":"model","parts":[{"text":"reason","thought":true,"thoughtSignature":"sig-1"},{"text":"lo"}]},"finishReason":"STOP"}]}\n',
  'data: [DONE]\n'
].join('');
const splitPoints = [11, 37, 79, 123, 171, sse.length];
const chunks = [];
let start = 0;
for (const end of splitPoints) {
  if (end > start) chunks.push(sse.slice(start, end));
  start = end;
}
if (start < sse.length) chunks.push(sse.slice(start));

let requestUrl = '';
let requestOptions = null;
globalThis.fetch = async (url, options) => {
  requestUrl = String(url);
  requestOptions = options;
  return streamingResponse(chunks);
};

const textChunks = [];
const thoughtChunks = [];
const activity = [];
let completed = null;
const result = await streamChat({
  model: '3.7 Flash',
  messages: [{ id: 'user-1', role: 'user', content: 'Hello', sequence: 0, createdAt: 1 }],
  activeTools: { googleSearch: false, urlContext: false, codeExecution: false, workspace: false, todo: false },
  signal: new AbortController().signal,
  onChunk: (chunk, fullText) => textChunks.push({ chunk, fullText }),
  onThoughtChunk: (chunk, fullThinking) => thoughtChunks.push({ chunk, fullThinking }),
  onActivityEvent: event => activity.push(event),
  onComplete: (text, thinking, signature, parts) => { completed = { text, thinking, signature, parts }; }
});

assert.equal(result, 'Hello', 'split SSE chunks must reconstruct the full assistant text');
assert.equal(completed?.text, 'Hello');
assert.equal(completed?.thinking, 'reason');
assert.equal(completed?.signature, 'sig-1');
assert.equal(textChunks.at(-1)?.fullText, 'Hello');
assert.equal(thoughtChunks.at(-1)?.fullThinking, 'reason');
assert.ok(activity.some(event => event.type === 'text.delta'), 'text activity must be emitted');
assert.ok(activity.some(event => event.type === 'thinking.delta'), 'thinking activity must be emitted');
assert.match(requestUrl, /gemini-3\.7-flash:streamGenerateContent\?alt=sse$/, 'Gemini text requests must use the SSE endpoint');
assert.equal(requestOptions?.headers?.['x-goog-api-key'], 'fixture-key');
const requestBody = JSON.parse(requestOptions.body);
assert.equal(requestBody.contents.at(-1)?.role, 'user');
assert.equal(requestBody.contents.at(-1)?.parts?.[0]?.text, 'Hello');

const aborted = new AbortController();
aborted.abort();
globalThis.fetch = async () => streamingResponse([]);
await assert.rejects(
  streamChat({
    model: '3.7 Flash',
    messages: [{ id: 'user-2', role: 'user', content: 'Stop', sequence: 0, createdAt: 1 }],
    activeTools: { googleSearch: false, urlContext: false, codeExecution: false, workspace: false, todo: false },
    signal: aborted.signal
  }),
  error => error?.name === 'AbortError',
  'an aborted generation must stop before consuming the stream'
);

console.log('Gemini SSE streaming fixture verification passed.');
