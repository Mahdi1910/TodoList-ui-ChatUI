/**
 * workspace-ui.js - Lazy Workspace explorer, search, manual management, and app-mode switching.
 */

import { openActionMenu } from '../ui/action-menu.js';
import { escapeHtml } from '../utils/dom.js';
import { parseWorkspacePath } from './workspace-paths.js';
import {
  WorkspaceServiceError,
  createDirectory,
  deleteDirectory,
  deleteFile,
  getPathForNodeId,
  listDirectory,
  move,
  readFileForViewer,
  resolveWorkspacePath,
  searchWorkspace,
  writeFile
} from './workspace-service.js';
import { renderWorkspaceDocument } from './workspace-document.js';

const ROOT_CACHE_KEY = '__workspace_root__';
const SEARCH_DEBOUNCE_MS = 200;

const childrenCache = new Map();
const expandedDirectoryIds = new Set();
let workspaceOpenedOnce = false;
let selectedNode = { id: null, type: 'directory', path: '/' };
let searchTimer = null;
let documentRenderTimer = null;
let initialized = false;

function elements() {
  return {
    view: document.getElementById('workspace-view'),
    chatView: document.querySelector('.main-content'),
    navBtn: document.getElementById('workspace-nav-btn'),
    sidebar: document.getElementById('sidebar'),
    openSidebarBtn: document.getElementById('workspace-open-sidebar-btn'),
    tree: document.getElementById('workspace-tree'),
    breadcrumb: document.getElementById('workspace-breadcrumb'),
    searchInput: document.getElementById('workspace-search-input'),
    searchResults: document.getElementById('workspace-search-results'),
    selectionView: document.getElementById('workspace-selection-view'),
    emptyState: document.getElementById('workspace-empty-state'),
    folderView: document.getElementById('workspace-folder-view'),
    folderGrid: document.getElementById('workspace-folder-grid'),
    documentCanvas: document.getElementById('workspace-document-canvas'),
    documentActions: document.getElementById('workspace-document-actions'),
    newFolderBtn: document.getElementById('workspace-new-folder-btn'),
    newPageBtn: document.getElementById('workspace-new-page-btn'),
    refreshBtn: document.getElementById('workspace-refresh-btn')
  };
}

function initializeIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function showError(error, prefix = 'Workspace operation failed') {
  console.error(prefix, error);
  alert(`${prefix}: ${error?.message || 'Unknown error'}`);
}

function cacheKeyForNode(nodeId) {
  return nodeId || ROOT_CACHE_KEY;
}

async function loadDirectoryChildren(path, nodeId = null, { force = false } = {}) {
  const key = cacheKeyForNode(nodeId);
  if (!force && childrenCache.has(key)) return childrenCache.get(key);
  const result = await listDirectory(path, 1);
  childrenCache.set(key, result.entries || []);
  return result.entries || [];
}

function clearViews() {
  const { emptyState, folderView, documentCanvas } = elements();
  emptyState?.classList.add('hidden');
  folderView?.classList.add('hidden');
  documentCanvas?.classList.add('hidden');
}

function setBreadcrumb(path) {
  const { breadcrumb } = elements();
  if (breadcrumb) breadcrumb.textContent = path || '/';
}

function currentDirectoryPath() {
  if (selectedNode.type === 'directory') return selectedNode.path;
  try {
    return parseWorkspacePath(selectedNode.path, { allowRoot: false }).parentPath || '/';
  } catch (_) {
    return '/';
  }
}

async function revealPath(path) {
  const parsed = parseWorkspacePath(path, { allowRoot: true });
  if (parsed.path === '/') {
    await loadDirectoryChildren('/', null);
    renderTree();
    return;
  }

  await loadDirectoryChildren('/', null);
  let currentPath = '/';
  for (let index = 0; index < parsed.segments.length - 1; index += 1) {
    currentPath = currentPath === '/' ? `/${parsed.segments[index]}` : `${currentPath}/${parsed.segments[index]}`;
    const directory = await resolveWorkspacePath(currentPath, 'directory');
    expandedDirectoryIds.add(directory.id);
    await loadDirectoryChildren(directory.path, directory.id);
  }
  renderTree();
}

