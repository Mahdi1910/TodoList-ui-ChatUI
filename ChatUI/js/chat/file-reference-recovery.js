/**
 * file-reference-recovery.js — Robust pre-stream recovery for Gemini File access failures.
 *
 * When generation clearly fails because a remote Gemini File is inaccessible,
 * validate every remote attachment in the request, re-upload inaccessible ones
 * from the permanent local Blob, and persist the replacement File metadata.
 */

import { getApiSettings, getCleanBaseUrl } from '../api/api-config.js';
import {
  getGeminiFile,
  uploadGeminiFile,
  waitForGeminiFileActive
} from '../api/gemini-files.js';
import { persistAttachmentRemoteMetadata } from '../storage/storage.js';
import { collectUniqueMessageAttachments } from './attachment-transport.js';
import {
  isFileSpecificPermissionDeniedError,
  isRemoteFileLookupUnavailable,
  remoteFileName
} from './attachment-file-errors.js';

export const FILE_RECOVERY_CONCURRENCY = 7;

function normalizedBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function isAbortError(error) {
  return error?.name === 'AbortError';
}

function hasLocalBlob(attachment) {
  return typeof Blob !== 'undefined' && attachment?.blob instanceof Blob;
}

function localBlobMissingError(attachment) {
  const error = new Error(
    `The local copy of “${attachment?.name || 'Attachment'}” no longer exists, so its Gemini File cannot be uploaded again.`
  );
  error.name = 'AttachmentLocalBlobMissingError';
  error.code = 'LOCAL_ATTACHMENT_MISSING';
  return error;
}

function remoteMetadataFromFile(file, cleanBaseUrl) {
  return {
    transferStrategy: 'auto',
    fileUri: file?.uri || null,
    fileApiName: file?.name || null,
    fileApiExpirationTime: file?.expirationTime || null,
    fileApiCreateTime: file?.createTime || null,
    fileApiState: file?.state || 'STATE_UNSPECIFIED',
    fileApiMimeType: file?.mimeType || null,
    fileApiBaseUrl: normalizedBaseUrl(cleanBaseUrl)
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

async function persistMetadataNonFatal(attachment, metadata) {
  if (!attachment?.id) return;
  try {
    await persistAttachmentRemoteMetadata(attachment.id, metadata);
  } catch (error) {
    console.warn('Recovered Gemini File metadata could not be persisted.', error);
  }
}

async function applyRemoteMetadata(attachment, file, cleanBaseUrl) {
  const metadata = remoteMetadataFromFile(file, cleanBaseUrl);
  Object.assign(attachment, metadata);
  await persistMetadataNonFatal(attachment, metadata);
}

async function invalidateRemoteMetadata(attachment) {
  const metadata = emptyRemoteMetadata();
  Object.assign(attachment, metadata);
  await persistMetadataNonFatal(attachment, metadata);
}

function attachmentMimeType(attachment) {
  return String(
    attachment?.fileApiMimeType ||
    attachment?.type ||
    attachment?.mimeType ||
    attachment?.blob?.type ||
    'application/octet-stream'
  );
}

async function uploadLocalBlob(attachment, context) {
  if (!hasLocalBlob(attachment)) throw localBlobMissingError(attachment);

  const uploaded = await uploadGeminiFile({
    file: attachment.blob,
    mimeType: attachmentMimeType(attachment),
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
  await applyRemoteMetadata(attachment, active, context.cleanBaseUrl);
  return active;
}

async function replaceRemoteFile(attachment, context) {
  if (!hasLocalBlob(attachment)) throw localBlobMissingError(attachment);
  await invalidateRemoteMetadata(attachment);
  await uploadLocalBlob(attachment, context);
  return true;
}

async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
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

  const count = Math.min(Math.max(1, Number(limit) || 1), list.length);
  await Promise.all(Array.from({ length: count }, () => runWorker()));
  return results;
}

async function validateOrRepairEntry(entry, context) {
  const attachment = entry.attachment;
  const name = remoteFileName(attachment?.fileApiName) || remoteFileName(attachment?.fileUri);

  // Some older records can retain a URI without a parseable File name. A clear
  // generation-time File permission error is enough to rebuild it from Blob.
  if (!name) {
    if (!hasLocalBlob(attachment)) throw localBlobMissingError(attachment);
    await replaceRemoteFile(attachment, context);
    return { repaired: true, validated: false };
  }

  try {
    const previousUri = attachment.fileUri || '';
    const remote = await getGeminiFile({
      fileApiName: name,
      apiSettings: context.apiSettings,
      cleanBaseUrl: context.cleanBaseUrl,
      signal: context.signal
    });
    await applyRemoteMetadata(attachment, remote, context.cleanBaseUrl);
    return {
      repaired: !!remote?.uri && remote.uri !== previousUri,
      validated: true
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (!isRemoteFileLookupUnavailable(error)) throw error;
    await replaceRemoteFile(attachment, context);
    return { repaired: true, validated: false };
  }
}

async function forceRefreshAllLocalFiles(entries, context) {
  const localEntries = entries.filter(entry => hasLocalBlob(entry.attachment));
  if (localEntries.length === 0) {
    const first = entries[0]?.attachment;
    throw localBlobMissingError(first);
  }

  await mapWithConcurrency(localEntries, FILE_RECOVERY_CONCURRENCY, async entry => {
    await replaceRemoteFile(entry.attachment, context);
    return true;
  });
  return localEntries.length > 0;
}

export async function recoverGenerationFilePermissionFailure({
  error,
  messages,
  signal
}) {
  if (isAbortError(error)) return false;

  const apiSettings = getApiSettings();
  const cleanBaseUrl = getCleanBaseUrl(apiSettings.textBaseUrl);
  if (!isFileSpecificPermissionDeniedError(error, messages, cleanBaseUrl)) return false;

  const entries = collectUniqueMessageAttachments(messages).filter(entry =>
    !!entry.attachment?.fileUri || !!entry.attachment?.fileApiName
  );
  if (entries.length === 0) return false;

  const context = {
    apiSettings,
    cleanBaseUrl: normalizedBaseUrl(cleanBaseUrl),
    signal
  };

  const results = await mapWithConcurrency(
    entries,
    FILE_RECOVERY_CONCURRENCY,
    entry => validateOrRepairEntry(entry, context)
  );

  if (results.some(result => result?.repaired)) return true;

  // A generation request proved that at least one File reference is unusable,
  // but every files.get check succeeded. This can happen if the proxy changes
  // Google account/context between requests. Refresh all local-backed remote
  // Files together so the next generation has one coherent new set of URIs.
  return forceRefreshAllLocalFiles(entries, context);
}
