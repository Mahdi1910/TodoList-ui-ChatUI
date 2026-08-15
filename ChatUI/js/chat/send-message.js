/**
 * send-message.js - User send flow with durable pre-generation persistence.
 */

import {
  state,
  runtime,
  setState,
  setRuntime,
  updateChat,
  createEntityId,
  createMessageSequence,
  normalizeProjectId
} from '../state/store.js';
import { persistNewUserTurn } from '../storage/storage.js';
import { renderMessageDOM } from './messages.js';
import { updateFilePreviewsUI, validateAttachmentSet } from '../composer/attachments.js';
import { stopAudioRecording } from '../composer/recorder.js';
import { getChatDOMElements, scrollToBottom } from './ui.js';
import { messageDeleteHandler, messageEditHandler } from './message-actions.js';
import { sendGenerationForChat } from './generation-runner.js';
import { sendRegenerateRequest } from './regenerate.js';
import { ensureChatLoaded } from './chat-loader.js';
import { replaceChatRoute } from '../router/chat-router.js';
// TEMP_PERF_DIAGNOSTICS
import {
  beginPerformanceRun,
  endPerformancePhase,
  finishPerformanceRun,
  hasActivePerformanceRun,
  startPerformancePhase,
  updatePerformanceRunMetadata
} from '../diagnostics/performance-diagnostics.js';

