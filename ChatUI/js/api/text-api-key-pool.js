/*
 * text-api-key-pool.js — Persistent Gemini text-key rotation, health, validation, and retry policy.
 */

import { state, setState } from '../state/store.js';
import { persistSettings } from '../storage/storage.js';

export const TEXT_KEY_RETRY_DELAYS_MS = Object.freeze([2000, 4000, 8000]);
export const TEXT_KEY_MAX_FAILURE_HISTORY = 20;
export const TEXT_KEY_VALIDATION_CONCURRENCY = 4;
const PACIFIC_TIME_ZONE = 'America/Los_Angeles';
const HOUR_MS = 60 * 60 * 1000;

function nowMs() {
  return Date.now();
}

export function normalizeApiKey(value) {
  return String(value || '').replace(/\s+/g, '').trim();
}

export function parseApiKeyLines(value) {
  const seen = new Set();
  const keys = [];
  String(value || '').split(/\r?\n/).forEach(line => {
    const key = normalizeApiKey(line);
    if (!key || seen.has(key)) return;
    seen.add(key);
    keys.push(key);
  });
  return keys;
}

function normalizeFailureHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.slice(-TEXT_KEY_MAX_FAILURE_HISTORY).map(entry => ({
    at: Number(entry?.at) || 0,
    httpStatus: Number(entry?.httpStatus) || 0,
    apiStatus: String(entry?.apiStatus || ''),
    name: String(entry?.name || 'Error'),
    message: String(entry?.message || '').slice(0, 800),
    rateLimited: !!entry?.rateLimited
  }));
}

function buildPoolEntry(key, previous = null) {
  return {
    key,
    validationStatus: previous?.validationStatus || 'unknown',
    lastValidatedAt: Number(previous?.lastValidatedAt) || 0,
    lastSuccessAt: Number(previous?.lastSuccessAt) || 0,
    lastFailureAt: Number(previous?.lastFailureAt) || 0,
    consecutiveFailures: Math.max(0, Number(previous?.consecutiveFailures) || 0),
    cooldownUntil: Math.max(0, Number(previous?.cooldownUntil) || 0),
    lastError: previous?.lastError && typeof previous.lastError === 'object'
      ? {
          httpStatus: Number(previous.lastError.httpStatus) || 0,
          apiStatus: String(previous.lastError.apiStatus || ''),
          name: String(previous.lastError.name || 'Error'),
          message: String(previous.lastError.message || '').slice(0, 800)
        }
      : null,
    failureHistory: normalizeFailureHistory(previous?.failureHistory)
  };
}

export function normalizeStoredTextApiPool(api = state.api || {}) {
  const previousEntries = Array.isArray(api.textApiKeys) ? api.textApiKeys : [];
  const previousByKey = new Map();
  previousEntries.forEach(entry => {
    const key = normalizeApiKey(typeof entry === 'string' ? entry : entry?.key);
    if (key && !previousByKey.has(key)) previousByKey.set(key, typeof entry === 'string' ? null : entry);
  });

  const rawKeys = previousEntries.length > 0
    ? previousEntries.map(entry => typeof entry === 'string' ? entry : entry?.key)
    : [api.textApiKey];
  const keys = parseApiKeyLines(rawKeys.join('\n'));
  const entries = keys.map(key => buildPoolEntry(key, previousByKey.get(key)));
  const requestedIndex = Number(api.textApiKeyIndex);
  const index = Number.isInteger(requestedIndex) && requestedIndex >= 0 && requestedIndex < entries.length
    ? requestedIndex
    : 0;
  const activeKey = entries[index]?.key || '';

  return {
    ...api,
    textApiKey: activeKey,
    textApiKeys: entries,
    textApiKeyIndex: index
  };
}

export function ensureTextApiKeyPoolState() {
  const normalized = normalizeStoredTextApiPool(state.api || {});
  const current = state.api || {};
  const changed = current.textApiKey !== normalized.textApiKey ||
    current.textApiKeyIndex !== normalized.textApiKeyIndex ||
    !Array.isArray(current.textApiKeys) ||
    current.textApiKeys.length !== normalized.textApiKeys.length;
  if (changed) setState({ api: normalized });
  return changed ? normalized : current;
}

