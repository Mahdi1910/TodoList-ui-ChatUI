/**
 * gemini.js — Gemini API networking, SSE streaming, and client function-tool orchestration.
 */

import { getApiSettings, getCleanBaseUrl } from './api-config.js';
import { getBackendModelId, getModelConfig } from '../models/models.js';
import { state } from '../state/store.js';
import {
  attachmentEntryKey,
  collectUniqueMessageAttachments,
  createAttachmentPreparationContext,
  isMachineUnsupportedFileError,
  markModelMimeUnsupported,
  prepareAttachmentsForHistory,
  recoverMissingRemoteAttachments
} from '../chat/attachment-transport.js';
import {
  executeCustomFunctionCall,
  getCustomFunctionDeclarations,
  isCustomFunctionCallSupported
} from '../tools/function-tool-registry.js';

const MAX_CUSTOM_TOOL_ROUNDS = 12;
const MAX_CUSTOM_FUNCTION_CALLS = 32;

// Kept as a compatibility helper for callers that explicitly need inlineData.
// Plan 15 no longer uses it for the normal attachment fast path.
export function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result || '');
      const base64Data = result.split(',')[1] || result;
      resolve({
        inlineData: {
          mimeType: file.type || 'application/octet-stream',
          data: base64Data
        }
      });
    };
    reader.onerror = error => reject(error);
    reader.readAsDataURL(file);
  });
}

function cloneJson(value) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (err) {
    console.warn('Failed to preserve Gemini response value:', err);
    return null;
  }
}

function cloneGeminiPart(part) {
  return cloneJson(part);
}

export async function buildGeminiHistory(messages = [], options = {}) {
  const orderedMessages = [...messages].sort((a, b) => {
    const sequenceA = Number(a?.sequence);
    const sequenceB = Number(b?.sequence);
    if (Number.isSafeInteger(sequenceA) && Number.isSafeInteger(sequenceB) && sequenceA !== sequenceB) {
      return sequenceA - sequenceB;
    }
    return (a?.createdAt || 0) - (b?.createdAt || 0);
  });

  const conversationalMessages = orderedMessages.filter(msg => {
    if (!msg || !msg.role) return false;
    if (msg.role === 'user') return true;
    return msg.role === 'assistant' && msg.status === 'completed';
  });

  const attachmentContext = options.attachmentContext || null;
  let preparedAttachmentParts = null;
  if (attachmentContext) {
    // Prepare each unique attachment exactly once for the whole history build.
    // The resolver owns one shared concurrency limit, then message construction
    // below restores the original message and attachment order.
    const entries = collectUniqueMessageAttachments(conversationalMessages);
    preparedAttachmentParts = await prepareAttachmentsForHistory(entries, attachmentContext);
  }

  const contents = await Promise.all(conversationalMessages.map(async (msg, messageIndex) => {
    const role = msg.role === 'assistant' ? 'model' : 'user';
    const preservedParts = role === 'model' && Array.isArray(msg.modelResponseParts)
      ? msg.modelResponseParts.map(cloneGeminiPart).filter(Boolean)
      : [];
    const parts = preservedParts.length > 0
      ? preservedParts
      : [{
          text: msg.content || '',
          ...(role === 'model' && typeof msg.thoughtSignature === 'string' && msg.thoughtSignature.length > 0
            ? { thoughtSignature: msg.thoughtSignature }
            : {})
        }];

    if (role === 'user' && msg.attachments && msg.attachments.length > 0) {
      for (let attachmentIndex = 0; attachmentIndex < msg.attachments.length; attachmentIndex += 1) {
        const att = msg.attachments[attachmentIndex];
        if (preparedAttachmentParts) {
          const key = attachmentEntryKey(msg, att, messageIndex, attachmentIndex);
          const prepared = preparedAttachmentParts.get(key);
          if (!prepared) {
            throw new Error(`Attachment “${att?.name || 'Attachment'}” could not be prepared for Gemini.`);
          }
          parts.push(cloneGeminiPart(prepared) || prepared);
          continue;
        }

        // Compatibility path for direct buildGeminiHistory() callers that did
        // not supply a Files-aware preparation context.
        if (att.inlineData) {
          parts.push({ inlineData: att.inlineData });
        } else if (att.blob) {
          try {
            const base64Obj = await fileToBase64(att.blob);
            parts.push({ inlineData: base64Obj.inlineData });
          } catch (e) {
            console.warn('Failed to convert stored attachment blob to base64:', e);
          }
        }
      }
    }

    return { role, parts };
  }));

  if (contents.length === 0) {
    throw new Error('Gemini history is empty; no conversational user request is available.');
  }
  if (contents.at(-1)?.role !== 'user') {
    throw new Error('Gemini history is invalid: the final conversational turn must be the user request.');
  }

  return contents;
}

