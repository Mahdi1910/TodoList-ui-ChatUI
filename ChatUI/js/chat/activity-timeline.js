/**
 * activity-timeline.js - Pure chronological activity model for streamed assistant turns.
 *
 * The timeline is presentation state only. Gemini protocol history must never be
 * reconstructed from these records.
 */

const TOOL_PREVIEW_MAX_CHARS = 16 * 1024;
const TOOL_PREVIEW_MAX_DEPTH = 6;
const TOOL_PREVIEW_MAX_ARRAY_ITEMS = 40;
const TOOL_PREVIEW_MAX_OBJECT_KEYS = 60;
const TOOL_PREVIEW_MAX_STRING_CHARS = 4000;

function nowMs() {
  return Date.now();
}

function cloneScalar(value) {
  if (value == null || typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return String(value);
}

function safePreviewValue(value, depth, state) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.length <= TOOL_PREVIEW_MAX_STRING_CHARS) return value;
    state.truncated = true;
    return `${value.slice(0, TOOL_PREVIEW_MAX_STRING_CHARS)}\n… [truncated]`;
  }
  if (typeof Blob !== 'undefined' && value instanceof Blob) {
    state.truncated = true;
    return `[Blob ${value.type || 'application/octet-stream'} · ${value.size} bytes]`;
  }
  if (depth >= TOOL_PREVIEW_MAX_DEPTH) {
    state.truncated = true;
    return '[Max depth reached]';
  }
  if (Array.isArray(value)) {
    const output = value.slice(0, TOOL_PREVIEW_MAX_ARRAY_ITEMS)
      .map(item => safePreviewValue(item, depth + 1, state));
    if (value.length > TOOL_PREVIEW_MAX_ARRAY_ITEMS) {
      state.truncated = true;
      output.push(`… [${value.length - TOOL_PREVIEW_MAX_ARRAY_ITEMS} more items]`);
    }
    return output;
  }
  if (typeof value === 'object') {
    const output = {};
    const entries = Object.entries(value);
    for (const [key, item] of entries.slice(0, TOOL_PREVIEW_MAX_OBJECT_KEYS)) {
      output[key] = safePreviewValue(item, depth + 1, state);
    }
    if (entries.length > TOOL_PREVIEW_MAX_OBJECT_KEYS) {
      state.truncated = true;
      output.__truncatedKeys = entries.length - TOOL_PREVIEW_MAX_OBJECT_KEYS;
    }
    return output;
  }
  state.truncated = true;
  return cloneScalar(value);
}

function compactPreview(preview, state) {
  let serialized = '';
  try { serialized = JSON.stringify(preview); }
  catch (_) {
    state.truncated = true;
    return '[Unserializable result]';
  }
  if (serialized.length <= TOOL_PREVIEW_MAX_CHARS) return preview;

  state.truncated = true;
  return {
    preview: `${serialized.slice(0, TOOL_PREVIEW_MAX_CHARS - 80)}… [truncated]`
  };
}

export function buildBoundedToolPreview(value) {
  const state = { truncated: false };
  const preview = safePreviewValue(value, 0, state);
  return {
    value: compactPreview(preview, state),
    truncated: state.truncated
  };
}

function basename(path = '') {
  const clean = String(path || '').replace(/\\/g, '/').replace(/\/+$/, '');
  return clean.split('/').filter(Boolean).at(-1) || '/';
}

export function getToolProvider(name = '', toolType = '') {
  const normalizedName = String(name || '');
  const normalizedType = String(toolType || '').toUpperCase();
  if (normalizedName.startsWith('workspace_')) return 'workspace';
  if (normalizedType.includes('GOOGLE_SEARCH')) return 'google-search';
  if (normalizedType.includes('URL_CONTEXT')) return 'url-context';
  if (normalizedType.includes('CODE_EXECUTION')) return 'code-execution';
  return normalizedType ? 'builtin' : 'unknown';
}

