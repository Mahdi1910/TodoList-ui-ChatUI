/**
 * attachment-file-errors.js — Classifiers for stale/inaccessible Gemini File references.
 *
 * Generic authentication/permission failures remain fatal. A 403 is recoverable
 * only when Google/proxy text clearly describes an inaccessible File resource and
 * the request contains at least one remote Gemini File reference.
 */

function normalizedBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

export function remoteFileName(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/(?:^|\/)files\/([A-Za-z0-9-]+)(?:$|[/?#])/i);
  return match?.[1] ? `files/${match[1]}` : '';
}

function remoteFileId(value = '') {
  return remoteFileName(value).replace(/^files\//i, '');
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

function hasRemoteFileReference(messages = [], cleanBaseUrl = '') {
  const currentBase = normalizedBaseUrl(cleanBaseUrl);
  return (messages || []).some(message => {
    if (message?.role !== 'user') return false;
    return (message.attachments || []).some(attachment => {
      if (!attachment?.fileUri && !attachment?.fileApiName) return false;
      const savedBase = normalizedBaseUrl(attachment?.fileApiBaseUrl);
      // Legacy records may not have fileApiBaseUrl. They are still recoverable
      // because the local Blob is the permanent source of truth.
      return !currentBase || !savedBase || savedBase === currentBase;
    });
  });
}

function isExplicitFileAccessPermissionText(text = '') {
  const value = String(text || '');
  return /permission\s+to\s+access\s+the\s+File\b/i.test(value) ||
    /File\s+(?:files\/)?[A-Za-z0-9-]+\s+or\s+it\s+may\s+not\s+exist/i.test(value);
}

export function isRemoteFileLookupUnavailable(error) {
  const status = Number(error?.httpStatus);
  if (status === 404) return true;
  return isPermissionDenied403(error);
}

export function isFileSpecificPermissionDeniedError(error, messages = [], cleanBaseUrl = '') {
  if (!isPermissionDenied403(error)) return false;
  if (!hasRemoteFileReference(messages, cleanBaseUrl)) return false;

  const text = errorText(error);
  if (!isExplicitFileAccessPermissionText(text)) return false;

  // Prefer an exact ID match when the proxy exposes the File ID. Do not require
  // it, though: older attachment records can have incomplete remote metadata,
  // while Google's error still unambiguously says that a File resource failed.
  const requestFileIds = new Set();
  for (const message of messages || []) {
    if (message?.role !== 'user') continue;
    for (const attachment of message.attachments || []) {
      const id = remoteFileId(attachment?.fileApiName) || remoteFileId(attachment?.fileUri);
      if (id) requestFileIds.add(id);
    }
  }

  const referencedIds = new Set();
  for (const match of text.matchAll(/\bFile\s+(?:files\/)?([A-Za-z0-9-]+)\b/gi)) {
    referencedIds.add(match[1]);
  }
  for (const match of text.matchAll(/\bfiles\/([A-Za-z0-9-]+)\b/gi)) {
    referencedIds.add(match[1]);
  }

  if ([...referencedIds].some(id => requestFileIds.has(id))) return true;
  return true;
}
