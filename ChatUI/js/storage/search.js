/**
 * search.js - Bounded cursor-based conversation content search.
 */

import { openDatabase } from './database.js';

const DEFAULT_MAX_CHATS = 50;
const DEFAULT_MAX_EXCERPTS = 100;
const DEFAULT_MAX_EXCERPTS_PER_CHAT = 8;
const DEFAULT_MAX_EXCERPT_CHARS = 360;

function abortError() {
  if (typeof DOMException !== 'undefined') return new DOMException('Search cancelled.', 'AbortError');
  const error = new Error('Search cancelled.');
  error.name = 'AbortError';
  return error;
}

function findRanges(text, query, maxRanges = 8) {
  const lowerText = text.toLocaleLowerCase();
  const lowerQuery = query.toLocaleLowerCase();
  const ranges = [];
  let offset = 0;
  while (offset <= lowerText.length - lowerQuery.length && ranges.length < maxRanges) {
    const index = lowerText.indexOf(lowerQuery, offset);
    if (index === -1) break;
    ranges.push({ start: index, end: index + query.length });
    offset = Math.max(index + query.length, index + 1);
  }
  return ranges;
}

function paragraphBounds(text, index) {
  const before = text.lastIndexOf('\n\n', Math.max(0, index - 1));
  const after = text.indexOf('\n\n', index);
  return {
    start: before === -1 ? 0 : before + 2,
    end: after === -1 ? text.length : after
  };
}

function cropAroundMatch(text, firstRange, maxChars) {
  const paragraph = paragraphBounds(text, firstRange.start);
  if (paragraph.end - paragraph.start <= maxChars) {
    return { start: paragraph.start, end: paragraph.end };
  }

  const half = Math.floor(maxChars / 2);
  let start = Math.max(paragraph.start, firstRange.start - half);
  let end = Math.min(paragraph.end, start + maxChars);
  if (end - start < maxChars) start = Math.max(paragraph.start, end - maxChars);

  const leftNewline = text.lastIndexOf('\n', firstRange.start);
  const rightNewline = text.indexOf('\n', firstRange.end);
  if (leftNewline >= paragraph.start && firstRange.start - leftNewline < half) start = Math.max(start, leftNewline + 1);
  if (rightNewline !== -1 && rightNewline <= paragraph.end && rightNewline - firstRange.end < half) end = Math.min(end, rightNewline);
  return { start, end };
}

export function buildSearchExcerpt(content, query, maxChars = DEFAULT_MAX_EXCERPT_CHARS) {
  const text = String(content || '');
  const needle = String(query || '').trim();
  if (!text || !needle) return null;
  const sourceRanges = findRanges(text, needle);
  if (!sourceRanges.length) return null;

  const crop = cropAroundMatch(text, sourceRanges[0], maxChars);
  const croppedText = text.slice(crop.start, crop.end);
  const matchRanges = sourceRanges
    .filter(range => range.end > crop.start && range.start < crop.end)
    .map(range => ({
      start: Math.max(0, range.start - crop.start),
      end: Math.min(croppedText.length, range.end - crop.start)
    }));

  return {
    text: `${crop.start > 0 ? '…' : ''}${croppedText}${crop.end < text.length ? '…' : ''}`,
    matchRanges: matchRanges.map(range => ({
      start: range.start + (crop.start > 0 ? 1 : 0),
      end: range.end + (crop.start > 0 ? 1 : 0)
    }))
  };
}

export async function searchConversationMatches(query, options = {}) {
  const needle = String(query || '').trim();
  if (!needle) return { query: '', totalMatchingMessages: 0, truncated: false, chats: [] };

  const signal = options.signal || null;
  const maxChats = Math.max(1, Number(options.maxChats) || DEFAULT_MAX_CHATS);
  const maxExcerpts = Math.max(1, Number(options.maxExcerpts) || DEFAULT_MAX_EXCERPTS);
  const maxExcerptsPerChat = Math.max(1, Number(options.maxExcerptsPerChat) || DEFAULT_MAX_EXCERPTS_PER_CHAT);
  const db = await openDatabase();

  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(abortError());
      return;
    }

    const tx = db.transaction('messages', 'readonly');
    const request = tx.objectStore('messages').openCursor();
    const groups = new Map();
    let totalMatchingMessages = 0;
    let totalExcerpts = 0;
    let truncated = false;
    let settled = false;

    const cleanup = () => signal?.removeEventListener('abort', onAbort);
    const fail = error => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const onAbort = () => {
      try { tx.abort(); } catch (_) {}
      fail(abortError());
    };
    signal?.addEventListener('abort', onAbort, { once: true });

    request.onerror = () => fail(request.error || new Error('Conversation search cursor failed.'));
    tx.onerror = () => fail(tx.error || new Error('Conversation search transaction failed.'));
    tx.onabort = () => {
      if (signal?.aborted) fail(abortError());
      else fail(tx.error || new Error('Conversation search transaction was aborted.'));
    };

    request.onsuccess = () => {
      if (signal?.aborted) return;
      const cursor = request.result;
      if (!cursor) return;
      const message = cursor.value;
      const excerpt = buildSearchExcerpt(message?.content, needle);
      if (excerpt && message?.chatId) {
        totalMatchingMessages += 1;
        let group = groups.get(message.chatId);
        if (!group && groups.size < maxChats) {
          group = { chatId: message.chatId, messageMatchCount: 0, excerpts: [], truncated: false };
          groups.set(message.chatId, group);
        } else if (!group) {
          truncated = true;
        }

        if (group) {
          group.messageMatchCount += 1;
          if (group.excerpts.length < maxExcerptsPerChat && totalExcerpts < maxExcerpts) {
            group.excerpts.push({
              messageId: message.id,
              role: message.role,
              sequence: Number(message.sequence) || 0,
              createdAt: Number(message.createdAt) || 0,
              text: excerpt.text,
              matchRanges: excerpt.matchRanges
            });
            totalExcerpts += 1;
          } else {
            group.truncated = true;
            truncated = true;
          }
        }
      }
      cursor.continue();
    };

    tx.oncomplete = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve({
        query: needle,
        totalMatchingMessages,
        truncated,
        chats: [...groups.values()]
      });
    };
  });
}