function resolveThinkingLevel(model) {
  const modelConfig = getModelConfig(model);
  return modelConfig.thinkingLevels.includes(state.thinkingLevel)
    ? state.thinkingLevel
    : modelConfig.defaultThinkingLevel;
}

function buildNativeToolsPayload(activeTools = {}, canonicalFields = false) {
  const tools = [];
  if (activeTools.googleSearch) tools.push(canonicalFields ? { googleSearch: {} } : { google_search: {} });
  if (activeTools.urlContext) tools.push(canonicalFields ? { urlContext: {} } : { url_context: {} });
  if (activeTools.codeExecution) tools.push(canonicalFields ? { codeExecution: {} } : { code_execution: {} });
  return tools;
}

function createMetadataAccumulator() {
  return {
    groundingMetadata: null,
    urlContextMetadata: null,
    codeExecutions: [],
    codeExecutionKeys: new Set()
  };
}

function addCodeExecutionMetadata(accumulator, entry) {
  if (!entry) return;
  let key = '';
  try { key = JSON.stringify(entry); } catch (_) { key = `${entry.type || 'entry'}:${accumulator.codeExecutions.length}`; }
  if (accumulator.codeExecutionKeys.has(key)) return;
  accumulator.codeExecutionKeys.add(key);
  accumulator.codeExecutions.push(entry);
}

function recordCandidateMetadata(candidate, accumulator) {
  if (!candidate || !accumulator) return;
  if (candidate.groundingMetadata) accumulator.groundingMetadata = candidate.groundingMetadata;
  if (candidate.urlContextMetadata) accumulator.urlContextMetadata = candidate.urlContextMetadata;

  const parts = candidate.content?.parts || [];
  for (const part of parts) {
    if (part?.executableCode) addCodeExecutionMetadata(accumulator, { type: 'code', ...part.executableCode });
    if (part?.codeExecutionResult) {
      addCodeExecutionMetadata(accumulator, { type: 'result', ...part.codeExecutionResult });
      const execOutput = part.codeExecutionResult.output;
      if (execOutput && typeof execOutput === 'object') {
        const inline = execOutput.inlineData || execOutput.inline_data;
        if (inline?.data) {
          addCodeExecutionMetadata(accumulator, {
            type: 'file',
            mimeType: inline.mimeType || inline.mime_type || 'application/octet-stream',
            data: inline.data
          });
        }
      }
    }
    const inline = part?.inlineData || part?.inline_data;
    if (inline?.data) {
      addCodeExecutionMetadata(accumulator, {
        type: 'file',
        mimeType: inline.mimeType || inline.mime_type || 'application/octet-stream',
        data: inline.data
      });
    }
  }
}

function metadataResult(accumulator) {
  return {
    groundingMetadata: accumulator.groundingMetadata,
    urlContextMetadata: accumulator.urlContextMetadata,
    codeExecutions: accumulator.codeExecutions
  };
}

function attachPartialToolMetadata(error, accumulator) {
  if (!error || !accumulator) return error;
  try { error.partialToolMetadata = metadataResult(accumulator); } catch (_) {}
  return error;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof DOMException !== 'undefined') throw new DOMException('Generation aborted.', 'AbortError');
  const error = new Error('Generation aborted.');
  error.name = 'AbortError';
  throw error;
}

async function parseApiError(response) {
  let errText = '';
  try { errText = await response.text(); } catch (_) {}
  let parsed = null;
  try { parsed = errText ? JSON.parse(errText) : null; } catch (_) {}
  const bodyError = parsed?.error && typeof parsed.error === 'object' ? parsed.error : {};
  const message = bodyError.message || errText || response.statusText;
  const error = new Error(`API Error ${response.status}: ${message || 'Request failed.'}`);
  error.name = 'GeminiApiError';
  error.httpStatus = response.status;
  error.apiStatus = bodyError.status || (typeof bodyError.code === 'string' ? bodyError.code : '');
  error.apiCode = bodyError.code ?? null;
  error.details = Array.isArray(bodyError.details) ? bodyError.details : [];
  error.responseText = errText;
  return error;
}

