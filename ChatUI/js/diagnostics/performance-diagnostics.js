/**
 * TEMPORARY PERFORMANCE DIAGNOSTICS — remove after profiling is complete.
 *
 * Central measurement/persistence/reporting boundary for Implementation Plan ID 12.
 * Never store prompt text, assistant text, API keys, Base64 payloads, file names,
 * file contents, Workspace contents, or raw tool arguments/results here.
 */

export const PERFORMANCE_DIAGNOSTICS_STORAGE_KEY = 'chatui_temp_performance_diagnostics_v1';
export const PERFORMANCE_DIAGNOSTICS_EVENT = 'chatui:performance-diagnostics-updated';

const STORAGE_VERSION = 1;
const MAX_SAVED_RUNS = 100;
const ALLOWED_METADATA_KEYS = new Set([
  'requestKind',
  'textChars',
  'currentAttachmentCount',
  'currentAttachmentBytes',
  'attachmentTypeCounts',
  'chatMessageCountBeforeSend',
  'chatWasAlreadyLoaded',
  'newChat',
  'model',
  'thinkingLevel',
  'enabledTools',
  'apiOrigin'
]);

let diagnosticsEnabled = false;
let activeRun = null;

function perfNow() {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}

function relativeNow() {
  if (!activeRun) return 0;
  return Math.max(0, perfNow() - activeRun._perfStartedAt);
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function nonNegativeNumber(value) {
  return Math.max(0, finiteNumber(value, 0));
}

function safeShortString(value, maxLength = 160) {
  return String(value == null ? '' : value).slice(0, maxLength);
}

function safeBooleanMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 32)) {
    output[safeShortString(key, 64)] = !!item;
  }
  return output;
}

function safeNumberMap(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, item] of Object.entries(value).slice(0, 32)) {
    output[safeShortString(key, 64)] = nonNegativeNumber(item);
  }
  return output;
}

function sanitizeMetadataPatch(patch = {}) {
  const output = {};
  for (const [key, value] of Object.entries(patch || {})) {
    if (!ALLOWED_METADATA_KEYS.has(key)) continue;
    if (key === 'enabledTools') output[key] = safeBooleanMap(value);
    else if (key === 'attachmentTypeCounts') output[key] = safeNumberMap(value);
    else if (['requestKind', 'model', 'thinkingLevel', 'apiOrigin'].includes(key)) output[key] = safeShortString(value);
    else if (['chatWasAlreadyLoaded', 'newChat'].includes(key)) output[key] = !!value;
    else output[key] = nonNegativeNumber(value);
  }
  return output;
}

function dispatchDiagnosticsUpdate(reason = 'updated') {
  if (typeof window === 'undefined' || typeof window.dispatchEvent !== 'function') return;
  try {
    window.dispatchEvent(new CustomEvent(PERFORMANCE_DIAGNOSTICS_EVENT, {
      detail: { reason, enabled: diagnosticsEnabled, active: !!activeRun }
    }));
  } catch (_) {}
}

function emptyStoredState() {
  return { version: STORAGE_VERSION, runs: [] };
}

function loadStoredState() {
  if (typeof localStorage === 'undefined') return emptyStoredState();
  try {
    const raw = localStorage.getItem(PERFORMANCE_DIAGNOSTICS_STORAGE_KEY);
    if (!raw) return emptyStoredState();
    const parsed = JSON.parse(raw);
    if (parsed?.version !== STORAGE_VERSION || !Array.isArray(parsed?.runs)) {
      localStorage.removeItem(PERFORMANCE_DIAGNOSTICS_STORAGE_KEY);
      return emptyStoredState();
    }
    return {
      version: STORAGE_VERSION,
      runs: parsed.runs.slice(-MAX_SAVED_RUNS)
    };
  } catch (error) {
    console.warn('Temporary performance diagnostic data could not be loaded:', error);
    try { localStorage.removeItem(PERFORMANCE_DIAGNOSTICS_STORAGE_KEY); } catch (_) {}
    return emptyStoredState();
  }
}

function saveStoredState(state) {
  if (typeof localStorage === 'undefined') return false;
  try {
    localStorage.setItem(PERFORMANCE_DIAGNOSTICS_STORAGE_KEY, JSON.stringify({
      version: STORAGE_VERSION,
      runs: Array.isArray(state?.runs) ? state.runs.slice(-MAX_SAVED_RUNS) : []
    }));
    return true;
  } catch (error) {
    console.warn('Temporary performance diagnostic data could not be saved:', error);
    return false;
  }
}

