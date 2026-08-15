/**
 * chat-loader.js - Session-cached lazy loading for one chat at a time.
 */

import { state, updateChat } from '../state/store.js';
import { loadChatContent, reconcileLoadedChat } from '../storage/storage.js';

const pendingLoads = new Map();

export async function ensureChatLoaded(chatId) {
  const existing = state.chats.find(chat => chat.id === chatId);
  if (!existing) return null;
  if (existing.messagesLoaded === true) return existing;
  if (pendingLoads.has(chatId)) return pendingLoads.get(chatId);

  const operation = (async () => {
    const result = await loadChatContent(chatId);
    const updatedChat = updateChat(chatId, current => ({
      ...current,
      messages: result.messages,
      messagesLoaded: true,
      messageCount: result.messages.length
    }));

    if (!updatedChat) return null;
    if (result.repaired) await reconcileLoadedChat(updatedChat);
    return updatedChat;
  })();

  pendingLoads.set(chatId, operation);
  try {
    return await operation;
  } finally {
    pendingLoads.delete(chatId);
  }
}
