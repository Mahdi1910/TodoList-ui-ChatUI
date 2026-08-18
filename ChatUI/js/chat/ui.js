/**
 * ui.js — Shared chat viewport, scrolling, and thinking UI helpers.
 */

import { renderMarkdown } from './markdown.js';

let autoFollowBottom = true;
let programmaticScroll = false;

function getDOMElements() {
  return {
    emptyState: document.getElementById('empty-state'),
    conversationThread: document.getElementById('conversation-thread'),
    stopGeneratingBtn: document.getElementById('stop-generating-btn')
  };
}

export function updateScrollToBottomButton() {
  const viewport = document.getElementById('chat-viewport');
  const button = document.getElementById('scroll-to-bottom-btn');
  if (!viewport || !button) return;

  const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
  button.classList.toggle('hidden', distanceFromBottom <= 8);
}

export function initSmartScrollControls() {
  const viewport = document.getElementById('chat-viewport');
  const button = document.getElementById('scroll-to-bottom-btn');
  if (!viewport || !button) return;

  viewport.addEventListener('scroll', () => {
    if (!programmaticScroll) {
      const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
      autoFollowBottom = distanceFromBottom <= 8;
    }
    updateScrollToBottomButton();
  }, { passive: true });

  const goToBottom = (event) => {
    event.preventDefault();
    event.stopPropagation();
    autoFollowBottom = true;
    scrollToBottom(true);
  };

  document.addEventListener('pointerdown', (event) => {
    const rect = button.getBoundingClientRect();
    const inside = event.clientX >= rect.left && event.clientX <= rect.right &&
      event.clientY >= rect.top && event.clientY <= rect.bottom;
    if (inside && !button.classList.contains('hidden')) goToBottom(event);
  }, true);

  autoFollowBottom = true;
  updateScrollToBottomButton();
}

export function scrollToBottom(force = false) {
  const { conversationThread } = getDOMElements();
  if (!conversationThread) return;
  const viewport = conversationThread.parentElement || conversationThread;

  if (force) {
    autoFollowBottom = true;
    programmaticScroll = true;
    viewport.scrollTop = viewport.scrollHeight;
    requestAnimationFrame(() => {
      programmaticScroll = false;
      updateScrollToBottomButton();
    });
    updateScrollToBottomButton();
    return;
  }

  if (autoFollowBottom) {
    programmaticScroll = true;
    viewport.scrollTop = viewport.scrollHeight;
    requestAnimationFrame(() => {
      programmaticScroll = false;
      updateScrollToBottomButton();
    });
  }
  updateScrollToBottomButton();
}

export function getChatDOMElements() {
  return getDOMElements();
}

export function updateThinkingUI(thinkingSlot, thinkingText, status = 'Thinking') {
  if (!thinkingSlot) return;
  thinkingSlot.classList.remove('hidden');

  const panel = thinkingSlot.querySelector('.thinking-panel');
  const content = thinkingSlot.querySelector('.thinking-content');
  const statusEl = thinkingSlot.querySelector('.thinking-status');
  if (panel) {
    panel.classList.toggle('has-content', Boolean(thinkingText));
    panel.classList.toggle('generating', status !== 'Completed');
  }
  if (content) content.innerHTML = thinkingText ? renderMarkdown(thinkingText, { isFinal: status === 'Completed' }) : '';
  if (statusEl) statusEl.textContent = status;
}
