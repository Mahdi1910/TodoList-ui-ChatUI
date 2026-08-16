/**
 * streaming.js — Ordered streaming response lifecycle and frame-throttled activity rendering.
 */

import { streamChat } from '../api/gemini.js';
import {
  applyActivityEvent,
  createActivitySession,
  finalizeActivitySession,
  snapshotActivitySession
} from './activity-timeline.js';
import { renderActivityTimeline } from './activity-renderer.js';
import { scrollToBottom } from './ui.js';
import {
  beginCustomToolGenerationContext,
  clearCustomToolGenerationContext
} from '../tools/custom-tool-generation-context.js';
// TEMP_PERF_DIAGNOSTICS
import {
  beginNetworkRound,
  finishNetworkRound,
  hasActivePerformanceRun,
  markPerformanceEvent,
  recordHistoryStats,
  recordNetworkChunk,
  recordRenderSample,
  recordToolExecution
} from '../diagnostics/performance-diagnostics.js';

function safeNotify(callback, ...args) {
  try { callback?.(...args); }
  catch (error) { console.error('Assistant stream observer failed:', error); }
}

function createFrameScheduler() {
  let frameId = null;
  let pendingRender = null;
  const schedule = render => {
    pendingRender = render;
    if (frameId !== null) return;
    frameId = requestAnimationFrame(() => {
      frameId = null;
      const next = pendingRender;
      pendingRender = null;
      next?.();
    });
  };
  const flush = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    const next = pendingRender;
    pendingRender = null;
    next?.();
  };
  const cancel = () => {
    if (frameId !== null) cancelAnimationFrame(frameId);
    frameId = null;
    pendingRender = null;
  };
  return { schedule, flush, cancel };
}

function syncLiveMessage(assistantMessage, session) {
  if (!assistantMessage || !session) return;
  assistantMessage.content = session.content;
  assistantMessage.thinking = session.thinking;
  assistantMessage.activityTimeline = session.timeline;
}

function attachPartialGeneration(error, session) {
  if (!error || !session) return;
  const snapshot = snapshotActivitySession(session);
  try { error.partialGeneration = snapshot; } catch (_) {}
}

function diagnosticActivityType(eventType = '') {
  const type = String(eventType || '');
  if (type.startsWith('thinking')) return 'thinking';
  if (type.startsWith('text')) return 'text';
  if (type) return 'tool';
  return 'unknown';
}

function currentSessionActivityType(session) {
  const first = session?.timeline?.[0];
  if (first?.type === 'thinking') return 'thinking';
  if (first?.type === 'text') return 'text';
  if (first?.type === 'tool') return 'tool';
  if (session?.thinking) return 'thinking';
  if (session?.content) return 'text';
  return 'unknown';
}

function recordDiagnosticHistoryShape(messages = []) {
  if (!hasActivePerformanceRun()) return;
  const conversational = (messages || []).filter(message => {
    if (!message || !message.role) return false;
    if (message.role === 'user') return true;
    return message.role === 'assistant' && message.status === 'completed';
  });
  let attachmentCount = 0;
  let attachmentBytes = 0;
  let preservedModelPartCount = 0;
  conversational.forEach(message => {
    if (message.role === 'assistant' && Array.isArray(message.modelResponseParts)) {
      preservedModelPartCount += message.modelResponseParts.length;
    }
    if (message.role !== 'user') return;
    (message.attachments || []).forEach(attachment => {
      attachmentCount += 1;
      attachmentBytes += Math.max(0, Number(attachment?.size ?? attachment?.blob?.size) || 0);
    });
  });
  recordHistoryStats({
    inputMessageCount: (messages || []).length,
    includedConversationMessageCount: conversational.length,
    includedUserMessageCount: conversational.filter(message => message.role === 'user').length,
    includedAssistantMessageCount: conversational.filter(message => message.role === 'assistant').length,
    historicalAttachmentCount: attachmentCount,
    historicalAttachmentBytes: attachmentBytes,
    historicalBlobToBase64Conversions: 0,
    historicalBlobToBase64TotalMs: 0,
    preservedModelPartCount
  });
}

