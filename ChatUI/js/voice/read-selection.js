/**
 * read-selection.js — Preserve readable conversation text selections for Audio Read.
 */

import { state } from '../state/store.js';

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

function allowedRootFor(node) {
  const element = node?.nodeType === Node.ELEMENT_NODE ? node : node?.parentElement;
  return element?.closest?.('.message-text, .content-slot') || null;
}

function selectedTextFromRange(range, thread) {
  const startRoot = allowedRootFor(range.startContainer);
  const endRoot = allowedRootFor(range.endContainer);
  if (!startRoot || !endRoot || !thread.contains(startRoot) || !thread.contains(endRoot)) return '';
  const roots = [...thread.querySelectorAll('.message-text, .content-slot')]
    .filter(root => {
      try { return range.intersectsNode(root); } catch (error) { return false; }
    });
  const pieces = [];
  roots.forEach(root => {
    const part = document.createRange();
    part.selectNodeContents(root);
    if (root.contains(range.startContainer)) part.setStart(range.startContainer, range.startOffset);
    if (root.contains(range.endContainer)) part.setEnd(range.endContainer, range.endOffset);
    const holder = document.createElement('div');
    holder.appendChild(part.cloneContents());
    holder.querySelectorAll('button, .code-block-header, svg, [aria-hidden="true"]').forEach(node => node.remove());
    const text = normalizeText(holder.innerText || holder.textContent || '');
    if (text) pieces.push(text);
  });
  return normalizeText(pieces.join('\n'));
}

export function captureSelectedReadText() {
  const selection = window.getSelection?.();
  const thread = document.getElementById('conversation-thread');
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed || !thread) return selectedText;
  const range = selection.getRangeAt(0);
  const text = selectedTextFromRange(range, thread);
  if (!text) return selectedText;
  selectedText = text;
  selectedChatId = state.activeChatId || null;
  return selectedText;
}
export function getSelectedReadText() {
  if (!selectedText) return '';
  if (selectedChatId && selectedChatId !== state.activeChatId) return '';
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
