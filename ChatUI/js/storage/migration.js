/**
 * migration.js - Legacy LocalStorage to IndexedDB migration.
 */

import { createEntityId } from '../state/store.js';
import { getModelConfig } from '../models/models.js';
import { base64ToBlob } from './blob-utils.js';

export const LEGACY_STORAGE_KEY = 'chat_app_data';
export const MIGRATED_FLAG_KEY = 'chat_app_data_indexeddb_migrated';

export async function migrateLegacyLocalStorage(db) {
  const isMigrated = localStorage.getItem(MIGRATED_FLAG_KEY);
  if (isMigrated === 'true') return;

  const rawLegacy = localStorage.getItem(LEGACY_STORAGE_KEY);
  if (!rawLegacy) return;

  try {
    const legacyData = JSON.parse(rawLegacy);
    const tx = db.transaction(['projects', 'chats', 'messages', 'attachments', 'settings'], 'readwrite');

    const projectStore = tx.objectStore('projects');
    const chatStore = tx.objectStore('chats');
    const msgStore = tx.objectStore('messages');
    const attachStore = tx.objectStore('attachments');
    const settingsStore = tx.objectStore('settings');

    const now = Date.now();

    // 1. Migrate Projects
    if (Array.isArray(legacyData.projects)) {
      legacyData.projects.forEach(proj => {
        if (proj) {
          projectStore.put({
            id: proj.id || createEntityId('proj'),
            name: proj.name || 'Untitled Project',
            createdAt: proj.createdAt || now,
            updatedAt: proj.updatedAt || now
          });
        }
      });
    }

    // 2. Migrate Chats & Messages & Attachments
    if (Array.isArray(legacyData.chats)) {
      legacyData.chats.forEach(chat => {
        if (!chat) return;
        const chatId = chat.id || createEntityId('chat');

        chatStore.put({
          id: chatId,
          projectId: chat.projectId || null,
          title: chat.title || 'New Chat',
          pinned: !!chat.pinned,
          createdAt: chat.createdAt || now,
          updatedAt: chat.updatedAt || now
        });

        if (Array.isArray(chat.messages)) {
          chat.messages.forEach((msg, idx) => {
            if (!msg) return;
            const msgId = msg.id || createEntityId('msg');
            const createdAt = msg.createdAt || (now + idx);
            const sequence = Number.isSafeInteger(Number(msg.sequence)) ? Number(msg.sequence) : (createdAt * 1000 + idx);
            msgStore.put({
              id: msgId,
              chatId,
              role: msg.role,
              content: msg.content || '',
              thinking: msg.thinking || '',
              thoughtSignature: typeof msg.thoughtSignature === 'string' ? msg.thoughtSignature : null,
              modelResponseParts: Array.isArray(msg.modelResponseParts) ? msg.modelResponseParts : [],
              status: msg.status || 'completed',
              errorMessage: msg.errorMessage || '',
              sequence,
              createdAt,
              updatedAt: msg.updatedAt || createdAt
            });

            // Convert Base64 attachments to Blobs
            if (Array.isArray(msg.attachments)) {
              msg.attachments.forEach((att) => {
                if (!att) return;
                const attId = att.id || createEntityId('att');
                let blobData = att.blob instanceof Blob ? att.blob : null;
                if (!blobData && att.inlineData?.data) {
                  blobData = base64ToBlob(att.inlineData.data, att.inlineData.mimeType || att.type);
                }

                attachStore.put({
                  id: attId,
                  messageId: msgId,
                  name: att.name || 'Attachment',
                  mimeType: att.type || att.inlineData?.mimeType || 'application/octet-stream',
                  size: att.size ?? (blobData ? blobData.size : 0),
                  data: blobData,
                  createdAt: att.createdAt || now
                });
              });
            }
          });
        }
      });
    }

    // 3. Migrate Settings
    const legacyModel = getModelConfig(legacyData.currentModel || '3.7 Flash');
    const legacyThinkingLevel = legacyModel.thinkingLevels.includes(legacyData.thinkingLevel)
      ? legacyData.thinkingLevel
      : legacyModel.defaultThinkingLevel;

    settingsStore.put({
      id: 'app',
      currentModel: legacyModel.name,
      thinkingLevel: legacyThinkingLevel,
      theme: legacyData.theme || 'dark',
      accentColor: legacyData.accentColor || '#2563EB',
      activeChatId: legacyData.activeChatId || null,
      activeProjectId: legacyData.activeProjectId || null,
      api: legacyData.api || { textApiKey: '', textBaseUrl: '', voiceApiKey: '', voiceBaseUrl: '' }
    });

    await new Promise((res, rej) => {
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });

    localStorage.setItem(MIGRATED_FLAG_KEY, 'true');
    console.log('Successfully migrated legacy LocalStorage data to IndexedDB.');
  } catch (err) {
    console.error('Migration from LocalStorage failed:', err);
    throw err;
  }
}