export function setTextApiKeyPoolFromText(value) {
  const api = ensureTextApiKeyPoolState();
  const nextKeys = parseApiKeyLines(value);
  const previousEntries = Array.isArray(api.textApiKeys) ? api.textApiKeys : [];
  const previousByKey = new Map(previousEntries.map(entry => [entry.key, entry]));
  const previousActiveKey = previousEntries[api.textApiKeyIndex]?.key || api.textApiKey || '';
  const textApiKeys = nextKeys.map(key => buildPoolEntry(key, previousByKey.get(key)));
  const retainedIndex = textApiKeys.findIndex(entry => entry.key === previousActiveKey);
  const textApiKeyIndex = retainedIndex >= 0 ? retainedIndex : 0;
  const textApiKey = textApiKeys[textApiKeyIndex]?.key || '';
  const nextApi = { ...api, textApiKeys, textApiKeyIndex, textApiKey };
  setState({ api: nextApi });
  return nextApi;
}

export function textApiKeyPoolText() {
  const api = ensureTextApiKeyPoolState();
  return (api.textApiKeys || []).map(entry => entry.key).join('\n');
}

export function maskApiKey(key) {
  const clean = normalizeApiKey(key);
  if (!clean) return 'Empty key';
  const suffix = clean.slice(-4);
  return `••••••${suffix}`;
}

function pacificParts(timestamp) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: PACIFIC_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23'
  }).formatToParts(new Date(timestamp));
  return Object.fromEntries(parts.filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
}

export function nextPacificQuotaReleaseAt(from = nowMs()) {
  const current = pacificParts(from);
  const currentDate = `${current.year}-${current.month}-${current.day}`;
  let candidate = Math.floor(from / HOUR_MS) * HOUR_MS + HOUR_MS;
  const limit = from + (36 * HOUR_MS);

  while (candidate <= limit) {
    const local = pacificParts(candidate);
    const localDate = `${local.year}-${local.month}-${local.day}`;
    if (localDate !== currentDate && Number(local.hour) === 1) return candidate;
    candidate += HOUR_MS;
  }

  // Defensive fallback; normal Intl implementations should always resolve above.
  return from + (25 * HOUR_MS);
}

export function isRateLimitError(error) {
  return Number(error?.httpStatus) === 429 ||
    String(error?.apiStatus || '').toUpperCase() === 'RESOURCE_EXHAUSTED';
}

function summarizeError(error) {
  return {
    httpStatus: Number(error?.httpStatus) || 0,
    apiStatus: String(error?.apiStatus || error?.code || ''),
    name: String(error?.name || 'Error'),
    message: String(error?.message || 'Unknown Gemini API error').slice(0, 800)
  };
}

function updatePoolEntry(key, updater) {
  const api = ensureTextApiKeyPoolState();
  const entries = (api.textApiKeys || []).map(entry => entry.key === key ? updater({ ...entry }) : entry);
  const activeIndex = entries.findIndex(entry => entry.key === api.textApiKey);
  const textApiKeyIndex = activeIndex >= 0 ? activeIndex : Math.min(api.textApiKeyIndex || 0, Math.max(0, entries.length - 1));
  const textApiKey = entries[textApiKeyIndex]?.key || '';
  const nextApi = { ...api, textApiKeys: entries, textApiKeyIndex, textApiKey };
  setState({ api: nextApi });
  return nextApi;
}

export async function recordTextApiKeyFailure(key, error, { persist = true } = {}) {
  const failedAt = nowMs();
  const rateLimited = isRateLimitError(error);
  const summary = summarizeError(error);
  updatePoolEntry(key, entry => {
    const history = [...normalizeFailureHistory(entry.failureHistory), {
      at: failedAt,
      ...summary,
      rateLimited
    }].slice(-TEXT_KEY_MAX_FAILURE_HISTORY);
    return {
      ...entry,
      lastFailureAt: failedAt,
      consecutiveFailures: (Number(entry.consecutiveFailures) || 0) + 1,
      cooldownUntil: rateLimited ? nextPacificQuotaReleaseAt(failedAt) : Number(entry.cooldownUntil) || 0,
      lastError: summary,
      validationStatus: rateLimited ? 'rate-limited' : entry.validationStatus,
      failureHistory: history
    };
  });
  if (persist) await persistSettings();
}

export async function recordTextApiKeySuccess(key, { persist = true } = {}) {
  const succeededAt = nowMs();
  updatePoolEntry(key, entry => ({
    ...entry,
    lastSuccessAt: succeededAt,
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastError: null,
    validationStatus: 'valid'
  }));
  if (persist) await persistSettings();
}

