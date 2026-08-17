/**
 * attachment-transport.js — Policy for choosing Gemini Files API vs inlineData.
 *
 * Local Blob data remains the permanent source of truth. Remote File metadata is
 * a temporary accelerator and is never used for local previews or backup ownership.
 */

import {
  getGeminiFile,
  uploadGeminiFile,
  waitForGeminiFileActive
} from '../api/gemini-files.js';
import { persistAttachmentRemoteMetadata } from '../storage/storage.js';
import { isRemoteFileLookupUnavailable, remoteFileName } from './attachment-file-errors.js';

export const FILE_API_EXPIRATION_LEEWAY_MS = 5 * 60 * 1000;
export const MAX_CONCURRENT_FILE_OPERATIONS = 7;

const uploadCapabilityCache = new Map();
const modelCapabilityCache = new Map();

function normalizedBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function mimeTypeForAttachment(attachment) {
  return String(
    attachment?.fileApiMimeType ||
    attachment?.type ||
    attachment?.mimeType ||
    attachment?.blob?.type ||
    'application/octet-stream'
  ).toLowerCase();
}

function uploadCapabilityKey(context, mimeType) {
  return `${normalizedBaseUrl(context?.cleanBaseUrl)}\u0000${mimeType}`;
}

function modelCapabilityKey(context, mimeType) {
  return `${normalizedBaseUrl(context?.cleanBaseUrl)}\u0000${String(context?.modelId || '')}\u0000${mimeType}`;
}

export function markModelMimeUnsupported(context, mimeType) {
  modelCapabilityCache.set(modelCapabilityKey(context, String(mimeType || '').toLowerCase()), 'unsupported');
}

function isModelMimeUnsupported(context, mimeType) {
  return modelCapabilityCache.get(modelCapabilityKey(context, mimeType)) === 'unsupported';
}

function isUploadMimeUnsupported(context, mimeType) {
  return uploadCapabilityCache.get(uploadCapabilityKey(context, mimeType)) === 'unsupported';
}

function markUploadMimeUnsupported(context, mimeType) {
  uploadCapabilityCache.set(uploadCapabilityKey(context, mimeType), 'unsupported');
}

function collectMachineReasons(value, output = new Set()) {
  if (!value || typeof value !== 'object') return output;
  if (Array.isArray(value)) {
    value.forEach(item => collectMachineReasons(item, output));
    return output;
  }
  for (const [key, item] of Object.entries(value)) {
    const normalizedKey = String(key || '').toLowerCase();
    if (['reason', 'errorcode', 'error_code', 'status', 'code'].includes(normalizedKey) && typeof item === 'string') {
      output.add(item.toUpperCase());
    } else if (item && typeof item === 'object') {
      collectMachineReasons(item, output);
    }
  }
  return output;
}

export function isMachineUnsupportedFileError(error) {
  if (!error) return false;
  if (Number(error.httpStatus) === 415) return true;
  const reasons = collectMachineReasons(error.details || []);
  if (typeof error.apiStatus === 'string') reasons.add(error.apiStatus.toUpperCase());
  const supportedMachineReasons = new Set([
    'UNSUPPORTED_MEDIA_TYPE',
    'UNSUPPORTED_MIME_TYPE',
    'UNSUPPORTED_FILE_TYPE',
    'FILE_TYPE_UNSUPPORTED',
    'MEDIA_TYPE_UNSUPPORTED'
  ]);
  return [...reasons].some(reason => supportedMachineReasons.has(reason));
}

