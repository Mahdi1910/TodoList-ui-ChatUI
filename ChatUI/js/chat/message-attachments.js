/**
 * message-attachments.js - Render stored Gemini-supported attachments.
 */

import { escapeHtml } from '../utils/dom.js';
import { getAttachmentPresentation } from '../composer/attachment-types.js';

export function renderMessageAttachments(attachments = []) {
  if (!attachments.length) return null;

  const attachContainer = document.createElement('div');
  attachContainer.className = 'message-attachments-container';

  attachments.forEach(fileInfo => {
    const item = document.createElement('div');
    item.className = 'chat-attachment-item';
    const presentation = getAttachmentPresentation({
      name: fileInfo?.name,
      type: fileInfo?.type || fileInfo?.mimeType
    });

    if (presentation.kind === 'audio' && fileInfo.url) {
      item.classList.add('chat-attachment-media');
      item.innerHTML = `
        <div class="chat-attachment-media-header">
          <i data-lucide="mic" class="chat-attachment-media-icon"></i>
          <span class="chat-attachment-name">${escapeHtml(fileInfo.name)}</span>
        </div>
        <audio controls src="${fileInfo.url}" class="chat-audio-player"></audio>
      `;
    } else if (presentation.kind === 'image' && fileInfo.url) {
      item.classList.add('chat-attachment-media');
      item.innerHTML = `
        <img src="${fileInfo.url}" alt="${escapeHtml(fileInfo.name)}" class="chat-attachment-image" />
        <span class="chat-attachment-name chat-attachment-image-name">${escapeHtml(fileInfo.name)}</span>
      `;
    } else {
      item.innerHTML = `
        <div class="chat-attachment-icon"><i data-lucide="${presentation.icon}"></i></div>
        <div class="chat-attachment-info">
          <span class="chat-attachment-name">${escapeHtml(fileInfo.name)}</span>
          <span class="chat-attachment-type">${escapeHtml(presentation.label)}</span>
        </div>
      `;
    }
    attachContainer.appendChild(item);
  });

  return attachContainer;
}