function diagnosticAttachmentCategory(file) {
  const type = String(file?.type || '').toLowerCase();
  const name = String(file?.name || '').toLowerCase();
  if (type.startsWith('audio/')) return 'audio';
  if (type.startsWith('image/')) return 'image';
  if (type.includes('pdf') || name.endsWith('.pdf')) return 'pdf';
  if (type.startsWith('text/') || name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.markdown')) return 'text';
  return 'other';
}

function diagnosticAttachmentSummary(files = []) {
  const typeCounts = {};
  let bytes = 0;
  for (const file of files || []) {
    const category = diagnosticAttachmentCategory(file);
    typeCounts[category] = (typeCounts[category] || 0) + 1;
    bytes += Math.max(0, Number(file?.size) || 0);
  }
  return { count: files.length, bytes, typeCounts };
}

function diagnosticRequestKind(text, files = []) {
  const hasText = !!String(text || '').trim();
  const hasAudio = files.some(file => diagnosticAttachmentCategory(file) === 'audio');
  const hasOtherAttachment = files.some(file => diagnosticAttachmentCategory(file) !== 'audio');
  if (hasAudio && hasOtherAttachment && hasText) return 'mixed';
  if (hasAudio && hasOtherAttachment) return 'audio+attachment';
  if (hasAudio && hasText) return 'audio+text';
  if (hasAudio) return 'audio';
  if (hasOtherAttachment && hasText) return 'text+attachment';
  if (hasOtherAttachment) return 'attachment';
  return 'text';
}

function updateDiagnosticRequestMetadata(text, files, chat, { newChat = false, chatWasAlreadyLoaded = true } = {}) {
  if (!hasActivePerformanceRun()) return;
  const summary = diagnosticAttachmentSummary(files);
  updatePerformanceRunMetadata({
    requestKind: diagnosticRequestKind(text, files),
    textChars: String(text || '').length,
    currentAttachmentCount: summary.count,
    currentAttachmentBytes: summary.bytes,
    attachmentTypeCounts: summary.typeCounts,
    chatMessageCountBeforeSend: (chat?.messages || []).length,
    chatWasAlreadyLoaded,
    newChat,
    model: state.currentModel,
    thinkingLevel: state.thinkingLevel,
    enabledTools: { ...(state.tools || {}) }
  });
}

export async function sendMessage(updateSidebarCallback = null, options = {}) {
  const { emptyState, conversationThread, composerTextarea } = getChatDOMElements();
  if (!composerTextarea || runtime.isGenerating) return false;

  const initialText = composerTextarea.value.trim();
  const hasPotentialRequest = !!initialText || runtime.attachedFiles.length > 0 || runtime.isRecordingAudio;
  if (!hasPotentialRequest) return false;

  const initialChat = state.chats.find(chat => chat.id === state.activeChatId) || null;
  const chatWasAlreadyLoaded = !initialChat || initialChat.messagesLoaded === true;
  const initialAttachments = diagnosticAttachmentSummary(runtime.attachedFiles);

  // TEMP_PERF_DIAGNOSTICS
  beginPerformanceRun({
    requestKind: 'pending',
    textChars: initialText.length,
    currentAttachmentCount: runtime.attachedFiles.length,
    currentAttachmentBytes: initialAttachments.bytes,
    attachmentTypeCounts: initialAttachments.typeCounts,
    chatMessageCountBeforeSend: initialChat?.messagesLoaded === true
      ? (initialChat.messages || []).length
      : Math.max(0, Number(initialChat?.messageCount) || 0),
    chatWasAlreadyLoaded,
    newChat: !initialChat,
    model: state.currentModel,
    thinkingLevel: state.thinkingLevel,
    enabledTools: { ...(state.tools || {}) }
  });

  if (runtime.isRecordingAudio) {
    // TEMP_PERF_DIAGNOSTICS
    startPerformancePhase('audio_stop_and_blob_finalize');
    try {
      await stopAudioRecording();
    } finally {
      endPerformancePhase('audio_stop_and_blob_finalize');
    }
  }

  const text = composerTextarea.value.trim();
  if (!text && runtime.attachedFiles.length === 0) {
    finishPerformanceRun('rejected_empty');
    return false;
  }

  let currentChat = state.chats.find(chat => chat.id === state.activeChatId);
  if (currentChat && currentChat.messagesLoaded !== true) {
    // TEMP_PERF_DIAGNOSTICS
    startPerformancePhase('ensure_chat_loaded');
    try {
      currentChat = await ensureChatLoaded(currentChat.id);
    } catch (error) {
      endPerformancePhase('ensure_chat_loaded');
      finishPerformanceRun('chat_load_failed');
      console.error('Failed to load active chat before sending:', error);
      alert('Message was not sent because the active conversation could not be loaded.');
      return false;
    }
    endPerformancePhase('ensure_chat_loaded');
    if (!currentChat) {
      finishPerformanceRun('chat_load_failed');
      return false;
    }
  }

  const filesToSend = [...runtime.attachedFiles];
  if (!validateAttachmentSet(filesToSend).valid) {
    finishPerformanceRun('invalid_attachment');
    return false;
  }

  const previousChats = state.chats;
  const previousActiveChatId = state.activeChatId;
  let createdNewChat = false;

  if (!currentChat) {
    const now = Date.now();
    const projectId = normalizeProjectId(state.activeProjectId);
    if (projectId !== state.activeProjectId) setState({ activeProjectId: projectId });
    currentChat = {
      id: createEntityId('chat'),
      title: (text || 'Multimodal Chat').slice(0, 24) + ((text || '').length > 24 ? '...' : ''),
      projectId,
      pinned: false,
      createdAt: now,
      updatedAt: now,
      messages: [],
      messagesLoaded: true,
      messageCount: 0
    };
    setState({ chats: [...state.chats, currentChat], activeChatId: currentChat.id });
    createdNewChat = true;
  }

  // TEMP_PERF_DIAGNOSTICS
  updateDiagnosticRequestMetadata(text, filesToSend, currentChat, {
    newChat: createdNewChat,
    chatWasAlreadyLoaded
  });

  setRuntime({ attachedFiles: [] });
  updateFilePreviewsUI();

  // Plan 15: attachment preparation is now local Blob/object creation only.
  // Remote Files API work happens after the durable user-turn write succeeds.
  // TEMP_PERF_DIAGNOSTICS
  startPerformancePhase('new_attachment_prepare_total');
  let attachmentObjects;
  try {
    attachmentObjects = buildAttachments(filesToSend);
  } finally {
    endPerformancePhase('new_attachment_prepare_total');
  }

  const messageCreatedAt = Date.now();
  const userMsgObj = {
    id: createEntityId('msg_user'),
    role: 'user',
    content: text || (attachmentObjects.length ? '' : '[Attachment Sent]'),
    attachments: attachmentObjects,
    sequence: createMessageSequence(currentChat.messages || []),
    createdAt: messageCreatedAt,
    updatedAt: messageCreatedAt
  };
  currentChat = updateChat(currentChat.id, current => {
    const messages = [...current.messages, userMsgObj];
    return {
      ...current,
      messages,
      messagesLoaded: true,
      messageCount: messages.length,
      updatedAt: messageCreatedAt
    };
  });

  try {
    // Durability remains a hard precondition for all external Gemini work.
    // This writes the user turn and original attachment Blobs first.
    // TEMP_PERF_DIAGNOSTICS
    startPerformancePhase('persist_user_turn');
    try {
      await persistNewUserTurn(currentChat, userMsgObj, { includeSettings: createdNewChat });
    } finally {
      endPerformancePhase('persist_user_turn');
    }
  } catch (error) {
    attachmentObjects.forEach(attachment => {
      if (attachment.url) {
        try { URL.revokeObjectURL(attachment.url); } catch (revokeError) {}
      }
    });
    setState({ chats: previousChats, activeChatId: previousActiveChatId });
    setRuntime({ attachedFiles: filesToSend });
    updateFilePreviewsUI();
    finishPerformanceRun('persistence_failed_before_generation');
    console.error('Failed to persist user request before generation:', error);
    alert('Message was not sent because it could not be saved locally: ' + error.message);
    return false;
  }

  if (createdNewChat) {
    replaceChatRoute(currentChat.id);
    document.title = currentChat.title ? `${currentChat.title} — ChatUI` : 'ChatUI';
  }

  // TEMP_PERF_DIAGNOSTICS
  startPerformancePhase('render_user_message');
  try {
    if (emptyState && conversationThread) {
      emptyState.classList.add('hidden');
      conversationThread.classList.remove('hidden');
      conversationThread.appendChild(renderMessageDOM(
        userMsgObj,
        currentChat,
        sendRegenerateRequest,
        messageDeleteHandler(updateSidebarCallback),
        messageEditHandler()
      ));
      if (typeof lucide !== 'undefined') lucide.createIcons?.();
      scrollToBottom();
    }
  } finally {
    endPerformancePhase('render_user_message');
  }

  composerTextarea.value = '';
  composerTextarea.style.height = 'auto';

  // TEMP_PERF_DIAGNOSTICS
  startPerformancePhase('sidebar_update_before_generation');
  try {
    updateSidebarCallback?.();
  } catch (error) {
    finishPerformanceRun('error');
    throw error;
  } finally {
    endPerformancePhase('sidebar_update_before_generation');
  }

  try {
    await sendGenerationForChat(
      currentChat,
      updateSidebarCallback,
      sendRegenerateRequest,
      options.generationObserver || null
    );
  } catch (error) {
    if (hasActivePerformanceRun()) {
      finishPerformanceRun(error?.name === 'AbortError' ? 'interrupted' : 'error');
    }
    throw error;
  }
  return true;
}

function buildAttachments(files) {
  return (files || []).map(file => ({
    id: createEntityId('att'),
    name: file.name,
    type: file.type || 'application/octet-stream',
    size: file.size,
    blob: file,
    url: URL.createObjectURL(file),
    transferStrategy: 'auto',
    fileUri: null,
    fileApiName: null,
    fileApiExpirationTime: null,
    fileApiCreateTime: null,
    fileApiState: null,
    fileApiMimeType: null,
    fileApiBaseUrl: null
  }));
}
