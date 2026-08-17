/**
 * message-renderer.js - Compose user/assistant message rows from focused renderers.
 */

import { renderMarkdown } from './markdown.js';
import { renderMessageAttachments } from './message-attachments.js';
import { renderActivityTimeline } from './activity-renderer.js';
import { appendToolMetadata } from './message-tools.js';
import { appendMessageToolbar } from './message-controls.js';

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
    const text = document.createElement('div');
    text.className = 'message-text';
    text.innerHTML = renderMarkdown(content);
    bubble.appendChild(text);
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