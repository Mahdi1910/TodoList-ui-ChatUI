/**
 * workspace-service.js - Authoritative virtual filesystem semantics shared by UI and Gemini tools.
 */

import { createEntityId } from '../state/store.js';
import {
  WORKSPACE_MAX_FILE_BYTES,
  WORKSPACE_READ_DEFAULT_LINES,
  WORKSPACE_READ_MAX_LINES,
  WORKSPACE_READ_MAX_CHARS,
  WorkspacePathError,
  countWorkspaceLines,
  isMarkdownName,
  joinWorkspacePath,
  normalizeNameKey,
  parseWorkspacePath,
  readWorkspaceLineWindow,
  replaceWorkspaceBlock,
  utf8ByteLength,
  validateWorkspaceNodeName
} from './workspace-paths.js';
import {
  createWorkspaceDirectoryNodes,
  createWorkspaceFilePair,
  deleteWorkspaceFilePair,
  deleteWorkspaceSubtree,
  findWorkspaceChild,
  getWorkspaceFileByNodeId,
  getWorkspaceNodeById,
  listWorkspaceChildren,
  updateWorkspaceFilePair,
  updateWorkspaceNode
} from './workspace-storage.js';

const ROOT_PARENT_KEY = '__workspace_root__';
const LIST_MAX_DEPTH = 5;
const LIST_MAX_ENTRIES = 500;
const MULTI_READ_MAX_FILES = 10;
const MULTI_READ_MAX_CHARS = 150000;
const SEARCH_MAX_RESULTS = 100;
const DEFAULT_SEARCH_RESULTS = 25;

export class WorkspaceServiceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'WorkspaceServiceError';
    this.code = code;
    this.details = details;
  }
}

function parentKey(parentId) {
  return parentId || ROOT_PARENT_KEY;
}

function throwIfAborted(signal) {
  if (!signal?.aborted) return;
  if (typeof DOMException !== 'undefined') throw new DOMException('Operation aborted.', 'AbortError');
  const error = new Error('Operation aborted.');
  error.name = 'AbortError';
  throw error;
}

function translatePathError(error) {
  if (error instanceof WorkspacePathError) {
    throw new WorkspaceServiceError(error.code || 'INVALID_PATH', error.message);
  }
  throw error;
}

function translateStorageError(error) {
  if (error instanceof WorkspaceServiceError) throw error;
  if (error instanceof WorkspacePathError) translatePathError(error);
  if (error?.name === 'QuotaExceededError') {
    throw new WorkspaceServiceError('QUOTA_EXCEEDED', 'Browser storage quota was exceeded while updating Workspace.');
  }
  if (error?.name === 'ConstraintError') {
    throw new WorkspaceServiceError('ALREADY_EXISTS', 'A Workspace item with that name already exists in the destination folder.');
  }
  throw error;
}

function assertFileSize(content) {
  const sizeBytes = utf8ByteLength(content);
  if (sizeBytes > WORKSPACE_MAX_FILE_BYTES) {
    throw new WorkspaceServiceError('FILE_TOO_LARGE', `Workspace Markdown files are limited to ${WORKSPACE_MAX_FILE_BYTES} UTF-8 bytes.`);
  }
  return sizeBytes;
}

function sortNodes(nodes) {
  return [...nodes].sort((a, b) => {
    if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
    return String(a.name || '').localeCompare(String(b.name || ''), undefined, { sensitivity: 'base' });
  });
}

function nodeSummary(node, path) {
  return {
    id: node.id,
    parentId: node.parentId ?? null,
    type: node.type,
    name: node.name,
    path,
    ...(node.type === 'file' ? { sizeBytes: node.sizeBytes || 0, lineCount: node.lineCount || 0 } : {}),
    revision: Number(node.revision) || 0,
    createdAt: node.createdAt || 0,
    updatedAt: node.updatedAt || node.createdAt || 0
  };
}

function notifyWorkspaceChange(detail) {
  if (typeof window === 'undefined' || typeof CustomEvent === 'undefined') return;
  window.dispatchEvent(new CustomEvent('workspace:changed', { detail }));
}

function parsePath(path, options = {}) {
  try {
    return parseWorkspacePath(path, options);
  } catch (error) {
    translatePathError(error);
  }
}

