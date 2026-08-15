/**
 * message-actions.js - Message deletion/editing with ID-based state resolution.
 */

import { state, runtime, updateChat } from '../state/store.js';
import { deleteChatMessages, persistChatMessage } from '../storage/storage.js';
import { invalidateReadAudioForMessage, invalidateReadAudioForMessages } from '../voice/read-aloud.js';
import { clearSelectedReadText } from '../voice/read-selection.js';
import { updateScrollToBottomButton } from './ui.js';

function sortMessages(messages = []) {
  return [...messages].sort((a, b) => {
    const seqA = Number(a?.sequence);
    const seqB = Number(b?.sequence);
    if (Number.isSafeInteger(seqA) && Number.isSafeInteger(seqB) && seqA !== seqB) return seqA - seqB;
    if ((a?.createdAt || 0) !== (b?.createdAt || 0)) return (a?.createdAt || 0) - (b?.createdAt || 0);
    return String(a?.id || '').localeCompare(String(b?.id || ''));
  });
}

function findAssociatedAssistant(messages, userMessage) {
  const ordered = sortMessages(messages);
  const userIndex = ordered.findIndex(message => message.id === userMessage?.id);
  if (userIndex === -1) return null;
  for (let index = userIndex + 1; index < ordered.length; index += 1) {
    if (ordered[index]?.role === 'user') break;
    if (ordered[index]?.role === 'assistant') return ordered[index];
  }
  return null;
}

export function revokeMessageBlobUrls(message) {
  if (!Array.isArray(message?._blobUrls)) return;
  message._blobUrls.forEach(url => {
    try { URL.revokeObjectURL(url); } catch (error) {}
  });
  message._blobUrls = [];
}

export async function deleteMessageFromChat(chat, msgObj, row, updateSidebarCallback = null) {
  if (!chat?.id || !msgObj?.id || runtime.isGenerating) return;

  const currentChat = state.chats.find(item => item.id === chat.id);
  const currentMessage = currentChat?.messages?.find(message => message.id === msgObj.id);
  if (!currentChat || !currentMessage) {
    console.warn('Delete ignored because the current message no longer exists.', { chatId: chat.id, messageId: msgObj.id });
    return;
  }

  const idsToDelete = new Set([currentMessage.id]);
  if (currentMessage.role === 'user') {
    const associatedAssistant = findAssociatedAssistant(currentChat.messages, currentMessage);
    if (associatedAssistant) idsToDelete.add(associatedAssistant.id);
  }

  const previousMessages = currentChat.messages;
  const previousUpdatedAt = currentChat.updatedAt;
  const deletedMessages = currentChat.messages.filter(message => idsToDelete.has(message.id));
  const updatedAt = Date.now();
  const updatedChat = updateChat(currentChat.id, current => ({
    ...current,
    messages: current.messages.filter(message => !idsToDelete.has(message.id)),
    messageCount: current.messages.filter(message => !idsToDelete.has(message.id)).length,
    updatedAt
  }));
  if (!updatedChat) return;

  try {
    await deleteChatMessages(updatedChat, [...idsToDelete]);
  } catch (err) {
    updateChat(currentChat.id, current => ({
      ...current,
      messages: previousMessages,
      messageCount: previousMessages.length,
      updatedAt: previousUpdatedAt
    }));
    console.error('Failed to persist message deletion:', err);
    alert('Failed to delete message from database: ' + err.message);
    return;
  }

  clearSelectedReadText();
  const deletedAssistantIds = deletedMessages.filter(message => message.role === 'assistant').map(message => message.id);
  if (deletedAssistantIds.length > 0) {
    await invalidateReadAudioForMessages(deletedAssistantIds).catch(error => {
      console.warn('Message deleted but its Read Aloud cache could not be fully cleaned:', error);
    });
  }
  deletedMessages.forEach(revokeMessageBlobUrls);
  const conversationThread = document.getElementById('conversation-thread');
  if (conversationThread) {
    [...conversationThread.children].forEach(messageRow => {
      if (idsToDelete.has(messageRow.dataset.messageId)) messageRow.remove();
    });
  } else if (row) {
    row.remove();
  }

  const emptyState = document.getElementById('empty-state');
  if (updatedChat.messages.length === 0 && updatedChat.id === state.activeChatId) {
    emptyState?.classList.remove('hidden');
    if (conversationThread) {
      conversationThread.classList.add('hidden');
      conversationThread.innerHTML = '';
    }
  }

  updateScrollToBottomButton();
  updateSidebarCallback?.();
}

export async function editMessageInChat(chat, msgObj, newContent) {
  if (!chat?.id || !msgObj?.id || runtime.isGenerating) return null;

  const currentChat = state.chats.find(item => item.id === chat.id);
  const currentMessage = currentChat?.messages?.find(message => message.id === msgObj.id);
  if (!currentChat || !currentMessage) {
    console.warn('Edit ignored because the current message no longer exists.', { chatId: chat.id, messageId: msgObj.id });
    return null;
  }

  const previousMessage = currentMessage;
  const previousUpdatedAt = currentChat.updatedAt;
  const updatedAt = Date.now();
  const updatedMessage = currentMessage.role === 'assistant'
    ? {
        ...currentMessage,
        content: newContent,
        thinking: '',
        thoughtSignature: null,
        modelResponseParts: [],
        toolMetadata: null,
        activityTimeline: null,
        errorMessage: '',
        status: 'completed',
        _blobUrls: [],
        updatedAt
      }
    : {
        ...currentMessage,
        content: newContent,
        updatedAt
      };

  const updatedChat = updateChat(currentChat.id, current => ({
    ...current,
    messages: current.messages.map(message => message.id === currentMessage.id ? updatedMessage : message),
    updatedAt
  }));

  try {
    await persistChatMessage(updatedChat, updatedMessage, {
      // User text edits preserve their existing attachment records without
      // rewriting image/PDF/audio Blobs. Assistant edits deliberately clear
      // model/tool metadata, so synchronize that message's attachment scope to
      // remove stale generated tool files.
      synchronizeAttachments: currentMessage.role === 'assistant',
      newMessage: false
    });
    clearSelectedReadText();
    if (currentMessage.role === 'assistant') {
      revokeMessageBlobUrls(previousMessage);
      await invalidateReadAudioForMessage(currentMessage.id).catch(error => {
        console.warn('Assistant edit saved but old Read Aloud audio could not be fully cleaned:', error);
      });
    }
    return updatedMessage;
  } catch (error) {
    updateChat(currentChat.id, current => ({
      ...current,
      messages: current.messages.map(message => message.id === currentMessage.id ? previousMessage : message),
      updatedAt: previousUpdatedAt
    }));
    throw error;
  }
}

export function messageDeleteHandler(updateSidebarCallback = null) {
  return (chat, msgObj, row) => deleteMessageFromChat(chat, msgObj, row, updateSidebarCallback);
}

export function messageEditHandler() {
  return (chat, msgObj, newContent) => editMessageInChat(chat, msgObj, newContent);
}
