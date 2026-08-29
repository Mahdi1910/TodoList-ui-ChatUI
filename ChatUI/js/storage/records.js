/**
 * records.js - Canonical IndexedDB record serialization for ChatUI state.
 *
 * Keep targeted mutations and full reconciliation byte-for-byte compatible
 * with the existing persisted record shapes.
 */

import { state, runtime } from '../state/store.js';
import { sanitizeActivityTimeline } from '../chat/activity-timeline.js';
import { base64ToBlob } from './blob-utils.js';

export function isChatLoaded(chat) {
  return chat?.messagesLoaded === true;
}

export function buildProjectRecord(project) {
  if (!project?.id) throw new Error('Persistence integrity error: project is missing its permanent ID.');
  return {
    id: project.id,
    name: project.name,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt || project.createdAt
  };
}

export function buildChatRecord(chat) {
  if (!chat?.id) throw new Error('Persistence integrity error: chat is missing its permanent ID.');
  const loaded = isChatLoaded(chat);
  const messageCount = loaded
    ? (chat.messages || []).length
    : (Number.isSafeInteger(Number(chat.messageCount)) ? Number(chat.messageCount) : null);

  return {
    id: chat.id,
    projectId: chat.projectId || null,
    title: chat.title,
    titleSource: chat.titleSource || 'legacy',
    autoTitleGeneratedAt: Number(chat.autoTitleGeneratedAt) || 0,
    pinned: !!chat.pinned,
    createdAt: chat.createdAt,
    updatedAt: chat.updatedAt || chat.createdAt,
    messageCount
  };
}

export function cloneToolMetadata(toolMetadata) {
  if (!toolMetadata) return null;
  return JSON.parse(JSON.stringify(toolMetadata, (key, value) => {
    if (key === 'blob' && typeof Blob !== 'undefined' && value instanceof Blob) return undefined;
    return value;
  }));
}

export function buildMessageRecord(chatId, message) {
  if (!chatId) throw new Error('Persistence integrity error: message is missing its chat ID.');
  if (!message?.id) throw new Error(`Persistence integrity error: message in chat ${chatId} is missing its permanent ID.`);
  if (!Number.isSafeInteger(Number(message.sequence))) {
    throw new Error(`Persistence integrity error: message ${message.id} is missing stable sequence metadata.`);
  }

  return {
    id: message.id,
    chatId,
    role: message.role,
    content: message.content || '',
    thinking: message.thinking || '',
    thoughtSignature: typeof message.thoughtSignature === 'string' ? message.thoughtSignature : null,
    modelResponseParts: Array.isArray(message.modelResponseParts) ? message.modelResponseParts : [],
    toolMetadata: cloneToolMetadata(message.toolMetadata),
    activityTimeline: Array.isArray(message.activityTimeline)
      ? sanitizeActivityTimeline(message.activityTimeline, {
          content: message.content || '',
          thinking: message.thinking || ''
        })
      : null,
    activeTools: message.activeTools && typeof message.activeTools === 'object' ? { ...message.activeTools } : null,
    status: message.status || 'completed',
    errorMessage: message.errorMessage || '',
    sequence: Number(message.sequence),
    createdAt: message.createdAt,
    updatedAt: message.updatedAt || message.createdAt
  };
}

export function buildMessageAttachmentRecords(message) {
  if (!message?.id) throw new Error('Persistence integrity error: attachment owner message is missing its permanent ID.');
  const attachments = new Map();

  if (message.toolMetadata && Array.isArray(message.toolMetadata.codeExecutions)) {
    message.toolMetadata.codeExecutions.forEach((exec, execIdx) => {
      if (exec?.type !== 'file' || (!exec.data && !exec.blob)) return;
      let blobData = exec.blob instanceof Blob ? exec.blob : null;
      if (!blobData && typeof exec.data === 'string') {
        blobData = base64ToBlob(exec.data, exec.mimeType || 'application/octet-stream');
      }
      if (!blobData) return;
      const fileId = exec.id || `att_sandbox_${message.id}_${execIdx}`;
      attachments.set(fileId, {
        id: fileId,
        messageId: message.id,
        kind: 'tool',
        name: exec.fileName || `sandbox_output_${execIdx}`,
        mimeType: exec.mimeType || 'application/octet-stream',
        size: blobData.size,
        data: blobData,
        createdAt: message.createdAt
      });
    });
  }

  for (const attachment of message.attachments || []) {
    if (!attachment?.id) {
      throw new Error(`Persistence integrity error: attachment for message ${message.id} is missing its permanent ID.`);
    }
    const blobData = attachment.blob instanceof Blob ? attachment.blob : null;
    attachments.set(attachment.id, {
      id: attachment.id,
      messageId: message.id,
      kind: 'message',
      name: attachment.name || 'Attachment',
      mimeType: attachment.type || attachment.mimeType || 'application/octet-stream',
      size: attachment.size ?? (blobData?.size || 0),
      data: blobData,
      createdAt: attachment.createdAt || message.createdAt,
      transferStrategy: attachment.transferStrategy || 'auto',
      fileUri: attachment.fileUri || null,
      fileApiName: attachment.fileApiName || null,
      fileApiExpirationTime: attachment.fileApiExpirationTime || null,
      fileApiCreateTime: attachment.fileApiCreateTime || null,
      fileApiState: attachment.fileApiState || null,
      fileApiMimeType: attachment.fileApiMimeType || null,
      fileApiBaseUrl: attachment.fileApiBaseUrl || null
    });
  }

  return [...attachments.values()];
}

export function buildSettingsRecord() {
  return {
    id: 'app',
    currentModel: state.currentModel,
    thinkingLevel: state.thinkingLevel,
    customToolRoundLimit: state.customToolRoundLimit,
    theme: state.theme,
    accentColor: state.accentColor,
    activeChatId: state.activeChatId,
    activeProjectId: state.activeProjectId,
    collapsedProjectIds: Array.from(runtime.collapsedProjectIds || []),
    tools: state.tools || { googleSearch: false, urlContext: false, codeExecution: false, workspace: false },
    api: state.api,
    audioRead: state.audioRead || { voiceName: 'Zephyr', retentionDays: 7 }
  };
}

export function validateLoadedChatForPersistence(chat) {
  buildChatRecord(chat);
  if (!isChatLoaded(chat)) return;
  for (const message of chat.messages || []) {
    buildMessageRecord(chat.id, message);
    buildMessageAttachmentRecords(message);
  }
}