function runId() {
  const suffix = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  return `perf_run_${suffix}`;
}

function sanitizeEventMetadata(metadata = {}) {
  const output = {};
  if (metadata.activityType) output.activityType = safeShortString(metadata.activityType, 32);
  return output;
}

function sanitizePhaseEntry(entry = {}) {
  return {
    count: Math.max(0, Math.trunc(finiteNumber(entry.count, 0))),
    totalMs: nonNegativeNumber(entry.totalMs),
    maxMs: nonNegativeNumber(entry.maxMs),
    lastMs: nonNegativeNumber(entry.lastMs)
  };
}

function sanitizeHistoryStats(stats = {}) {
  return {
    inputMessageCount: nonNegativeNumber(stats.inputMessageCount),
    includedConversationMessageCount: nonNegativeNumber(stats.includedConversationMessageCount),
    includedUserMessageCount: nonNegativeNumber(stats.includedUserMessageCount),
    includedAssistantMessageCount: nonNegativeNumber(stats.includedAssistantMessageCount),
    historicalAttachmentCount: nonNegativeNumber(stats.historicalAttachmentCount),
    historicalAttachmentBytes: nonNegativeNumber(stats.historicalAttachmentBytes),
    historicalBlobToBase64Conversions: nonNegativeNumber(stats.historicalBlobToBase64Conversions),
    historicalBlobToBase64TotalMs: nonNegativeNumber(stats.historicalBlobToBase64TotalMs),
    preservedModelPartCount: nonNegativeNumber(stats.preservedModelPartCount)
  };
}

function sanitizeNetworkRound(round = {}) {
  return {
    roundNumber: Math.max(1, Math.trunc(finiteNumber(round.roundNumber, 1))),
    requestBodyChars: nonNegativeNumber(round.requestBodyChars),
    fetchStartMs: nonNegativeNumber(round.fetchStartMs),
    responseHeadersMs: round.responseHeadersMs == null ? null : nonNegativeNumber(round.responseHeadersMs),
    firstReaderChunkMs: round.firstReaderChunkMs == null ? null : nonNegativeNumber(round.firstReaderChunkMs),
    firstParsedSseEventMs: round.firstParsedSseEventMs == null ? null : nonNegativeNumber(round.firstParsedSseEventMs),
    firstCandidatePartMs: round.firstCandidatePartMs == null ? null : nonNegativeNumber(round.firstCandidatePartMs),
    lastReaderChunkMs: round.lastReaderChunkMs == null ? null : nonNegativeNumber(round.lastReaderChunkMs),
    roundCompleteMs: round.roundCompleteMs == null ? null : nonNegativeNumber(round.roundCompleteMs),
    streamedBytes: nonNegativeNumber(round.streamedBytes),
    readerChunkCount: nonNegativeNumber(round.readerChunkCount),
    sseEventCount: nonNegativeNumber(round.sseEventCount),
    candidatePartCount: nonNegativeNumber(round.candidatePartCount),
    httpStatus: round.httpStatus == null ? null : Math.trunc(finiteNumber(round.httpStatus, 0)),
    status: safeShortString(round.status || 'unknown', 32),
    finishReason: safeShortString(round.finishReason || '', 80),
    errorType: safeShortString(round.errorType || '', 80)
  };
}