export function toWorkspaceToolError(error) {
  if (error?.name === 'AbortError') throw error;
  const known = error instanceof WorkspaceServiceError || error instanceof WorkspacePathError;
  return {
    ok: false,
    error: {
      code: known ? (error.code || 'INVALID_PATH') : 'INTERNAL_WORKSPACE_ERROR',
      message: known ? error.message : 'Workspace operation failed unexpectedly.'
    }
  };
}

export async function resolveWorkspacePath(inputPath, expectedType = null) {
  const parsed = parsePath(inputPath, { allowRoot: true });
  if (parsed.path === '/') {
    if (expectedType && expectedType !== 'directory') {
      throw new WorkspaceServiceError('NOT_A_FILE', 'Workspace root is a directory.');
    }
    return {
      id: null,
      parentId: null,
      parentKey: ROOT_PARENT_KEY,
      type: 'directory',
      name: '',
      nameKey: '',
      path: '/',
      revision: 0,
      createdAt: 0,
      updatedAt: 0
    };
  }

  let parentId = null;
  let node = null;
  const canonicalSegments = [];
  for (const segment of parsed.segments) {
    node = await findWorkspaceChild(parentId, normalizeNameKey(segment));
    if (!node) throw new WorkspaceServiceError('NOT_FOUND', `Workspace path was not found: ${inputPath}`);
    canonicalSegments.push(node.name);
    parentId = node.id;
  }

  if (expectedType && node.type !== expectedType) {
    throw new WorkspaceServiceError(
      expectedType === 'directory' ? 'NOT_A_DIRECTORY' : 'NOT_A_FILE',
      `Workspace path is not a ${expectedType}: ${inputPath}`
    );
  }
  return { ...node, path: `/${canonicalSegments.join('/')}` };
}

async function canonicalPathForNode(node) {
  if (!node?.id) return '/';
  const names = [node.name];
  let parentId = node.parentId;
  while (parentId) {
    const parent = await getWorkspaceNodeById(parentId);
    if (!parent) throw new WorkspaceServiceError('INTERNAL_WORKSPACE_ERROR', 'Workspace hierarchy contains a missing parent node.');
    names.push(parent.name);
    parentId = parent.parentId;
  }
  return `/${names.reverse().join('/')}`;
}

async function ensureSiblingAvailable(parentId, nameKey, ignoreNodeId = null) {
  const existing = await findWorkspaceChild(parentId, nameKey);
  if (existing && existing.id !== ignoreNodeId) {
    throw new WorkspaceServiceError('ALREADY_EXISTS', 'A Workspace item with that name already exists in the destination folder.');
  }
}

export async function listDirectory(path = '/', depth = 1, options = {}) {
  const signal = options.signal;
  throwIfAborted(signal);
  const directory = await resolveWorkspacePath(path, 'directory');
  const numericDepth = depth == null ? 1 : Number(depth);
  if (!Number.isInteger(numericDepth) || numericDepth < 1 || numericDepth > LIST_MAX_DEPTH) {
    throw new WorkspaceServiceError('RESULT_LIMIT_EXCEEDED', `Directory depth must be an integer from 1 to ${LIST_MAX_DEPTH}.`);
  }

  const entries = [];
  let truncated = false;
  const walk = async (parentNode, parentPath, remainingDepth, level) => {
    throwIfAborted(signal);
    if (remainingDepth < 1 || truncated) return;
    const children = sortNodes(await listWorkspaceChildren(parentNode?.id ?? null));
    for (const child of children) {
      throwIfAborted(signal);
      if (entries.length >= LIST_MAX_ENTRIES) {
        truncated = true;
        return;
      }
      const childPath = joinWorkspacePath(parentPath, child.name);
      entries.push({ ...nodeSummary(child, childPath), depth: level });
      if (child.type === 'directory' && remainingDepth > 1) {
        await walk(child, childPath, remainingDepth - 1, level + 1);
      }
    }
  };

  await walk(directory, directory.path, numericDepth, 1);
  return { ok: true, path: directory.path, entries, truncated, maxEntries: LIST_MAX_ENTRIES };
}

