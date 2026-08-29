/**
 * conversation.js - Route-aware chat selection and conversation lifecycle operations.
 */

import { state, runtime, setState, setRuntime, updateChat, normalizeProjectId } from '../state/store.js';
import {
  persistSettings,
  persistChatMetadata,
  reconcileLoadedChat,
  deleteChatRecord
} from '../storage/storage.js';
import { renderMessageDOM } from './messages.js';
import { abortActiveGeneration } from './generation.js';
import { sendRegenerateRequest } from './generation.js';
import { messageDeleteHandler, messageEditHandler } from './message-actions.js';
import { getChatDOMElements, scrollToBottom } from './ui.js';
import { clearComposer } from '../composer/markdown-editor.js';
import { updateComposerButtons } from '../composer/composer.js';
import { invalidateReadAudioForChat, stopActiveReadForChat } from '../voice/read-aloud.js';
import { clearSelectedReadText } from '../voice/read-selection.js';
import { ensureChatLoaded } from './chat-loader.js';
import {
  pushChatRoute,
  replaceChatRoute,
  pushHomeRoute,
  replaceHomeRoute
} from '../router/chat-router.js';

let navigationSequence = 0;

function setLandingMessage(message = 'What can I help with?') {
  const title = document.querySelector('#empty-state .landing-title');
  if (!title) return;
  title.textContent = message;
  title.classList.toggle('default-landing-title', message === 'What can I help with?');
}

function showLoadingState() {
  const { emptyState, conversationThread } = getChatDOMElements();
  setLandingMessage('Loading conversation…');
  emptyState?.classList.remove('hidden');
  if (conversationThread) {
    conversationThread.classList.add('hidden');
    conversationThread.innerHTML = '';
  }
}

function showLoadError() {
  const { emptyState, conversationThread } = getChatDOMElements();
  setLandingMessage('Could not load this conversation.');
  emptyState?.classList.remove('hidden');
  if (conversationThread) {
    conversationThread.classList.add('hidden');
    conversationThread.innerHTML = '';
  }
}

function updateChatHistory(chatId, historyMode) {
  if (historyMode === 'replace') replaceChatRoute(chatId);
  else if (historyMode === 'push') pushChatRoute(chatId);
}

function updateHomeHistory(historyMode) {
  if (historyMode === 'replace') replaceHomeRoute();
  else if (historyMode === 'push') pushHomeRoute();
}

export async function loadChat(chatId, updateSidebarCallback = null, options = {}) {
  const { historyMode = 'push' } = options;
  const chatMetadata = state.chats.find(chat => chat.id === chatId);
  if (!chatMetadata) return null;

  const sequence = ++navigationSequence;
  if (state.activeChatId !== chatId) {
    clearSelectedReadText();
    if (runtime.isGenerating) abortActiveGeneration();
  }

  showLoadingState();

  let chat;
  try {
    chat = await ensureChatLoaded(chatId);
  } catch (error) {
    console.error(`Failed to lazy-load chat ${chatId}:`, error);
    if (sequence === navigationSequence) {
      showLoadError();
      alert('This conversation could not be loaded from local storage: ' + error.message);
    }
    return null;
  }

  if (!chat || sequence !== navigationSequence) return chat;

  setState({ activeChatId: chatId });
  updateChatHistory(chatId, historyMode);
  document.title = chat.title ? `${chat.title} — ChatUI` : 'ChatUI';
  persistSettings().catch(err => console.error('Failed to persist active chat:', err));

  const { emptyState, conversationThread } = getChatDOMElements();
  setLandingMessage('What can I help with?');
  if (emptyState && conversationThread) {
    if (chat.messages.length === 0) {
      emptyState.classList.remove('hidden');
      conversationThread.classList.add('hidden');
      conversationThread.innerHTML = '';
    } else {
      emptyState.classList.add('hidden');
      conversationThread.classList.remove('hidden');
      conversationThread.classList.remove('conversation-thread-fade');
      void conversationThread.offsetWidth;
      conversationThread.classList.add('conversation-thread-fade');
      conversationThread.innerHTML = '';
      renderChatMessages(conversationThread, chat, updateSidebarCallback);
      scrollToBottom();
    }
  }
  updateSidebarCallback?.();
  return chat;
}

export function renderChatMessages(conversationThread, chat, updateSidebarCallback = null) {
  chat.messages.forEach(msg => {
    conversationThread.appendChild(renderMessageDOM(
      msg,
      chat,
      sendRegenerateRequest,
      messageDeleteHandler(updateSidebarCallback),
      messageEditHandler()
    ));
  });
  if (typeof lucide !== 'undefined') lucide.createIcons?.();
}

export function startNewChat(updateSidebarCallback = null, projectId = null, options = {}) {
  const { historyMode = 'push' } = options;
  navigationSequence += 1;
  clearSelectedReadText();
  if (runtime.isGenerating) abortActiveGeneration();
  setRuntime({ isGenerating: false });
  const normalizedProjectId = normalizeProjectId(projectId);
  setState({ activeChatId: null, activeProjectId: normalizedProjectId });
  updateHomeHistory(historyMode);
  document.title = 'ChatUI';
  persistSettings().catch(err => console.error('Failed to persist new-chat state:', err));

  const { emptyState, conversationThread } = getChatDOMElements();
  setLandingMessage('What can I help with?');
  if (emptyState && conversationThread) {
    emptyState.classList.remove('hidden');
    conversationThread.classList.add('hidden');
    conversationThread.innerHTML = '';
  }
  clearComposer();
  updateComposerButtons();
  updateSidebarCallback?.();
}