function sanitizeCompletedRun(run) {
  const events = {};
  for (const [name, event] of Object.entries(run.events || {})) {
    events[safeShortString(name, 80)] = {
      atMs: nonNegativeNumber(event?.atMs),
      metadata: sanitizeEventMetadata(event?.metadata || {})
    };
  }

  const phases = {};
  for (const [name, entry] of Object.entries(run.phases || {})) {
    phases[safeShortString(name, 80)] = sanitizePhaseEntry(entry);
  }

  const byType = {};
  for (const [type, item] of Object.entries(run.attachmentConversions?.byType || {})) {
    byType[safeShortString(type, 40)] = {
      count: nonNegativeNumber(item?.count),
      bytes: nonNegativeNumber(item?.bytes),
      totalMs: nonNegativeNumber(item?.totalMs)
    };
  }

  return {
    id: safeShortString(run.id, 120),
    startedAt: nonNegativeNumber(run.startedAt),
    endedAt: nonNegativeNumber(run.endedAt),
    requestKind: safeShortString(run.metadata?.requestKind || 'unknown', 48),
    status: safeShortString(run.status || 'unknown', 64),
    metadata: sanitizeMetadataPatch(run.metadata || {}),
    events,
    phases,
    attachmentConversions: {
      count: nonNegativeNumber(run.attachmentConversions?.count),
      totalMs: nonNegativeNumber(run.attachmentConversions?.totalMs),
      maxMs: nonNegativeNumber(run.attachmentConversions?.maxMs),
      totalBytes: nonNegativeNumber(run.attachmentConversions?.totalBytes),
      byType
    },
    history: sanitizeHistoryStats(run.history || {}),
    networkRounds: (run.networkRounds || []).map(sanitizeNetworkRound),
    toolExecutions: (run.toolExecutions || []).slice(0, 64).map(item => ({
      name: safeShortString(item?.name || 'tool', 100),
      durationMs: nonNegativeNumber(item?.durationMs),
      success: item?.success !== false
    })),
    rendering: {
      renderFrameCount: nonNegativeNumber(run.rendering?.renderFrameCount),
      renderTotalMs: nonNegativeNumber(run.rendering?.renderTotalMs),
      renderMaxMs: nonNegativeNumber(run.rendering?.renderMaxMs),
      scrollTotalMs: nonNegativeNumber(run.rendering?.scrollTotalMs),
      scrollMaxMs: nonNegativeNumber(run.rendering?.scrollMaxMs)
    },
    endToEndMs: nonNegativeNumber(run.endToEndMs)
  };
}

export function isPerformanceDiagnosticsEnabled() {
  return diagnosticsEnabled;
}

export function hasActivePerformanceRun() {
  return !!activeRun;
}

export function setPerformanceDiagnosticsEnabled(enabled) {
  diagnosticsEnabled = !!enabled;
  dispatchDiagnosticsUpdate('enabled-changed');
  return diagnosticsEnabled;
}

export function getPerformanceDiagnosticsState() {
  const stored = loadStoredState();
  return {
    enabled: diagnosticsEnabled,
    active: !!activeRun,
    capturedRunCount: stored.runs.length
  };
}

export function beginPerformanceRun(metadata = {}) {
  if (!diagnosticsEnabled) return null;
  if (activeRun) {
    finishPerformanceRun('superseded');
  }

  const startedAt = Date.now();
  activeRun = {
    id: runId(),
    startedAt,
    endedAt: 0,
    status: 'running',
    metadata: sanitizeMetadataPatch(metadata),
    events: {},
    phases: {},
    attachmentConversions: { count: 0, totalMs: 0, maxMs: 0, totalBytes: 0, byType: {} },
    history: {},
    networkRounds: [],
    toolExecutions: [],
    rendering: { renderFrameCount: 0, renderTotalMs: 0, renderMaxMs: 0, scrollTotalMs: 0, scrollMaxMs: 0 },
    endToEndMs: 0,
    _perfStartedAt: perfNow(),
    _phaseStarts: {}
  };
  activeRun.events.send_entry = { atMs: 0, metadata: {} };
  dispatchDiagnosticsUpdate('run-started');
  return activeRun.id;
}

export function updatePerformanceRunMetadata(patch = {}) {
  if (!activeRun) return;
  Object.assign(activeRun.metadata, sanitizeMetadataPatch(patch));
}

export function markPerformanceEvent(name, metadata = {}) {
  if (!activeRun || !name) return;
  const key = safeShortString(name, 80);
  if (activeRun.events[key]) return;
  activeRun.events[key] = {
    atMs: relativeNow(),
    metadata: sanitizeEventMetadata(metadata)
  };
}

export function startPerformancePhase(name) {
  if (!activeRun || !name) return false;
  activeRun._phaseStarts[safeShortString(name, 80)] = perfNow();
  return true;
}

