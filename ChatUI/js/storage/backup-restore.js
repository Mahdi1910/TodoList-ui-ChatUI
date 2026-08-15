/**
 * backup-restore.js — Full portable backup/restore for durable ChatUI browser data.
 *
 * The backup source is IndexedDB itself, never lazy in-memory chat state.
 */

import { DB_NAME, DB_VERSION, openDatabase, getRequestPromise, waitForTransaction } from './database.js';
import { LEGACY_STORAGE_KEY, MIGRATED_FLAG_KEY } from './migration.js';
import { waitForCoreWrites } from './write-coordinator.js';

export const CHATUI_BACKUP_FORMAT = 'chatui-full-backup';
export const CHATUI_BACKUP_FORMAT_VERSION = 1;

const TYPE_MARKER = '__chatuiType';
const ROOT_PARENT_KEY = '__workspace_root__';
// TEMP_PERF_DIAGNOSTICS: keep this key local so removing the temporary diagnostics
// module later cannot break the permanent Backup & Restore feature.
const PERFORMANCE_DIAGNOSTICS_STORAGE_KEY = 'chatui_temp_performance_diagnostics_v1';
const LIVE_BROWSER_STORAGE_KEYS = [PERFORMANCE_DIAGNOSTICS_STORAGE_KEY];
const OBSOLETE_LOCAL_STORAGE_KEYS = [
  LEGACY_STORAGE_KEY,
  'gemini_text_api_key',
  'gemini_text_base_url',
  'gemini_voice_api_key',
  'gemini_voice_base_url'
];

export class BackupRestoreError extends Error {
  constructor(code, message, cause = null) {
    super(message);
    this.name = 'BackupRestoreError';
    this.code = code;
    if (cause) this.cause = cause;
  }
}

function fail(code, message, cause = null) {
  throw new BackupRestoreError(code, message, cause);
}

function assertObject(value, message) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('INVALID_BACKUP', message);
}

function ensureUniqueIds(records, key, label) {
  const ids = new Set();
  for (const record of records) {
    assertObject(record, `${label} contains an invalid record.`);
    const id = record[key];
    if (typeof id !== 'string' || !id) fail('INVALID_BACKUP', `${label} contains a record without a valid ${key}.`);
    if (ids.has(id)) fail('INVALID_BACKUP', `${label} contains duplicate ${key}: ${id}`);
    ids.add(id);
  }
  return ids;
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read Blob data.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      if (comma < 0) {
        reject(new Error('Blob conversion returned an invalid data URL.'));
        return;
      }
      resolve(result.slice(comma + 1));
    };
    reader.readAsDataURL(blob);
  });
}

function strictBase64ToBlob(base64, mimeType, expectedSize = null) {
  if (typeof base64 !== 'string') fail('INVALID_BACKUP', 'Blob is missing Base64 data.');
  let binary;
  try {
    binary = atob(base64);
  } catch (error) {
    fail('INVALID_BACKUP', 'Blob contains invalid Base64 data.', error);
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  const blob = new Blob([bytes], { type: typeof mimeType === 'string' ? mimeType : 'application/octet-stream' });
  if (expectedSize != null && Number(expectedSize) !== blob.size) {
    fail('INVALID_BACKUP', `Blob size mismatch: expected ${expectedSize}, decoded ${blob.size}.`);
  }
  return blob;
}

async function encodePortableValue(value, ancestors = new WeakSet()) {
  if (value == null || ['string', 'number', 'boolean'].includes(typeof value)) return value;
  if (typeof value === 'undefined') return { [TYPE_MARKER]: 'Undefined' };
  if (value instanceof Blob) {
    return {
      [TYPE_MARKER]: 'Blob',
      mimeType: value.type || 'application/octet-stream',
      size: value.size,
      base64: await blobToBase64(value)
    };
  }
  if (value instanceof Date) return { [TYPE_MARKER]: 'Date', value: value.toISOString() };
  if (typeof value !== 'object') fail('UNSUPPORTED_DATA', 'Backup contains a value that cannot be represented safely.');
  if (ancestors.has(value)) fail('UNSUPPORTED_DATA', 'Backup contains a circular data structure.');

  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      const result = [];
      for (const item of value) result.push(await encodePortableValue(item, ancestors));
      return result;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      fail('UNSUPPORTED_DATA', `Backup contains unsupported structured data (${value.constructor?.name || 'unknown'}).`);
    }
    const result = {};
    for (const [key, item] of Object.entries(value)) result[key] = await encodePortableValue(item, ancestors);
    return result;
  } finally {
    ancestors.delete(value);
  }
}

