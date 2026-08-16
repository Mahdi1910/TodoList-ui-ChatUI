/**
 * custom-tool-generation-context.js - Exact originating-turn context for the
 * one active ChatUI generation. Regenerate keeps the same userTurnId.
 */
import { state } from '../state/store.js';

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

function assistantAlreadyExists(assistantMessage) {
  const id = String(assistantMessage?.id || '');
  if (!id) return false;
  return state.chats.some(chat => (chat.messages || []).some(message => message?.id === id));
}

export function beginCustomToolGenerationContext({ messages = [], assistantMessage = null, generationId = '' } = {}) {
  current = Object.freeze({
    userTurnId: lastUserMessageId(messages),
    generationMode: assistantAlreadyExists(assistantMessage) ? 'regenerate' : 'normal',
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
