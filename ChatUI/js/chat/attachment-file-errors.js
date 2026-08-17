/**
 * attachment-file-errors.js — Classifiers for stale/inaccessible Gemini File references.
 *
 * Generic authentication/permission failures remain fatal. A 403 is recoverable
 * only when Google/proxy text clearly describes an inaccessible File resource.
 */

export function remoteFileName(value = '') {
  const text = String(value || '').trim();
  const match = text.match(/(?:^|\/)files\/([A-Za-z0-9-]+)(?:$|[/?#])/i);
  return match?.[1] ? `files/${match[1]}` : '';
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

export function isFileSpecificPermissionDeniedError(error) {
  if (!isPermissionDenied403(error)) return false;
  return isExplicitFileAccessPermissionText(errorText(error));
}
