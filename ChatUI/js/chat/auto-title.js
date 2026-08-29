/**
 * auto-title.js — One-shot automatic title generation after two complete turns.
 */

import { state, updateChat } from '../state/store.js';
import { persistChatMetadata } from '../storage/storage.js';
import { generateGeminiUtilityText } from '../api/gemini-utility.js';

export const AUTO_TITLE_MODEL_ID = 'gemini-3.5-flash-lite';
const MAX_MESSAGE_CHARS = 4000;
const MAX_TITLE_CHARS = 80;
const pendingChatIds = new Set();

function orderedMessages(messages = []) {
  return [...messages].sort((a, b) => {
    const aSequence = Number(a?.sequence);
    const bSequence = Number(b?.sequence);
    if (Number.isSafeInteger(aSequence) && Number.isSafeInteger(bSequence) && aSequence !== bSequence) {
      return aSequence - bSequence;
    }
    return (a?.createdAt || 0) - (b?.createdAt || 0);
  });
}

function firstTwoCompletedPairs(chat) {
  const pairs = [];
  const messages = orderedMessages(chat?.messages || []);
  let pendingUser = null;

  for (const message of messages) {
    if (message?.role === 'user') {
      pendingUser = message;
      continue;
    }
    if (message?.role !== 'assistant' || message.status !== 'completed' || !pendingUser) continue;
    pairs.push({ user: pendingUser, assistant: message });
    pendingUser = null;
    if (pairs.length === 2) return pairs;
  }
  return pairs;
}

function compactContent(value) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= MAX_MESSAGE_CHARS) return text;
  return `${text.slice(0, MAX_MESSAGE_CHARS - 1)}…`;
}

function buildTitlePrompt(pairs) {
  const transcript = pairs.map((pair, index) => [
    `Turn ${index + 1} user: ${compactContent(pair.user?.content) || '[attachment-only request]'}`,
    `Turn ${index + 1} assistant: ${compactContent(pair.assistant?.content) || '[no visible answer text]'}`
  ].join('\n')).join('\n\n');

  return `Create one concise title for this chat based only on the conversation below.

Rules:
- Capture the main topic and the user's intent, not a generic summary.
- Use the same language as the conversation when practical.
- Prefer 3 to 7 words.
- Return only the title.
- Do not use quotation marks, Markdown, labels such as "Title:", or an ending period.
- Never expose API keys, credentials, passwords, private identifiers, or unnecessary sensitive details in the title.

Conversation:
${transcript}`;
}

function sanitizeGeneratedTitle(value) {
  let title = String(value || '').trim();
  title = title.split(/\r?\n/).find(line => line.trim())?.trim() || '';
  title = title.replace(/^\s*(?:title\s*:\s*)/i, '');
  title = title.replace(/^[-*#`\s]+/, '').replace(/[`\s]+$/, '');
  title = title.replace(/^["'“”‘’]+|["'“”‘’]+$/g, '').trim();
  title = title.replace(/[.!?。！？]+$/u, '').trim();
  if (title.length > MAX_TITLE_CHARS) title = title.slice(0, MAX_TITLE_CHARS).trim();
  return title;
}

function eligibleChat(chat) {
  return !!chat &&
    chat.messagesLoaded === true &&
    chat.titleSource === 'auto' &&
    !Number(chat.autoTitleGeneratedAt);
}

export async function maybeGenerateAutomaticChatTitle(chatId, updateSidebarCallback = null) {
  if (!chatId || pendingChatIds.has(chatId)) return false;
  const chat = state.chats.find(item => item.id === chatId);
  if (!eligibleChat(chat)) return false;

  const pairs = firstTwoCompletedPairs(chat);
  if (pairs.length < 2) return false;

  pendingChatIds.add(chatId);
  try {
    const rawTitle = await generateGeminiUtilityText({
      modelId: AUTO_TITLE_MODEL_ID,
      prompt: buildTitlePrompt(pairs),
      temperature: 0.2,
      maxOutputTokens: 64
    });
    const title = sanitizeGeneratedTitle(rawTitle);
    if (!title) return false;

    // Re-read ownership after the network request. A manual rename that happened
    // while the background request was running must never be overwritten.
    const current = state.chats.find(item => item.id === chatId);
    if (!eligibleChat(current)) return false;

    const previous = {
      title: current.title,
      titleSource: current.titleSource,
      autoTitleGeneratedAt: current.autoTitleGeneratedAt
    };
    const renamed = updateChat(chatId, item => ({
      ...item,
      title,
      titleSource: 'auto',
      autoTitleGeneratedAt: Date.now()
      // Deliberately preserve updatedAt so background naming does not reorder chats.
    }));

    try {
      await persistChatMetadata(renamed);
    } catch (error) {
      updateChat(chatId, item => ({ ...item, ...previous }));
      throw error;
    }

    if (state.activeChatId === chatId) document.title = `${title} — ChatUI`;
    updateSidebarCallback?.();
    return true;
  } catch (error) {
    console.warn('Automatic chat title generation could not complete:', error);
    return false;
  } finally {
    pendingChatIds.delete(chatId);
  }
}
