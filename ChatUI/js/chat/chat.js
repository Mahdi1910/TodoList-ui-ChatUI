/**
 * chat.js — Public chat module facade.
 *
 * Chat lifecycle, generation, message actions, and viewport UI now live in
 * focused modules. Existing imports continue to use this stable API surface.
 */

export {
  initSmartScrollControls,
  scrollToBottom,
  updateThinkingUI
} from './ui.js';

export {
  abortActiveGeneration,
  finishGenerating,
  sendMessage,
  sendRegenerateRequest
} from './generation.js';

export {
  loadChat,
  startNewChat,
  deleteChat,
  renameChat,
  initRenameChatModal
} from './conversation.js';

export {
  deleteMessageFromChat,
  messageDeleteHandler
} from './message-actions.js';
