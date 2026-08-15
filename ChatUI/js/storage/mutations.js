/**
 * mutations.js - Small, ordered IndexedDB mutations for normal ChatUI actions.
 */

import { openDatabase, getRequestPromise, waitForTransaction } from './database.js';
import {
  buildProjectRecord,
  buildChatRecord,
  buildMessageRecord,
  buildMessageAttachmentRecords,
  buildSettingsRecord,
  validateLoadedChatForPersistence
} from './records.js';
import { enqueueCoreWrite } from './write-coordinator.js';

const REMOTE_ATTACHMENT_METADATA_FIELDS = new Set([
  'transferStrategy',
  'fileUri',
  'fileApiName',
  'fileApiExpirationTime',
  'fileApiCreateTime',
  'fileApiState',
  'fileApiMimeType',
  'fileApiBaseUrl'
]);

function transactionFailure(label, done) {
  return done.catch(error => {
    console.error(`${label} transaction failed:`, error);
    throw error;
  });
}

export function persistSettings() {
  const settingsRecord = buildSettingsRecord();
  return enqueueCoreWrite(async () => {
    const db = await openDatabase();
    const tx = db.transaction('settings', 'readwrite');
    const done = waitForTransaction(tx);
    tx.objectStore('settings').put(settingsRecord);
    return transactionFailure('persistSettings', done);
  });
}

export function persistMetadataChanges({ projects = [], chats = [], settings = false } = {}) {
  const projectRecords = projects.map(buildProjectRecord);
  const chatRecords = chats.map(buildChatRecord);
  const settingsRecord = settings ? buildSettingsRecord() : null;

  if (projectRecords.length === 0 && chatRecords.length === 0 && !settingsRecord) {
    return Promise.resolve();
  }

  return enqueueCoreWrite(async () => {
    const db = await openDatabase();
    const stores = [];
    if (projectRecords.length) stores.push('projects');
    if (chatRecords.length) stores.push('chats');
    if (settingsRecord) stores.push('settings');
    const tx = db.transaction(stores, 'readwrite');
    const done = waitForTransaction(tx);
    if (projectRecords.length) {
      const store = tx.objectStore('projects');
      projectRecords.forEach(record => store.put(record));
    }
    if (chatRecords.length) {
      const store = tx.objectStore('chats');
      chatRecords.forEach(record => store.put(record));
    }
    if (settingsRecord) tx.objectStore('settings').put(settingsRecord);
    return transactionFailure('persistMetadataChanges', done);
  });
}

export function persistChatMetadata(chat) {
  return persistMetadataChanges({ chats: [chat] });
}

export function persistProjectMetadata(project) {
  return persistMetadataChanges({ projects: [project] });
}

function replaceAttachmentScope(tx, messageId, desiredAttachments) {
  const attachmentStore = tx.objectStore('attachments');
  const request = attachmentStore.index('messageId').openCursor(IDBKeyRange.only(messageId));
  request.onerror = () => {
    try { tx.abort(); } catch (_) {}
  };
  request.onsuccess = () => {
    const cursor = request.result;
    if (cursor) {
      cursor.delete();
      cursor.continue();
      return;
    }
    desiredAttachments.forEach(record => attachmentStore.put(record));
  };
}

export function persistChatMessage(chat, message, options = {}) {
  const {
    includeSettings = false,
    synchronizeAttachments = true,
    newMessage = false
  } = options;

  const chatRecord = buildChatRecord(chat);
  const messageRecord = buildMessageRecord(chat.id, message);
  const attachmentRecords = synchronizeAttachments ? buildMessageAttachmentRecords(message) : [];
  const settingsRecord = includeSettings ? buildSettingsRecord() : null;

  return enqueueCoreWrite(async () => {
    const db = await openDatabase();
    const stores = ['chats', 'messages'];
    if (synchronizeAttachments) stores.push('attachments');
    if (settingsRecord) stores.push('settings');
    const tx = db.transaction(stores, 'readwrite');
    const done = waitForTransaction(tx);

    tx.objectStore('chats').put(chatRecord);
    tx.objectStore('messages').put(messageRecord);
    if (settingsRecord) tx.objectStore('settings').put(settingsRecord);

    if (synchronizeAttachments) {
      if (newMessage) {
        const attachmentStore = tx.objectStore('attachments');
        attachmentRecords.forEach(record => attachmentStore.put(record));
      } else {
        replaceAttachmentScope(tx, message.id, attachmentRecords);
      }
    }

    return transactionFailure('persistChatMessage', done);
  });
}

export function persistNewUserTurn(chat, message, { includeSettings = false } = {}) {
  return persistChatMessage(chat, message, {
    includeSettings,
    synchronizeAttachments: true,
    newMessage: true
  });
}