export async function readFile(path, offset = 0, length = WORKSPACE_READ_DEFAULT_LINES, options = {}) {
  const signal = options.signal;
  throwIfAborted(signal);
  const parsed = parsePath(path, { allowRoot: false, requireMarkdown: true });
  const numericOffset = offset == null ? 0 : Number(offset);
  const numericLength = length == null ? WORKSPACE_READ_DEFAULT_LINES : Number(length);
  if (!Number.isInteger(numericOffset)) {
    throw new WorkspaceServiceError('READ_LIMIT_EXCEEDED', 'offset must be an integer line offset.');
  }
  if (numericOffset >= 0 && (!Number.isInteger(numericLength) || numericLength < 1 || numericLength > WORKSPACE_READ_MAX_LINES)) {
    throw new WorkspaceServiceError('READ_LIMIT_EXCEEDED', `length must be an integer from 1 to ${WORKSPACE_READ_MAX_LINES}.`);
  }

  const node = await resolveWorkspacePath(parsed.path, 'file');
  const file = await getWorkspaceFileByNodeId(node.id);
  if (!file) throw new WorkspaceServiceError('INTERNAL_WORKSPACE_ERROR', 'Workspace file content record is missing.');
  throwIfAborted(signal);

  const result = readWorkspaceLineWindow(file.content || '', numericOffset, numericLength);
  return {
    ok: true,
    path: node.path,
    content: result.content,
    startLine: result.startLine,
    endLineExclusive: result.endLineExclusive,
    totalLines: result.totalLines,
    hasMore: result.hasMore,
    truncatedByCharacterLimit: result.charTruncated,
    maxCharacters: WORKSPACE_READ_MAX_CHARS,
    revision: Number(file.revision ?? node.revision) || 0
  };
}

export async function readFileForViewer(path) {
  const parsed = parsePath(path, { allowRoot: false, requireMarkdown: true });
  const node = await resolveWorkspacePath(parsed.path, 'file');
  const file = await getWorkspaceFileByNodeId(node.id);
  if (!file) throw new WorkspaceServiceError('INTERNAL_WORKSPACE_ERROR', 'Workspace file content record is missing.');
  return { ok: true, ...nodeSummary(node, node.path), content: String(file.content || '') };
}

export async function readMultipleFiles(paths, options = {}) {
  const signal = options.signal;
  if (!Array.isArray(paths) || paths.length < 1 || paths.length > MULTI_READ_MAX_FILES) {
    throw new WorkspaceServiceError('READ_LIMIT_EXCEEDED', `paths must contain 1 to ${MULTI_READ_MAX_FILES} files.`);
  }

  const results = [];
  let totalCharacters = 0;
  let truncated = false;
  for (const path of paths) {
    throwIfAborted(signal);
    try {
      const result = await readFile(path, 0, WORKSPACE_READ_MAX_LINES, { signal });
      const remaining = MULTI_READ_MAX_CHARS - totalCharacters;
      if (remaining <= 0) {
        truncated = true;
        break;
      }
      if (result.content.length > remaining) {
        result.content = result.content.slice(0, remaining);
        result.hasMore = true;
        result.truncatedByBatchLimit = true;
        truncated = true;
      }
      totalCharacters += result.content.length;
      results.push(result);
      if (truncated) break;
    } catch (error) {
      if (error?.name === 'AbortError') throw error;
      results.push({ path: String(path || ''), ...toWorkspaceToolError(error) });
    }
  }
  return { ok: true, files: results, totalCharacters, truncated, maxTotalCharacters: MULTI_READ_MAX_CHARS };
}