function functionCallFromPart(part) {
  return part?.functionCall || part?.function_call || null;
}

function toolCallFromPart(part) {
  return part?.toolCall || part?.tool_call || null;
}

function toolResponseFromPart(part) {
  return part?.toolResponse || part?.tool_response || null;
}

function explicitCallId(value) {
  const id = value?.id || value?.callId || value?.call_id;
  return id == null || id === '' ? '' : String(id);
}

function lastThoughtSignature(parts = []) {
  let signature = null;
  for (const part of parts) {
    if (typeof part?.thoughtSignature === 'string' && part.thoughtSignature.length > 0) signature = part.thoughtSignature;
  }
  return signature;
}

async function streamGenerateContentRound({
  apiSettings,
  cleanBaseUrl,
  modelId,
  payload,
  signal,
  onCandidate,
  onPart
}) {
  const apiUrl = `${cleanBaseUrl}/v1beta/models/${modelId}:streamGenerateContent?alt=sse`;
  const response = await fetch(apiUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiSettings.textApiKey
    },
    body: JSON.stringify(payload),
    signal
  });

  if (!response.ok) throw await parseApiError(response);
  if (!response.body) throw new Error('Response body is missing or unreadable.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let role = 'model';
  let finishReason = null;
  const parts = [];
  const customCallPartIndex = new Map();
  let partSequence = 0;

  const acceptPart = rawPart => {
    const cloned = cloneGeminiPart(rawPart);
    if (!cloned) return;
    const functionCall = functionCallFromPart(cloned);
    const callId = functionCall?.id ? String(functionCall.id) : '';
    if (callId && customCallPartIndex.has(callId)) {
      const existingIndex = customCallPartIndex.get(callId);
      const existing = parts[existingIndex];
      if (!existing?.thoughtSignature && cloned.thoughtSignature) parts[existingIndex] = cloned;
      return;
    }
    if (callId) customCallPartIndex.set(callId, parts.length);
    parts.push(cloned);
    partSequence += 1;
    onPart?.(cloned, { partSequence });
  };

  const consumeData = data => {
    const trimmed = String(data || '').trim();
    if (!trimmed || trimmed === '[DONE]') return;
    try {
      const parsed = JSON.parse(trimmed);
      const candidate = parsed.candidates?.[0];
      if (!candidate) return;
      if (candidate.content?.role) role = candidate.content.role;
      if (candidate.finishReason) finishReason = candidate.finishReason;
      onCandidate?.(candidate, parsed);
      for (const part of candidate.content?.parts || []) acceptPart(part);
    } catch (_) {
      // Preserve the previous tolerant SSE behavior: ignore malformed events.
    }
  };

  const consumeLine = line => {
    const trimmed = String(line || '').trim();
    if (!trimmed.startsWith('data:')) return;
    consumeData(trimmed.slice(5).trimStart());
  };

  while (true) {
    throwIfAborted(signal);
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() || '';
    lines.forEach(consumeLine);
  }

  buffer += decoder.decode();
  if (buffer) buffer.split(/\r?\n/).forEach(consumeLine);
  throwIfAborted(signal);

  return {
    content: { role: role || 'model', parts },
    finishReason
  };
}