function treeRow(entry) {
  const row = document.createElement('div');
  const isDirectory = entry.type === 'directory';
  const expanded = isDirectory && expandedDirectoryIds.has(entry.id);
  const active = selectedNode.id === entry.id;
  row.className = `workspace-tree-row${active ? ' active' : ''}`;
  row.dataset.nodeId = entry.id;
  row.dataset.path = entry.path;
  row.dataset.type = entry.type;
  row.setAttribute('role', 'treeitem');
  row.setAttribute('tabindex', '0');
  if (isDirectory) row.setAttribute('aria-expanded', String(expanded));

  row.innerHTML = `
    <button type="button" class="workspace-tree-toggle${isDirectory ? '' : ' invisible'}" aria-label="${expanded ? 'Collapse' : 'Expand'} ${escapeHtml(entry.name)}">
      <i data-lucide="${expanded ? 'chevron-down' : 'chevron-right'}"></i>
    </button>
    <i data-lucide="${isDirectory ? (expanded ? 'folder-open' : 'folder') : 'file-text'}"></i>
    <span class="workspace-tree-name">${escapeHtml(entry.name)}</span>
    <button type="button" class="workspace-tree-more" title="Actions" aria-label="Actions for ${escapeHtml(entry.name)}">
      <i data-lucide="more-horizontal"></i>
    </button>
  `;

  const select = () => void selectEntry(entry);
  row.addEventListener('click', event => {
    if (event.target.closest('.workspace-tree-toggle, .workspace-tree-more')) return;
    select();
  });
  row.addEventListener('keydown', event => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      select();
    }
    if (!isDirectory) return;
    if (event.key === 'ArrowRight' && !expandedDirectoryIds.has(entry.id)) {
      event.preventDefault();
      void toggleDirectory(entry);
    }
    if (event.key === 'ArrowLeft' && expandedDirectoryIds.has(entry.id)) {
      event.preventDefault();
      expandedDirectoryIds.delete(entry.id);
      renderTree();
    }
  });

  row.querySelector('.workspace-tree-toggle')?.addEventListener('click', event => {
    event.stopPropagation();
    if (isDirectory) void toggleDirectory(entry);
  });
  row.querySelector('.workspace-tree-more')?.addEventListener('click', event => {
    event.stopPropagation();
    openWorkspaceNodeMenu(event.currentTarget, entry);
  });

  return row;
}

function appendTreeEntries(container, entries) {
  for (const entry of entries) {
    const row = treeRow(entry);
    container.appendChild(row);
    if (entry.type !== 'directory' || !expandedDirectoryIds.has(entry.id)) continue;
    const childWrap = document.createElement('div');
    childWrap.className = 'workspace-tree-children';
    childWrap.style.paddingLeft = '15px';
    const children = childrenCache.get(cacheKeyForNode(entry.id));
    if (children) appendTreeEntries(childWrap, children);
    else childWrap.innerHTML = '<div class="workspace-tree-placeholder">Loading…</div>';
    container.appendChild(childWrap);
  }
}

function renderTree() {
  const { tree } = elements();
  if (!tree) return;
  tree.replaceChildren();
  const rootChildren = childrenCache.get(ROOT_CACHE_KEY);
  if (!rootChildren) {
    tree.innerHTML = '<div class="workspace-tree-placeholder">Loading Workspace…</div>';
  } else if (rootChildren.length === 0) {
    tree.innerHTML = '<div class="workspace-tree-placeholder">Workspace is empty</div>';
  } else {
    appendTreeEntries(tree, rootChildren);
  }
  initializeIcons();
}

async function toggleDirectory(entry) {
  try {
    if (expandedDirectoryIds.has(entry.id)) {
      expandedDirectoryIds.delete(entry.id);
      renderTree();
      return;
    }
    expandedDirectoryIds.add(entry.id);
    renderTree();
    await loadDirectoryChildren(entry.path, entry.id);
    renderTree();
  } catch (error) {
    expandedDirectoryIds.delete(entry.id);
    renderTree();
    showError(error, 'Could not expand folder');
  }
}

function buildSelectionActionButtons(entry) {
  const { documentActions } = elements();
  if (!documentActions) return;
  documentActions.replaceChildren();
  if (!entry?.id) return;

  const actions = [
    { label: 'Rename', icon: 'pencil', action: () => renameEntry(entry) },
    { label: 'Move', icon: 'folder-input', action: () => moveEntry(entry) },
    { label: 'Delete', icon: 'trash-2', danger: true, action: () => deleteEntry(entry) }
  ];
  actions.forEach(item => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `workspace-doc-action-btn${item.danger ? ' danger' : ''}`;
    button.innerHTML = `<i data-lucide="${item.icon}"></i><span>${item.label}</span>`;
    button.addEventListener('click', () => void item.action());
    documentActions.appendChild(button);
  });
  initializeIcons();
}