export async function writeFile(path, content, mode = 'rewrite') {
  const parsed = parsePath(path, { allowRoot: false, requireMarkdown: true });
  if (mode !== 'rewrite' && mode !== 'append') {
    throw new WorkspaceServiceError('INVALID_PATH', 'Workspace write mode must be rewrite or append.');
  }

  const suppliedContent = String(content ?? '');
  const parent = await resolveWorkspacePath(parsed.parentPath, 'directory');
  const existing = await findWorkspaceChild(parent.id, parsed.nameKey);

  try {
    if (!existing) {
      if (mode === 'append') throw new WorkspaceServiceError('NOT_FOUND', 'Append mode requires an existing Markdown file.');
      const sizeBytes = assertFileSize(suppliedContent);
      const now = Date.now();
      const node = {
        id: createEntityId('ws_node'),
        parentId: parent.id,
        parentKey: parentKey(parent.id),
        type: 'file',
        name: parsed.name,
        nameKey: parsed.nameKey,
        sizeBytes,
        lineCount: countWorkspaceLines(suppliedContent),
        revision: 1,
        createdAt: now,
        updatedAt: now
      };
      const fileRecord = { nodeId: node.id, content: suppliedContent, revision: 1, updatedAt: now };
      await createWorkspaceFilePair(node, fileRecord);
      const canonicalPath = joinWorkspacePath(parent.path, node.name);
      notifyWorkspaceChange({ operation: 'create-file', nodeId: node.id, path: canonicalPath });
      return { ok: true, created: true, path: canonicalPath, revision: 1, sizeBytes, lineCount: node.lineCount, id: node.id };
    }

    if (existing.type !== 'file') throw new WorkspaceServiceError('NOT_A_FILE', 'The destination path is an existing directory.');
    const currentFile = await getWorkspaceFileByNodeId(existing.id);
    if (!currentFile) throw new WorkspaceServiceError('INTERNAL_WORKSPACE_ERROR', 'Workspace file content record is missing.');
    const nextContent = mode === 'append' ? `${currentFile.content || ''}${suppliedContent}` : suppliedContent;
    const sizeBytes = assertFileSize(nextContent);
    const now = Date.now();
    const revision = Math.max(Number(existing.revision) || 0, Number(currentFile.revision) || 0) + 1;
    const node = { ...existing, sizeBytes, lineCount: countWorkspaceLines(nextContent), revision, updatedAt: now };
    const fileRecord = { ...currentFile, content: nextContent, revision, updatedAt: now };
    await updateWorkspaceFilePair(node, fileRecord);
    const canonicalPath = joinWorkspacePath(parent.path, node.name);
    notifyWorkspaceChange({ operation: mode === 'append' ? 'append' : 'rewrite', nodeId: node.id, path: canonicalPath });
    return { ok: true, created: false, path: canonicalPath, revision, sizeBytes, lineCount: node.lineCount, id: node.id };
  } catch (error) {
    translateStorageError(error);
  }
}

export async function editBlock(path, oldString, newString, expectedReplacements = 1) {
  const parsed = parsePath(path, { allowRoot: false, requireMarkdown: true });
  const node = await resolveWorkspacePath(parsed.path, 'file');
  const file = await getWorkspaceFileByNodeId(node.id);
  if (!file) throw new WorkspaceServiceError('INTERNAL_WORKSPACE_ERROR', 'Workspace file content record is missing.');

  const replacement = replaceWorkspaceBlock(file.content || '', oldString, newString, expectedReplacements);
  if (!replacement.ok) {
    throw new WorkspaceServiceError('EDIT_MATCH_COUNT_MISMATCH', replacement.reason, { actualMatches: replacement.count });
  }

  const sizeBytes = assertFileSize(replacement.content);
  const now = Date.now();
  const revision = Math.max(Number(node.revision) || 0, Number(file.revision) || 0) + 1;
  const updatedNode = {
    ...node,
    sizeBytes,
    lineCount: countWorkspaceLines(replacement.content),
    revision,
    updatedAt: now
  };
  delete updatedNode.path;
  const updatedFile = { ...file, content: replacement.content, revision, updatedAt: now };
  try {
    await updateWorkspaceFilePair(updatedNode, updatedFile);
  } catch (error) {
    translateStorageError(error);
  }
  notifyWorkspaceChange({ operation: 'edit', nodeId: node.id, path: node.path });
  return { ok: true, path: node.path, replacements: replacement.count, revision, sizeBytes, lineCount: updatedNode.lineCount, id: node.id };
}

export async function createDirectory(path) {
  const parsed = parsePath(path, { allowRoot: true });
  if (parsed.path === '/') return { ok: true, path: '/', id: null, created: false };

  let parentId = null;
  let missingStarted = false;
  let finalNode = null;
  const canonicalSegments = [];
  const missingNodes = [];

  for (const segment of parsed.segments) {
    const validated = validateWorkspaceNodeName(segment, 'directory');
    let node = null;
    if (!missingStarted) {
      node = await findWorkspaceChild(parentId, validated.nameKey);
      if (node && node.type !== 'directory') {
        throw new WorkspaceServiceError('NOT_A_DIRECTORY', `Cannot create directory because ${segment} is an existing file.`);
      }
      if (!node) missingStarted = true;
    }

    if (missingStarted) {
      const now = Date.now();
      node = {
        id: createEntityId('ws_node'),
        parentId,
        parentKey: parentKey(parentId),
        type: 'directory',
        name: validated.name,
        nameKey: validated.nameKey,
        sizeBytes: 0,
        lineCount: 0,
        revision: 1,
        createdAt: now,
        updatedAt: now
      };
      missingNodes.push(node);
    }

    finalNode = node;
    parentId = node.id;
    canonicalSegments.push(node.name);
  }

  try {
    await createWorkspaceDirectoryNodes(missingNodes);
  } catch (error) {
    translateStorageError(error);
  }

  const canonicalPath = `/${canonicalSegments.join('/')}`;
  if (missingNodes.length > 0) {
    notifyWorkspaceChange({ operation: 'create-directory', nodeId: finalNode.id, path: canonicalPath });
  }
  return { ok: true, path: canonicalPath, id: finalNode.id, created: missingNodes.length > 0, revision: finalNode.revision || 0 };
}

