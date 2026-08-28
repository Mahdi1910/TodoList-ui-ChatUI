/**
 * gemini-file-recovery-wrapper.js — Bounded pre-stream recovery around streamChat().
 *
 * If Gemini rejects a remote File before any visible/tool activity starts, repair
 * the complete attachment set from local Blobs and retry. Retry-only messages also
 * remove stale remote fileData pointers preserved inside old assistant history.
 * Once generation starts, never retry.
 */

import { streamChat } from './gemini.js';
import { recoverGenerationFilePermissionFailure } from '../chat/file-reference-recovery.js';
import { isFileSpecificPermissionDeniedError } from '../chat/attachment-file-errors.js';
import { createFileRecoveryMessages } from '../chat/file-history-sanitizer.js';
import { runWithTextApiKeyFailover } from './text-api-key-pool.js';

export const MAX_FILE_RECOVERY_RETRIES = 3;

function recoveryExhaustedError(lastError, attempts) {
  const error = new Error(
    `Gemini File access could not be repaired after ${attempts} automatic recovery attempts. ` +
    'The local attachment data may still exist, but the proxy keeps rejecting the newly prepared remote File resources.'
  );
  error.name = 'GeminiFileRecoveryExhaustedError';
  error.code = 'FILE_RECOVERY_EXHAUSTED';
  error.cause = lastError;
  return error;
}

async function streamChatForCurrentKey(options = {}) {
  let recoveryAttempts = 0;

  while (true) {
    let generationStarted = false;
    const markStarted = callback => (...args) => {
      generationStarted = true;
      callback?.(...args);
    };

    // The first attempt is byte-for-byte the normal chat history. After Gemini
    // proves that a File URI is inaccessible, retries use a temporary API view
    // with stale assistant fileData parts removed. The persisted chat is not
    // mutated; user attachments still point at their freshly recovered metadata.
    const attemptMessages = recoveryAttempts > 0
      ? createFileRecoveryMessages(options.messages)
      : options.messages;

    const attemptOptions = {
      ...options,
      messages: attemptMessages,
      onActivityEvent: markStarted(options.onActivityEvent),
      onChunk: markStarted(options.onChunk),
      onThoughtChunk: markStarted(options.onThoughtChunk),
      onComplete: markStarted(options.onComplete)
    };

    try {
      return await streamChat(attemptOptions);
    } catch (error) {
      if (generationStarted) {
        try { error.chatUiGenerationStarted = true; } catch (_) {}
      }
      if (generationStarted || error?.name === 'AbortError') throw error;
      if (!isFileSpecificPermissionDeniedError(error)) throw error;

      if (recoveryAttempts >= MAX_FILE_RECOVERY_RETRIES) {
        throw recoveryExhaustedError(error, recoveryAttempts);
      }

      const recovered = await recoverGenerationFilePermissionFailure({
        error,
        messages: options.messages,
        signal: options.signal
      });
      if (!recovered) throw error;

      recoveryAttempts += 1;
      // Loop back through streamChat with fresh attachment metadata and a clean
      // retry-only history. Any later visible/tool activity disables more retries.
    }
  }
}

export async function streamChatWithFileRecovery(options = {}) {
  return runWithTextApiKeyFailover(
    () => streamChatForCurrentKey(options),
    {
      signal: options.signal,
      canReplay: error => error?.chatUiGenerationStarted !== true
    }
  );
}