function entryUsable(entry, now = nowMs()) {
  if (!entry?.key) return false;
  if (entry.validationStatus === 'invalid') return false;
  return !(Number(entry.cooldownUntil) > now);
}

export function getTextApiKeyPoolSummary(now = nowMs()) {
  const api = ensureTextApiKeyPoolState();
  const entries = api.textApiKeys || [];
  let available = 0;
  let cooling = 0;
  let invalid = 0;
  let checking = 0;
  entries.forEach(entry => {
    if (Number(entry.cooldownUntil) > now) cooling += 1;
    else if (entry.validationStatus === 'invalid') invalid += 1;
    else {
      available += 1;
      if (entry.validationStatus === 'checking') checking += 1;
    }
  });
  return { total: entries.length, available, cooling, invalid, checking };
}

function setActiveIndex(index) {
  const api = ensureTextApiKeyPoolState();
  const entries = api.textApiKeys || [];
  const normalizedIndex = entries.length > 0 ? ((index % entries.length) + entries.length) % entries.length : 0;
  const textApiKey = entries[normalizedIndex]?.key || '';
  setState({ api: { ...api, textApiKeyIndex: normalizedIndex, textApiKey } });
  return entries[normalizedIndex] || null;
}

function nextUsableEntry(afterIndex = -1, visited = new Set()) {
  const api = ensureTextApiKeyPoolState();
  const entries = api.textApiKeys || [];
  if (entries.length === 0) return null;
  const now = nowMs();
  for (let step = 1; step <= entries.length; step += 1) {
    const index = (afterIndex + step + entries.length) % entries.length;
    const entry = entries[index];
    if (visited.has(entry.key) || !entryUsable(entry, now)) continue;
    return { entry, index };
  }
  return null;
}

function firstUsableEntry(visited = new Set()) {
  const api = ensureTextApiKeyPoolState();
  const entries = api.textApiKeys || [];
  if (entries.length === 0) return null;
  const now = nowMs();
  const start = Number.isInteger(api.textApiKeyIndex) ? api.textApiKeyIndex : 0;
  for (let step = 0; step < entries.length; step += 1) {
    const index = (start + step) % entries.length;
    const entry = entries[index];
    if (visited.has(entry.key) || !entryUsable(entry, now)) continue;
    return { entry, index };
  }
  return null;
}

function abortError() {
  if (typeof DOMException !== 'undefined') return new DOMException('Operation aborted.', 'AbortError');
  const error = new Error('Operation aborted.');
  error.name = 'AbortError';
  return error;
}