export async function move(source, destination) {
  const sourceParsed = parsePath(source, { allowRoot: false });
  const destinationParsed = parsePath(destination, { allowRoot: false });
  const sourceNode = await resolveWorkspacePath(sourceParsed.path);
  if (sourceNode.type === 'file' && !isMarkdownName(destinationParsed.name)) {
    throw new WorkspaceServiceError('NOT_MARKDOWN', 'Workspace files must use the .md extension.');
  }

  const validated = validateWorkspaceNodeName(destinationParsed.name, sourceNode.type);
  const destinationParent = await resolveWorkspacePath(destinationParsed.parentPath, 'directory');
  await ensureSiblingAvailable(destinationParent.id, validated.nameKey, sourceNode.id);

  if (sourceNode.type === 'directory') {
    let cursor = destinationParent;
    while (cursor?.id) {
      if (cursor.id === sourceNode.id) {
        throw new WorkspaceServiceError('DESTINATION_INSIDE_SOURCE', 'A directory cannot be moved into itself or one of its descendants.');
      }
      cursor = cursor.parentId ? await getWorkspaceNodeById(cursor.parentId) : null;
    }
  }

  const canonicalDestination = joinWorkspacePath(destinationParent.path, validated.name);
  if (sourceNode.path === canonicalDestination) {
    return { ok: true, moved: false, source: sourceNode.path, destination: canonicalDestination, id: sourceNode.id, revision: sourceNode.revision || 0 };
  }

  const updatedNode = {
    ...sourceNode,
    parentId: destinationParent.id,
    parentKey: parentKey(destinationParent.id),
    name: validated.name,
    nameKey: validated.nameKey,
    revision: (Number(sourceNode.revision) || 0) + 1,
    updatedAt: Date.now()
  };
  delete updatedNode.path;
  try {
    await updateWorkspaceNode(updatedNode);
  } catch (error) {
    translateStorageError(error);
  }
  notifyWorkspaceChange({ operation: 'move', nodeId: sourceNode.id, path: canonicalDestination, previousPath: sourceNode.path });
  return { ok: true, moved: true, source: sourceNode.path, destination: canonicalDestination, id: sourceNode.id, revision: updatedNode.revision };
}

export async function deleteFile(path) {
  const parsed = parsePath(path, { allowRoot: false, requireMarkdown: true });
  const node = await resolveWorkspacePath(parsed.path, 'file');
  try {
    await deleteWorkspaceFilePair(node.id);
  } catch (error) {
    translateStorageError(error);
  }
  notifyWorkspaceChange({ operation: 'delete-file', nodeId: node.id, path: node.path });
  return { ok: true, deleted: true, path: node.path, id: node.id };
}

async function collectSubtree(directory, signal = null) {
  const nodeIds = [directory.id];
  const fileNodeIds = [];
  const queue = [directory];
  while (queue.length) {
    throwIfAborted(signal);
    const current = queue.shift();
    const children = await listWorkspaceChildren(current.id);
    for (const child of children) {
      nodeIds.push(child.id);
      if (child.type === 'file') fileNodeIds.push(child.id);
      else queue.push(child);
    }
  }
  return { nodeIds, fileNodeIds };
}

