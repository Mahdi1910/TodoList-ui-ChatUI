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

export function setState(patch) {
  if (patch?.api) patch = { ...patch, api: synchronizeApiProfiles(patch.api) };
  Object.assign(state, patch);
}

export function setRuntime(patch) {
  Object.assign(runtime, patch);
}

export function updateChat(chatId, updater) {
  const index = state.chats.findIndex(chat => chat.id === chatId);
  if (index === -1) return null;
  const updatedChat = updater({ ...state.chats[index] });
  state.chats = state.chats.map((chat, i) => i === index ? updatedChat : chat);
  return updatedChat;
}

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