function emitPartActivity(part, context) {
  const {
    round,
    partSequence,
    onActivityEvent,
    onChunk,
    onThoughtChunk,
    totals,
    codeExecutionQueue
  } = context;

  if (typeof part?.text === 'string' && part.text.length > 0) {
    if (part.thought === true) {
      totals.thinking += part.text;
      onActivityEvent?.({ type: 'thinking.delta', delta: part.text, round, partSequence });
      onThoughtChunk?.(part.text, totals.thinking);
    } else {
      totals.text += part.text;
      onActivityEvent?.({ type: 'text.delta', delta: part.text, round, partSequence });
      onChunk?.(part.text, totals.text);
    }
  }

  const functionCall = functionCallFromPart(part);
  if (functionCall) {
    onActivityEvent?.({
      type: 'custom_tool.requested',
      callId: functionCall.id,
      name: functionCall.name,
      args: cloneJson(functionCall.args || {}),
      provider: String(functionCall.name || '').startsWith('workspace_') ? 'workspace' : 'unknown',
      round,
      partSequence
    });
  }

  const toolCall = toolCallFromPart(part);
  if (toolCall) {
    onActivityEvent?.({
      type: 'builtin_tool.requested',
      callId: toolCall.id,
      toolType: toolCall.toolType || toolCall.tool_type || 'BUILTIN_TOOL',
      args: cloneJson(toolCall.args || {}),
      round,
      partSequence
    });
  }

  const toolResponse = toolResponseFromPart(part);
  if (toolResponse) {
    onActivityEvent?.({
      type: 'builtin_tool.completed',
      callId: toolResponse.id,
      toolType: toolResponse.toolType || toolResponse.tool_type || 'BUILTIN_TOOL',
      result: cloneJson(toolResponse.response || {}),
      round,
      partSequence
    });
  }

  if (part?.executableCode) {
    const explicitId = explicitCallId(part.executableCode);
    const callId = explicitId || `code-${round}-${partSequence}`;
    codeExecutionQueue.push(callId);
    onActivityEvent?.({
      type: 'code_execution.requested',
      callId,
      name: 'code_execution',
      provider: 'code-execution',
      args: { code: part.executableCode.code || '', language: part.executableCode.language || 'python' },
      round,
      partSequence
    });
  }

  if (part?.codeExecutionResult) {
    const queuedCallId = codeExecutionQueue.shift();
    const callId = queuedCallId || explicitCallId(part.codeExecutionResult) || `code-result-${round}-${partSequence}`;
    onActivityEvent?.({
      type: 'code_execution.completed',
      callId,
      name: 'code_execution',
      provider: 'code-execution',
      result: cloneJson(part.codeExecutionResult),
      round,
      partSequence
    });
  }
}

async function streamNativeChat({
  apiSettings,
  cleanBaseUrl,
  modelId,
  model,
  contents,
  activeTools,
  signal,
  onChunk,
  onThoughtChunk,
  onActivityEvent,
  onComplete
}) {
  const toolsPayload = buildNativeToolsPayload(activeTools, false);
  const payload = {
    contents,
    generationConfig: {
      thinkingConfig: {
        thinkingLevel: resolveThinkingLevel(model),
        includeThoughts: true
      }
    },
    ...(toolsPayload.length > 0 ? {
      tools: toolsPayload,
      toolConfig: { includeServerSideToolInvocations: true }
    } : {})
  };

  const totals = { text: '', thinking: '' };
  const metadata = createMetadataAccumulator();
  const codeExecutionQueue = [];
  let round;
  try {
    round = await streamGenerateContentRound({
      apiSettings,
      cleanBaseUrl,
      modelId,
      payload,
      signal,
      onCandidate: candidate => recordCandidateMetadata(candidate, metadata),
      onPart: (part, { partSequence }) => emitPartActivity(part, {
        round: 1,
        partSequence,
        onActivityEvent,
        onChunk,
        onThoughtChunk,
        totals,
        codeExecutionQueue
      })
    });
  } catch (error) {
    throw attachPartialToolMetadata(error, metadata);
  }

  const finalContent = totals.text || 'No text response returned.';
  await onComplete?.(
    finalContent,
    totals.thinking,
    lastThoughtSignature(round.content.parts),
    round.content.parts.map(cloneGeminiPart).filter(Boolean),
    metadataResult(metadata)
  );
  return finalContent;
}

function extractCustomFunctionCalls(parts = []) {
  const calls = [];
  const seenIds = new Set();
  for (const part of parts) {
    const call = functionCallFromPart(part);
    if (!call) continue;
    const id = typeof call.id === 'string' ? call.id : '';
    if (id && seenIds.has(id)) continue;
    if (id) seenIds.add(id);
    calls.push(call);
  }
  return calls;
}

