/**
 * file-reference-recovery.js — Robust pre-stream recovery for Gemini File access failures.
 *
 * Once generation proves that a remote Gemini File is inaccessible, rebuild one
 * coherent fresh set of File resources from the permanent local Blobs. This is
 * safer with a multi-account proxy than mixing old account-owned File URIs with
 * newly uploaded ones. If the stale URI lives only in preserved assistant
 * modelResponseParts, the retry is still allowed so the wrapper can sanitize it.
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
import { hasPreservedRemoteFileData } from './file-history-sanitizer.js';

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

async function validateRemoteWithoutLocalBlob(entry, context) {
  const attachment = entry.attachment;
  const name = remoteFileName(attachment?.fileApiName) || remoteFileName(attachment?.fileUri);
  if (!name) throw localBlobMissingError(attachment);

  try {
    const remote = await getGeminiFile({
      fileApiName: name,
      apiSettings: context.apiSettings,
      cleanBaseUrl: context.cleanBaseUrl,
      signal: context.signal
    });
    await applyRemoteMetadata(attachment, remote, context.cleanBaseUrl);
    return true;
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (isRemoteFileLookupUnavailable(error)) throw localBlobMissingError(attachment);
    throw error;
  }
}

async function refreshCoherentLocalFileSet(entries, context) {
  const localEntries = entries.filter(entry => hasLocalBlob(entry.attachment));
  const remoteOnlyEntries = entries.filter(entry => !hasLocalBlob(entry.attachment));

  // A remote-only attachment can remain only if the current proxy identity can
  // still read it. If it cannot, tell the user the true problem: no local copy.
  await mapWithConcurrency(
    remoteOnlyEntries,
    FILE_RECOVERY_CONCURRENCY,
    entry => validateRemoteWithoutLocalBlob(entry, context)
  );

  if (localEntries.length === 0) {
    throw localBlobMissingError(entries[0]?.attachment);
  }

  // Re-upload every local-backed File together. This deliberately replaces even
  // remote Files that files.get might still consider valid: with rotating proxy
  // accounts, a mixed old/new set can otherwise fail again on the next request.
  await mapWithConcurrency(localEntries, FILE_RECOVERY_CONCURRENCY, async entry => {
    await replaceRemoteFile(entry.attachment, context);
    return true;
  });

  return true;
}

export async function recoverGenerationFilePermissionFailure({
  error,
  messages,
  signal
}) {
  if (isAbortError(error)) return false;
  if (!isFileSpecificPermissionDeniedError(error)) return false;

  const preservedHistoryHasRemoteFile = hasPreservedRemoteFileData(messages);
  const entries = collectUniqueMessageAttachments(messages).filter(entry =>
    !!entry.attachment?.fileUri || !!entry.attachment?.fileApiName
  );

  // This is the Regenerate failure mode that the earlier implementation missed:
  // a dead File URI can live only inside saved assistant modelResponseParts. The
  // wrapper will remove that remote pointer from its retry-only message view.
  if (entries.length === 0) return preservedHistoryHasRemoteFile;

  const apiSettings = getApiSettings();
  const cleanBaseUrl = getCleanBaseUrl(apiSettings.textBaseUrl);
  const context = {
    apiSettings,
    cleanBaseUrl: normalizedBaseUrl(cleanBaseUrl),
    signal
  };

  await refreshCoherentLocalFileSet(entries, context);
  return true;
}