function waitWithAbort(delayMs, signal) {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, delayMs);
    if (!signal) return;
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(abortError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export async function runWithTextApiKeyFailover(operation, options = {}) {
  const api = ensureTextApiKeyPoolState();
  if (!(api.textApiKeys || []).length) {
    throw new Error('Gemini API key is missing. Please enter one or more API keys in Settings > Gemini.');
  }

  const visited = new Set();
  let current = firstUsableEntry(visited);
  let lastError = null;

  while (current) {
    const { entry, index } = current;
    const key = entry.key;
    visited.add(key);
    setActiveIndex(index);

    for (let attempt = 0; attempt <= TEXT_KEY_RETRY_DELAYS_MS.length; attempt += 1) {
      if (options.signal?.aborted) throw abortError();
      try {
        const result = await operation({ key, index, attempt: attempt + 1 });
        await recordTextApiKeySuccess(key);
        return result;
      } catch (error) {
        if (error?.name === 'AbortError') throw error;
        lastError = error;
        await recordTextApiKeyFailure(key, error);

        const safeToReplay = typeof options.canReplay === 'function' ? options.canReplay(error) : true;
        if (!safeToReplay) {
          // Preserve the failed key's pointer for now; the next user request will
          // begin at the following usable key without replaying visible/tool work.
          const next = nextUsableEntry(index, new Set());
          if (next) {
            setActiveIndex(next.index);
            await persistSettings();
          }
          throw error;
        }

        if (isRateLimitError(error)) break;
        if (attempt >= TEXT_KEY_RETRY_DELAYS_MS.length) break;
        await waitWithAbort(TEXT_KEY_RETRY_DELAYS_MS[attempt], options.signal);
      }
    }

    const next = nextUsableEntry(index, visited);
    if (next) {
      setActiveIndex(next.index);
      await persistSettings();
    }
    current = next;
  }

  const summary = getTextApiKeyPoolSummary();
  if (summary.available === 0 && summary.cooling > 0) {
    const exhausted = new Error('All configured Gemini text API keys are cooling down after rate-limit failures.');
    exhausted.name = 'GeminiApiKeyPoolCooldownError';
    exhausted.code = 'ALL_TEXT_API_KEYS_COOLING_DOWN';
    exhausted.cause = lastError;
    throw exhausted;
  }
  throw lastError || new Error('No usable Gemini text API key is available.');
}

function validationErrorFromResponse(response, bodyText = '') {
  let parsed = null;
  try { parsed = bodyText ? JSON.parse(bodyText) : null; } catch (_) {}
  const bodyError = parsed?.error && typeof parsed.error === 'object' ? parsed.error : {};
  const error = new Error(bodyError.message || bodyText || response.statusText || `HTTP ${response.status}`);
  error.name = 'GeminiApiKeyValidationError';
  error.httpStatus = response.status;
  error.apiStatus = bodyError.status || '';
  return error;
}

async function validateOneKey(entry, cleanBaseUrl, signal) {
  const checkedAt = nowMs();
  try {
    const response = await fetch(`${cleanBaseUrl}/v1beta/models`, {
      method: 'GET',
      headers: { 'x-goog-api-key': entry.key },
      signal
    });
    if (!response.ok) {
      let bodyText = '';
      try { bodyText = await response.text(); } catch (_) {}
      throw validationErrorFromResponse(response, bodyText);
    }
    return { key: entry.key, ok: true, checkedAt };
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return { key: entry.key, ok: false, checkedAt, error };
  }
}

export async function validateTextApiKeyPool({ cleanBaseUrl, signal, onProgress } = {}) {
  const api = ensureTextApiKeyPoolState();
  const entries = api.textApiKeys || [];
  if (!entries.length) return getTextApiKeyPoolSummary();

  const queue = [...entries];
  let completed = 0;
  const results = [];
  const worker = async () => {
    while (queue.length > 0) {
      if (signal?.aborted) throw abortError();
      const entry = queue.shift();
      const result = await validateOneKey(entry, cleanBaseUrl, signal);
      results.push(result);
      completed += 1;
      onProgress?.({ completed, total: entries.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(TEXT_KEY_VALIDATION_CONCURRENCY, entries.length) }, () => worker()));

  let nextApi = ensureTextApiKeyPoolState();
  const resultByKey = new Map(results.map(result => [result.key, result]));
  const now = nowMs();
  const updatedEntries = (nextApi.textApiKeys || []).map(entry => {
    const result = resultByKey.get(entry.key);
    if (!result) return entry;
    if (result.ok) {
      return {
        ...entry,
        validationStatus: 'valid',
        lastValidatedAt: result.checkedAt,
        cooldownUntil: Number(entry.cooldownUntil) > now ? entry.cooldownUntil : 0,
        lastError: Number(entry.cooldownUntil) > now ? entry.lastError : null
      };
    }

    const error = result.error;
    const rateLimited = isRateLimitError(error);
    const invalid = [400, 401, 403].includes(Number(error?.httpStatus));
    const summary = summarizeError(error);
    const history = [...normalizeFailureHistory(entry.failureHistory), {
      at: result.checkedAt,
      ...summary,
      rateLimited
    }].slice(-TEXT_KEY_MAX_FAILURE_HISTORY);
    return {
      ...entry,
      validationStatus: rateLimited ? 'rate-limited' : invalid ? 'invalid' : 'error',
      lastValidatedAt: result.checkedAt,
      lastFailureAt: result.checkedAt,
      cooldownUntil: rateLimited ? nextPacificQuotaReleaseAt(result.checkedAt) : Number(entry.cooldownUntil) || 0,
      lastError: summary,
      failureHistory: history
    };
  });

  const currentIndex = Number(nextApi.textApiKeyIndex) || 0;
  let selectedIndex = currentIndex;
  if (!entryUsable(updatedEntries[selectedIndex], now)) {
    const found = updatedEntries.findIndex(entry => entryUsable(entry, now));
    selectedIndex = found >= 0 ? found : Math.min(currentIndex, Math.max(0, updatedEntries.length - 1));
  }
  nextApi = {
    ...nextApi,
    textApiKeys: updatedEntries,
    textApiKeyIndex: selectedIndex,
    textApiKey: updatedEntries[selectedIndex]?.key || ''
  };
  setState({ api: nextApi });
  await persistSettings();
  return getTextApiKeyPoolSummary();
}