function parseExpiration(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function metadataMatchesCurrentBase(attachment, context) {
  return !!attachment?.fileApiBaseUrl &&
    normalizedBaseUrl(attachment.fileApiBaseUrl) === normalizedBaseUrl(context.cleanBaseUrl);
}

function isFreshActiveRemote(attachment, context, now = Date.now()) {
  if (!attachment?.fileUri || !attachment?.fileApiName) return false;
  if (!metadataMatchesCurrentBase(attachment, context)) return false;
  if (String(attachment.fileApiState || '').toUpperCase() !== 'ACTIVE') return false;
  const expiration = parseExpiration(attachment.fileApiExpirationTime);
  return expiration != null && expiration > now + FILE_API_EXPIRATION_LEEWAY_MS;
}

function fileDataPart(attachment) {
  return {
    fileData: {
      mimeType: attachment.fileApiMimeType || attachment.type || attachment.mimeType || 'application/octet-stream',
      fileUri: attachment.fileUri
    }
  };
}

function blobToBase64(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error || new Error('Could not read attachment Blob.'));
    reader.onload = () => {
      const result = String(reader.result || '');
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.readAsDataURL(blob);
  });
}

async function inlineDataPart(attachment, signal) {
  if (signal?.aborted) {
    if (typeof DOMException !== 'undefined') throw new DOMException('Attachment preparation cancelled.', 'AbortError');
    const error = new Error('Attachment preparation cancelled.');
    error.name = 'AbortError';
    throw error;
  }
  const blob = attachment?.blob instanceof Blob ? attachment.blob : null;
  if (!blob) {
    throw new Error(`Attachment “${attachment?.name || 'Attachment'}” has no local Blob available for inline fallback.`);
  }
  const data = await blobToBase64(blob);
  return {
    inlineData: {
      mimeType: attachment.type || attachment.mimeType || blob.type || 'application/octet-stream',
      data
    }
  };
}

function remoteMetadataFromFile(file, context) {
  return {
    transferStrategy: 'auto',
    fileUri: file?.uri || null,
    fileApiName: file?.name || null,
    fileApiExpirationTime: file?.expirationTime || null,
    fileApiCreateTime: file?.createTime || null,
    fileApiState: file?.state || 'STATE_UNSPECIFIED',
    fileApiMimeType: file?.mimeType || null,
    fileApiBaseUrl: normalizedBaseUrl(context.cleanBaseUrl)
  };
}

function emptyRemoteMetadata() {
  return {
    transferStrategy: 'auto',
    fileUri: null,
    fileApiName: null,
    fileApiExpirationTime: null,
    fileApiCreateTime: null,
    fileApiState: null,
    fileApiMimeType: null,
    fileApiBaseUrl: null
  };
}

async function persistRemoteMetadataNonFatal(attachment, metadata) {
  if (!attachment?.id) return;
  try {
    await persistAttachmentRemoteMetadata(attachment.id, metadata);
  } catch (error) {
    console.warn('Gemini File metadata could not be persisted; current in-memory File reference remains usable.', error);
  }
}

async function applyRemoteMetadata(attachment, file, context) {
  const metadata = remoteMetadataFromFile(file, context);
  Object.assign(attachment, metadata);
  await persistRemoteMetadataNonFatal(attachment, metadata);
  return metadata;
}

