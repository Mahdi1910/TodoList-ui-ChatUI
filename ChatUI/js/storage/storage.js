/**
 * storage.js - Stable public storage facade.
 * Implementation is split by responsibility behind this API.
 */

export { openDatabase } from './database.js';
export { base64ToBlob } from './blob-utils.js';
export { loadState, loadChatContent, searchMessageChatIds } from './load.js';
export { saveState } from './save.js';
export {
  persistSettings,
  persistMetadataChanges,
  persistChatMetadata,
  persistProjectMetadata,
  persistChatMessage,
  persistNewUserTurn,
  persistAttachmentRemoteMetadata,
  deleteChatMessages,
  reconcileLoadedChat
} from './mutations.js';
export { deleteMessageRecord, deleteChatRecord, deleteProjectRecord, removeAllData } from './delete.js';
export {
  getReadAudio,
  putReadAudio,
  deleteReadAudio,
  deleteReadAudioForMessages,
  deleteReadAudioForChat,
  cleanupExpiredReadAudio,
  applyReadAudioRetentionPolicy,
  buildReadAudioExpiresAt
} from './read-audio.js';
