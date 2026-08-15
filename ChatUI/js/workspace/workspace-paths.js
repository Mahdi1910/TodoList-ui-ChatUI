/**
 * workspace-paths.js - Pure validation and text helpers for the virtual Workspace filesystem.
 */

export const WORKSPACE_MAX_DEPTH = 32;
export const WORKSPACE_MAX_SEGMENT_LENGTH = 255;
export const WORKSPACE_MAX_PATH_LENGTH = 2048;
export const WORKSPACE_MAX_FILE_BYTES = 2 * 1024 * 1024;
export const WORKSPACE_READ_DEFAULT_LINES = 200;
export const WORKSPACE_READ_MAX_LINES = 500;
export const WORKSPACE_READ_MAX_CHARS = 100000;

const CONTROL_CHARACTER_RE = /[\u0000-\u001F\u007F]/;

export class WorkspacePathError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'WorkspacePathError';
    this.code = code;
  }
}

export function normalizeNameKey(name) {
  return String(name || '').normalize('NFKC').toLocaleLowerCase();
}

export function isMarkdownName(name) {
  return typeof name === 'string' && name.toLocaleLowerCase().endsWith('.md');
}

export function parseWorkspacePath(input, options = {}) {
  const { requireMarkdown = false, allowRoot = true } = options;
  if (typeof input !== 'string') {
    throw new WorkspacePathError('INVALID_PATH', 'Workspace path must be a string.');
  }
  if (!input.startsWith('/')) {
    throw new WorkspacePathError('INVALID_PATH', 'Workspace paths must be absolute and start with /.');
  }
  if (input.includes('\\')) {
    throw new WorkspacePathError('INVALID_PATH', 'Workspace paths must use / separators, not backslashes.');
  }
  if (CONTROL_CHARACTER_RE.test(input)) {
    throw new WorkspacePathError('INVALID_PATH', 'Workspace paths may not contain control characters.');
  }
  if (input.length > WORKSPACE_MAX_PATH_LENGTH) {
    throw new WorkspacePathError('INVALID_PATH', `Workspace path exceeds ${WORKSPACE_MAX_PATH_LENGTH} characters.`);
  }
  if (input === '/') {
    if (!allowRoot || requireMarkdown) {
      throw new WorkspacePathError(requireMarkdown ? 'NOT_MARKDOWN' : 'INVALID_PATH', 'This operation requires a non-root Workspace path.');
    }
    return { path: '/', segments: [], name: '', parentPath: null, nameKey: '' };
  }
  if (input.endsWith('/') || input.includes('//')) {
    throw new WorkspacePathError('INVALID_PATH', 'Workspace paths may not contain empty path segments.');
  }

  const segments = input.slice(1).split('/');
  if (segments.length > WORKSPACE_MAX_DEPTH) {
    throw new WorkspacePathError('INVALID_PATH', `Workspace path exceeds the maximum depth of ${WORKSPACE_MAX_DEPTH}.`);
  }

  for (const segment of segments) {
    if (!segment || segment === '.' || segment === '..') {
      throw new WorkspacePathError('INVALID_PATH', 'Workspace paths may not contain empty, . or .. segments.');
    }
    if (segment.length > WORKSPACE_MAX_SEGMENT_LENGTH) {
      throw new WorkspacePathError('INVALID_PATH', `Workspace path segment exceeds ${WORKSPACE_MAX_SEGMENT_LENGTH} characters.`);
    }
    if (CONTROL_CHARACTER_RE.test(segment)) {
      throw new WorkspacePathError('INVALID_PATH', 'Workspace names may not contain control characters.');
    }
  }

  const path = `/${segments.join('/')}`;
  const name = segments.at(-1);
  if (requireMarkdown && !isMarkdownName(name)) {
    throw new WorkspacePathError('NOT_MARKDOWN', 'Workspace files must use the .md extension.');
  }

  return {
    path,
    segments,
    name,
    nameKey: normalizeNameKey(name),
    parentPath: segments.length === 1 ? '/' : `/${segments.slice(0, -1).join('/')}`
  };
}