export async function streamAssistantResponse({
  model,
  messages,
  activeTools,
  signal,
  assistantMessage,
  timelineSlot,
  generationId,
  isCurrentGeneration,
  onTextUpdate,
  onComplete
}) {
  const renderFrames = createFrameScheduler();
  const session = createActivitySession({ messageId: assistantMessage?.id || '' });
  const toolStarts = new Map();
  const measure = hasActivePerformanceRun();
  // This diagnostic round begins at ChatUI's streamChat boundary. Because the
  // Gemini module itself is deliberately left untouched, the first-byte mark is
  // the first usable Gemini activity parsed by ChatUI, not a raw socket byte.
  const diagnosticRoundId = measure ? beginNetworkRound({ roundNumber: 1, requestBodyChars: 0 }) : null;
  let firstActivityMeasured = false;

  beginCustomToolGenerationContext({ messages, assistantMessage, generationId });

  // TEMP_PERF_DIAGNOSTICS
  markPerformanceEvent('stream_call_started');
  recordDiagnosticHistoryShape(messages);

  const markFirstActivity = activityType => {
    markPerformanceEvent('first_activity_event', { activityType });
    if (diagnosticRoundId && !firstActivityMeasured) {
      firstActivityMeasured = true;
      recordNetworkChunk(diagnosticRoundId, 0);
    }
  };

  const renderCurrent = isFinal => {
    if (!isCurrentGeneration(generationId) || !timelineSlot) return;
    syncLiveMessage(assistantMessage, session);
    const measureRender = hasActivePerformanceRun();
    const renderStartedAt = measureRender ? performance.now() : 0;
    renderActivityTimeline(timelineSlot, assistantMessage, { isFinal });
    const renderFinishedAt = measureRender ? performance.now() : 0;
    scrollToBottom();
    const scrollFinishedAt = measureRender ? performance.now() : 0;
    if (measureRender) {
      recordRenderSample({
        renderMs: renderFinishedAt - renderStartedAt,
        scrollMs: scrollFinishedAt - renderFinishedAt
      });
      if (session.timeline.length > 0 || session.content || session.thinking) {
        markPerformanceEvent('first_visible_activity', { activityType: currentSessionActivityType(session) });
      }
    }
  };

  try {
    await streamChat({
      model,
      messages,
      activeTools,
      signal,
      onActivityEvent: event => {
        // TEMP_PERF_DIAGNOSTICS
        markFirstActivity(diagnosticActivityType(event?.type));
        const eventType = String(event?.type || '');
        const callId = String(event?.callId || event?.id || '');
        if (eventType === 'custom_tool.running' && callId && !toolStarts.has(callId)) {
          toolStarts.set(callId, { startedAt: performance.now(), name: String(event?.name || 'tool') });
        }
        if ((eventType === 'custom_tool.completed' || eventType === 'custom_tool.failed') && callId) {
          const start = toolStarts.get(callId);
          if (start) {
            recordToolExecution({
              name: start.name,
              durationMs: performance.now() - start.startedAt,
              success: eventType === 'custom_tool.completed'
            });
            toolStarts.delete(callId);
          }
        }
        applyActivityEvent(session, event);
        syncLiveMessage(assistantMessage, session);
        renderFrames.schedule(() => renderCurrent(false));
      },
      onThoughtChunk: (_chunk, fullThinkingText) => {
        if (fullThinkingText !== session.thinking && fullThinkingText.startsWith(session.thinking)) {
          const missing = fullThinkingText.slice(session.thinking.length);
          if (missing) {
            // TEMP_PERF_DIAGNOSTICS
            markFirstActivity('thinking');
            applyActivityEvent(session, { type: 'thinking.delta', delta: missing });
          }
        }
      },
      onChunk: (_chunk, fullText) => {
        if (fullText !== session.content && fullText.startsWith(session.content)) {
          const missing = fullText.slice(session.content.length);
          if (missing) {
            // TEMP_PERF_DIAGNOSTICS
            markFirstActivity('text');
            applyActivityEvent(session, { type: 'text.delta', delta: missing });
          }
        }
        syncLiveMessage(assistantMessage, session);
        if (isCurrentGeneration(generationId)) safeNotify(onTextUpdate, session.content);
        renderFrames.schedule(() => renderCurrent(false));
      },
      onComplete: (fullText, fullThinkingText, thoughtSignature, modelResponseParts, toolMetadata) => {
        // TEMP_PERF_DIAGNOSTICS
        markPerformanceEvent('stream_complete');
        if (diagnosticRoundId) finishNetworkRound(diagnosticRoundId, { status: 'completed' });
        if (!session.content && fullText) applyActivityEvent(session, { type: 'text.delta', delta: fullText });
        else if (fullText.startsWith(session.content) && fullText.length > session.content.length) {
          applyActivityEvent(session, { type: 'text.delta', delta: fullText.slice(session.content.length) });
        }
        if (fullThinkingText.startsWith(session.thinking) && fullThinkingText.length > session.thinking.length) {
          applyActivityEvent(session, { type: 'thinking.delta', delta: fullThinkingText.slice(session.thinking.length) });
        }
        finalizeActivitySession(session, 'completed');
        const snapshot = snapshotActivitySession(session);
        if (assistantMessage) {
          assistantMessage.content = snapshot.content;
          assistantMessage.thinking = snapshot.thinking;
          assistantMessage.activityTimeline = snapshot.activityTimeline;
        }
        renderFrames.flush();
        renderCurrent(true);
        onComplete?.(
          snapshot.content,
          snapshot.thinking,
          thoughtSignature,
          modelResponseParts,
          toolMetadata,
          snapshot.activityTimeline
        );
      }
    });
  } catch (error) {
    if (diagnosticRoundId) {
      finishNetworkRound(diagnosticRoundId, {
        status: error?.name === 'AbortError' ? 'interrupted' : 'error',
        errorType: error?.name || 'Error'
      });
    }
    finalizeActivitySession(session, error?.name === 'AbortError' ? 'interrupted' : 'failed');
    const snapshot = snapshotActivitySession(session);
    if (assistantMessage) {
      assistantMessage.content = snapshot.content;
      assistantMessage.thinking = snapshot.thinking;
      assistantMessage.activityTimeline = snapshot.activityTimeline;
    }
    renderFrames.flush();
    renderCurrent(true);
    attachPartialGeneration(error, session);
    throw error;
  } finally {
    clearCustomToolGenerationContext(generationId);
    renderFrames.cancel();
  }
}