export function endPerformancePhase(name) {
  if (!activeRun || !name) return 0;
  const key = safeShortString(name, 80);
  const started = activeRun._phaseStarts[key];
  if (!Number.isFinite(started)) return 0;
  delete activeRun._phaseStarts[key];
  const durationMs = Math.max(0, perfNow() - started);
  const existing = activeRun.phases[key] || { count: 0, totalMs: 0, maxMs: 0, lastMs: 0 };
  existing.count += 1;
  existing.totalMs += durationMs;
  existing.maxMs = Math.max(existing.maxMs, durationMs);
  existing.lastMs = durationMs;
  activeRun.phases[key] = existing;
  return durationMs;
}

export function recordAttachmentConversion({ durationMs = 0, bytes = 0, type = 'other' } = {}) {
  if (!activeRun) return;
  const duration = nonNegativeNumber(durationMs);
  const size = nonNegativeNumber(bytes);
  const category = safeShortString(type || 'other', 40);
  const aggregate = activeRun.attachmentConversions;
  aggregate.count += 1;
  aggregate.totalMs += duration;
  aggregate.maxMs = Math.max(aggregate.maxMs, duration);
  aggregate.totalBytes += size;
  const bucket = aggregate.byType[category] || { count: 0, bytes: 0, totalMs: 0 };
  bucket.count += 1;
  bucket.bytes += size;
  bucket.totalMs += duration;
  aggregate.byType[category] = bucket;
}

export function recordHistoryStats(stats = {}) {
  if (!activeRun) return;
  activeRun.history = sanitizeHistoryStats(stats);
}

export function beginNetworkRound({ roundNumber = 1, requestBodyChars = 0 } = {}) {
  if (!activeRun) return null;
  const id = `network_round_${activeRun.networkRounds.length + 1}`;
  const fetchStartMs = relativeNow();
  activeRun.networkRounds.push({
    id,
    roundNumber,
    requestBodyChars: nonNegativeNumber(requestBodyChars),
    fetchStartMs,
    responseHeadersMs: null,
    firstReaderChunkMs: null,
    firstParsedSseEventMs: null,
    firstCandidatePartMs: null,
    lastReaderChunkMs: null,
    roundCompleteMs: null,
    streamedBytes: 0,
    readerChunkCount: 0,
    sseEventCount: 0,
    candidatePartCount: 0,
    httpStatus: null,
    status: 'running',
    finishReason: '',
    errorType: ''
  });
  markPerformanceEvent('first_fetch');
  return id;
}

function findNetworkRound(id) {
  if (!activeRun || !id) return null;
  return activeRun.networkRounds.find(round => round.id === id) || null;
}

export function recordNetworkResponseHeaders(id, httpStatus) {
  const round = findNetworkRound(id);
  if (!round) return;
  if (round.responseHeadersMs == null) round.responseHeadersMs = relativeNow();
  if (httpStatus != null) round.httpStatus = Math.trunc(finiteNumber(httpStatus, 0));
}

export function recordNetworkChunk(id, byteLength = 0) {
  const round = findNetworkRound(id);
  if (!round) return;
  const atMs = relativeNow();
  if (round.firstReaderChunkMs == null) round.firstReaderChunkMs = atMs;
  round.lastReaderChunkMs = atMs;
  round.readerChunkCount += 1;
  round.streamedBytes += nonNegativeNumber(byteLength);
}

export function recordParsedSseEvent(id) {
  const round = findNetworkRound(id);
  if (!round) return;
  if (round.firstParsedSseEventMs == null) round.firstParsedSseEventMs = relativeNow();
  round.sseEventCount += 1;
}

export function recordCandidatePart(id) {
  const round = findNetworkRound(id);
  if (!round) return;
  if (round.firstCandidatePartMs == null) round.firstCandidatePartMs = relativeNow();
  round.candidatePartCount += 1;
}

export function finishNetworkRound(id, { status = 'completed', finishReason = '', errorType = '' } = {}) {
  const round = findNetworkRound(id);
  if (!round || round.roundCompleteMs != null) return;
  round.roundCompleteMs = relativeNow();
  round.status = safeShortString(status, 32);
  round.finishReason = safeShortString(finishReason, 80);
  round.errorType = safeShortString(errorType, 80);
}

export function recordToolExecution({ name = 'tool', durationMs = 0, success = true } = {}) {
  if (!activeRun) return;
  activeRun.toolExecutions.push({
    name: safeShortString(name, 100),
    durationMs: nonNegativeNumber(durationMs),
    success: success !== false
  });
}

