/**
 * gemini-files.js — Gemini Files API resumable upload and File metadata helpers.
 *
 * This module owns remote File networking only. Local attachment policy and
 * IndexedDB ownership live elsewhere.
 */

const FILE_POLL_INTERVAL_MS = 1500;
const FILE_PROCESSING_TIMEOUT_MS = 60_000;

export class GeminiFilesApiError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = 'GeminiFilesApiError';
    this.httpStatus = Number.isFinite(Number(options.httpStatus)) ? Number(options.httpStatus) : null;
    this.apiStatus = options.apiStatus ? String(options.apiStatus) : '';
    this.apiCode = options.apiCode ?? null;
    this.details = Array.isArray(options.details) ? options.details : [];
    this.operation = options.operation ? String(options.operation) : '';
    this.responseText = options.responseText ? String(options.responseText) : '';
    if (options.cause) this.cause = options.cause;
  }
}

function abortError(message = 'Gemini File operation was cancelled.') {
  if (typeof DOMException !== 'undefined') return new DOMException(message, 'AbortError');
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function throwIfAborted(signal) {
  if (signal?.aborted) throw abortError();
}

function cleanBaseUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function parseJsonSafely(text) {
  if (!text) return null;
  try { return JSON.parse(text); }
  catch (_) { return null; }
}

async function buildHttpError(response, operation) {
  let text = '';
  try { text = await response.text(); } catch (_) {}
  const parsed = parseJsonSafely(text);
  const bodyError = parsed?.error && typeof parsed.error === 'object' ? parsed.error : {};
  const message = bodyError.message || text || response.statusText || `${operation} failed.`;
  return new GeminiFilesApiError(`${operation} failed (${response.status}): ${message}`, {
    httpStatus: response.status,
    apiStatus: bodyError.status || bodyError.code || '',
    apiCode: bodyError.code ?? null,
    details: bodyError.details,
    operation,
    responseText: text
  });
}

async function readJsonResponse(response, operation) {
  const text = await response.text();
  if (!text) return null;
  const parsed = parseJsonSafely(text);
  if (!parsed) {
    throw new GeminiFilesApiError(`${operation} returned invalid JSON.`, {
      httpStatus: response.status,
      operation,
      responseText: text
    });
  }
  return parsed;
}

function normalizeState(value) {
  const normalized = String(value || 'STATE_UNSPECIFIED').toUpperCase();
  if (['STATE_UNSPECIFIED', 'PROCESSING', 'ACTIVE', 'FAILED'].includes(normalized)) return normalized;
  return 'STATE_UNSPECIFIED';
}

export function normalizeGeminiFileResource(raw) {
  const source = raw?.file && typeof raw.file === 'object' ? raw.file : raw;
  if (!source || typeof source !== 'object') return null;
  return {
    name: source.name ? String(source.name) : '',
    uri: source.uri ? String(source.uri) : '',
    mimeType: String(source.mimeType || source.mime_type || ''),
    sizeBytes: source.sizeBytes ?? source.size_bytes ?? null,
    createTime: String(source.createTime || source.create_time || ''),
    updateTime: String(source.updateTime || source.update_time || ''),
    expirationTime: String(source.expirationTime || source.expiration_time || ''),
    state: normalizeState(source.state),
    error: source.error || null
  };
}

function apiHeaders(apiSettings = {}, extra = {}) {
  return {
    ...(apiSettings.textApiKey ? { 'x-goog-api-key': apiSettings.textApiKey } : {}),
    ...extra
  };
}

function resolveUploadSessionUrl(uploadUrl, baseUrl) {
  try { return new URL(uploadUrl, `${cleanBaseUrl(baseUrl)}/`).toString(); }
  catch (_) { return String(uploadUrl || ''); }
}

function shouldAttachConfiguredCredential(uploadUrl, baseUrl) {
  try {
    const target = new URL(uploadUrl, `${cleanBaseUrl(baseUrl)}/`);
    const configured = new URL(`${cleanBaseUrl(baseUrl)}/`);
    return target.origin === configured.origin;
  } catch (_) {
    return false;
  }
}

async function startResumableUploadSession({ file, mimeType, displayName, apiSettings, baseUrl, signal }) {
  throwIfAborted(signal);
  const url = `${cleanBaseUrl(baseUrl)}/upload/v1beta/files`;
  const response = await fetch(url, {
    method: 'POST',
    headers: apiHeaders(apiSettings, {
      'Content-Type': 'application/json',
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(file.size),
      'X-Goog-Upload-Header-Content-Type': mimeType
    }),
    body: JSON.stringify({ file: { display_name: displayName || file.name || 'Attachment' } }),
    signal
  });
  if (!response.ok) throw await buildHttpError(response, 'Gemini File upload start');

  const uploadUrlHeader = response.headers.get('x-goog-upload-url');
  if (!uploadUrlHeader) {
    throw new GeminiFilesApiError('Gemini File upload start did not return x-goog-upload-url.', {
      httpStatus: response.status,
      operation: 'Gemini File upload start'
    });
  }
  return resolveUploadSessionUrl(uploadUrlHeader, baseUrl);
}

async function uploadResumableBytes({ uploadUrl, file, apiSettings, baseUrl, signal, onProgress }) {
  throwIfAborted(signal);
  onProgress?.({ loaded: 0, total: file.size });
  const headers = {
    'X-Goog-Upload-Offset': '0',
    'X-Goog-Upload-Command': 'upload, finalize'
  };
  if (shouldAttachConfiguredCredential(uploadUrl, baseUrl) && apiSettings?.textApiKey) {
    headers['x-goog-api-key'] = apiSettings.textApiKey;
  }

  // Do not set HTTP Content-Length here. Browser Fetch owns that forbidden
  // request header and calculates it from the Blob body.
  const response = await fetch(uploadUrl, {
    method: 'POST',
    headers,
    body: file,
    signal
  });
  if (!response.ok) throw await buildHttpError(response, 'Gemini File byte upload');
  const parsed = await readJsonResponse(response, 'Gemini File byte upload');
  onProgress?.({ loaded: file.size, total: file.size });
  return normalizeGeminiFileResource(parsed);
}

export async function uploadGeminiFile({
  file,
  mimeType,
  displayName,
  apiSettings,
  cleanBaseUrl: baseUrl,
  signal,
  onProgress
}) {
  if (!(file instanceof Blob)) {
    throw new TypeError('Gemini File upload requires a Blob or File.');
  }
  const resolvedBaseUrl = cleanBaseUrl(baseUrl);
  if (!resolvedBaseUrl) throw new Error('Gemini File upload base URL is missing.');
  const resolvedMime = String(mimeType || file.type || 'application/octet-stream');
  const uploadUrl = await startResumableUploadSession({
    file,
    mimeType: resolvedMime,
    displayName,
    apiSettings,
    baseUrl: resolvedBaseUrl,
    signal
  });
  const resource = await uploadResumableBytes({
    uploadUrl,
    file,
    apiSettings,
    baseUrl: resolvedBaseUrl,
    signal,
    onProgress
  });
  if (!resource?.name || !resource?.uri) {
    throw new GeminiFilesApiError('Gemini File upload completed without a usable File resource.', {
      operation: 'Gemini File byte upload'
    });
  }
  return resource;
}

export async function getGeminiFile({ fileApiName, apiSettings, cleanBaseUrl: baseUrl, signal }) {
  throwIfAborted(signal);
  const name = String(fileApiName || '').replace(/^\/+/, '');
  if (!/^files\/[A-Za-z0-9-]+$/.test(name)) {
    throw new TypeError('Gemini File name must use the files/<id> resource form.');
  }
  const response = await fetch(`${cleanBaseUrl(baseUrl)}/v1beta/${name}`, {
    method: 'GET',
    headers: apiHeaders(apiSettings),
    signal
  });
  if (!response.ok) throw await buildHttpError(response, 'Gemini files.get');
  const parsed = await readJsonResponse(response, 'Gemini files.get');
  const resource = normalizeGeminiFileResource(parsed);
  if (!resource?.name) {
    throw new GeminiFilesApiError('Gemini files.get returned an invalid File resource.', {
      httpStatus: response.status,
      operation: 'Gemini files.get'
    });
  }
  return resource;
}

function wait(ms, signal) {
  return new Promise((resolve, reject) => {
    throwIfAborted(signal);
    const timer = setTimeout(() => {
      signal?.removeEventListener?.('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(abortError());
    };
    signal?.addEventListener?.('abort', onAbort, { once: true });
  });
}

export async function waitForGeminiFileActive({
  fileApiName,
  initialFile,
  apiSettings,
  cleanBaseUrl: baseUrl,
  signal,
  timeoutMs = FILE_PROCESSING_TIMEOUT_MS,
  pollIntervalMs = FILE_POLL_INTERVAL_MS
}) {
  let current = normalizeGeminiFileResource(initialFile);
  const startedAt = Date.now();

  while (true) {
    throwIfAborted(signal);
    if (current?.state === 'ACTIVE') return current;
    if (current?.state === 'FAILED') {
      throw new GeminiFilesApiError('Gemini File processing failed.', {
        operation: 'Gemini File processing',
        details: current.error ? [current.error] : []
      });
    }
    if (Date.now() - startedAt >= timeoutMs) {
      throw new GeminiFilesApiError(`Gemini File processing did not become ACTIVE within ${Math.round(timeoutMs / 1000)} seconds.`, {
        operation: 'Gemini File processing'
      });
    }

    const name = current?.name || fileApiName;
    if (!name) {
      throw new GeminiFilesApiError('Gemini File processing cannot be checked because the File name is missing.', {
        operation: 'Gemini File processing'
      });
    }
    await wait(Math.max(250, pollIntervalMs), signal);
    current = await getGeminiFile({ fileApiName: name, apiSettings, cleanBaseUrl: baseUrl, signal });
  }
}
