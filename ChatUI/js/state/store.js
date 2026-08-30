/**
 * store.js — Central Application & Runtime State Management
 */

export function createEntityId(prefix) {
  const randomId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2)}`;
  return `${prefix}_${randomId}`;
}

export function createMessageSequence(messages = []) {
  const maxSequence = messages.reduce((max, message) => {
    const sequence = Number(message?.sequence);
    return Number.isSafeInteger(sequence) && sequence > max ? sequence : max;
  }, -1);
  return maxSequence + 1;
}

const DEFAULT_TEXT_PROFILES = [
  { id: 'mode-1', name: 'Mode 1', textApiKey: '', textApiKeys: [], textApiKeyIndex: 0, textBaseUrl: '' },
  { id: 'mode-2', name: 'Mode 2', textApiKey: '', textApiKeys: [], textApiKeyIndex: 0, textBaseUrl: '' }
];

export const state = {
  projects: [],
  chats: [],
  activeChatId: null,
  activeProjectId: null,
  currentModel: '3.7 Flash',
  thinkingLevel: 'medium',
  customToolRoundLimit: 24,
  theme: 'dark',
  accentColor: '#3B82F6',
  tools: {
    googleSearch: false,
    urlContext: false,
    codeExecution: false,
    workspace: false,
    todo: false
  },
  api: {
    activeTextProfileId: 'mode-1',
    textProfiles: DEFAULT_TEXT_PROFILES.map(profile => ({ ...profile })),
    textApiKey: '',
    textApiKeys: [],
    textApiKeyIndex: 0,
    textBaseUrl: '',
    voiceApiKey: '',
    voiceBaseUrl: ''
  },
  audioRead: {
    voiceName: 'Zephyr',
    retentionDays: 7
  }
};

export const runtime = {
  isGenerating: false,
  currentGenerationId: null,
  attachedFiles: [],
  isRecordingAudio: false,
  mediaRecorder: null,
  audioChunks: [],
  audioRecordedBytes: 0,
  audioRecordingByteLimit: 0,
  isStoppingAudioRecording: false,
  audioRecordingLimitReached: false,
  mediaStreamTrack: null,
  activeAbortController: null,
  currentVoiceIndex: 0,
  activeChatForProjectAdd: null,
  activeProjectForChatManagement: null,
  collapsedProjectIds: new Set(),
  activeChatForRename: null,
  activeProjectForRename: null,
  lastFocusedElement: null,
  isVoiceMuted: false,
  isVoiceModeActive: false
};

const stateListeners = new Set();
const runtimeListeners = new Set();
let stateRevision = 0;
let runtimeRevision = 0;

function notifyListeners(listeners, change, label) {
  for (const listener of [...listeners]) {
    try { listener(change); }
    catch (error) { console.error(`${label} listener failed:`, error); }
  }
}

export function getStateRevision() {
  return stateRevision;
}

export function getRuntimeRevision() {
  return runtimeRevision;
}

export function subscribeStateChanges(listener) {
  if (typeof listener !== 'function') return () => {};
  stateListeners.add(listener);
  return () => stateListeners.delete(listener);
}

export function subscribeRuntimeChanges(listener) {
  if (typeof listener !== 'function') return () => {};
  runtimeListeners.add(listener);
  return () => runtimeListeners.delete(listener);
}

export function normalizeProjectId(projectId, projects = state.projects) {
  if (!projectId) return null;
  return (projects || []).some(project => project?.id === projectId) ? projectId : null;
}

function synchronizeApiProfiles(apiPatch) {
  if (!apiPatch || !Array.isArray(apiPatch.textProfiles) || !apiPatch.activeTextProfileId) return apiPatch;
  const activeId = apiPatch.activeTextProfileId;
  const activeProfile = apiPatch.textProfiles.find(profile => profile?.id === activeId);
  if (!activeProfile) return apiPatch;
  const fields = ['textApiKey', 'textApiKeys', 'textApiKeyIndex', 'textBaseUrl'];
  const nextActive = { ...activeProfile };
  fields.forEach(field => {
    if (apiPatch[field] !== undefined) nextActive[field] = apiPatch[field];
  });
  return {
    ...apiPatch,
    textProfiles: apiPatch.textProfiles.map(profile => profile?.id === activeId ? nextActive : profile)
  };
}

/**
 * Generic state assignment plus the existing Text API profile compatibility
 * contract. Feature-specific business rules remain outside the store.
 */
export function setState(patch, meta = {}) {
  if (!patch || typeof patch !== 'object') return stateRevision;
  if (patch?.api) patch = { ...patch, api: synchronizeApiProfiles(patch.api) };
  const previous = {};
  Object.keys(patch).forEach(key => { previous[key] = state[key]; });
  Object.assign(state, patch);
  stateRevision += 1;
  notifyListeners(stateListeners, Object.freeze({
    kind: 'state',
    revision: stateRevision,
    source: meta.source || 'setState',
    keys: Object.freeze(Object.keys(patch)),
    patch,
    previous
  }), 'State change');
  return stateRevision;
}

export function setRuntime(patch, meta = {}) {
  if (!patch || typeof patch !== 'object') return runtimeRevision;
  const previous = {};
  Object.keys(patch).forEach(key => { previous[key] = runtime[key]; });
  Object.assign(runtime, patch);
  runtimeRevision += 1;
  notifyListeners(runtimeListeners, Object.freeze({
    kind: 'runtime',
    revision: runtimeRevision,
    source: meta.source || 'setRuntime',
    keys: Object.freeze(Object.keys(patch)),
    patch,
    previous
  }), 'Runtime change');
  return runtimeRevision;
}

export function updateChat(chatId, updater, meta = {}) {
  const index = state.chats.findIndex(chat => chat.id === chatId);
  if (index === -1 || typeof updater !== 'function') return null;
  const previousChat = state.chats[index];
  const updatedChat = updater({ ...previousChat });
  if (!updatedChat) return null;
  state.chats = state.chats.map((chat, i) => i === index ? updatedChat : chat);
  stateRevision += 1;
  notifyListeners(stateListeners, Object.freeze({
    kind: 'chat',
    revision: stateRevision,
    source: meta.source || 'updateChat',
    keys: Object.freeze(['chats']),
    chatId,
    previousChat,
    chat: updatedChat
  }), 'State change');
  return updatedChat;
}

/**
 * Compare-before-update helper for asynchronous rollback paths. A stale async
 * operation can change a chat only while the predicate still proves that the
 * chat is in the state owned by that operation.
 */
export function updateChatIf(chatId, predicate, updater, meta = {}) {
  const current = state.chats.find(chat => chat.id === chatId);
  if (!current || typeof predicate !== 'function' || !predicate(current)) return null;
  return updateChat(chatId, updater, meta);
}