export async function invalidateAttachmentRemoteMetadata(attachment, options = {}) {
  const metadata = emptyRemoteMetadata();
  Object.assign(attachment, metadata);
  if (options.persist !== false) await persistRemoteMetadataNonFatal(attachment, metadata);
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function isAuthenticationOrPermissionError(error) {
  return [401, 403].includes(Number(error?.httpStatus));
}

async function uploadAndActivateAttachment(attachment, context) {
  const blob = attachment?.blob instanceof Blob ? attachment.blob : null;
  if (!blob) {
    throw new Error(`The local copy of “${attachment?.name || 'Attachment'}” no longer exists, so its Gemini File cannot be uploaded again.`);
  }
  const mimeType = mimeTypeForAttachment(attachment);
  const uploaded = await uploadGeminiFile({
    file: blob,
    mimeType,
    displayName: attachment.name || 'Attachment',
    apiSettings: context.apiSettings,
    cleanBaseUrl: context.cleanBaseUrl,
    signal: context.signal
  });
  const active = await waitForGeminiFileActive({
    fileApiName: uploaded.name,
    initialFile: uploaded,
    apiSettings: context.apiSettings,
    cleanBaseUrl: context.cleanBaseUrl,
    signal: context.signal
  });
  await applyRemoteMetadata(attachment, active, context);
  return active;
}

async function refreshUncertainRemoteMetadata(attachment, context) {
  if (!attachment?.fileApiName || !metadataMatchesCurrentBase(attachment, context)) return null;
  const remote = await getGeminiFile({
    fileApiName: attachment.fileApiName,
    apiSettings: context.apiSettings,
    cleanBaseUrl: context.cleanBaseUrl,
    signal: context.signal
  });
  const active = remote.state === 'ACTIVE'
    ? remote
    : await waitForGeminiFileActive({
        fileApiName: remote.name,
        initialFile: remote,
        apiSettings: context.apiSettings,
        cleanBaseUrl: context.cleanBaseUrl,
        signal: context.signal
      });
  await applyRemoteMetadata(attachment, active, context);
  return active;
}

async function prepareAutoAttachment(attachment, context) {
  const mimeType = mimeTypeForAttachment(attachment);
  if (isUploadMimeUnsupported(context, mimeType) || isModelMimeUnsupported(context, mimeType)) {
    return inlineDataPart(attachment, context.signal);
  }

  if (isFreshActiveRemote(attachment, context)) return fileDataPart(attachment);

  const sameBase = metadataMatchesCurrentBase(attachment, context);
  const expiration = parseExpiration(attachment?.fileApiExpirationTime);
  const nearExpiry = expiration != null && expiration <= Date.now() + FILE_API_EXPIRATION_LEEWAY_MS;
  const hasRemoteIdentity = !!attachment?.fileApiName && !!attachment?.fileUri && sameBase;

  if (hasRemoteIdentity && !nearExpiry) {
    try {
      const refreshed = await refreshUncertainRemoteMetadata(attachment, context);
      if (refreshed?.state === 'ACTIVE' && isFreshActiveRemote(attachment, context)) return fileDataPart(attachment);
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (isRemoteFileLookupUnavailable(error)) {
        // This exact remote File is missing or inaccessible to the current
        // upstream identity. Clear it so the local Blob becomes authoritative.
        await invalidateAttachmentRemoteMetadata(attachment);
      } else {
        if (isAuthenticationOrPermissionError(error)) throw error;
        console.warn(`Could not validate Gemini File metadata for “${attachment?.name || 'Attachment'}”; using local recovery path.`, error);
      }
    }
  }

  if (!(attachment?.blob instanceof Blob)) {
    throw new Error(`The local copy of “${attachment?.name || 'Attachment'}” no longer exists, and there is no reusable Gemini File available.`);
  }

  try {
    await uploadAndActivateAttachment(attachment, context);
    return fileDataPart(attachment);
  } catch (error) {
    if (isAbortError(error)) throw error;
    // A 401/403 from upload itself is a real credential/permission problem.
    // Do not hide it behind inlineData or another retry.
    if (isAuthenticationOrPermissionError(error)) throw error;
    if (isMachineUnsupportedFileError(error)) markUploadMimeUnsupported(context, mimeType);
    console.warn(`Gemini Files API could not prepare “${attachment?.name || 'Attachment'}”; using inlineData for this request.`, error);
    return inlineDataPart(attachment, context.signal);
  }
}

export function createAttachmentPreparationContext({ apiSettings, cleanBaseUrl, modelId, signal }) {
  return {
    apiSettings,
    cleanBaseUrl: normalizedBaseUrl(cleanBaseUrl),
    modelId: String(modelId || ''),
    signal
  };
}

export async function prepareGeminiAttachmentPart(attachment, context) {
  if (!attachment) throw new Error('Cannot prepare a missing attachment.');
  if (attachment.transferStrategy === 'inline') return inlineDataPart(attachment, context.signal);
  return prepareAutoAttachment(attachment, context);
}

export async function prepareAttachmentsForHistory(entries, context, maxConcurrency = MAX_CONCURRENT_FILE_OPERATIONS) {
  const list = Array.isArray(entries) ? entries : [];
  const results = new Map();
  const concurrency = Math.max(1, Math.min(MAX_CONCURRENT_FILE_OPERATIONS, Number(maxConcurrency) || MAX_CONCURRENT_FILE_OPERATIONS));
  let cursor = 0;

  async function worker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      const entry = list[index];
      const part = await prepareGeminiAttachmentPart(entry.attachment, context);
      results.set(entry.key, part);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, list.length) }, () => worker()));
  return results;
}

