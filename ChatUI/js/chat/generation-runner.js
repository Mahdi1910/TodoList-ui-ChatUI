/**
 * generation-runner.js - Common assistant generation and final-state rendering.
 */

import { state, runtime, setRuntime, updateChat, createEntityId, createMessageSequence } from '../state/store.js';
import { persistChatMessage } from '../storage/storage.js';
import { renderMessageDOM } from './messages.js';
import { createFallbackTextTimeline } from './activity-timeline.js';
import { streamAssistantResponse } from './streaming.js';
import { getChatDOMElements, scrollToBottom } from './ui.js';
import { messageDeleteHandler, messageEditHandler } from './message-actions.js';
import { beginGeneration, finishGenerating, isCurrentGeneration } from './generation-lifecycle.js';
import { maybeGenerateAutomaticChatTitle } from './auto-title.js';
// TEMP_PERF_DIAGNOSTICS
import {
  endPerformancePhase,
  finishPerformanceRun,
  hasActivePerformanceRun,
  startPerformancePhase
} from '../diagnostics/performance-diagnostics.js';

function safeNotify(observer, method, ...args) {
  try { observer?.[method]?.(...args); }
  catch (error) { console.error(`Generation observer ${method} failed:`, error); }
}

function createAssistantRow(chat, assistantMessage, updateSidebarCallback, onRegenerateCallback) {
  const row = renderMessageDOM(
    assistantMessage,
    chat,
    onRegenerateCallback,
    messageDeleteHandler(updateSidebarCallback),
    messageEditHandler()
  );
  row.classList.add('assistant-entrance');
  return row;
}

function replaceWithFreshRow(row, chat, assistantMessage, updateSidebarCallback, onRegenerateCallback) {
  if (!row || !chat) return row;
  const freshRow = createAssistantRow(chat, assistantMessage, updateSidebarCallback, onRegenerateCallback);
  freshRow.classList.remove('assistant-entrance');
  if (assistantMessage.status === 'error' && !assistantMessage.thinking) {
    freshRow.querySelector('.thinking-slot')?.classList.add('hidden');
  }
  row.replaceWith(freshRow);
  if (typeof lucide !== 'undefined') lucide.createIcons?.();
  return freshRow;
}

function applyPartialGeneration(assistantMessage, error) {
  const partial = error?.partialGeneration;
  if (partial) {
    assistantMessage.content = partial.content || assistantMessage.content || '';
    assistantMessage.thinking = partial.thinking || assistantMessage.thinking || '';
    assistantMessage.activityTimeline = Array.isArray(partial.activityTimeline)
      ? partial.activityTimeline
      : assistantMessage.activityTimeline;
  }
  if (error?.partialToolMetadata) {
    assistantMessage.toolMetadata = error.partialToolMetadata;
  }
}

