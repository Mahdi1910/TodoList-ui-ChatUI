/**
 * load.js - Metadata startup, lazy chat content loading, and message search.
 */

import { setState, setRuntime, normalizeProjectId } from '../state/store.js';
import { getModelConfig } from '../models/models.js';
import { sanitizeActivityTimeline } from '../chat/activity-timeline.js';
import { openDatabase, getRequestPromise, waitForTransaction } from './database.js';
import { migrateLegacyLocalStorage } from './migration.js';
import { persistMetadataChanges } from './mutations.js';

function sortMessages(messages = []) {
  return [...messages].sort((a, b) => {
    if (a.sequence !== b.sequence) return a.sequence - b.sequence;
    if (a.createdAt !== b.createdAt) return a.createdAt - b.createdAt;
    return a.id.localeCompare(b.id);
  });
}

function compareAssistantFreshness(a, b) {
  const updatedDiff = (a?.updatedAt || 0) - (b?.updatedAt || 0);
  if (updatedDiff !== 0) return updatedDiff;
  const sequenceDiff = Number(a?.sequence || 0) - Number(b?.sequence || 0);
  if (sequenceDiff !== 0) return sequenceDiff;
  const createdDiff = (a?.createdAt || 0) - (b?.createdAt || 0);
  if (createdDiff !== 0) return createdDiff;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function repairDuplicateAssistants(messages) {
  const ordered = sortMessages(messages);
  const keepAssistantIds = new Set();
  let repaired = false;
  const firstUserIndex = ordered.findIndex(message => message.role === 'user');
  if (firstUserIndex === -1) return { messages: ordered, repaired: false };

  for (let index = 0; index < firstUserIndex; index += 1) {
    if (ordered[index].role === 'assistant') keepAssistantIds.add(ordered[index].id);
  }

  for (let index = firstUserIndex; index < ordered.length; index += 1) {
    if (ordered[index].role !== 'user') continue;
    const assistants = [];
    for (let cursor = index + 1; cursor < ordered.length; cursor += 1) {
      if (ordered[cursor].role === 'user') break;
      if (ordered[cursor].role === 'assistant') assistants.push(ordered[cursor]);
    }
    if (assistants.length === 1) keepAssistantIds.add(assistants[0].id);
    if (assistants.length > 1) {
      const newest = assistants.reduce((best, candidate) =>
        compareAssistantFreshness(candidate, best) > 0 ? candidate : best
      );
      keepAssistantIds.add(newest.id);
      repaired = true;
    }
  }

  const repairedMessages = ordered.filter(message =>
    message.role !== 'assistant' || keepAssistantIds.has(message.id)
  );
  return { messages: repairedMessages, repaired };
}

async function loadAttachmentsForMessages(db, messages) {
  if (!messages.length) return messages.map(() => []);
  const attachmentTx = db.transaction('attachments', 'readonly');
  const attachmentDone = waitForTransaction(attachmentTx);
  const attachIndex = attachmentTx.objectStore('attachments').index('messageId');
  const requests = messages.map(message => attachIndex.getAll(message.id));
  const results = await Promise.all(requests.map(getRequestPromise));
  await attachmentDone;
  return results;
}

export async function loadChatContent(chatId) {
  if (!chatId) throw new Error('Cannot load chat content without a chat ID.');
  const db = await openDatabase();

  const messageTx = db.transaction('messages', 'readonly');
  const messageDone = waitForTransaction(messageTx);
  const storedMessages = await getRequestPromise(messageTx.objectStore('messages').index('chatId').getAll(chatId));
  await messageDone;

  const repair = repairDuplicateAssistants(storedMessages || []);
  const orderedMessages = repair.messages;
  const attachmentResults = await loadAttachmentsForMessages(db, orderedMessages);

  const messages = orderedMessages.map((message, index) => {
    const storedAttachments = attachmentResults[index] || [];
    const toolAttachmentIds = new Set();
    let toolMetadata = message.toolMetadata || null;

    if (toolMetadata && Array.isArray(toolMetadata.codeExecutions)) {
      toolMetadata = JSON.parse(JSON.stringify(toolMetadata));
      toolMetadata.codeExecutions.forEach((exec, execIdx) => {
        if (exec.type !== 'file') return;
        const expectedId = exec.id || `att_sandbox_${message.id}_${execIdx}`;
        const match = storedAttachments.find(attachment =>
          attachment.id === expectedId ||
          (attachment.kind === 'tool' && attachment.name === exec.fileName) ||
          (!attachment.kind && attachment.name === exec.fileName)
        );
        if (match) {
          exec.id = exec.id || match.id;
          if (match.data) exec.blob = match.data;
          toolAttachmentIds.add(match.id);
        }
      });
    }

    const messageAttachments = storedAttachments.filter(attachment => {
      if (attachment.kind === 'tool') return false;
      if (attachment.kind === 'message') return true;
      return !toolAttachmentIds.has(attachment.id);
    });

    const content = message.content || '';
    const thinking = message.thinking || '';
    return {
      id: message.id,
      role: message.role,
      content,
      thinking,
      thoughtSignature: typeof message.thoughtSignature === 'string' ? message.thoughtSignature : null,
      modelResponseParts: Array.isArray(message.modelResponseParts) ? message.modelResponseParts : [],
      toolMetadata,
      activityTimeline: Array.isArray(message.activityTimeline)
        ? sanitizeActivityTimeline(message.activityTimeline, { content, thinking })
        : null,
      activeTools: message.activeTools && typeof message.activeTools === 'object' ? { ...message.activeTools } : null,
      status: message.status || 'completed',
      errorMessage: message.errorMessage || '',
      sequence: Number.isSafeInteger(Number(message.sequence)) ? Number(message.sequence) : 0,
      createdAt: message.createdAt || 0,
      updatedAt: message.updatedAt || message.createdAt || 0,
      attachments: messageAttachments.map(attachment => ({
        id: attachment.id,
        name: attachment.name,
        type: attachment.mimeType,
        size: attachment.size,
        blob: attachment.data || null,
        url: attachment.data && attachment.data.size > 0 ? URL.createObjectURL(attachment.data) : null,
        transferStrategy: attachment.transferStrategy || 'auto',
        fileUri: attachment.fileUri || null,
        fileApiName: attachment.fileApiName || null,
        fileApiExpirationTime: attachment.fileApiExpirationTime || null,
        fileApiCreateTime: attachment.fileApiCreateTime || null,
        fileApiState: attachment.fileApiState || null,
        fileApiMimeType: attachment.fileApiMimeType || null,
        fileApiBaseUrl: attachment.fileApiBaseUrl || null
      }))
    };
  });

  return { messages, repaired: repair.repaired };
}

export async function searchMessageChatIds(query) {
  const normalizedQuery = String(query || '').trim().toLowerCase();
  if (!normalizedQuery) return { chatIds: [], matchCounts: {} };

  const db = await openDatabase();
  const tx = db.transaction('messages', 'readonly');
  const done = waitForTransaction(tx);
  const messages = await getRequestPromise(tx.objectStore('messages').getAll());
  await done;

  const matchCounts = {};
  (messages || []).forEach(message => {
    const content = String(message?.content || '').toLowerCase();
    if (!content.includes(normalizedQuery) || !message?.chatId) return;
    matchCounts[message.chatId] = (matchCounts[message.chatId] || 0) + 1;
  });

  return { chatIds: Object.keys(matchCounts), matchCounts };
}

export async function loadState(options = {}) {
  const isActive = typeof options.isActive === 'function' ? options.isActive : () => true;
  try {
    const db = await openDatabase();
    await migrateLegacyLocalStorage(db);

    const tx = db.transaction(['projects', 'chats', 'settings'], 'readonly');
    const transactionDone = waitForTransaction(tx);
    const projects = await getRequestPromise(tx.objectStore('projects').getAll());
    const chats = await getRequestPromise(tx.objectStore('chats').getAll());
    const settingsArr = await getRequestPromise(tx.objectStore('settings').getAll());
    await transactionDone;

    const loadedProjects = projects || [];
    const settings = settingsArr.find(setting => setting.id === 'app') || {};
    const modelConfig = getModelConfig(settings.currentModel || '3.7 Flash');
    const modelWasCorrected = settings.currentModel !== modelConfig.name;
    const savedThinkingLevel = settings.thinkingLevel;
    const thinkingLevel = modelConfig.thinkingLevels.includes(savedThinkingLevel)
      ? savedThinkingLevel
      : modelConfig.defaultThinkingLevel;
    let repairedProjectReferences = false;
    const repairedChatIds = new Set();

    const formattedChats = (chats || []).map(chat => {
      const savedProjectId = chat.projectId || null;
      const projectId = normalizeProjectId(savedProjectId, loadedProjects);
      if (projectId !== savedProjectId) {
        repairedProjectReferences = true;
        repairedChatIds.add(chat.id);
      }
      const rawMessageCount = Number(chat.messageCount);
      return {
        id: chat.id,
        title: chat.title,
        projectId,
        pinned: !!chat.pinned,
        createdAt: chat.createdAt || 0,
        updatedAt: chat.updatedAt || chat.createdAt || 0,
        messages: [],
        messagesLoaded: false,
        messageCount: Number.isSafeInteger(rawMessageCount) && rawMessageCount >= 0 ? rawMessageCount : null
      };
    });

    formattedChats.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    const activeChatId = settings.activeChatId && formattedChats.some(chat => chat.id === settings.activeChatId)
      ? settings.activeChatId
      : null;
    const savedActiveProjectId = settings.activeProjectId || null;
    const activeProjectId = normalizeProjectId(savedActiveProjectId, loadedProjects);
    if (activeProjectId !== savedActiveProjectId) repairedProjectReferences = true;

    if (!isActive()) {
      throw new Error('IndexedDB state loading completed after the startup deadline and was discarded.');
    }

    const savedTools = settings.tools || {};
    setState({
      projects: loadedProjects,
      chats: formattedChats,
      activeChatId,
      activeProjectId,
      currentModel: modelConfig.name,
      thinkingLevel,
      theme: settings.theme || 'dark',
      accentColor: settings.accentColor || '#2563EB',
      tools: {
        googleSearch: !!savedTools.googleSearch,
        urlContext: !!savedTools.urlContext,
        codeExecution: !!savedTools.codeExecution,
        workspace: !!savedTools.workspace
      },
      api: {
        textApiKey: settings.api?.textApiKey || '',
        textBaseUrl: settings.api?.textBaseUrl || '',
        voiceApiKey: settings.api?.voiceApiKey || '',
        voiceBaseUrl: settings.api?.voiceBaseUrl || ''
      },
      audioRead: {
        voiceName: settings.audioRead?.voiceName || 'Zephyr',
        retentionDays: Number.isInteger(Number(settings.audioRead?.retentionDays))
          ? Number(settings.audioRead.retentionDays)
          : 7
      }
    });

    const hasSavedCollapsed = Array.isArray(settings.collapsedProjectIds);
    const savedCollapsed = hasSavedCollapsed
      ? settings.collapsedProjectIds
      : loadedProjects.map(project => project.id);
    const filteredCollapsed = [...new Set(savedCollapsed.filter(projectId =>
      normalizeProjectId(projectId, loadedProjects) === projectId
    ))];
    if (hasSavedCollapsed && (
      filteredCollapsed.length !== savedCollapsed.length ||
      filteredCollapsed.some((projectId, index) => projectId !== savedCollapsed[index])
    )) {
      repairedProjectReferences = true;
    }
    setRuntime({ collapsedProjectIds: new Set(filteredCollapsed) });

    if (modelWasCorrected || savedThinkingLevel !== thinkingLevel || repairedProjectReferences) {
      const repairedChats = formattedChats.filter(chat => repairedChatIds.has(chat.id));
      await persistMetadataChanges({ chats: repairedChats, settings: true });
    }
    return true;
  } catch (err) {
    console.error('Failed to load state from IndexedDB:', err);
    throw err;
  }
}