async function showDirectory(entry) {
  const { emptyState, folderView, folderGrid } = elements();
  clearViews();
  setBreadcrumb(entry.path);
  buildSelectionActionButtons(entry.id ? entry : null);
  const children = await loadDirectoryChildren(entry.path, entry.id);
  if (!folderView || !folderGrid || !emptyState) return;

  folderGrid.replaceChildren();
  if (children.length === 0) {
    folderGrid.innerHTML = '<div class="workspace-folder-empty">This folder is empty.</div>';
  } else {
    for (const child of children) folderGrid.appendChild(folderCard(child));
  }
  folderView.classList.remove('hidden');
  initializeIcons();
}

function folderCard(entry) {
  const wrapper = document.createElement('div');
  wrapper.className = 'workspace-folder-card';
  wrapper.dataset.nodeId = entry.id;
  wrapper.innerHTML = `
    <i data-lucide="${entry.type === 'directory' ? 'folder' : 'file-text'}"></i>
    <button type="button" class="workspace-folder-card-main">
      <span class="workspace-folder-card-name">${escapeHtml(entry.name)}</span>
      <span class="workspace-folder-card-meta">${entry.type === 'directory' ? 'Folder' : `${entry.lineCount || 0} lines`}</span>
    </button>
    <button type="button" class="workspace-folder-card-more" title="Actions" aria-label="Actions for ${escapeHtml(entry.name)}">
      <i data-lucide="more-horizontal"></i>
    </button>
  `;
  wrapper.querySelector('.workspace-folder-card-main')?.addEventListener('click', () => void selectEntry(entry));
  wrapper.querySelector('.workspace-folder-card-more')?.addEventListener('click', event => {
    event.stopPropagation();
    openWorkspaceNodeMenu(event.currentTarget, entry);
  });
  return wrapper;
}

async function showFile(entry) {
  const { documentCanvas } = elements();
  clearViews();
  setBreadcrumb(entry.path);
  buildSelectionActionButtons(entry);
  if (!documentCanvas) return;
  documentCanvas.classList.remove('hidden');
  documentCanvas.innerHTML = '<div class="workspace-tree-placeholder">Loading page…</div>';
  const file = await readFileForViewer(entry.path);
  if (selectedNode.id !== file.id) return;
  renderWorkspaceDocument(file.content, documentCanvas);
}

async function selectEntry(entry) {
  try {
    selectedNode = { id: entry.id ?? null, type: entry.type, path: entry.path };
    renderTree();
    if (entry.type === 'directory') await showDirectory(selectedNode);
    else await showFile(selectedNode);
  } catch (error) {
    showError(error, 'Could not open Workspace item');
  }
}

function openWorkspaceNodeMenu(anchor, entry) {
  openActionMenu(anchor, [
    { label: 'Rename', icon: 'pencil', onSelect: () => renameEntry(entry) },
    { label: 'Move', icon: 'folder-input', onSelect: () => moveEntry(entry) },
    { label: entry.type === 'directory' ? 'Delete Folder' : 'Delete Page', icon: 'trash-2', danger: true, onSelect: () => deleteEntry(entry) }
  ]);
}

async function renameEntry(entry) {
  const nextNameRaw = prompt(`Rename ${entry.name} to:`, entry.name);
  if (nextNameRaw == null) return;
  let nextName = nextNameRaw.trim();
  if (!nextName || nextName === entry.name) return;
  if (entry.type === 'file' && !nextName.toLocaleLowerCase().endsWith('.md')) nextName += '.md';
  const parentPath = parseWorkspacePath(entry.path, { allowRoot: false }).parentPath || '/';
  const destination = parentPath === '/' ? `/${nextName}` : `${parentPath}/${nextName}`;
  await move(entry.path, destination);
}

async function moveEntry(entry) {
  const destinationRaw = prompt(`Move ${entry.path} to exact destination path:`, entry.path);
  if (destinationRaw == null) return;
  const destination = destinationRaw.trim();
  if (!destination || destination === entry.path) return;
  await move(entry.path, destination);
}

