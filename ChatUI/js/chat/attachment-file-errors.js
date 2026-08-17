/**
 * attachment-file-errors.js — Narrow classifiers for stale/inaccessible Gemini File references.
 *
 * Keep generic authentication/permission failures fatal. Only a 403 that names
 * one of the exact remote File resources present in the request is considered a
 * recoverable generation-time File reference failure.
 */

function normalizedBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function remoteFileId(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/(?:^|\/)files\/([A-Za-z0-9-]+)(?:$|[/?#])/i);
  return match?.[1] || '';
}

function errorText(error) {
  const pieces = [error?.message, error?.responseText];
  if (Array.isArray(error?.details) && error.details.length > 0) {
    try { pieces.push(JSON.stringify(error.details)); } catch (_) {}
  }
  return pieces.filter(Boolean).join('\n');
}

function isPermissionDenied403(error) {
  if (Number(error?.httpStatus) !== 403) return false;
  const apiStatus = String(error?.apiStatus || '').toUpperCase();
  if (apiStatus && apiStatus !== 'PERMISSION_DENIED') return false;
  return true;
}

export function isRemoteFileLookupUnavailable(error) {
  const status = Number(error?.httpStatus);
  if (status === 404) return true;
  return isPermissionDenied403(error);
}

export function isFileSpecificPermissionDeniedError(error, messages = [], cleanBaseUrl = '') {
  if (!isPermissionDenied403(error)) return false;

  const currentBase = normalizedBaseUrl(cleanBaseUrl);
  const requestFileIds = new Set();
  for (const message of messages || []) {
    if (message?.role !== 'user') continue;
    for (const attachment of message.attachments || []) {
      if (!attachment?.fileUri || !attachment?.fileApiName) continue;
      if (currentBase && normalizedBaseUrl(attachment.fileApiBaseUrl) !== currentBase) continue;
      const id = remoteFileId(attachment.fileApiName) || remoteFileId(attachment.fileUri);
      if (id) requestFileIds.add(id);
    }
  }
  if (requestFileIds.size === 0) return false;

  const text = errorText(error);
  if (!text) return false;

  const referencedIds = new Set();
  for (const match of text.matchAll(/\bFile\s+(?:files\/)?([A-Za-z0-9-]+)\b/gi)) {
    referencedIds.add(match[1]);
  }
  for (const match of text.matchAll(/\bfiles\/([A-Za-z0-9-]+)\b/gi)) {
    referencedIds.add(match[1]);
  }

  return [...referencedIds].some(id => requestFileIds.has(id));
}
