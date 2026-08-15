/**
 * generation-lifecycle.js - Shared generation state, abort, and cleanup.
 */

import { runtime, setRuntime, updateChat } from '../state/store.js';
import { updateComposerButtons } from '../composer/composer.js';

export function createGenerationId() {
  return 'gen_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
}

export function beginGeneration(chat) {
  const genId = createGenerationId();
  setRuntime({ isGenerating: true, currentGenerationId: genId });
  updateChat(chat.id, current => ({ ...current, isGenerating: true }));
  updateComposerButtons();
  return genId;
}

export function abortActiveGeneration() {
  if (runtime.activeAbortController) {
    runtime.activeAbortController.abort();
    setRuntime({ activeAbortController: null });
  }
  setRuntime({ isGenerating: false, currentGenerationId: null });
  updateComposerButtons();
}

export async function finishGenerating(chat, genId, updateSidebarCallback = null) {
  if (genId && runtime.currentGenerationId && genId !== runtime.currentGenerationId) return;
  setRuntime({ isGenerating: false, currentGenerationId: null });
  setRuntime({ activeAbortController: null });
  if (chat) updateChat(chat.id, current => ({ ...current, isGenerating: false }));
  updateComposerButtons();
  updateSidebarCallback?.();
}

export function isCurrentGeneration(genId) {
  return runtime.currentGenerationId === genId;
}