async function deleteEntry(entry) {
  if (!confirm(`Delete ${entry.path}?`)) return;
  if (entry.type === 'file') {
    await deleteFile(entry.path);
    return;
  }
  try {
    await deleteDirectory(entry.path, false);
  } catch (error) {
    if (!(error instanceof WorkspaceServiceError) || error.code !== 'DIRECTORY_NOT_EMPTY') throw error;
    if (!confirm(`${entry.path} is not empty. Delete this folder and everything inside it?`)) return;
    await deleteDirectory(entry.path, true);
  }
}

async function createFolderFromUi() {
  const nameRaw = prompt(`New folder inside ${currentDirectoryPath()}:`);
  if (nameRaw == null) return;
  const name = nameRaw.trim();
  if (!name) return;
  const parent = currentDirectoryPath();
  const path = parent === '/' ? `/${name}` : `${parent}/${name}`;
  try {
    const result = await createDirectory(path);
    await revealPath(result.path);
    await selectEntry({ id: result.id, type: 'directory', path: result.path, name });
  } catch (error) {
    showError(error, 'Could not create folder');
  }
}

async function createPageFromUi() {
  const nameRaw = prompt(`New Markdown page inside ${currentDirectoryPath()}:`);
  if (nameRaw == null) return;
  let name = nameRaw.trim();
  if (!name) return;
  if (!name.toLocaleLowerCase().endsWith('.md')) name += '.md';
  const parent = currentDirectoryPath();
  const path = parent === '/' ? `/${name}` : `${parent}/${name}`;
  try {
    const result = await writeFile(path, '', 'rewrite');
    await revealPath(result.path);
    await selectEntry({ id: result.id, type: 'file', path: result.path, name });
  } catch (error) {
    showError(error, 'Could not create page');
  }
}

async function refreshWorkspace({ keepSelection = true } = {}) {
  childrenCache.clear();
  try {
    await loadDirectoryChildren('/', null, { force: true });
    if (keepSelection && selectedNode.path !== '/') {
      try {
        const refreshed = await resolveWorkspacePath(selectedNode.path);
        selectedNode = { id: refreshed.id, type: refreshed.type, path: refreshed.path };
        await revealPath(refreshed.path);
        await selectEntry(selectedNode);
        return;
      } catch (_) {
        selectedNode = { id: null, type: 'directory', path: '/' };
      }
    }
    renderTree();
    await selectEntry({ id: null, type: 'directory', path: '/' });
  } catch (error) {
    showError(error, 'Could not refresh Workspace');
  }
}

function renderSearchResults(result) {
  const { searchResults, selectionView } = elements();
  if (!searchResults || !selectionView) return;
  searchResults.replaceChildren();
  const summary = document.createElement('div');
  summary.className = 'workspace-search-summary';
  summary.textContent = `${result.results.length} result${result.results.length === 1 ? '' : 's'}${result.truncated ? ' (limited)' : ''}`;
  searchResults.appendChild(summary);

  if (result.results.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'workspace-tree-placeholder';
    empty.textContent = 'No Workspace matches found.';
    searchResults.appendChild(empty);
  }

  for (const match of result.results) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-search-result';
    button.innerHTML = `
      <i data-lucide="${match.type === 'directory' ? 'folder' : 'file-text'}"></i>
      <span class="workspace-search-result-main">
        <span class="workspace-search-result-path">${escapeHtml(match.path)}</span>
        ${match.excerpt ? `<span class="workspace-search-result-excerpt">${escapeHtml(match.excerpt)}</span>` : ''}
        ${Number.isInteger(match.lineIndex) ? `<span class="workspace-search-result-line">Line index ${match.lineIndex}</span>` : ''}
      </span>
    `;
    button.addEventListener('click', async () => {
      const searchInput = elements().searchInput;
      if (searchInput) searchInput.value = '';
      hideSearchResults();
      try {
        const node = await resolveWorkspacePath(match.path);
        await revealPath(node.path);
        await selectEntry({ id: node.id, type: node.type, path: node.path, name: node.name });
      } catch (error) {
        showError(error, 'Could not open search result');
      }
    });
    searchResults.appendChild(button);
  }

  selectionView.classList.add('hidden');
  searchResults.classList.remove('hidden');
  initializeIcons();
}

function hideSearchResults() {
  const { searchResults, selectionView } = elements();
  searchResults?.classList.add('hidden');
  selectionView?.classList.remove('hidden');
}