export function validateWorkspaceNodeName(name, type = 'directory') {
  if (typeof name !== 'string' || !name) {
    throw new WorkspacePathError('INVALID_PATH', 'Workspace name is required.');
  }
  if (name === '.' || name === '..' || name.includes('/') || name.includes('\\') || CONTROL_CHARACTER_RE.test(name)) {
    throw new WorkspacePathError('INVALID_PATH', 'Workspace name contains an invalid path character or reserved segment.');
  }
  if (name.length > WORKSPACE_MAX_SEGMENT_LENGTH) {
    throw new WorkspacePathError('INVALID_PATH', `Workspace name exceeds ${WORKSPACE_MAX_SEGMENT_LENGTH} characters.`);
  }
  if (type === 'file' && !isMarkdownName(name)) {
    throw new WorkspacePathError('NOT_MARKDOWN', 'Workspace files must use the .md extension.');
  }
  return { name, nameKey: normalizeNameKey(name) };
}

export function joinWorkspacePath(parentPath, name) {
  const parent = parseWorkspacePath(parentPath, { allowRoot: true });
  validateWorkspaceNodeName(name);
  return parent.path === '/' ? `/${name}` : `${parent.path}/${name}`;
}

export function splitWorkspaceLines(content) {
  const text = String(content ?? '');
  return text === '' ? [] : text.split(/\r?\n/);
}

export function countWorkspaceLines(content) {
  return splitWorkspaceLines(content).length;
}

export function utf8ByteLength(content) {
  const text = String(content ?? '');
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).byteLength;
  return unescape(encodeURIComponent(text)).length;
}

export function readWorkspaceLineWindow(content, offset = 0, length = WORKSPACE_READ_DEFAULT_LINES) {
  const lines = splitWorkspaceLines(content);
  const totalLines = lines.length;
  const normalizedOffset = Number.isInteger(Number(offset)) ? Number(offset) : 0;
  const normalizedLength = Number.isInteger(Number(length)) ? Number(length) : WORKSPACE_READ_DEFAULT_LINES;

  if (normalizedOffset < 0) {
    const tailCount = Math.min(Math.abs(normalizedOffset), WORKSPACE_READ_MAX_LINES);
    const startLine = Math.max(0, totalLines - tailCount);
    const selected = lines.slice(startLine);
    let result = selected.join('\n');
    const charTruncated = result.length > WORKSPACE_READ_MAX_CHARS;
    if (charTruncated) result = result.slice(0, WORKSPACE_READ_MAX_CHARS);
    return {
      content: result,
      startLine,
      endLineExclusive: totalLines,
      totalLines,
      hasMore: startLine > 0 || charTruncated,
      charTruncated
    };
  }

  const safeOffset = Math.max(0, normalizedOffset);
  const safeLength = Math.max(1, Math.min(normalizedLength, WORKSPACE_READ_MAX_LINES));
  const endLineExclusive = Math.min(totalLines, safeOffset + safeLength);
  let result = lines.slice(safeOffset, endLineExclusive).join('\n');
  const charTruncated = result.length > WORKSPACE_READ_MAX_CHARS;
  if (charTruncated) result = result.slice(0, WORKSPACE_READ_MAX_CHARS);

  return {
    content: result,
    startLine: Math.min(safeOffset, totalLines),
    endLineExclusive,
    totalLines,
    hasMore: endLineExclusive < totalLines || charTruncated,
    charTruncated
  };
}

export function replaceWorkspaceBlock(content, oldString, newString, expectedReplacements = 1) {
  const source = String(content ?? '');
  const oldText = String(oldString ?? '');
  const newText = String(newString ?? '');
  const expected = Number(expectedReplacements);

  if (!oldText) {
    return { ok: false, count: 0, content: source, reason: 'old_string must not be empty.' };
  }
  if (!Number.isInteger(expected) || expected < 1 || expected > 100) {
    return { ok: false, count: 0, content: source, reason: 'expected_replacements must be an integer from 1 to 100.' };
  }

  let count = 0;
  let cursor = 0;
  while (true) {
    const index = source.indexOf(oldText, cursor);
    if (index === -1) break;
    count += 1;
    cursor = index + oldText.length;
  }

  if (count !== expected) {
    return { ok: false, count, content: source, reason: `Expected ${expected} exact match(es) but found ${count}.` };
  }

  return { ok: true, count, content: source.split(oldText).join(newText), reason: '' };
}
