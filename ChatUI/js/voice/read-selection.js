/**
 * read-selection.js — Preserve readable conversation text selections for Audio Read.
 */

import { state } from '../state/store.js';

export const READABLE_SELECTION_SELECTOR = '.message-text, .content-slot, .activity-item-text';

let selectedText = '';
let selectedChatId = null;
let initialized = false;

function normalizeText(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function rangeIntersectionWithRoot(range, root) {
  const rootRange = document.createRange();
  rootRange.selectNodeContents(root);
  const part = range.cloneRange();

  // Browser word/paragraph selection (especially triple-click) can place a
  // range boundary just outside the visible paragraph/list item. Clip the
  // browser range to the readable message root instead of rejecting it merely
  // because an endpoint lives in the parent container.
  if (part.compareBoundaryPoints(Range.START_TO_START, rootRange) < 0) {
    part.setStart(rootRange.startContainer, rootRange.startOffset);
  }
  if (part.compareBoundaryPoints(Range.END_TO_END, rootRange) > 0) {
    part.setEnd(rootRange.endContainer, rootRange.endOffset);
  }

  return part.collapsed ? null : part;
}

function selectedTextFromRange(range, thread) {
  const roots = [...thread.querySelectorAll(READABLE_SELECTION_SELECTOR)]
    .filter(root => {
      try { return range.intersectsNode(root); } catch (error) { return false; }
    });
  if (!roots.length) return '';

  const pieces = [];
  roots.forEach(root => {
    let part;
    try { part = rangeIntersectionWithRoot(range, root); }
    catch (error) { part = null; }
    if (!part) return;

    const holder = document.createElement('div');
    holder.appendChild(part.cloneContents());
    holder.querySelectorAll('button, .code-block-header, .streaming-cursor, svg, [aria-hidden="true"]').forEach(node => node.remove());
    const text = normalizeText(holder.innerText || holder.textContent || '');
    if (text) pieces.push(text);
  });
  return normalizeText(pieces.join('\n'));
}

export function captureSelectedReadText() {
  const selection = window.getSelection?.();
  const thread = document.getElementById('conversation-thread');
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !thread) return getSelectedReadText();

  const range = selection.getRangeAt(0);
  const text = selectedTextFromRange(range, thread);
  if (!text) {
    // A new non-collapsed selection exists but it is not readable conversation
    // text. Never fall back to an older selection from this chat: that can make
    // Read Selected Text speak stale words that are no longer selected.
    clearSelectedReadText();
    return '';
  }

  selectedText = text;
  selectedChatId = state.activeChatId || null;
  return selectedText;
}

export function getSelectedReadText() {
  if (!selectedText) return '';
  if (selectedChatId && selectedChatId !== state.activeChatId) {
    clearSelectedReadText();
    return '';
  }
  return selectedText;
}

export function clearSelectedReadText() {
  selectedText = '';
  selectedChatId = null;
}

export function initReadSelection() {
  if (initialized) return;
  initialized = true;
  document.addEventListener('selectionchange', () => {
    captureSelectedReadText();
  });
}