export async function deleteChat(chatId, updateSidebarCallback = null) {
  if (state.activeChatId === chatId && runtime.isGenerating) abortActiveGeneration();

  try {
    await deleteChatRecord(chatId);
  } catch (err) {
    console.error('Failed to delete chat from IndexedDB:', err);
    alert('Failed to delete chat from database: ' + err.message);
    return;
  }

  await stopActiveReadForChat(chatId).catch(error => {
    console.warn('Chat was deleted but its active Read Aloud playback could not be fully stopped:', error);
  });

  const wasActive = state.activeChatId === chatId;
  setState({ chats: state.chats.filter(chat => chat.id !== chatId) });

  if (wasActive) {
    startNewChat(updateSidebarCallback, null, { historyMode: 'replace' });
  } else {
    updateSidebarCallback?.();
  }
}

export function renameChat(chat) {
  if (!chat) return;
  const modal = document.getElementById('rename-chat-modal');
  const input = document.getElementById('rename-chat-input');
  if (!modal || !input) return;
  runtime.activeChatForRename = chat;
  input.value = chat.title || '';
  modal.classList.remove('hidden');
  input.focus();
  input.select();
}

export function initRenameChatModal(updateSidebarCallback = null) {
  const modal = document.getElementById('rename-chat-modal');
  const input = document.getElementById('rename-chat-input');
  const confirmBtn = document.getElementById('confirm-rename-chat-btn');
  const closeBtn = document.getElementById('close-rename-chat-btn');
  if (!modal || !input || !confirmBtn || !closeBtn) return;

  closeBtn.onclick = () => {
    modal.classList.add('hidden');
    runtime.activeChatForRename = null;
  };

  confirmBtn.onclick = async () => {
    const chat = runtime.activeChatForRename;
    const newTitle = input.value.trim();
    if (!chat || !newTitle) return;
    const currentChat = state.chats.find(item => item.id === chat.id);
    if (!currentChat) return;
    const previousChats = state.chats;
    const updatedAt = Date.now();
    // A title explicitly chosen by the user always wins over background auto-title.
    const renamedChat = updateChat(currentChat.id, current => ({
      ...current,
      title: newTitle,
      titleSource: 'manual',
      updatedAt
    }));
    try {
      await persistChatMetadata(renamedChat);
    } catch (err) {
      setState({ chats: previousChats });
      console.error('Failed to rename chat:', err);
      alert('Failed to rename chat: ' + err.message);
      return;
    }
    if (state.activeChatId === renamedChat.id) document.title = `${newTitle} — ChatUI`;
    modal.classList.add('hidden');
    setRuntime({ activeChatForRename: null });
    updateSidebarCallback?.();
  };
}

export async function clearActiveChatMessages(updateSidebarCallback = null) {
  let activeChat = state.chats.find(chat => chat.id === state.activeChatId);
  if (activeChat && activeChat.messagesLoaded !== true) activeChat = await ensureChatLoaded(activeChat.id);
  if (!activeChat || activeChat.messages.length === 0) return;

  if (runtime.isGenerating) abortActiveGeneration();
  if (!confirm('Are you sure you want to clear all messages in this chat?')) return;

  const previousMessages = activeChat.messages;
  const previousUpdatedAt = activeChat.updatedAt;
  const clearedChat = updateChat(activeChat.id, current => ({
    ...current,
    messages: [],
    messagesLoaded: true,
    messageCount: 0,
    updatedAt: Date.now()
  }));

  try {
    await reconcileLoadedChat(clearedChat);
  } catch (err) {
    updateChat(activeChat.id, current => ({
      ...current,
      messages: previousMessages,
      messageCount: previousMessages.length,
      updatedAt: previousUpdatedAt
    }));
    console.error('Failed to clear active chat messages:', err);
    alert('Failed to clear chat messages: ' + err.message);
    return;
  }

  clearSelectedReadText();
  await invalidateReadAudioForChat(activeChat.id).catch(error => {
    console.warn('Chat messages were cleared but Read Aloud cache cleanup was incomplete:', error);
  });
  await loadChat(activeChat.id, updateSidebarCallback, { historyMode: 'none' });
}

export function exportActiveChat() {
  const activeChat = state.chats.find(chat => chat.id === state.activeChatId);
  if (!activeChat || activeChat.messagesLoaded !== true || activeChat.messages.length === 0) {
    alert('No active chat messages to export.');
    return;
  }

  let text = `# ${activeChat.title || 'Exported Chat'}\n\n`;
  activeChat.messages.forEach(msg => {
    const roleName = msg.role === 'user' ? 'User' : 'Assistant';
    text += `### ${roleName}:\n${msg.content || ''}\n\n`;
  });

  const blob = new Blob([text], { type: 'text/markdown;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${(activeChat.title || 'chat').replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
  a.click();
  URL.revokeObjectURL(url);
}
