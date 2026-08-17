/**
 * gemini-file-recovery-wrapper.js — Adds one narrow pre-stream retry around streamChat().
 *
 * The underlying Gemini client remains unchanged. If a generation fails before
 * any text/thinking/tool activity with a File-specific 403, recover the exact
 * remote File from its local Blob and retry the whole generation once.
 */

import { streamChat } from './gemini.js';
import { recoverGenerationFilePermissionFailure } from '../chat/file-reference-recovery.js';

export async function streamChatWithFileRecovery(options = {}) {
  let generationStarted = false;
  const markStarted = callback => (...args) => {
    generationStarted = true;
    callback?.(...args);
  };

  const firstAttemptOptions = {
    ...options,
    onActivityEvent: markStarted(options.onActivityEvent),
    onChunk: markStarted(options.onChunk),
    onThoughtChunk: markStarted(options.onThoughtChunk),
    onComplete: markStarted(options.onComplete)
  };

  try {
    return await streamChat(firstAttemptOptions);
  } catch (error) {
    if (generationStarted || error?.name === 'AbortError') throw error;

    const recovered = await recoverGenerationFilePermissionFailure({
      error,
      messages: options.messages,
      model: options.model,
      signal: options.signal
    });
    if (!recovered) throw error;

    // Exactly one retry. A second failure is returned unchanged so credential
    // problems or a genuinely unavailable local Blob cannot loop forever.
    return streamChat(options);
  }
}
