/**
 * workspace-backup.js - Human-readable Workspace-only ZIP backup and restore.
 */

import { createEntityId } from '../state/store.js';
import { waitForCoreWrites } from '../storage/write-coordinator.js';
import {
  WORKSPACE_MAX_FILE_BYTES,
  countWorkspaceLines,
  normalizeNameKey,
  parseWorkspacePath,
  utf8ByteLength,
  validateWorkspaceNodeName
} from './workspace-paths.js';
import {
  getAllWorkspaceFiles,
  getAllWorkspaceNodes,
  replaceWorkspaceSnapshot
} from './workspace-storage.js';
import { createStoredZip, readStoredZip } from './workspace-zip.js';

export const WORKSPACE_BACKUP_FORMAT = 'chatui-workspace-backup';
export const WORKSPACE_BACKUP_VERSION = 1;
export const WORKSPACE_BACKUP_MAX_ENTRIES = 10000;
export const WORKSPACE_BACKUP_MAX_BYTES = 100 * 1024 * 1024;

const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
const ROOT_PARENT_KEY = '__workspace_root__';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function canonicalSnapshot(nodes, files) {
  const nodeMap = new Map();
  const siblingKeys = new Set();
  for (const node of nodes) {
    assert(node?.id && !nodeMap.has(node.id), 'Workspace hierarchy contains a missing or duplicate node ID.');
    assert(node.type === 'directory' || node.type === 'file', 'Workspace hierarchy contains an unsupported node type.');
    validateWorkspaceNodeName(node.name, node.type);
    const siblingKey = `${node.parentId || ROOT_PARENT_KEY}:${normalizeNameKey(node.name)}`;
    assert(!siblingKeys.has(siblingKey), 'Workspace hierarchy contains duplicate sibling names.');
    siblingKeys.add(siblingKey);
    nodeMap.set(node.id, node);
  }

  const pathCache = new Map();
  const visiting = new Set();
  const pathFor = node => {
    if (pathCache.has(node.id)) return pathCache.get(node.id);
    assert(!visiting.has(node.id), 'Workspace hierarchy contains a parent cycle.');
    visiting.add(node.id);
    let parentPath = '';
    if (node.parentId) {
      const parent = nodeMap.get(node.parentId);
      assert(parent && parent.type === 'directory', 'Workspace hierarchy contains a missing or non-directory parent.');
      parentPath = pathFor(parent);
    }
    const path = `${parentPath}/${node.name}`;
    parseWorkspacePath(path, { allowRoot: false, requireMarkdown: node.type === 'file' });
    visiting.delete(node.id);
    pathCache.set(node.id, path);
    return path;
  };

  const fileMap = new Map();
  for (const file of files) {
    assert(file?.nodeId && !fileMap.has(file.nodeId), 'Workspace file storage contains a duplicate content record.');
    fileMap.set(file.nodeId, file);
  }

  const directories = [];
  const fileEntries = [];
  for (const node of nodes) {
    const path = pathFor(node).slice(1);
    if (node.type === 'directory') {
      assert(!fileMap.has(node.id), 'Workspace directory unexpectedly has a file-content record.');
      directories.push(path);
      continue;
    }
    const file = fileMap.get(node.id);
    assert(file, `Workspace file content is missing for ${path}.`);
    const content = String(file.content || '');
    assert(utf8ByteLength(content) <= WORKSPACE_MAX_FILE_BYTES, `Workspace file exceeds the ${WORKSPACE_MAX_FILE_BYTES}-byte limit: ${path}`);
    fileEntries.push({ path, content });
    fileMap.delete(node.id);
  }
  assert(fileMap.size === 0, 'Workspace file storage contains orphan content records.');

  directories.sort((a, b) => a.localeCompare(b));
  fileEntries.sort((a, b) => a.path.localeCompare(b.path));
  return { directories, files: fileEntries };
}

