/**
 * message-renderer.js - Compose user/assistant message rows from focused renderers.
 */

import { renderMarkdown } from './markdown.js';
import { renderMessageAttachments } from './message-attachments.js';
import { renderActivityTimeline } from './activity-renderer.js';
import { appendToolMetadata } from './message-tools.js';
import { appendMessageToolbar } from './message-controls.js';

export const USER_MESSAGE_COLLAPSE_LINES = 6;

function appendLegacyAssistantContent(bubble, msgObj, content, thinking) {
  const thinkingSlot = document.createElement('div');
  const shouldHideThinking = msgObj.status === 'error' || (!thinking && content);
  thinkingSlot.className = `thinking-slot ${shouldHideThinking ? 'hidden' : ''}`;
  const isGenerating = msgObj.status === 'generating';
  thinkingSlot.innerHTML = `
    <div class="thinking-panel ${thinking ? 'has-content' : ''} ${isGenerating ? 'generating' : ''}">
      <button class="thinking-toggle" type="button" aria-expanded="false">
        <span class="thinking-toggle-left"><span class="thinking-sphere"></span><span class="thinking-label">Thinking</span><span class="thinking-status">${thinking ? 'Completed' : 'In progress'}</span></span>
        <i data-lucide="chevron-down" class="thinking-chevron"></i>
      </button>
      <div class="thinking-details hidden"><div class="thinking-content">${thinking ? renderMarkdown(thinking) : ''}</div></div>
    </div>`;
  const thinkingToggle = thinkingSlot.querySelector('.thinking-toggle');
  const thinkingDetails = thinkingSlot.querySelector('.thinking-details');
  if (thinkingToggle && thinkingDetails) {
    thinkingToggle.addEventListener('click', () => {
      const expanded = thinkingToggle.getAttribute('aria-expanded') === 'true';
      thinkingToggle.setAttribute('aria-expanded', String(!expanded));
      thinkingDetails.classList.toggle('hidden', expanded);
    });
  }

  const contentSlot = document.createElement('div');
  contentSlot.className = 'content-slot';
  if (content) contentSlot.innerHTML = renderMarkdown(content);
  bubble.append(thinkingSlot, contentSlot);
}

function appendUserContent(bubble, content) {
  const collapsible = document.createElement('div');
  collapsible.className = 'user-message-collapsible is-collapsed';

  const text = document.createElement('div');
  text.className = 'message-text';
  text.innerHTML = renderMarkdown(content);
  collapsible.appendChild(text);
  bubble.appendChild(collapsible);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'user-message-toggle';
  toggle.textContent = 'Show more';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.hidden = true;
  bubble.appendChild(toggle);

  let hasMeasuredOverflow = false;

  const measureOverflow = () => {
    if (!collapsible.isConnected || !text.isConnected) return false;
    const textWidth = text.getBoundingClientRect().width;
    const naturalHeight = text.scrollHeight;
    if (textWidth <= 0 || naturalHeight <= 0) return false;

    const computed = window.getComputedStyle(text);
    const lineHeight = Number.parseFloat(computed.lineHeight);
    const fontSize = Number.parseFloat(computed.fontSize) || 16;
    const effectiveLineHeight = Number.isFinite(lineHeight) && lineHeight > 0 ? lineHeight : fontSize * 1.6;
    const collapsedHeight = effectiveLineHeight * USER_MESSAGE_COLLAPSE_LINES;
    const hasOverflow = naturalHeight > collapsedHeight + 2;
    hasMeasuredOverflow = hasOverflow;

    toggle.hidden = !hasOverflow;
    if (!hasOverflow) {
      collapsible.classList.add('is-collapsed');
      collapsible.classList.remove('has-overflow');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.textContent = 'Show more';
    } else {
      collapsible.classList.toggle('has-overflow', collapsible.classList.contains('is-collapsed'));
    }
    return true;
  };

  toggle.addEventListener('click', () => {
    if (!hasMeasuredOverflow) return;
    const expanding = collapsible.classList.contains('is-collapsed');
    collapsible.classList.toggle('is-collapsed', !expanding);
    collapsible.classList.toggle('has-overflow', !expanding);
    toggle.setAttribute('aria-expanded', String(expanding));
    toggle.textContent = expanding ? 'Show less' : 'Show more';
  });

  // Start with no disclosure at all. Only a real rendered height beyond six
  // lines is allowed to reveal Show more. This avoids short messages being
  // misclassified by character/newline heuristics or by the fade pseudo-element.
  requestAnimationFrame(() => requestAnimationFrame(measureOverflow));

  // ChatUI can be preloaded in a hidden iframe and message width changes across
  // responsive layouts. Keep measuring the natural text box when its size
  // changes so the disclosure remains correct after visibility/width changes.
  if (typeof ResizeObserver !== 'undefined') {
    const observer = new ResizeObserver(() => {
      measureOverflow();
    });
    observer.observe(text);
  }
}

export function renderMessageDOM(msgInput, chatRef = null, onRegenerateCallback = null, onDeleteCallback = null, onEditSaveCallback = null) {
  const msgObj = typeof msgInput === 'object' ? msgInput : { role: msgInput, content: arguments[1] || '' };
  const role = msgObj.role;
  const content = msgObj.content || '';
  const thinking = msgObj.thinking || '';

  const row = document.createElement('div');
  row.className = `message-row ${role}`;
  if (msgObj.id) row.dataset.messageId = msgObj.id;
  const bubble = document.createElement('div');
  bubble.className = `message-bubble ${role}-bubble`;

  const attachments = renderMessageAttachments(msgObj.attachments || []);
  if (attachments) bubble.appendChild(attachments);

  if (role === 'assistant') {
    if (Array.isArray(msgObj.activityTimeline)) {
      const timelineSlot = document.createElement('div');
      timelineSlot.className = 'assistant-activity-timeline';
      renderActivityTimeline(timelineSlot, msgObj, { isFinal: msgObj.status !== 'generating' });
      bubble.appendChild(timelineSlot);
    } else {
      appendLegacyAssistantContent(bubble, msgObj, content, thinking);
    }
    if (msgObj.toolMetadata) appendToolMetadata(bubble, msgObj.toolMetadata, msgObj);
  } else if (content) {
    appendUserContent(bubble, content);
  }

  row.appendChild(bubble);
  if (role === 'assistant' && msgObj.status === 'error' && msgObj.errorMessage) {
    const errorBox = document.createElement('div');
    errorBox.className = 'message-error-box';
    errorBox.textContent = msgObj.errorMessage;
    row.appendChild(errorBox);
  }

  appendMessageToolbar(row, msgObj, chatRef, { onRegenerateCallback, onDeleteCallback, onEditSaveCallback }, renderMessageDOM);
  return row;
}