export function formatToolSummary({ provider, name, args = {}, toolType = '' } = {}) {
  if (provider === 'workspace' || String(name || '').startsWith('workspace_')) {
    switch (name) {
      case 'workspace_list_directory': return `Listed ${args.path || '/'}`;
      case 'workspace_read_file': return `Read ${basename(args.path)}`;
      case 'workspace_read_multiple_files': return `Read ${Array.isArray(args.paths) ? args.paths.length : 0} files`;
      case 'workspace_write_file': return `${args.mode === 'append' ? 'Appended' : 'Wrote'} ${basename(args.path)}`;
      case 'workspace_edit_block': return `Edited ${basename(args.path)}`;
      case 'workspace_create_directory': return `Created ${args.path || 'folder'}`;
      case 'workspace_move': return `Moved ${basename(args.source)} → ${basename(args.destination)}`;
      case 'workspace_delete_file': return `Deleted ${basename(args.path)}`;
      case 'workspace_delete_directory': return `Deleted ${args.path || 'folder'}`;
      case 'workspace_get_file_info': return `Inspected ${basename(args.path)}`;
      case 'workspace_search': return `Searched for “${String(args.query || '').slice(0, 80)}”`;
      default: return String(name || 'Workspace operation').replace(/^workspace_/, '').replaceAll('_', ' ');
    }
  }
  if (provider === 'google-search') {
    const queries = Array.isArray(args.queries) ? args.queries : [];
    return queries.length ? `Searched “${String(queries[0]).slice(0, 90)}”` : 'Searched the web';
  }
  if (provider === 'url-context') {
    const urls = Array.isArray(args.urls) ? args.urls : [];
    return urls.length === 1 ? `Opened ${String(urls[0]).slice(0, 100)}` : `Opened ${urls.length || ''} URLs`.trim();
  }
  if (provider === 'code-execution') return 'Ran code';
  return String(toolType || name || 'Tool operation').replaceAll('_', ' ');
}

function providerLabel(provider) {
  switch (provider) {
    case 'workspace': return 'Workspace';
    case 'google-search': return 'Google Search';
    case 'url-context': return 'URL Context';
    case 'code-execution': return 'Code Execution';
    case 'builtin': return 'Tool';
    default: return 'Tool';
  }
}

export function getToolDisplayTitle(activity) {
  const prefix = providerLabel(activity?.provider);
  return `${prefix} · ${activity?.summary || formatToolSummary(activity)}`;
}

function createTextualActivity(session, type, start) {
  return {
    id: `${session.messageId || 'assistant'}_activity_${++session.sequence}`,
    type,
    start,
    end: start,
    status: 'running',
    startedAt: nowMs(),
    completedAt: 0
  };
}

function closeLastTextual(session) {
  const last = session.timeline.at(-1);
  if (!last || !['text', 'thinking'].includes(last.type) || last.status !== 'running') return;
  last.status = 'completed';
  last.completedAt = nowMs();
}

function findTool(session, callId) {
  if (!callId) return null;
  return session.timeline.find(item => item.type === 'tool' && item.callId === callId) || null;
}

function createToolActivity(session, event) {
  closeLastTextual(session);
  const provider = event.provider || getToolProvider(event.name, event.toolType);
  const argsPreview = buildBoundedToolPreview(event.args || {});
  const sequence = ++session.sequence;
  const activity = {
    id: `${session.messageId || 'assistant'}_activity_${sequence}`,
    type: 'tool',
    status: event.status || 'requested',
    provider,
    name: String(event.name || event.toolType || 'tool'),
    toolType: event.toolType ? String(event.toolType) : '',
    callId: String(event.callId || event.id || `activity-call-${sequence}`),
    summary: event.summary || formatToolSummary({ provider, name: event.name, args: event.args || {}, toolType: event.toolType }),
    args: argsPreview.value,
    argsTruncated: argsPreview.truncated,
    resultPreview: null,
    resultTruncated: false,
    error: null,
    startedAt: nowMs(),
    completedAt: 0
  };
  session.timeline.push(activity);
  return activity;
}

function updateToolResult(activity, event, status) {
  activity.status = status;
  if (Object.prototype.hasOwnProperty.call(event, 'result')) {
    const preview = buildBoundedToolPreview(event.result);
    activity.resultPreview = preview.value;
    activity.resultTruncated = preview.truncated;
  }
  if (event.error) {
    const preview = buildBoundedToolPreview(event.error);
    activity.error = preview.value;
    activity.resultTruncated = activity.resultTruncated || preview.truncated;
  }
  if (event.summary) activity.summary = event.summary;
  if (['completed', 'failed', 'interrupted'].includes(status)) activity.completedAt = nowMs();
}

export function createActivitySession({ messageId = '' } = {}) {
  return {
    messageId,
    sequence: 0,
    content: '',
    thinking: '',
    timeline: []
  };
}

