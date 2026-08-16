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

export const state = {
  projects: [],
  chats: [],
  activeChatId: null,
  activeProjectId: null,
  currentModel: '3.7 Flash',
  thinkingLevel: 'medium',
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
    textApiKey: '',
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

export function setState(patch) {
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