export async function buildWorkspaceBackup() {
  await waitForCoreWrites();
  const [nodes, files] = await Promise.all([getAllWorkspaceNodes(), getAllWorkspaceFiles()]);
  const snapshot = canonicalSnapshot(nodes, files);
  const manifest = {
    format: WORKSPACE_BACKUP_FORMAT,
    formatVersion: WORKSPACE_BACKUP_VERSION,
    createdAt: Date.now(),
    directories: snapshot.directories,
    files: snapshot.files.map(file => file.path)
  };

  const entries = [
    { name: 'workspace-manifest.json', data: JSON.stringify(manifest, null, 2) },
    ...snapshot.directories.map(path => ({ name: `${path}/`, directory: true })),
    ...snapshot.files.map(file => ({ name: file.path, data: file.content }))
  ];
  assert(entries.length <= WORKSPACE_BACKUP_MAX_ENTRIES, `Workspace backup exceeds ${WORKSPACE_BACKUP_MAX_ENTRIES} ZIP entries.`);
  const bytes = createStoredZip(entries);
  return {
    bytes,
    manifest,
    nodeCount: nodes.length,
    fileCount: snapshot.files.length,
    sizeBytes: bytes.byteLength
  };
}

function validateRelativeArchivePath(rawPath, { directory = false, file = false } = {}) {
  const raw = String(rawPath || '');
  assert(raw && !raw.startsWith('/') && !raw.startsWith('\\'), 'Workspace backup paths must be relative.');
  assert(!raw.includes('\\') && !raw.includes('//'), 'Workspace backup paths must use safe / separators.');
  const trimmed = directory && raw.endsWith('/') ? raw.slice(0, -1) : raw;
  assert(trimmed && !trimmed.endsWith('/'), 'Workspace backup contains an invalid directory path.');
  const parsed = parseWorkspacePath(`/${trimmed}`, { allowRoot: false, requireMarkdown: file });
  if (directory) parsed.segments.forEach(segment => validateWorkspaceNodeName(segment, 'directory'));
  return { relativePath: trimmed, parsed };
}

function parseManifest(entry) {
  let text;
  try { text = decoder.decode(entry.data); }
  catch (_) { throw new Error('workspace-manifest.json is not valid UTF-8.'); }
  let manifest;
  try { manifest = JSON.parse(text); }
  catch (_) { throw new Error('workspace-manifest.json is not valid JSON.'); }
  assert(manifest?.format === WORKSPACE_BACKUP_FORMAT, 'This ZIP is not a ChatUI Workspace backup.');
  assert(manifest?.formatVersion === WORKSPACE_BACKUP_VERSION, `Unsupported Workspace backup version: ${manifest?.formatVersion}`);
  assert(Array.isArray(manifest.directories) && Array.isArray(manifest.files), 'Workspace backup manifest is missing directories/files arrays.');
  return manifest;
}