export function collectUniqueMessageAttachments(messages = []) {
  const entries = [];
  const seen = new Set();
  (messages || []).forEach((message, messageIndex) => {
    if (message?.role !== 'user') return;
    (message.attachments || []).forEach((attachment, attachmentIndex) => {
      const key = attachment?.id
        ? `id:${attachment.id}`
        : `anon:${message?.id || messageIndex}:${attachmentIndex}`;
      if (seen.has(key)) return;
      seen.add(key);
      entries.push({ key, attachment, messageId: message?.id || '', attachmentIndex });
    });
  });
  return entries;
}

export function attachmentEntryKey(message, attachment, messageIndex, attachmentIndex) {
  return attachment?.id
    ? `id:${attachment.id}`
    : `anon:${message?.id || messageIndex}:${attachmentIndex}`;
}

async function mapEntriesWithConcurrency(entries, worker) {
  const list = Array.isArray(entries) ? entries : [];
  if (list.length === 0) return [];
  const results = new Array(list.length);
  let cursor = 0;

  async function runWorker() {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= list.length) return;
      results[index] = await worker(list[index], index);
    }
  }

  await Promise.all(Array.from(
    { length: Math.min(MAX_CONCURRENT_FILE_OPERATIONS, list.length) },
    () => runWorker()
  ));
  return results;
}

export async function recoverMissingRemoteAttachments(messages, context) {
  const entries = collectUniqueMessageAttachments(messages).filter(entry => {
    const attachment = entry.attachment;
    const savedBase = normalizedBaseUrl(attachment?.fileApiBaseUrl);
    const currentBase = normalizedBaseUrl(context.cleanBaseUrl);
    return (!!attachment?.fileUri || !!attachment?.fileApiName) &&
      (!savedBase || !currentBase || savedBase === currentBase);
  });
  if (entries.length === 0) return false;

  const results = await mapEntriesWithConcurrency(entries, async entry => {
    const attachment = entry.attachment;
    const name = remoteFileName(attachment?.fileApiName) || remoteFileName(attachment?.fileUri);

    if (!name) {
      if (!(attachment?.blob instanceof Blob)) {
        throw new Error(`The local copy of “${attachment?.name || 'Attachment'}” no longer exists, so its Gemini File cannot be uploaded again.`);
      }
      await invalidateAttachmentRemoteMetadata(attachment);
      await uploadAndActivateAttachment(attachment, context);
      return true;
    }

    try {
      const previousUri = attachment.fileUri;
      const remote = await getGeminiFile({
        fileApiName: name,
        apiSettings: context.apiSettings,
        cleanBaseUrl: context.cleanBaseUrl,
        signal: context.signal
      });
      await applyRemoteMetadata(attachment, remote, context);
      return !!remote?.uri && remote.uri !== previousUri;
    } catch (error) {
      if (isAbortError(error)) throw error;
      if (!isRemoteFileLookupUnavailable(error)) return false;
      if (!(attachment?.blob instanceof Blob)) {
        throw new Error(`The local copy of “${attachment?.name || 'Attachment'}” no longer exists, so its Gemini File cannot be uploaded again.`);
      }

      await invalidateAttachmentRemoteMetadata(attachment);
      await uploadAndActivateAttachment(attachment, context);
      return true;
    }
  });

  return results.some(Boolean);
}