export function recordRenderSample({ renderMs = 0, scrollMs = 0 } = {}) {
  if (!activeRun) return;
  const renderDuration = nonNegativeNumber(renderMs);
  const scrollDuration = nonNegativeNumber(scrollMs);
  const aggregate = activeRun.rendering;
  aggregate.renderFrameCount += 1;
  aggregate.renderTotalMs += renderDuration;
  aggregate.renderMaxMs = Math.max(aggregate.renderMaxMs, renderDuration);
  aggregate.scrollTotalMs += scrollDuration;
  aggregate.scrollMaxMs = Math.max(aggregate.scrollMaxMs, scrollDuration);
}

export function finishPerformanceRun(status = 'completed') {
  if (!activeRun) return null;
  const run = activeRun;
  run.status = safeShortString(status || 'completed', 64);
  run.endedAt = Date.now();
  run.endToEndMs = Math.max(0, perfNow() - run._perfStartedAt);
  if (!run.events.run_complete) run.events.run_complete = { atMs: run.endToEndMs, metadata: {} };

  const completed = sanitizeCompletedRun(run);
  activeRun = null;

  const stored = loadStoredState();
  stored.runs.push(completed);
  stored.runs = stored.runs.slice(-MAX_SAVED_RUNS);
  saveStoredState(stored);
  dispatchDiagnosticsUpdate('run-finished');
  return completed;
}

export function loadSavedPerformanceRuns() {
  return loadStoredState().runs;
}

export function clearSavedPerformanceRuns() {
  if (typeof localStorage !== 'undefined') {
    try { localStorage.removeItem(PERFORMANCE_DIAGNOSTICS_STORAGE_KEY); }
    catch (error) { console.warn('Temporary performance diagnostic data could not be cleared:', error); }
  }
  dispatchDiagnosticsUpdate('runs-cleared');
}

function phaseTotal(run, name) {
  return nonNegativeNumber(run?.phases?.[name]?.totalMs);
}

function eventTime(run, name) {
  const value = run?.events?.[name]?.atMs;
  return value == null ? null : nonNegativeNumber(value);
}

function firstRound(run) {
  return Array.isArray(run?.networkRounds) && run.networkRounds.length ? run.networkRounds[0] : null;
}

function deriveRunMetrics(run) {
  const first = firstRound(run);
  const firstFetch = first?.fetchStartMs ?? eventTime(run, 'first_fetch');
  const firstChunk = first?.firstReaderChunkMs ?? null;
  const firstVisible = eventTime(run, 'first_visible_activity');
  const streamComplete = eventTime(run, 'stream_complete');
  return {
    sendToFirstFetch: firstFetch == null ? null : nonNegativeNumber(firstFetch),
    fetchToFirstChunk: firstFetch == null || firstChunk == null ? null : Math.max(0, firstChunk - firstFetch),
    firstChunkToFirstVisible: firstChunk == null || firstVisible == null ? null : Math.max(0, firstVisible - firstChunk),
    streamDuration: firstChunk == null || streamComplete == null ? null : Math.max(0, streamComplete - firstChunk),
    finalization: streamComplete == null ? null : Math.max(0, nonNegativeNumber(run.endToEndMs) - streamComplete),
    endToEnd: nonNegativeNumber(run.endToEndMs),
    requestBodyChars: (run.networkRounds || []).reduce((total, round) => total + nonNegativeNumber(round.requestBodyChars), 0),
    renderTotalMs: nonNegativeNumber(run.rendering?.renderTotalMs),
    historyMessages: nonNegativeNumber(run.history?.includedConversationMessageCount),
    historicalAttachmentBytes: nonNegativeNumber(run.history?.historicalAttachmentBytes)
  };
}

function formatMs(value) {
  if (value == null || !Number.isFinite(Number(value))) return 'n/a';
  const ms = Number(value);
  if (ms < 1000) return `${ms.toFixed(ms < 10 ? 2 : 1)} ms`;
  return `${(ms / 1000).toFixed(2)} s`;
}

