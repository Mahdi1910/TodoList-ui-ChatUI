/**
 * save.js - Explicit full-state reconciliation fallback.
 *
 * Normal UI actions use targeted mutations. This module remains as a recovery
 * safety net and preserves Plan 04 unloaded-chat protection.
 */

import { state } from '../state/store.js';
import { openDatabase, getRequestPromise, waitForTransaction } from './database.js';
import {
  isChatLoaded,
  buildProjectRecord,
  buildChatRecord,
  buildMessageRecord,
  buildMessageAttachmentRecords,
  buildSettingsRecord,
  validateLoadedChatForPersistence
} from './records.js';
import { enqueueCoreWrite } from './write-coordinator.js';

const GLOBAL_STORE_NAMES = ['projects', 'chats', 'settings'];
const ALL_STORE_NAMES = ['projects', 'chats', 'messages', 'attachments', 'settings'];

function validateStateForPersistence() {
  for (const project of state.projects || []) buildProjectRecord(project);
  for (const chat of state.chats || []) validateLoadedChatForPersistence(chat);
}

function buildPersistenceSnapshot() {
  const projects = (state.projects || []).map(buildProjectRecord);
  const chats = [];
  const messages = [];
  const attachments = new Map();
  const loadedChatIds = [];

  for (const chat of state.chats || []) {
    chats.push(buildChatRecord(chat));
    if (!isChatLoaded(chat)) continue;
    loadedChatIds.push(chat.id);

    for (const message of chat.messages || []) {
      messages.push(buildMessageRecord(chat.id, message));
      for (const attachment of buildMessageAttachmentRecords(message)) {
        attachments.set(attachment.id, attachment);
      }
    }
  }

  return {
    projects,
    chats,
    messages,
    attachments: [...attachments.values()],
    loadedChatIds,
    settings: [buildSettingsRecord()]
  };
}

async function readExistingGlobalKeys(db) {
  const tx = db.transaction(GLOBAL_STORE_NAMES, 'readonly');
  const done = waitForTransaction(tx);
  const results = await Promise.all(GLOBAL_STORE_NAMES.map(name =>
    getRequestPromise(tx.objectStore(name).getAllKeys())
  ));
  await done;
  return Object.fromEntries(GLOBAL_STORE_NAMES.map((name, index) => [name, results[index] || []]));
}

async function readExistingLoadedChatScope(db, chatId, desiredMessageIds) {
  const messageTx = db.transaction('messages', 'readonly');
  const messageDone = waitForTransaction(messageTx);
  const existingMessages = await getRequestPromise(messageTx.objectStore('messages').index('chatId').getAll(chatId));
  await messageDone;

  const existingMessageIds = (existingMessages || []).map(message => message.id);
  const attachmentMessageIds = [...new Set([...existingMessageIds, ...desiredMessageIds])];
  const existingAttachmentIds = [];

  if (attachmentMessageIds.length > 0) {
    const attachmentTx = db.transaction('attachments', 'readonly');
    const attachmentDone = waitForTransaction(attachmentTx);
    const index = attachmentTx.objectStore('attachments').index('messageId');
    const requests = attachmentMessageIds.map(messageId => index.getAll(messageId));
    const groups = await Promise.all(requests.map(getRequestPromise));
    await attachmentDone;
    groups.flat().forEach(attachment => existingAttachmentIds.push(attachment.id));
  }

  return { chatId, existingMessageIds, existingAttachmentIds };
}

function syncStore(store, existingKeys, records) {
  const desiredKeys = new Set(records.map(record => record.id));
  existingKeys.forEach(key => {
    if (!desiredKeys.has(key)) store.delete(key);
  });
  records.forEach(record => store.put(record));
}

async function persistSnapshot(snapshot) {
  const db = await openDatabase();
  const existingGlobalKeys = await readExistingGlobalKeys(db);

  const messagesByChat = new Map(snapshot.loadedChatIds.map(chatId => [chatId, []]));
  const messageToChat = new Map();
  snapshot.messages.forEach(message => {
    messagesByChat.get(message.chatId)?.push(message);
    messageToChat.set(message.id, message.chatId);
  });

  const attachmentsByChat = new Map(snapshot.loadedChatIds.map(chatId => [chatId, []]));
  snapshot.attachments.forEach(attachment => {
    const chatId = messageToChat.get(attachment.messageId);
    if (chatId) attachmentsByChat.get(chatId)?.push(attachment);
  });

  const existingScopes = await Promise.all(snapshot.loadedChatIds.map(chatId => {
    const desiredMessageIds = (messagesByChat.get(chatId) || []).map(message => message.id);
    return readExistingLoadedChatScope(db, chatId, desiredMessageIds);
  }));

  const tx = db.transaction(ALL_STORE_NAMES, 'readwrite');
  const done = waitForTransaction(tx);

  syncStore(tx.objectStore('projects'), existingGlobalKeys.projects, snapshot.projects);
  syncStore(tx.objectStore('chats'), existingGlobalKeys.chats, snapshot.chats);
  syncStore(tx.objectStore('settings'), existingGlobalKeys.settings, snapshot.settings);

  const messageStore = tx.objectStore('messages');
  const attachmentStore = tx.objectStore('attachments');

  existingScopes.forEach(scope => {
    const desiredMessages = messagesByChat.get(scope.chatId) || [];
    const desiredMessageIds = new Set(desiredMessages.map(message => message.id));
    scope.existingMessageIds.forEach(messageId => {
      if (!desiredMessageIds.has(messageId)) messageStore.delete(messageId);
    });
    desiredMessages.forEach(message => messageStore.put(message));

    const desiredAttachments = attachmentsByChat.get(scope.chatId) || [];
    const desiredAttachmentIds = new Set(desiredAttachments.map(attachment => attachment.id));
    scope.existingAttachmentIds.forEach(attachmentId => {
      if (!desiredAttachmentIds.has(attachmentId)) attachmentStore.delete(attachmentId);
    });
    desiredAttachments.forEach(attachment => attachmentStore.put(attachment));
  });

  return done.catch(error => {
    console.error('saveState synchronization transaction failed:', error);
    throw error;
  });
}

export function saveState() {
  // Build the fallback snapshot only when this queued operation actually starts.
  // This prevents an old queued snapshot from overwriting a newer targeted write.
  return enqueueCoreWrite(async () => {
    validateStateForPersistence();
    const snapshot = buildPersistenceSnapshot();
    return persistSnapshot(snapshot);
  });
}