async function runWorkspaceSearch(query) {
  const trimmed = String(query || '').trim();
  if (!trimmed) {
    hideSearchResults();
    return;
  }
  try {
    const result = await searchWorkspace('/', trimmed, 'both', 50);
    const currentQuery = elements().searchInput?.value.trim() || '';
    if (currentQuery !== trimmed) return;
    renderSearchResults(result);
  } catch (error) {
    showError(error, 'Workspace search failed');
  }
}

export async function openWorkspaceView() {
  const { view, chatView, navBtn, sidebar } = elements();
  if (!view || !chatView) return;
  chatView.classList.add('hidden');
  view.classList.remove('hidden');
  navBtn?.classList.add('active');
  navBtn?.setAttribute('aria-current', 'page');
  document.title = 'Workspace — ChatUI';

  if (window.matchMedia('(max-width: 767px)').matches) sidebar?.classList.add('collapsed');

  if (!workspaceOpenedOnce) {
    workspaceOpenedOnce = true;
    try {
      await loadDirectoryChildren('/', null);
      renderTree();
      await selectEntry({ id: null, type: 'directory', path: '/' });
    } catch (error) {
      showError(error, 'Workspace could not be opened');
    }
  }
}

export function closeWorkspaceView() {
  const { view, chatView, navBtn } = elements();
  view?.classList.add('hidden');
  chatView?.classList.remove('hidden');
  navBtn?.classList.remove('active');
  navBtn?.removeAttribute('aria-current');
}

async function handleWorkspaceChanged(event) {
  const detail = event?.detail || {};
  childrenCache.clear();

  if (detail.operation?.startsWith('delete') && detail.nodeId === selectedNode.id) {
    selectedNode = { id: null, type: 'directory', path: '/' };
  } else if (detail.operation === 'move' && detail.nodeId === selectedNode.id && detail.path) {
    selectedNode = { ...selectedNode, path: detail.path };
  }

  if (!workspaceOpenedOnce) return;
  try {
    await loadDirectoryChildren('/', null, { force: true });
    if (selectedNode.path !== '/') {
      try {
        const refreshedPath = selectedNode.id ? await getPathForNodeId(selectedNode.id) : selectedNode.path;
        const node = await resolveWorkspacePath(refreshedPath);
        selectedNode = { id: node.id, type: node.type, path: node.path };
        await revealPath(node.path);
        await selectEntry(selectedNode);
      } catch (_) {
        selectedNode = { id: null, type: 'directory', path: '/' };
        renderTree();
        await selectEntry(selectedNode);
      }
    } else {
      renderTree();
      await selectEntry(selectedNode);
    }

    const query = elements().searchInput?.value.trim();
    if (query) await runWorkspaceSearch(query);
  } catch (error) {
    console.error('Workspace change refresh failed:', error);
  }
}

function scheduleDocumentRepagination() {
  if (documentRenderTimer) window.clearTimeout(documentRenderTimer);
  documentRenderTimer = window.setTimeout(async () => {
    documentRenderTimer = null;
    const { view } = elements();
    if (view?.classList.contains('hidden') || selectedNode.type !== 'file') return;
    try { await showFile(selectedNode); }
    catch (error) { console.error('Workspace document repagination failed:', error); }
  }, 180);
}

export function initWorkspaceUI() {
  if (initialized) return;
  initialized = true;
  const { navBtn, sidebar, openSidebarBtn, searchInput, newFolderBtn, newPageBtn, refreshBtn } = elements();

  navBtn?.addEventListener('click', () => void openWorkspaceView());
  openSidebarBtn?.addEventListener('click', () => sidebar?.classList.remove('collapsed'));
  newFolderBtn?.addEventListener('click', () => void createFolderFromUi());
  newPageBtn?.addEventListener('click', () => void createPageFromUi());
  refreshBtn?.addEventListener('click', () => void refreshWorkspace());

  searchInput?.addEventListener('input', event => {
    if (searchTimer) window.clearTimeout(searchTimer);
    const query = event.target.value;
    searchTimer = window.setTimeout(() => {
      searchTimer = null;
      void runWorkspaceSearch(query);
    }, SEARCH_DEBOUNCE_MS);
  });

  window.addEventListener('workspace:changed', event => void handleWorkspaceChanged(event));
  window.addEventListener('chat:view-opened', closeWorkspaceView);
  window.addEventListener('workspace:theme-changed', scheduleDocumentRepagination);
  window.addEventListener('resize', scheduleDocumentRepagination);

  initializeIcons();
}