function formatBytes(value) {
  const bytes = nonNegativeNumber(value);
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatChars(value) {
  const count = nonNegativeNumber(value);
  if (count < 1000) return `${Math.round(count)}`;
  if (count < 1000000) return `${(count / 1000).toFixed(1)}k`;
  return `${(count / 1000000).toFixed(2)}m`;
}

function median(values) {
  const sorted = (values || []).filter(value => value != null && Number.isFinite(Number(value))).map(Number).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function minValue(values) {
  const safe = (values || []).filter(value => value != null && Number.isFinite(Number(value))).map(Number);
  return safe.length ? Math.min(...safe) : null;
}

function maxValue(values) {
  const safe = (values || []).filter(value => value != null && Number.isFinite(Number(value))).map(Number);
  return safe.length ? Math.max(...safe) : null;
}

function enabledToolNames(tools = {}) {
  const enabled = Object.entries(tools || {}).filter(([, value]) => !!value).map(([key]) => key);
  return enabled.length ? enabled.join(', ') : 'none';
}

function largestFirstResponseCategory(metrics) {
  const categories = [
    ['Frontend before first fetch', metrics.sendToFirstFetch],
    ['Network/backend wait to first stream data', metrics.fetchToFirstChunk],
    ['Browser processing to first visible activity', metrics.firstChunkToFirstVisible]
  ].filter(([, value]) => value != null && Number.isFinite(Number(value)));
  if (!categories.length) return null;
  return categories.reduce((best, candidate) => Number(candidate[1]) > Number(best[1]) ? candidate : best);
}

function appendAggregateMetric(lines, label, values, formatter = formatMs) {
  const filtered = values.filter(value => value != null && Number.isFinite(Number(value)));
  if (!filtered.length) return;
  lines.push(`- ${label}: min ${formatter(minValue(filtered))} · median ${formatter(median(filtered))} · max ${formatter(maxValue(filtered))}`);
}

export function buildPerformanceReport() {
  const runs = loadSavedPerformanceRuns();
  const lines = [
    '# ChatUI Temporary Performance Diagnostic Report',
    '',
    `Captured runs: ${runs.length}`,
    `Browser: ${typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown'}`,
    `App origin: ${typeof location !== 'undefined' ? location.origin : 'unknown'}`,
    '',
    'Privacy note: this report contains timing/size/count metadata only; it intentionally excludes prompts, assistant responses, API keys, Base64 data, file names, and file contents.',
    ''
  ];

  if (!runs.length) {
    lines.push('No diagnostic runs have been captured yet.');
    return lines.join('\n');
  }

  const derivedRuns = runs.map(run => ({ run, metrics: deriveRunMetrics(run) }));
  const countsByKind = {};
  runs.forEach(run => {
    const kind = run.requestKind || 'unknown';
    countsByKind[kind] = (countsByKind[kind] || 0) + 1;
  });

  lines.push('## Aggregate Summary', '');
  lines.push(`Request kinds: ${Object.entries(countsByKind).map(([kind, count]) => `${kind}=${count}`).join(', ')}`);
  appendAggregateMetric(lines, 'Send → first fetch', derivedRuns.map(item => item.metrics.sendToFirstFetch));
  appendAggregateMetric(lines, 'Fetch → first stream chunk', derivedRuns.map(item => item.metrics.fetchToFirstChunk));
  appendAggregateMetric(lines, 'First stream chunk → first visible activity', derivedRuns.map(item => item.metrics.firstChunkToFirstVisible));
  appendAggregateMetric(lines, 'First stream chunk → stream complete', derivedRuns.map(item => item.metrics.streamDuration));
  appendAggregateMetric(lines, 'End-to-end', derivedRuns.map(item => item.metrics.endToEnd));
  appendAggregateMetric(lines, 'Request body chars (all rounds)', derivedRuns.map(item => item.metrics.requestBodyChars), formatChars);
  appendAggregateMetric(lines, 'Historical attachment bytes', derivedRuns.map(item => item.metrics.historicalAttachmentBytes), formatBytes);
  appendAggregateMetric(lines, 'Streaming render CPU total', derivedRuns.map(item => item.metrics.renderTotalMs));

  const grouped = new Map();
  derivedRuns.forEach(item => {
    const kind = item.run.requestKind || 'unknown';
    if (!grouped.has(kind)) grouped.set(kind, []);
    grouped.get(kind).push(item.metrics);
  });
  if (grouped.size > 1) {
    lines.push('', '### By request kind');
    for (const [kind, metrics] of grouped.entries()) {
      lines.push('', `**${kind}** (${metrics.length})`);
      appendAggregateMetric(lines, 'Send → first fetch', metrics.map(item => item.sendToFirstFetch));
      appendAggregateMetric(lines, 'Fetch → first stream chunk', metrics.map(item => item.fetchToFirstChunk));
      appendAggregateMetric(lines, 'End-to-end', metrics.map(item => item.endToEnd));
    }
  }

  runs.forEach((run, index) => {
    const metrics = deriveRunMetrics(run);
    const largest = largestFirstResponseCategory(metrics);
    const firstActivityType = run.events?.first_activity_event?.metadata?.activityType || 'n/a';
    const firstVisibleType = run.events?.first_visible_activity?.metadata?.activityType || 'n/a';
    const metadata = run.metadata || {};
    const history = run.history || {};
    const conversions = run.attachmentConversions || {};
    const render = run.rendering || {};

    lines.push('', `## Run ${index + 1} — ${run.requestKind || 'unknown'}`, '');
    lines.push(`Status: ${run.status || 'unknown'}`);
    lines.push(`Model: ${metadata.model || 'unknown'}`);
    lines.push(`Thinking: ${metadata.thinkingLevel || 'unknown'}`);
    lines.push(`Tools: ${enabledToolNames(metadata.enabledTools)}`);
    lines.push(`API origin: ${metadata.apiOrigin || 'unknown'}`);
    lines.push(`Text characters: ${Math.round(nonNegativeNumber(metadata.textChars))}`);
    lines.push(`Current attachments: ${Math.round(nonNegativeNumber(metadata.currentAttachmentCount))} (${formatBytes(metadata.currentAttachmentBytes)})`);
    lines.push(`Attachment categories: ${Object.entries(metadata.attachmentTypeCounts || {}).map(([key, value]) => `${key}=${Math.round(value)}`).join(', ') || 'none'}`);
    lines.push(`Chat messages before send: ${Math.round(nonNegativeNumber(metadata.chatMessageCountBeforeSend))}`);
    lines.push(`Chat already loaded: ${metadata.chatWasAlreadyLoaded === true ? 'yes' : 'no'}`);
    lines.push(`New chat: ${metadata.newChat === true ? 'yes' : 'no'}`);
    lines.push(`History messages sent: ${Math.round(nonNegativeNumber(history.includedConversationMessageCount))}`);
    lines.push(`History users/assistants: ${Math.round(nonNegativeNumber(history.includedUserMessageCount))}/${Math.round(nonNegativeNumber(history.includedAssistantMessageCount))}`);
    lines.push(`Historical attachments included: ${Math.round(nonNegativeNumber(history.historicalAttachmentCount))} (${formatBytes(history.historicalAttachmentBytes)})`);
    lines.push(`Historical Blob → Base64: ${Math.round(nonNegativeNumber(history.historicalBlobToBase64Conversions))} conversions, ${formatMs(history.historicalBlobToBase64TotalMs)}`);
    lines.push(`Preserved model parts: ${Math.round(nonNegativeNumber(history.preservedModelPartCount))}`);
    lines.push(`Gemini network rounds: ${(run.networkRounds || []).length}`);
    lines.push('');
    lines.push('### First-response wall timing');
    lines.push(`- Send → first fetch: ${formatMs(metrics.sendToFirstFetch)}`);
    lines.push(`- Fetch → first stream chunk: ${formatMs(metrics.fetchToFirstChunk)}`);
    lines.push(`- First stream chunk → first visible activity: ${formatMs(metrics.firstChunkToFirstVisible)}`);
    lines.push(`- First activity type: ${firstActivityType}`);
    lines.push(`- First visible activity type: ${firstVisibleType}`);
    lines.push(`- First stream chunk → stream complete: ${formatMs(metrics.streamDuration)}`);
    lines.push(`- Stream complete → run complete: ${formatMs(metrics.finalization)}`);
    lines.push(`- End-to-end: ${formatMs(metrics.endToEnd)}`);
    if (largest) {
      const firstVisibleAt = eventTime(run, 'first_visible_activity');
      const percentage = firstVisibleAt && Number(firstVisibleAt) > 0
        ? Math.min(100, Math.max(0, Number(largest[1]) / Number(firstVisibleAt) * 100))
        : null;
      lines.push(`- Largest measured first-response delay: ${largest[0]} — ${formatMs(largest[1])}${percentage == null ? '' : ` (${percentage.toFixed(1)}%)`}`);
    }

    lines.push('', '### Frontend phases');
    const phaseNames = [
      ['audio_stop_and_blob_finalize', 'Audio stop/blob finalize'],
      ['ensure_chat_loaded', 'Ensure chat loaded'],
      ['new_attachment_prepare_total', 'New attachment preparation'],
      ['persist_user_turn', 'Persist user turn'],
      ['render_user_message', 'Render user message'],
      ['sidebar_update_before_generation', 'Sidebar update before generation'],
      ['build_gemini_history', 'Build Gemini history'],
      ['serialize_payload', 'Serialize payload (all rounds)'],
      ['persist_final_assistant', 'Persist final assistant'],
      ['finish_generation_cleanup', 'Finish generation cleanup']
    ];
    phaseNames.forEach(([name, label]) => lines.push(`- ${label}: ${formatMs(phaseTotal(run, name))}`));
    lines.push(`- New attachment Base64 conversions: ${Math.round(nonNegativeNumber(conversions.count))} files, ${formatMs(conversions.totalMs)} total, ${formatMs(conversions.maxMs)} max, ${formatBytes(conversions.totalBytes)}`);

    lines.push('', '### Streaming UI CPU');
    const frameCount = Math.round(nonNegativeNumber(render.renderFrameCount));
    lines.push(`- Render frames measured: ${frameCount}`);
    lines.push(`- Render CPU total: ${formatMs(render.renderTotalMs)}`);
    lines.push(`- Render CPU max frame: ${formatMs(render.renderMaxMs)}`);
    lines.push(`- Render CPU average: ${frameCount ? formatMs(nonNegativeNumber(render.renderTotalMs) / frameCount) : 'n/a'}`);
    lines.push(`- Scroll work total: ${formatMs(render.scrollTotalMs)}`);
    lines.push(`- Scroll work max: ${formatMs(render.scrollMaxMs)}`);

    (run.networkRounds || []).forEach((round, roundIndex) => {
      lines.push('', `### Network round ${roundIndex + 1}`);
      lines.push(`- Logical round number: ${round.roundNumber}`);
      lines.push(`- Status / HTTP: ${round.status || 'unknown'} / ${round.httpStatus ?? 'n/a'}`);
      lines.push(`- Request body chars: ${formatChars(round.requestBodyChars)}`);
      lines.push(`- Fetch → response headers: ${round.responseHeadersMs == null ? 'n/a' : formatMs(round.responseHeadersMs - round.fetchStartMs)}`);
      lines.push(`- Fetch → first reader chunk: ${round.firstReaderChunkMs == null ? 'n/a' : formatMs(round.firstReaderChunkMs - round.fetchStartMs)}`);
      lines.push(`- Fetch → first parsed SSE event: ${round.firstParsedSseEventMs == null ? 'n/a' : formatMs(round.firstParsedSseEventMs - round.fetchStartMs)}`);
      lines.push(`- Fetch → first candidate part: ${round.firstCandidatePartMs == null ? 'n/a' : formatMs(round.firstCandidatePartMs - round.fetchStartMs)}`);
      lines.push(`- Streamed bytes: ${formatBytes(round.streamedBytes)}`);
      lines.push(`- Reader chunks / SSE events / candidate parts: ${Math.round(round.readerChunkCount || 0)} / ${Math.round(round.sseEventCount || 0)} / ${Math.round(round.candidatePartCount || 0)}`);
      lines.push(`- Round wall time: ${round.roundCompleteMs == null ? 'n/a' : formatMs(round.roundCompleteMs - round.fetchStartMs)}`);
      if (round.finishReason) lines.push(`- Finish reason: ${round.finishReason}`);
      if (round.errorType) lines.push(`- Error type: ${round.errorType}`);
    });

    if ((run.toolExecutions || []).length) {
      lines.push('', '### Client tool execution');
      run.toolExecutions.forEach((tool, toolIndex) => {
        lines.push(`- ${toolIndex + 1}. ${tool.name}: ${formatMs(tool.durationMs)} · ${tool.success ? 'success' : 'failed'}`);
      });
    }
  });

  return lines.join('\n');
}