function validateArchive(bytes) {
  const zip = readStoredZip(bytes, {
    maxEntries: WORKSPACE_BACKUP_MAX_ENTRIES,
    maxTotalBytes: WORKSPACE_BACKUP_MAX_BYTES
  });
  const manifests = zip.entries.filter(entry => entry.name === 'workspace-manifest.json' && !entry.directory);
  assert(manifests.length === 1, 'Workspace backup must contain exactly one workspace-manifest.json.');
  const manifest = parseManifest(manifests[0]);

  const declaredDirectories = new Set();
  const declaredFiles = new Set();
  for (const path of manifest.directories) {
    const validated = validateRelativeArchivePath(path, { directory: true });
    assert(!declaredDirectories.has(validated.relativePath), 'Workspace backup manifest contains a duplicate directory.');
    declaredDirectories.add(validated.relativePath);
  }
  for (const path of manifest.files) {
    const validated = validateRelativeArchivePath(path, { file: true });
    assert(!declaredFiles.has(validated.relativePath), 'Workspace backup manifest contains a duplicate file.');
    assert(!declaredDirectories.has(validated.relativePath), 'Workspace backup path is declared as both a file and directory.');
    declaredFiles.add(validated.relativePath);
  }

  const archiveDirectories = new Set();
  const archiveFiles = new Map();
  for (const entry of zip.entries) {
    if (entry.name === 'workspace-manifest.json') continue;
    if (entry.directory) {
      const validated = validateRelativeArchivePath(entry.name, { directory: true });
      assert(!archiveDirectories.has(validated.relativePath), 'Workspace ZIP contains a duplicate directory entry.');
      archiveDirectories.add(validated.relativePath);
      continue;
    }
    const validated = validateRelativeArchivePath(entry.name, { file: true });
    assert(!archiveFiles.has(validated.relativePath), 'Workspace ZIP contains a duplicate file entry.');
    assert(entry.data.byteLength <= WORKSPACE_MAX_FILE_BYTES, `Workspace Markdown file exceeds ${WORKSPACE_MAX_FILE_BYTES} bytes: ${validated.relativePath}`);
    let content;
    try { content = decoder.decode(entry.data); }
    catch (_) { throw new Error(`Workspace Markdown file is not valid UTF-8: ${validated.relativePath}`); }
    archiveFiles.set(validated.relativePath, content);
  }

  assert(archiveDirectories.size === declaredDirectories.size, 'Workspace ZIP directories do not match the manifest.');
  assert(archiveFiles.size === declaredFiles.size, 'Workspace ZIP files do not match the manifest.');
  declaredDirectories.forEach(path => assert(archiveDirectories.has(path), `Workspace ZIP is missing declared directory: ${path}`));
  declaredFiles.forEach(path => assert(archiveFiles.has(path), `Workspace ZIP is missing declared file: ${path}`));

  const allPaths = new Set([...declaredDirectories, ...declaredFiles]);
  for (const path of allPaths) {
    const segments = path.split('/');
    for (let index = 1; index < segments.length; index += 1) {
      const parent = segments.slice(0, index).join('/');
      assert(declaredDirectories.has(parent), `Workspace backup is missing parent directory: ${parent}`);
    }
  }

  const siblingKeys = new Set();
  const registerSibling = (path, type) => {
    const segments = path.split('/');
    const name = segments.at(-1);
    validateWorkspaceNodeName(name, type);
    const parent = segments.slice(0, -1).join('/');
    const key = `${parent}:${normalizeNameKey(name)}`;
    assert(!siblingKeys.has(key), `Workspace backup contains conflicting sibling names in /${parent}.`);
    siblingKeys.add(key);
  };
  declaredDirectories.forEach(path => registerSibling(path, 'directory'));
  declaredFiles.forEach(path => registerSibling(path, 'file'));

  return { manifest, directories: [...declaredDirectories], files: archiveFiles };
}

function buildRestoredRecords(validated) {
  const now = Date.now();
  const idByPath = new Map();
  const nodes = [];
  const files = [];
  const directories = [...validated.directories].sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b));
  const filePaths = [...validated.files.keys()].sort((a, b) => a.localeCompare(b));

  const createNode = (relativePath, type, content = '') => {
    const segments = relativePath.split('/');
    const name = segments.at(-1);
    const parentPath = segments.slice(0, -1).join('/');
    const parentId = parentPath ? idByPath.get(parentPath) : null;
    assert(!parentPath || parentId, `Workspace restore could not resolve parent directory: ${parentPath}`);
    const id = createEntityId('ws_node');
    const node = {
      id,
      parentId,
      parentKey: parentId || ROOT_PARENT_KEY,
      type,
      name,
      nameKey: normalizeNameKey(name),
      sizeBytes: type === 'file' ? utf8ByteLength(content) : 0,
      lineCount: type === 'file' ? countWorkspaceLines(content) : 0,
      revision: 1,
      createdAt: now,
      updatedAt: now
    };
    nodes.push(node);
    idByPath.set(relativePath, id);
    if (type === 'file') files.push({ nodeId: id, content, revision: 1, updatedAt: now });
  };

  directories.forEach(path => createNode(path, 'directory'));
  filePaths.forEach(path => createNode(path, 'file', validated.files.get(path)));
  return { nodes, files };
}

export async function restoreWorkspaceBackup(input) {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(await input.arrayBuffer());
  const validated = validateArchive(bytes);
  const records = buildRestoredRecords(validated);
  await replaceWorkspaceSnapshot(records.nodes, records.files);
  if (typeof window !== 'undefined' && typeof CustomEvent !== 'undefined') {
    window.dispatchEvent(new CustomEvent('workspace:changed', {
      detail: { operation: 'restore', nodeId: null, path: '/', restoredNodeCount: records.nodes.length }
    }));
  }
  return {
    nodeCount: records.nodes.length,
    fileCount: records.files.length,
    createdAt: validated.manifest.createdAt || null
  };
}

export function workspaceBackupFilename(date = new Date()) {
  const pad = value => String(value).padStart(2, '0');
  return `Workspace-Backup-${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}.zip`;
}