async function decodePortableValue(value) {
  if (value == null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return Promise.all(value.map(decodePortableValue));

  if (value[TYPE_MARKER] === 'Blob') return strictBase64ToBlob(value.base64, value.mimeType, value.size);
  if (value[TYPE_MARKER] === 'Date') {
    const date = new Date(value.value);
    if (Number.isNaN(date.getTime())) fail('INVALID_BACKUP', 'Backup contains an invalid Date value.');
    return date;
  }
  if (value[TYPE_MARKER] === 'Undefined') return undefined;
  if (value[TYPE_MARKER] != null) fail('INVALID_BACKUP', `Backup contains an unknown encoded value type: ${String(value[TYPE_MARKER])}.`);

  const result = {};
  for (const [key, item] of Object.entries(value)) result[key] = await decodePortableValue(item);
  return result;
}

async function snapshotAllStores() {
  await waitForCoreWrites();
  const db = await openDatabase();
  const storeNames = Array.from(db.objectStoreNames);
  if (!storeNames.length) fail('DATABASE_ERROR', 'ChatUI database has no stores to back up.');

  const tx = db.transaction(storeNames, 'readonly');
  const done = waitForTransaction(tx);
  const requests = storeNames.map(name => getRequestPromise(tx.objectStore(name).getAll()));
  const values = await Promise.all(requests);
  await done;
  return {
    storeNames,
    stores: Object.fromEntries(storeNames.map((name, index) => [name, values[index] || []]))
  };
}

function collectBrowserStorage() {
  const result = {};
  for (const key of LIVE_BROWSER_STORAGE_KEYS) {
    const value = localStorage.getItem(key);
    if (value !== null) result[key] = value;
  }
  return result;
}

function buildBackupFileName(date) {
  const pad = value => String(value).padStart(2, '0');
  return `ChatUI-Backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.chatui.json`;
}

export async function createFullBackup() {
  const snapshot = await snapshotAllStores();
  const stores = {};
  for (const name of snapshot.storeNames) stores[name] = await encodePortableValue(snapshot.stores[name]);

  const createdAt = Date.now();
  const envelope = {
    format: CHATUI_BACKUP_FORMAT,
    formatVersion: CHATUI_BACKUP_FORMAT_VERSION,
    createdAt,
    source: {
      databaseName: DB_NAME,
      databaseVersion: DB_VERSION,
      storeNames: [...snapshot.storeNames]
    },
    stores,
    browserStorage: collectBrowserStorage()
  };
  const blob = new Blob([JSON.stringify(envelope)], { type: 'application/json' });
  return {
    blob,
    fileName: buildBackupFileName(new Date(createdAt)),
    byteSize: blob.size,
    createdAt,
    counts: Object.fromEntries(snapshot.storeNames.map(name => [name, snapshot.stores[name].length]))
  };
}

function validateEnvelope(parsed, currentStoreNames) {
  assertObject(parsed, 'Selected file is not a ChatUI backup object.');
  if (parsed.format !== CHATUI_BACKUP_FORMAT) fail('INVALID_BACKUP', 'Selected file is not a ChatUI full backup.');
  if (parsed.formatVersion !== CHATUI_BACKUP_FORMAT_VERSION) fail('UNSUPPORTED_VERSION', `Backup format version ${String(parsed.formatVersion)} is not supported.`);
  if (!Number.isFinite(Number(parsed.createdAt))) fail('INVALID_BACKUP', 'Backup creation time is invalid.');
  assertObject(parsed.source, 'Backup source metadata is missing.');
  if (parsed.source.databaseName !== DB_NAME) fail('INVALID_BACKUP', 'Backup was not created from the ChatUI database.');

  const sourceDatabaseVersion = Number(parsed.source.databaseVersion);
  if (!Number.isInteger(sourceDatabaseVersion) || sourceDatabaseVersion < 1) fail('INVALID_BACKUP', 'Backup database version is invalid.');
  if (sourceDatabaseVersion > DB_VERSION) fail('NEWER_SCHEMA', 'This backup was created by a newer ChatUI database version. Update ChatUI before restoring it.');
  if (!Array.isArray(parsed.source.storeNames)) fail('INVALID_BACKUP', 'Backup store manifest is invalid.');
  assertObject(parsed.stores, 'Backup stores are missing.');
  if (parsed.browserStorage != null) assertObject(parsed.browserStorage, 'Backup browser storage section is invalid.');

  const manifestNames = parsed.source.storeNames;
  const manifestSet = new Set();
  for (const name of manifestNames) {
    if (typeof name !== 'string' || !name) fail('INVALID_BACKUP', 'Backup store manifest contains an invalid store name.');
    if (manifestSet.has(name)) fail('INVALID_BACKUP', `Backup store manifest contains duplicate store “${name}”.`);
    manifestSet.add(name);
  }

  const storedNames = Object.keys(parsed.stores);
  if (storedNames.length !== manifestSet.size || storedNames.some(name => !manifestSet.has(name))) {
    fail('INVALID_BACKUP', 'Backup store manifest does not exactly match its store data.');
  }

  const current = new Set(currentStoreNames);
  for (const [name, records] of Object.entries(parsed.stores)) {
    if (!current.has(name)) fail('NEWER_SCHEMA', `This backup contains database store “${name}”, which this ChatUI build does not support. Update ChatUI before restoring it.`);
    if (!Array.isArray(records)) fail('INVALID_BACKUP', `Backup store “${name}” is invalid.`);
  }
}

function validateWorkspaceHierarchy(workspaceNodes, nodeById) {
  for (const node of workspaceNodes) {
    const visited = new Set([node.id]);
    let parentId = node.parentId;
    while (parentId != null) {
      if (visited.has(parentId)) fail('INVALID_BACKUP', `Workspace hierarchy contains a cycle involving node ${node.id}.`);
      visited.add(parentId);
      const parent = nodeById.get(parentId);
      if (!parent) break;
      parentId = parent.parentId;
    }
  }
}

function validateRelationships(stores) {
  const projects = stores.projects || [];
  const chats = stores.chats || [];
  const messages = stores.messages || [];
  const attachments = stores.attachments || [];
  const settings = stores.settings || [];
  const readAudio = stores.readAudio || [];
  const workspaceNodes = stores.workspaceNodes || [];
  const workspaceFiles = stores.workspaceFiles || [];

  const projectIds = ensureUniqueIds(projects, 'id', 'Projects');
  const chatIds = ensureUniqueIds(chats, 'id', 'Chats');
  for (const chat of chats) if (chat.projectId != null && !projectIds.has(chat.projectId)) fail('INVALID_BACKUP', `Chat ${chat.id} references a missing project.`);

  const messageIds = ensureUniqueIds(messages, 'id', 'Messages');
  const messageById = new Map(messages.map(message => [message.id, message]));
  for (const message of messages) {
    if (!chatIds.has(message.chatId)) fail('INVALID_BACKUP', `Message ${message.id} references a missing chat.`);
    if (!Number.isSafeInteger(Number(message.sequence))) fail('INVALID_BACKUP', `Message ${message.id} has invalid sequence metadata.`);
  }

  ensureUniqueIds(attachments, 'id', 'Attachments');
  for (const attachment of attachments) {
    if (!messageIds.has(attachment.messageId)) fail('INVALID_BACKUP', `Attachment ${attachment.id} references a missing message.`);
    if (attachment.data != null && !(attachment.data instanceof Blob)) fail('INVALID_BACKUP', `Attachment ${attachment.id} does not contain valid Blob data.`);
    if (attachment.data instanceof Blob && attachment.size != null && Number(attachment.size) !== attachment.data.size) fail('INVALID_BACKUP', `Attachment ${attachment.id} has inconsistent size metadata.`);
  }

  const settingIds = ensureUniqueIds(settings, 'id', 'Settings');
  if (settingIds.has('app') && settings.filter(record => record.id === 'app').length !== 1) fail('INVALID_BACKUP', 'Backup contains duplicate application settings records.');

  ensureUniqueIds(readAudio, 'messageId', 'Read Aloud audio');
  for (const record of readAudio) {
    const message = messageById.get(record.messageId);
    if (!message) fail('INVALID_BACKUP', `Read Aloud audio references missing message ${record.messageId}.`);
    if (record.chatId != null && record.chatId !== message.chatId) fail('INVALID_BACKUP', `Read Aloud audio for ${record.messageId} references the wrong chat.`);
    if (!(record.data instanceof Blob)) fail('INVALID_BACKUP', `Read Aloud audio for ${record.messageId} is missing its Blob.`);
  }

  ensureUniqueIds(workspaceNodes, 'id', 'Workspace nodes');
  const nodeById = new Map(workspaceNodes.map(node => [node.id, node]));
  const siblings = new Set();
  for (const node of workspaceNodes) {
    if (!['file', 'directory'].includes(node.type)) fail('INVALID_BACKUP', `Workspace node ${node.id} has an invalid type.`);
    if (node.parentId != null) {
      const parent = nodeById.get(node.parentId);
      if (!parent || parent.type !== 'directory') fail('INVALID_BACKUP', `Workspace node ${node.id} references an invalid parent.`);
    }
    const expectedParentKey = node.parentId || ROOT_PARENT_KEY;
    if (node.parentKey !== expectedParentKey || typeof node.nameKey !== 'string' || !node.nameKey) fail('INVALID_BACKUP', `Workspace node ${node.id} has invalid path metadata.`);
    const siblingKey = `${expectedParentKey}\u0000${node.nameKey}`;
    if (siblings.has(siblingKey)) fail('INVALID_BACKUP', 'Workspace contains duplicate sibling names.');
    siblings.add(siblingKey);
  }
  validateWorkspaceHierarchy(workspaceNodes, nodeById);

  const fileNodeIds = ensureUniqueIds(workspaceFiles, 'nodeId', 'Workspace files');
  for (const file of workspaceFiles) {
    const node = nodeById.get(file.nodeId);
    if (!node || node.type !== 'file') fail('INVALID_BACKUP', `Workspace file ${file.nodeId} references a missing file node.`);
  }
  for (const node of workspaceNodes) if (node.type === 'file' && !fileNodeIds.has(node.id)) fail('INVALID_BACKUP', `Workspace file node ${node.id} is missing its content record.`);
}

export async function validateFullBackup(parsedBackup) {
  const db = await openDatabase();
  const currentStoreNames = Array.from(db.objectStoreNames);
  validateEnvelope(parsedBackup, currentStoreNames);

  const stores = {};
  for (const name of currentStoreNames) {
    const source = Object.prototype.hasOwnProperty.call(parsedBackup.stores, name) ? parsedBackup.stores[name] : [];
    stores[name] = await decodePortableValue(source);
    if (!Array.isArray(stores[name])) fail('INVALID_BACKUP', `Decoded store “${name}” is invalid.`);
  }
  validateRelationships(stores);

  const browserStorage = {};
  for (const key of LIVE_BROWSER_STORAGE_KEYS) {
    if (!parsedBackup.browserStorage || !Object.prototype.hasOwnProperty.call(parsedBackup.browserStorage, key)) continue;
    if (typeof parsedBackup.browserStorage[key] !== 'string') fail('INVALID_BACKUP', `Backup browser storage value for ${key} is invalid.`);
    browserStorage[key] = parsedBackup.browserStorage[key];
  }

  return {
    format: parsedBackup.format,
    formatVersion: parsedBackup.formatVersion,
    createdAt: Number(parsedBackup.createdAt),
    storeNames: currentStoreNames,
    stores,
    browserStorage,
    counts: Object.fromEntries(currentStoreNames.map(name => [name, stores[name].length]))
  };
}

export async function prepareFullBackupRestore(file) {
  if (!(file instanceof Blob)) fail('INVALID_FILE', 'Choose a ChatUI backup file first.');
  let parsed;
  try {
    parsed = JSON.parse(await file.text());
  } catch (error) {
    fail('INVALID_BACKUP', 'The selected file is not valid backup JSON.', error);
  }
  return validateFullBackup(parsed);
}

export function applyRestoredBrowserStorage(browserStorage = {}) {
  for (const key of LIVE_BROWSER_STORAGE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(browserStorage, key)) localStorage.setItem(key, browserStorage[key]);
    else localStorage.removeItem(key);
  }
  for (const key of OBSOLETE_LOCAL_STORAGE_KEYS) localStorage.removeItem(key);
  localStorage.setItem(MIGRATED_FLAG_KEY, 'true');
}