async function runStreamingFunctionLoop({
  apiSettings,
  cleanBaseUrl,
  modelId,
  model,
  contents,
  activeTools,
  customDeclarations,
  signal,
  onChunk,
  onThoughtChunk,
  onActivityEvent,
  onComplete
}) {
  const nativeTools = buildNativeToolsPayload(activeTools, true);
  const toolsPayload = [
    ...nativeTools,
    { functionDeclarations: customDeclarations }
  ];
  const workingContents = cloneJson(contents) || [...contents];
  const metadata = createMetadataAccumulator();
  const totals = { text: '', thinking: '' };
  let totalFunctionCalls = 0;

  try {
    for (let roundNumber = 1; roundNumber <= MAX_CUSTOM_TOOL_ROUNDS; roundNumber += 1) {
      throwIfAborted(signal);
      const payload = {
        contents: workingContents,
        generationConfig: {
          thinkingConfig: {
            thinkingLevel: resolveThinkingLevel(model),
            includeThoughts: true
          }
        },
        tools: toolsPayload,
        ...(nativeTools.length > 0 ? {
          toolConfig: { includeServerSideToolInvocations: true }
        } : {})
      };

      const codeExecutionQueue = [];
      const round = await streamGenerateContentRound({
        apiSettings,
        cleanBaseUrl,
        modelId,
        payload,
        signal,
        onCandidate: candidate => recordCandidateMetadata(candidate, metadata),
        onPart: (part, { partSequence }) => emitPartActivity(part, {
          round: roundNumber,
          partSequence,
          onActivityEvent,
          onChunk,
          onThoughtChunk,
          totals,
          codeExecutionQueue
        })
      });

      const modelContent = round.content;
      if (!modelContent || !Array.isArray(modelContent.parts)) {
        throw new Error('Gemini streaming function-tool response did not contain valid candidate content.');
      }
      const functionCalls = extractCustomFunctionCalls(modelContent.parts);
      if (functionCalls.length === 0) {
        const finalContent = totals.text || 'No text response returned.';
        await onComplete?.(
          finalContent,
          totals.thinking,
          lastThoughtSignature(modelContent.parts),
          modelContent.parts.map(cloneGeminiPart).filter(Boolean),
          metadataResult(metadata)
        );
        return finalContent;
      }

      if (roundNumber >= MAX_CUSTOM_TOOL_ROUNDS) {
        throw new Error(`Gemini Workspace tool loop exceeded ${MAX_CUSTOM_TOOL_ROUNDS} rounds.`);
      }
      if (totalFunctionCalls + functionCalls.length > MAX_CUSTOM_FUNCTION_CALLS) {
        throw new Error(`Gemini Workspace tool loop exceeded ${MAX_CUSTOM_FUNCTION_CALLS} custom function calls.`);
      }

      // Preserve the exact streamed model Content, including thought signatures,
      // before returning any functionResponse parts to Gemini.
      workingContents.push(cloneJson(modelContent) || modelContent);
      const responseParts = [];
      for (const functionCall of functionCalls) {
        throwIfAborted(signal);
        totalFunctionCalls += 1;
        if (!isCustomFunctionCallSupported(functionCall.name)) {
          onActivityEvent?.({
            type: 'custom_tool.failed',
            callId: functionCall.id,
            name: functionCall.name,
            error: { message: `Unsupported client function: ${String(functionCall.name || 'unknown')}` }
          });
          throw new Error(`Gemini requested an unsupported client function: ${String(functionCall.name || 'unknown')}`);
        }
        if (typeof functionCall.id !== 'string' || !functionCall.id) {
          throw new Error(`Gemini function call ${functionCall.name} did not include the required call ID.`);
        }

        onActivityEvent?.({
          type: 'custom_tool.running',
          callId: functionCall.id,
          name: functionCall.name,
          args: cloneJson(functionCall.args || {}),
          provider: String(functionCall.name || '').startsWith('workspace_') ? 'workspace' : 'unknown'
        });

        const result = await executeCustomFunctionCall(functionCall, { signal, activeTools });
        throwIfAborted(signal);
        const failed = result?.ok === false;
        onActivityEvent?.({
          type: failed ? 'custom_tool.failed' : 'custom_tool.completed',
          callId: functionCall.id,
          name: functionCall.name,
          result: cloneJson(result),
          error: failed ? cloneJson(result?.error || null) : null,
          provider: String(functionCall.name || '').startsWith('workspace_') ? 'workspace' : 'unknown'
        });

        responseParts.push({
          functionResponse: {
            name: functionCall.name,
            id: functionCall.id,
            response: result
          }
        });
      }

      workingContents.push({ role: 'user', parts: responseParts });
      throwIfAborted(signal);
    }
  } catch (error) {
    throw attachPartialToolMetadata(error, metadata);
  }

  throw new Error(`Gemini Workspace tool loop exceeded ${MAX_CUSTOM_TOOL_ROUNDS} rounds.`);
}