export async function deleteDirectory(path, recursive = false, options = {}) {
  const parsed = parsePath(path, { allowRoot: false });
  const directory = await resolveWorkspacePath(parsed.path, 'directory');
  const children = await listWorkspaceChildren(directory.id);
  if (children.length > 0 && recursive !== true) {
    throw new WorkspaceServiceError('DIRECTORY_NOT_EMPTY', 'Directory is not empty. Set recursive=true to delete its complete subtree.');
  }

  const subtree = recursive === true
    ? await collectSubtree(directory, options.signal)
    : { nodeIds: [directory.id], fileNodeIds: [] };
  try {
    await deleteWorkspaceSubtree(subtree.nodeIds, subtree.fileNodeIds);
  } catch (error) {
    translateStorageError(error);
  }
  notifyWorkspaceChange({ operation: 'delete-directory', nodeId: directory.id, path: directory.path, recursive: recursive === true });
  return { ok: true, deleted: true, path: directory.path, id: directory.id, deletedNodes: subtree.nodeIds.length };
}

export async function getFileInfo(path) {
  const node = await resolveWorkspacePath(path);
  if (!node.id) {
    const children = await listWorkspaceChildren(null);
    return { ok: true, type: 'directory', name: '/', path: '/', id: null, directChildCount: children.length, revision: 0, createdAt: 0, updatedAt: 0 };
  }
  const result = { ok: true, ...nodeSummary(node, node.path) };
  if (node.type === 'directory') result.directChildCount = (await listWorkspaceChildren(node.id)).length;
  return result;
}

async function collectDescendants(directory, signal = null) {
  const results = [];
  const queue = [{ node: directory, path: directory.path }];
  while (queue.length) {
    throwIfAborted(signal);
    const current = queue.shift();
    const children = sortNodes(await listWorkspaceChildren(current.node.id));
    for (const child of children) {
      const childPath = joinWorkspacePath(current.path, child.name);
      results.push({ node: child, path: childPath });
      if (child.type === 'directory') queue.push({ node: child, path: childPath });
    }
  }
  return results;
}

export async function searchWorkspace(path = '/', query, searchType = 'both', maxResults = DEFAULT_SEARCH_RESULTS, options = {}) {
  const signal = options.signal;
  throwIfAborted(signal);
  const scope = await resolveWorkspacePath(path, 'directory');
  const q = String(query || '').trim();
  if (!q) return { ok: true, path: scope.path, query: '', results: [], truncated: false };
  if (!['name', 'content', 'both'].includes(searchType)) {
    throw new WorkspaceServiceError('INVALID_PATH', 'search_type must be name, content, or both.');
  }

  const requestedMax = Number(maxResults ?? DEFAULT_SEARCH_RESULTS);
  if (!Number.isInteger(requestedMax) || requestedMax < 1) {
    throw new WorkspaceServiceError('RESULT_LIMIT_EXCEEDED', 'max_results must be a positive integer.');
  }
  const limit = Math.min(requestedMax, SEARCH_MAX_RESULTS);
  const lowerQuery = q.toLocaleLowerCase();
  const descendants = await collectDescendants(scope, signal);
  const results = [];
  let truncated = false;

  const addResult = result => {
    if (results.length >= limit) {
      truncated = true;
      return false;
    }
    results.push(result);
    return true;
  };

  if (searchType === 'name' || searchType === 'both') {
    for (const item of descendants) {
      throwIfAborted(signal);
      if (!item.node.name.toLocaleLowerCase().includes(lowerQuery)) continue;
      if (!addResult({ id: item.node.id, type: item.node.type, path: item.path, name: item.node.name, matchType: 'name' })) break;
    }
  }

  if (!truncated && (searchType === 'content' || searchType === 'both')) {
    for (const item of descendants) {
      throwIfAborted(signal);
      if (item.node.type !== 'file') continue;
      const file = await getWorkspaceFileByNodeId(item.node.id);
      if (!file) continue;
      const lines = String(file.content || '').split(/\r?\n/);
      for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
        const line = lines[lineIndex];
        if (!line.toLocaleLowerCase().includes(lowerQuery)) continue;
        const excerpt = line.length > 220 ? `${line.slice(0, 217)}...` : line;
        if (!addResult({ id: item.node.id, type: 'file', path: item.path, name: item.node.name, matchType: 'content', lineIndex, excerpt })) break;
      }
      if (truncated) break;
    }
  }

  return { ok: true, path: scope.path, query: q, searchType, results, truncated, maxResults: limit };
}

export async function getPathForNodeId(nodeId) {
  if (!nodeId) return '/';
  const node = await getWorkspaceNodeById(nodeId);
  if (!node) throw new WorkspaceServiceError('NOT_FOUND', 'Workspace node was not found.');
  return canonicalPathForNode(node);
}
