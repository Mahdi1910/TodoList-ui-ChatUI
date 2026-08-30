import assert from 'node:assert/strict';
import {
  state,
  runtime,
  setState,
  setRuntime,
  updateChatIf,
  getStateRevision,
  getRuntimeRevision,
  subscribeStateChanges,
  subscribeRuntimeChanges
} from '../ChatUI/js/state/store.js';

const stateEvents = [];
const runtimeEvents = [];
const unsubscribeState = subscribeStateChanges(event => stateEvents.push(event));
const unsubscribeRuntime = subscribeRuntimeChanges(event => runtimeEvents.push(event));

const initialStateRevision = getStateRevision();
setState({ chats: [{ id: 'chat-race', title: 'Original', status: 'pending' }] }, { source: 'test.setup' });
assert.equal(getStateRevision(), initialStateRevision + 1, 'setState must advance the state revision');

const completed = updateChatIf(
  'chat-race',
  chat => chat.status === 'pending',
  chat => ({ ...chat, title: 'Newest result', status: 'completed' }),
  { source: 'test.complete' }
);
assert.equal(completed?.title, 'Newest result');

const staleRollback = updateChatIf(
  'chat-race',
  chat => chat.status === 'pending',
  chat => ({ ...chat, title: 'Stale rollback', status: 'failed' }),
  { source: 'test.stale' }
);
assert.equal(staleRollback, null, 'a stale async rollback must lose when its ownership predicate no longer matches');
assert.equal(state.chats[0].title, 'Newest result', 'stale work must not overwrite newer chat state');
assert.equal(state.chats[0].status, 'completed');

assert.ok(stateEvents.length >= 2, 'state listeners must observe state changes');
for (let index = 1; index < stateEvents.length; index += 1) {
  assert.ok(stateEvents[index].revision > stateEvents[index - 1].revision, 'state event revisions must increase monotonically');
}
assert.equal(stateEvents.at(-1).source, 'test.complete', 'failed compare-before-update attempts must not emit a state event');

const initialRuntimeRevision = getRuntimeRevision();
setRuntime({ isGenerating: true, currentGenerationId: 'generation-test' }, { source: 'test.runtime' });
assert.equal(getRuntimeRevision(), initialRuntimeRevision + 1, 'setRuntime must advance the runtime revision');
assert.equal(runtime.currentGenerationId, 'generation-test');
assert.equal(runtimeEvents.at(-1)?.source, 'test.runtime');

const profiles = [
  { id: 'mode-1', name: 'Mode 1', textApiKey: 'old-key', textApiKeys: [], textApiKeyIndex: 0, textBaseUrl: '' },
  { id: 'mode-2', name: 'Mode 2', textApiKey: '', textApiKeys: [], textApiKeyIndex: 0, textBaseUrl: '' }
];
setState({
  api: {
    ...state.api,
    activeTextProfileId: 'mode-1',
    textProfiles: profiles,
    textApiKey: 'new-key',
    textApiKeys: [{ key: 'new-key' }],
    textApiKeyIndex: 0,
    textBaseUrl: 'https://example.test'
  }
}, { source: 'test.profile-sync' });
const activeProfile = state.api.textProfiles.find(profile => profile.id === 'mode-1');
assert.equal(activeProfile.textApiKey, 'new-key', 'active Text API profile must stay synchronized with compatibility aliases');
assert.equal(activeProfile.textBaseUrl, 'https://example.test');

unsubscribeState();
unsubscribeRuntime();
console.log('ChatUI state race and revision behavior verification passed.');
