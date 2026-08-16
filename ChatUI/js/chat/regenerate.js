/**
 * regenerate.js - Deterministic, ID-based assistant regeneration.
 */

import { state, runtime, setRuntime, updateChat, createEntityId, createMessageSequence } from '../state/store.js';
import { persistChatMessage } from '../storage/storage.js';
import { renderMessageDOM } from './messages.js';
import { streamAssistantResponse } from './streaming.js';
import { getChatDOMElements } from './ui.js';
import { messageDeleteHandler, messageEditHandler, revokeMessageBlobUrls } from './message-actions.js';
import { invalidateReadAudioForMessage } from '../voice/read-aloud.js';
import { clearSelectedReadText } from '../voice/read-selection.js';
import { beginGeneration, finishGenerating, isCurrentGeneration } from './generation-lifecycle.js';
// TEMP_PERF_DIAGNOSTICS
import {
  beginPerformanceRun,
  endPerformancePhase,
  finishPerformanceRun,
  hasActivePerformanceRun,
  startPerformancePhase
} from '../diagnostics/performance-diagnostics.js';

function sortMessages(messages = []) {
  return [...messages].sort((a, b) => {
    const sequenceA = Number(a?.sequence);
    const sequenceB = Number(b?.sequence);
    if (Number.isSafeInteger(sequenceA) && Number.isSafeInteger(sequenceB) && sequenceA !== sequenceB) {
      return sequenceA - sequenceB;
    }
    if ((a?.createdAt || 0) !== (b?.createdAt || 0)) return (a?.createdAt || 0) - (b?.createdAt || 0);
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

function findPrecedingUser(messages, assistantMessage) {
  const ordered = sortMessages(messages);
  const assistantIndex = ordered.findIndex(message => message.id === assistantMessage?.id);
  if (assistantIndex === -1) return null;
  for (let index = assistantIndex - 1; index >= 0; index -= 1) {
    if (ordered[index]?.role === 'user') return ordered[index];
  }
  return null;
}

function findAssociatedAssistant(messages, userMessage) {
  const ordered = sortMessages(messages);
  const userIndex = ordered.findIndex(message => message.id === userMessage?.id);
  if (userIndex === -1) return null;
  for (let index = userIndex + 1; index < ordered.length; index += 1) {
    if (ordered[index]?.role === 'user') break;
    if (ordered[index]?.role === 'assistant') return ordered[index];
  }
  return null;
}

function createAssistantSequenceForTurn(ordered, targetUser) {
  const userIndex = ordered.findIndex(message => message.id === targetUser.id);
  if (userIndex === -1 || userIndex === ordered.length - 1) return createMessageSequence(ordered);
  const userSequence = Number(targetUser.sequence);
  const nextSequence = Number(ordered[userIndex + 1]?.sequence);
  if (Number.isSafeInteger(userSequence) && Number.isSafeInteger(nextSequence) && nextSequence > userSequence + 1) {
    return userSequence + 1;
  }
  if (Number.isSafeInteger(userSequence)) return userSequence;
  return createMessageSequence(ordered);
}

function replaceRenderedRow(conversationThread, assistantMessage, targetUser, existingAssistant, row) {
  if (!conversationThread) return;
  const existingRow = existingAssistant
    ? [...conversationThread.children].find(item => item.dataset.messageId === existingAssistant.id)
    : null;
  if (existingRow) {
    existingRow.replaceWith(row);
    return;
  }
  const userRow = [...conversationThread.children].find(item => item.dataset.messageId === targetUser.id);
  const followingRow = userRow?.nextElementSibling;
  if (followingRow?.classList.contains('assistant')) followingRow.replaceWith(row);
  else if (userRow) userRow.after(row);
  else conversationThread.appendChild(row);
}

function diagnosticAttachmentBytes(attachments = []) {
  return attachments.reduce((total, attachment) => total + Math.max(0, Number(attachment?.size ?? attachment?.blob?.size) || 0), 0);
}

async function regenerateTarget(chatRef, targetRef, updateSidebarCallback = null) {
  if (!chatRef?.id || !targetRef?.id || runtime.isGenerating) return;

  const currentChat = state.chats.find(item => item.id === chatRef.id);
  const targetMessage = currentChat?.messages?.find(message => message.id === targetRef.id);
  if (!currentChat || !targetMessage) {
    console.warn('Regenerate ignored because the current target no longer exists.', {
      chatId: chatRef.id,
      messageId: targetRef.id
    });
    return;
  }

  const ordered = sortMessages(currentChat.messages || []);
  const targetUser = targetMessage.role === 'user'
    ? targetMessage
    : findPrecedingUser(ordered, targetMessage);
  if (!targetUser) {
    alert('Cannot regenerate this message because its user request could not be identified.');
    return;
  }

  const existingAssistant = targetMessage.role === 'assistant'
    ? targetMessage
    : findAssociatedAssistant(ordered, targetUser);
  const originalAssistant = existingAssistant ? { ...existingAssistant } : null;
  const originalChatUpdatedAt = currentChat.updatedAt;
  const originalMessageCount = currentChat.messageCount;
  const activeTools = { ...(state.tools || { googleSearch: false, urlContext: false, codeExecution: false, workspace: false }) };
  const now = Date.now();
  const assistantMessage = existingAssistant
    ? {
        ...existingAssistant,
        content: '',
        thinking: '',
        thoughtSignature: null,
        modelResponseParts: [],
        toolMetadata: null,
        activityTimeline: [],
        activeTools,
        status: 'generating',
        errorMessage: '',
        _blobUrls: [],
        updatedAt: now
      }
    : {
        id: createEntityId('msg_asst'),
        role: 'assistant',
        content: '',
        thinking: '',
        thoughtSignature: null,
        modelResponseParts: [],
        toolMetadata: null,
        activityTimeline: [],
        activeTools,
        status: 'generating',
        errorMessage: '',
        sequence: createAssistantSequenceForTurn(ordered, targetUser),
        createdAt: now,
        updatedAt: now
      };

  const targetUserIndex = ordered.findIndex(message => message.id === targetUser.id);
  const historyThroughUser = targetUserIndex >= 0
    ? ordered.slice(0, targetUserIndex + 1)
    : [targetUser];

  // TEMP_PERF_DIAGNOSTICS
  beginPerformanceRun({
    requestKind: 'regenerate',
    textChars: String(targetUser.content || '').length,
    currentAttachmentCount: (targetUser.attachments || []).length,
    currentAttachmentBytes: diagnosticAttachmentBytes(targetUser.attachments || []),
    attachmentTypeCounts: {},
    chatMessageCountBeforeSend: historyThroughUser.length,
    chatWasAlreadyLoaded: true,
    newChat: false,
    model: state.currentModel,
    thinkingLevel: state.thinkingLevel,
    enabledTools: activeTools
  });

  const { conversationThread, stopGeneratingBtn } = getChatDOMElements();
  const assistantRow = renderMessageDOM(
    assistantMessage,
    currentChat,
    sendRegenerateRequest,
    messageDeleteHandler(updateSidebarCallback),
    messageEditHandler()
  );
  assistantRow.dataset.messageId = assistantMessage.id;
  replaceRenderedRow(conversationThread, assistantMessage, targetUser, existingAssistant, assistantRow);
  if (typeof lucide !== 'undefined') lucide.createIcons?.();

  const genId = beginGeneration(currentChat);
  const controller = new AbortController();
  setRuntime({ activeAbortController: controller });
  if (stopGeneratingBtn) stopGeneratingBtn.onclick = () => runtime.activeAbortController?.abort();
  let replacementPersisted = false;
  let diagnosticStatus = 'completed';

  try {
    await streamAssistantResponse({
      model: state.currentModel,
      messages: historyThroughUser,
      activeTools,
      signal: controller.signal,
      assistantMessage,
      timelineSlot: assistantRow.querySelector('.assistant-activity-timeline'),
      generationId: genId,
      generationMode: 'regenerate',
      isCurrentGeneration,
      onComplete: (fullText, thinkingText, thoughtSignature, modelResponseParts, toolMetadata, activityTimeline) => {
        assistantMessage.content = fullText || '';
        assistantMessage.thinking = thinkingText || '';
        assistantMessage.thoughtSignature = typeof thoughtSignature === 'string' && thoughtSignature.length > 0
          ? thoughtSignature
          : null;
        assistantMessage.modelResponseParts = Array.isArray(modelResponseParts) ? modelResponseParts : [];
        assistantMessage.toolMetadata = toolMetadata || null;
        assistantMessage.activityTimeline = Array.isArray(activityTimeline) ? activityTimeline : [];
        assistantMessage.status = 'completed';
        assistantMessage.errorMessage = '';
        assistantMessage.updatedAt = Date.now();
      }
    });

    if (!isCurrentGeneration(genId)) return;

    const updatedChat = updateChat(currentChat.id, current => ({
      ...current,
      updatedAt: Date.now(),
      messages: existingAssistant
        ? current.messages.map(message => message.id === existingAssistant.id ? assistantMessage : message)
        : [...current.messages, assistantMessage]
    }));
    if (!updatedChat) throw new Error('The target chat no longer exists.');

    // Existing assistants reuse the same permanent ID, so synchronize only
    // that assistant's attachment scope. This removes stale generated tool
    // files and persists any newly returned files without touching other turns.
    // TEMP_PERF_DIAGNOSTICS
    startPerformancePhase('persist_final_assistant');
    try {
      await persistChatMessage(updatedChat, assistantMessage, {
        synchronizeAttachments: true,
        newMessage: !existingAssistant
      });
    } finally {
      endPerformancePhase('persist_final_assistant');
    }
    replacementPersisted = true;

    clearSelectedReadText();
    if (existingAssistant) {
      await invalidateReadAudioForMessage(existingAssistant.id).catch(error => {
        console.warn('Assistant regenerated but old Read Aloud audio could not be fully cleaned:', error);
      });
    }
    if (originalAssistant) revokeMessageBlobUrls(originalAssistant);
    const rendered = renderMessageDOM(
      assistantMessage,
      updatedChat,
      sendRegenerateRequest,
      messageDeleteHandler(updateSidebarCallback),
      messageEditHandler()
    );
    rendered.dataset.messageId = assistantMessage.id;
    const activeRow = [...(conversationThread?.children || [])].find(row => row.dataset.messageId === assistantMessage.id);
    if (activeRow) activeRow.replaceWith(rendered);
    if (typeof lucide !== 'undefined') lucide.createIcons?.();
  } catch (err) {
    diagnosticStatus = err.name === 'AbortError' ? 'interrupted' : 'error';
    // Restore only if the replacement was never durably committed. A later UI
    // cleanup/rendering problem must not roll memory back behind IndexedDB.
    if (!replacementPersisted) {
      if (originalAssistant) {
        const restoredChat = updateChat(currentChat.id, current => ({
          ...current,
          updatedAt: originalChatUpdatedAt,
          messageCount: originalMessageCount,
          messages: current.messages.map(message => message.id === originalAssistant.id ? originalAssistant : message)
        }));
        const restored = renderMessageDOM(
          originalAssistant,
          restoredChat || currentChat,
          sendRegenerateRequest,
          messageDeleteHandler(updateSidebarCallback),
          messageEditHandler()
        );
        restored.dataset.messageId = originalAssistant.id;
        const activeRow = [...(conversationThread?.children || [])].find(row => row.dataset.messageId === assistantMessage.id);
        if (activeRow) activeRow.replaceWith(restored);
      } else {
        updateChat(currentChat.id, current => ({
          ...current,
          updatedAt: originalChatUpdatedAt,
          messageCount: originalMessageCount,
          messages: current.messages.filter(message => message.id !== assistantMessage.id)
        }));
        assistantRow.remove();
      }
    }

    if (err.name === 'AbortError') return;
    console.error('Gemini regeneration error:', err);
    alert('Failed to regenerate the response: ' + err.message);
  } finally {
    // TEMP_PERF_DIAGNOSTICS
    startPerformancePhase('finish_generation_cleanup');
    try {
      await finishGenerating(currentChat, genId, updateSidebarCallback);
    } finally {
      endPerformancePhase('finish_generation_cleanup');
    }
    if (hasActivePerformanceRun()) finishPerformanceRun(diagnosticStatus);
  }
}

export async function sendRegenerateRequest(chatRef, targetRef = null, updateSidebarCallback = null) {
  if (!chatRef?.id || runtime.isGenerating) return;
  const currentChat = state.chats.find(item => item.id === chatRef.id);
  if (!currentChat) return;
  const target = targetRef?.id
    ? currentChat.messages.find(message => message.id === targetRef.id)
    : sortMessages(currentChat.messages).at(-1);
  if (!target) return;
  await regenerateTarget(currentChat, target, updateSidebarCallback);
}