function attachmentMimeForCapability(attachment) {
  return String(
    attachment?.fileApiMimeType || attachment?.type || attachment?.mimeType || attachment?.blob?.type || ''
  ).toLowerCase();
}

function markCurrentRemoteMimesUnsupported(messages, attachmentContext) {
  let marked = 0;
  for (const entry of collectUniqueMessageAttachments(messages)) {
    const attachment = entry.attachment;
    if (!attachment?.fileUri) continue;
    if (String(attachment.fileApiBaseUrl || '').replace(/\/+$/, '') !== attachmentContext.cleanBaseUrl) continue;
    const mimeType = attachmentMimeForCapability(attachment);
    if (!mimeType) continue;
    markModelMimeUnsupported(attachmentContext, mimeType);
    marked += 1;
  }
  return marked;
}

export async function streamChat({
  model,
  messages,
  activeTools,
  signal,
  onChunk,
  onThoughtChunk,
  onActivityEvent,
  onComplete,
  onError
}) {
  const apiSettings = getApiSettings();
  if (!apiSettings.textApiKey) {
    const err = new Error('Gemini API key is missing. Please enter your API key in Settings > Gemini.');
    onError?.(err, '');
    throw err;
  }
  const cleanBaseUrl = getCleanBaseUrl(apiSettings.textBaseUrl);
  const modelId = getBackendModelId(model);
  if (!modelId) {
    const err = new Error(`Selected model "${model}" has no valid backend configuration.`);
    onError?.(err, '');
    throw err;
  }

  const attachmentContext = createAttachmentPreparationContext({
    apiSettings,
    cleanBaseUrl,
    modelId,
    signal
  });
  let contents = await buildGeminiHistory(messages, { attachmentContext });
  const resolvedTools = activeTools || state.tools || {};
  const customDeclarations = getCustomFunctionDeclarations(resolvedTools);
  let activityStarted = false;

  const trackedActivity = event => {
    activityStarted = true;
    onActivityEvent?.(event);
  };
  const trackedChunk = (chunk, fullText) => {
    activityStarted = true;
    onChunk?.(chunk, fullText);
  };
  const trackedThoughtChunk = (chunk, fullThinking) => {
    activityStarted = true;
    onThoughtChunk?.(chunk, fullThinking);
  };

  const executeGeneration = currentContents => {
    if (customDeclarations.length === 0) {
      return streamNativeChat({
        apiSettings,
        cleanBaseUrl,
        modelId,
        model,
        contents: currentContents,
        activeTools: resolvedTools,
        signal,
        onChunk: trackedChunk,
        onThoughtChunk: trackedThoughtChunk,
        onActivityEvent: trackedActivity,
        onComplete
      });
    }

    return runStreamingFunctionLoop({
      apiSettings,
      cleanBaseUrl,
      modelId,
      model,
      contents: currentContents,
      activeTools: resolvedTools,
      customDeclarations,
      signal,
      onChunk: trackedChunk,
      onThoughtChunk: trackedThoughtChunk,
      onActivityEvent: trackedActivity,
      onComplete
    });
  };

  try {
    return await executeGeneration(contents);
  } catch (initialError) {
    if (!activityStarted && initialError?.name !== 'AbortError') {
      try {
        let shouldRetry = false;

        // Official GenerateContent semantics: 404 means the referenced resource
        // was not found. We still verify each File with files.get before deciding
        // that a stored File reference is stale and safe to rebuild.
        if (Number(initialError?.httpStatus) === 404) {
          shouldRetry = await recoverMissingRemoteAttachments(messages, attachmentContext);
        } else if (Number(initialError?.httpStatus) === 400 && isMachineUnsupportedFileError(initialError)) {
          // Only machine-readable unsupported-media reasons may trigger this
          // compatibility fallback. Human-readable error text is not a classifier.
          shouldRetry = markCurrentRemoteMimesUnsupported(messages, attachmentContext) > 0;
        }

        if (shouldRetry) {
          contents = await buildGeminiHistory(messages, { attachmentContext });
          try {
            return await executeGeneration(contents);
          } catch (retryError) {
            onError?.(retryError, '');
            throw retryError;
          }
        }
      } catch (recoveryError) {
        if (recoveryError !== initialError) {
          onError?.(recoveryError, '');
          throw recoveryError;
        }
      }
    }

    onError?.(initialError, '');
    throw initialError;
  }
}
