/**
 * gemini-file-recovery-wrapper.js — Bounded pre-stream recovery around streamChat().
 *
 * If Gemini rejects a remote File before any visible/tool activity starts, repair
 * the complete attachment set from local Blobs and retry. Repeated pre-stream
 * File failures are allowed a few recovery passes because a proxy can rotate its
 * upstream Google account between requests. Once generation starts, never retry.
 */

import { streamChat } from './gemini.js';
import { recoverGenerationFilePermissionFailure } from '../chat/file-reference-recovery.js';
import { isFileSpecificPermissionDeniedError } from '../chat/attachment-file-errors.js';
import { getApiSettings, getCleanBaseUrl } from './api-config.js';

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

export async function streamChatWithFileRecovery(options = {}) {
  let recoveryAttempts = 0;

  while (true) {
    let generationStarted = false;
    const markStarted = callback => (...args) => {
      generationStarted = true;
      callback?.(...args);
    };

    const attemptOptions = {
      ...options,
      onActivityEvent: markStarted(options.onActivityEvent),
      onChunk: markStarted(options.onChunk),
      onThoughtChunk: markStarted(options.onThoughtChunk),
      onComplete: markStarted(options.onComplete)
    };

    try {
      return await streamChat(attemptOptions);
    } catch (error) {
      if (generationStarted || error?.name === 'AbortError') throw error;

      const apiSettings = getApiSettings();
      const cleanBaseUrl = getCleanBaseUrl(apiSettings.textBaseUrl);
      const filePermissionFailure = isFileSpecificPermissionDeniedError(
        error,
        options.messages,
        cleanBaseUrl
      );
      if (!filePermissionFailure) throw error;

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
      // Loop back through the normal streamChat path with freshly persisted
      // File metadata. Any later activity makes further retry impossible.
    }
  }
}