export async function runGeneration(
  chat,
  assistantMessage,
  updateSidebarCallback,
  onRegenerateCallback,
  generationObserver = null
) {
  const genId = beginGeneration(chat);
  const { conversationThread, stopGeneratingBtn } = getChatDOMElements();
  let assistantRow = createAssistantRow(chat, assistantMessage, updateSidebarCallback, onRegenerateCallback);
  const timelineSlot = assistantRow.querySelector('.assistant-activity-timeline');
  if (conversationThread) {
    conversationThread.appendChild(assistantRow);
    if (typeof lucide !== 'undefined') lucide.createIcons?.();
    scrollToBottom();
  }

  const controller = new AbortController();
  setRuntime({ activeAbortController: controller });
  if (stopGeneratingBtn) stopGeneratingBtn.onclick = () => runtime.activeAbortController?.abort();

  const activeTools = assistantMessage.activeTools || { ...state.tools };
  let finalChatForPersistence = null;
  let persistenceError = null;

  try {
    await streamAssistantResponse({
      model: state.currentModel,
      messages: chat.messages,
      activeTools,
      signal: controller.signal,
      assistantMessage,
      timelineSlot,
      generationId: genId,
      isCurrentGeneration,
      onTextUpdate: fullText => safeNotify(generationObserver, 'onAssistantTextUpdate', fullText),
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
        safeNotify(generationObserver, 'onAssistantComplete', assistantMessage.content);
      }
    });

    const updatedChat = updateChat(chat.id, current => ({
      ...current,
      updatedAt: Date.now(),
      messages: current.messages.some(message => message.id === assistantMessage.id)
        ? current.messages.map(message => message.id === assistantMessage.id ? assistantMessage : message)
        : [...current.messages, assistantMessage]
    }));
    finalChatForPersistence = updatedChat || state.chats.find(item => item.id === chat.id) || null;
    assistantRow = replaceWithFreshRow(
      assistantRow,
      finalChatForPersistence,
      assistantMessage,
      updateSidebarCallback,
      onRegenerateCallback
    );
  } catch (err) {
    applyPartialGeneration(assistantMessage, err);
    if (err.name === 'AbortError') {
      if (!assistantMessage.content?.trim()) {
        assistantMessage.content = 'Generation stopped by user.';
        assistantMessage.activityTimeline = createFallbackTextTimeline(assistantMessage.id, assistantMessage.content);
      }
      assistantMessage.status = 'interrupted';
      assistantMessage.errorMessage = '';
      assistantMessage.updatedAt = Date.now();
      safeNotify(generationObserver, 'onAssistantInterrupted', assistantMessage.content);
      const updatedChat = updateChat(chat.id, current => ({
        ...current,
        updatedAt: Date.now(),
        messages: current.messages.some(message => message.id === assistantMessage.id)
          ? current.messages.map(message => message.id === assistantMessage.id ? assistantMessage : message)
          : [...current.messages, assistantMessage]
      }));
      finalChatForPersistence = updatedChat || state.chats.find(item => item.id === chat.id) || null;
      assistantRow = replaceWithFreshRow(
        assistantRow,
        finalChatForPersistence,
        assistantMessage,
        updateSidebarCallback,
        onRegenerateCallback
      );
    } else {
      console.error('Gemini API Error:', err);
      const errMsg = `Error connecting to Gemini API: ${err.message}`;
      assistantMessage.errorMessage = errMsg;
      assistantMessage.status = 'error';
      assistantMessage.updatedAt = Date.now();
      safeNotify(generationObserver, 'onAssistantError', err);
      const updatedChat = updateChat(chat.id, current => ({
        ...current,
        updatedAt: Date.now(),
        messages: current.messages.some(message => message.id === assistantMessage.id)
          ? current.messages.map(message => message.id === assistantMessage.id ? assistantMessage : message)
          : [...current.messages, assistantMessage]
      }));
      finalChatForPersistence = updatedChat || state.chats.find(item => item.id === chat.id) || null;
      assistantRow = replaceWithFreshRow(
        assistantRow,
        finalChatForPersistence,
        assistantMessage,
        updateSidebarCallback,
        onRegenerateCallback
      );
    }
  } finally {
    if (finalChatForPersistence) {
      try {
        // Normal generation always owns a fresh assistant ID. Persist only this
        // final assistant and any generated tool-file attachments it owns.
        // TEMP_PERF_DIAGNOSTICS
        startPerformancePhase('persist_final_assistant');
        try {
          await persistChatMessage(finalChatForPersistence, assistantMessage, {
            synchronizeAttachments: true,
            newMessage: true
          });
        } finally {
          endPerformancePhase('persist_final_assistant');
        }
      } catch (error) {
        persistenceError = error;
        console.error('Failed to persist final assistant message:', error);
      }
    }

    // TEMP_PERF_DIAGNOSTICS
    startPerformancePhase('finish_generation_cleanup');
    try {
      await finishGenerating(chat, genId, updateSidebarCallback);
    } finally {
      endPerformancePhase('finish_generation_cleanup');
    }

    if (hasActivePerformanceRun()) {
      const diagnosticStatus = persistenceError
        ? 'persistence_error'
        : assistantMessage.status === 'completed'
          ? 'completed'
          : assistantMessage.status === 'interrupted'
            ? 'interrupted'
            : 'error';
      finishPerformanceRun(diagnosticStatus);
    }

    // Title generation is deliberately detached from the answer lifecycle. It
    // runs only after a completed assistant answer is safely persisted, and a
    // failure here can never turn a successful chat answer into an error.
    if (!persistenceError && assistantMessage.status === 'completed') {
      void maybeGenerateAutomaticChatTitle(chat.id, updateSidebarCallback);
    }

    if (persistenceError) throw persistenceError;
  }
}

export async function sendGenerationForChat(
  chat,
  updateSidebarCallback,
  onRegenerateCallback,
  generationObserver = null
) {
  const currentChat = state.chats.find(item => item.id === chat.id) || chat;
  const now = Date.now();
  const assistantMessage = {
    id: createEntityId('msg_asst'),
    role: 'assistant',
    content: '',
    thinking: '',
    thoughtSignature: null,
    modelResponseParts: [],
    toolMetadata: null,
    activityTimeline: [],
    activeTools: { ...(state.tools || { googleSearch: false, urlContext: false, codeExecution: false, workspace: false }) },
    status: 'generating',
    errorMessage: '',
    sequence: createMessageSequence(currentChat.messages || []),
    createdAt: now,
    updatedAt: now
  };
  await runGeneration(currentChat, assistantMessage, updateSidebarCallback, onRegenerateCallback, generationObserver);
}