function sanitizeRemoteAttachmentMetadata(metadata = {}) {
  const patch = {};
  for (const [key, value] of Object.entries(metadata || {})) {
    if (!REMOTE_ATTACHMENT_METADATA_FIELDS.has(key)) continue;
    if (key === 'transferStrategy') {
      patch[key] = value === 'inline' ? 'inline' : 'auto';
    } else {
      patch[key] = value == null || value === '' ? null : String(value);
    }
  }
  return patch;
}

export function persistAttachmentRemoteMetadata(attachmentId, metadata = {}) {
  if (!attachmentId) return Promise.reject(new Error('Cannot update attachment metadata without an attachment ID.'));
  const patch = sanitizeRemoteAttachmentMetadata(metadata);
  if (Object.keys(patch).length === 0) return Promise.resolve();

  return enqueueCoreWrite(async () => {
    const db = await openDatabase();
    const tx = db.transaction('attachments', 'readwrite');
    const done = waitForTransaction(tx);
    const store = tx.objectStore('attachments');
    let semanticError = null;
    const request = store.get(attachmentId);

    request.onerror = () => {
      try { tx.abort(); } catch (_) {}
    };
    request.onsuccess = () => {
      const current = request.result;
      if (!current) {
        semanticError = new Error(`Attachment ${attachmentId} no longer exists in IndexedDB.`);
        try { tx.abort(); } catch (_) {}
        return;
      }
      if (current.kind === 'tool') {
        semanticError = new Error(`Attachment ${attachmentId} is a generated tool file and cannot receive Gemini File metadata.`);
        try { tx.abort(); } catch (_) {}
        return;
      }
      store.put({ ...current, ...patch });
    };

    return done.catch(error => {
      const resolved = semanticError || error;
      console.error('persistAttachmentRemoteMetadata transaction failed:', resolved);
      throw resolved;
    });
  });
}

export function deleteChatMessages(chat, messageIds = []) {
  const ids = [...new Set((messageIds || []).filter(Boolean))];
  if (!chat?.id || ids.length === 0) return Promise.resolve();
  const chatRecord = buildChatRecord(chat);

  return enqueueCoreWrite(async () => {
    const db = await openDatabase();
    const tx = db.transaction(['chats', 'messages', 'attachments'], 'readwrite');
    const done = waitForTransaction(tx);
    tx.objectStore('chats').put(chatRecord);

    const messageStore = tx.objectStore('messages');
    const attachmentStore = tx.objectStore('attachments');
    const attachmentIndex = attachmentStore.index('messageId');

    ids.forEach(messageId => {
      messageStore.delete(messageId);
      const cursorRequest = attachmentIndex.openCursor(IDBKeyRange.only(messageId));
      cursorRequest.onerror = () => {
        try { tx.abort(); } catch (_) {}
      };
      cursorRequest.onsuccess = () => {
        const cursor = cursorRequest.result;
        if (!cursor) return;
        cursor.delete();
        cursor.continue();
      };
    });

    return transactionFailure('deleteChatMessages', done);
  });
}

async function readExistingChatScope(db, chatId, desiredMessageIds) {
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

  return { existingMessageIds, existingAttachmentIds };
}

export function reconcileLoadedChat(chat) {
  validateLoadedChatForPersistence(chat);
  if (chat.messagesLoaded !== true) {
    return Promise.reject(new Error(`Cannot reconcile unloaded chat ${chat.id}.`));
  }

  const chatRecord = buildChatRecord(chat);
  const messageRecords = (chat.messages || []).map(message => buildMessageRecord(chat.id, message));
  const attachmentRecords = (chat.messages || []).flatMap(buildMessageAttachmentRecords);
  const desiredMessageIds = messageRecords.map(message => message.id);

  return enqueueCoreWrite(async () => {
    const db = await openDatabase();
    const existing = await readExistingChatScope(db, chat.id, desiredMessageIds);
    const tx = db.transaction(['chats', 'messages', 'attachments'], 'readwrite');
    const done = waitForTransaction(tx);

    tx.objectStore('chats').put(chatRecord);
    const messageStore = tx.objectStore('messages');
    const attachmentStore = tx.objectStore('attachments');

    const desiredMessageIdSet = new Set(desiredMessageIds);
    existing.existingMessageIds.forEach(messageId => {
      if (!desiredMessageIdSet.has(messageId)) messageStore.delete(messageId);
    });
    messageRecords.forEach(record => messageStore.put(record));

    const desiredAttachmentIds = new Set(attachmentRecords.map(record => record.id));
    existing.existingAttachmentIds.forEach(attachmentId => {
      if (!desiredAttachmentIds.has(attachmentId)) attachmentStore.delete(attachmentId);
    });
    attachmentRecords.forEach(record => attachmentStore.put(record));

    return transactionFailure('reconcileLoadedChat', done);
  });
}
