/**
 * custom-tool-generation-context.js - Exact originating-turn context for the
 * one active ChatUI generation. Regenerate keeps the same userTurnId but is
 * identified explicitly so it can never count as duplicate confirmation.
 */

let current = Object.freeze({
  userTurnId: '',
  generationMode: 'normal',
  generationAttemptId: ''
});

function lastUserMessageId(messages = []) {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === 'user' && messages[index]?.id) return String(messages[index].id);
  }
  return '';
}

export function beginCustomToolGenerationContext({ messages = [], generationId = '', generationMode = 'normal' } = {}) {
  const resolvedMode = generationMode === 'regenerate' ? 'regenerate' : 'normal';
  current = Object.freeze({
    userTurnId: lastUserMessageId(messages),
    generationMode: resolvedMode,
    generationAttemptId: String(generationId || '')
  });
  return current;
}

export function getCustomToolGenerationContext() {
  return current;
}

export function clearCustomToolGenerationContext(generationId = '') {
  if (generationId && current.generationAttemptId && String(generationId) !== current.generationAttemptId) return;
  current = Object.freeze({ userTurnId: '', generationMode: 'normal', generationAttemptId: '' });
}