export function applyActivityEvent(session, event = {}) {
  if (!session || !event?.type) return session;
  const last = session.timeline.at(-1);

  if (event.type === 'thinking.delta') {
    const delta = String(event.delta || '');
    if (!delta) return session;
    const start = session.thinking.length;
    session.thinking += delta;
    let activity = last && last.type === 'thinking' && last.status === 'running' ? last : null;
    if (!activity) {
      closeLastTextual(session);
      activity = createTextualActivity(session, 'thinking', start);
      session.timeline.push(activity);
    }
    activity.end = session.thinking.length;
    return session;
  }

  if (event.type === 'text.delta') {
    const delta = String(event.delta || '');
    if (!delta) return session;
    const start = session.content.length;
    session.content += delta;
    let activity = last && last.type === 'text' && last.status === 'running' ? last : null;
    if (!activity) {
      closeLastTextual(session);
      activity = createTextualActivity(session, 'text', start);
      session.timeline.push(activity);
    }
    activity.end = session.content.length;
    return session;
  }

  if (event.type.endsWith('.requested')) {
    createToolActivity(session, { ...event, status: 'requested' });
    return session;
  }

  if (event.type.endsWith('.running')) {
    const activity = findTool(session, String(event.callId || event.id || '')) || createToolActivity(session, event);
    updateToolResult(activity, event, 'running');
    return session;
  }

  if (event.type.endsWith('.completed')) {
    const activity = findTool(session, String(event.callId || event.id || '')) || createToolActivity(session, event);
    updateToolResult(activity, event, 'completed');
    return session;
  }

  if (event.type.endsWith('.failed')) {
    const activity = findTool(session, String(event.callId || event.id || '')) || createToolActivity(session, event);
    updateToolResult(activity, event, 'failed');
    return session;
  }

  if (event.type.endsWith('.interrupted')) {
    const activity = findTool(session, String(event.callId || event.id || '')) || createToolActivity(session, event);
    updateToolResult(activity, event, 'interrupted');
  }
  return session;
}

export function finalizeActivitySession(session, mode = 'completed') {
  if (!session) return session;
  const completedAt = nowMs();
  for (const activity of session.timeline) {
    if (['text', 'thinking'].includes(activity.type) && activity.status === 'running') {
      activity.status = mode === 'completed' ? 'completed' : mode;
      activity.completedAt = completedAt;
    }
    if (activity.type === 'tool' && ['requested', 'running'].includes(activity.status)) {
      activity.status = mode === 'completed' ? 'interrupted' : mode;
      activity.completedAt = completedAt;
    }
  }
  return session;
}

function sanitizeTextualActivity(item, sourceLength) {
  const length = Math.max(0, Number(sourceLength) || 0);
  const rawStart = Number.isInteger(Number(item?.start)) ? Number(item.start) : 0;
  const rawEnd = Number.isInteger(Number(item?.end)) ? Number(item.end) : rawStart;
  const start = Math.max(0, Math.min(length, rawStart));
  const end = Math.max(start, Math.min(length, rawEnd));
  return {
    id: String(item?.id || ''),
    type: item.type,
    start,
    end,
    status: ['running', 'completed', 'interrupted', 'failed'].includes(item?.status) ? item.status : 'completed',
    startedAt: Number(item?.startedAt) || 0,
    completedAt: Number(item?.completedAt) || 0
  };
}

function sanitizeToolActivity(item) {
  const args = buildBoundedToolPreview(item?.args || {});
  const result = buildBoundedToolPreview(item?.resultPreview);
  const error = item?.error == null ? { value: null, truncated: false } : buildBoundedToolPreview(item.error);
  return {
    id: String(item?.id || ''),
    type: 'tool',
    status: ['requested', 'running', 'completed', 'failed', 'interrupted'].includes(item?.status) ? item.status : 'completed',
    provider: String(item?.provider || 'unknown'),
    name: String(item?.name || 'tool'),
    toolType: String(item?.toolType || ''),
    callId: String(item?.callId || ''),
    summary: String(item?.summary || ''),
    args: args.value,
    argsTruncated: !!item?.argsTruncated || args.truncated,
    resultPreview: result.value,
    resultTruncated: !!item?.resultTruncated || result.truncated || error.truncated,
    error: error.value,
    startedAt: Number(item?.startedAt) || 0,
    completedAt: Number(item?.completedAt) || 0
  };
}

export function sanitizeActivityTimeline(timeline, { content = '', thinking = '' } = {}) {
  if (!Array.isArray(timeline)) return null;
  const safe = [];
  for (const item of timeline) {
    if (item?.type === 'text') safe.push(sanitizeTextualActivity(item, String(content || '').length));
    else if (item?.type === 'thinking') safe.push(sanitizeTextualActivity(item, String(thinking || '').length));
    else if (item?.type === 'tool') safe.push(sanitizeToolActivity(item));
  }
  return safe;
}

export function snapshotActivitySession(session) {
  return {
    content: String(session?.content || ''),
    thinking: String(session?.thinking || ''),
    activityTimeline: sanitizeActivityTimeline(session?.timeline || [], {
      content: session?.content || '',
      thinking: session?.thinking || ''
    }) || []
  };
}

export function createFallbackTextTimeline(messageId, content) {
  const text = String(content || '');
  if (!text) return [];
  const timestamp = nowMs();
  return [{
    id: `${messageId || 'assistant'}_activity_fallback`,
    type: 'text',
    start: 0,
    end: text.length,
    status: 'completed',
    startedAt: timestamp,
    completedAt: timestamp
  }];
}
