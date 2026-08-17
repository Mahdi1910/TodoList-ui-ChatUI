/**
 * workspace-ui.js - Lazy Workspace explorer, search, routing, and manual management.
 */

import { openActionMenu } from '../ui/action-menu.js';
import { escapeHtml } from '../utils/dom.js';
import { buildWorkspaceHref, isUnmodifiedPrimaryNavigation } from '../router/app-links.js';
import { pushWorkspaceRoute, replaceWorkspaceRoute } from '../router/chat-router.js';
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

function writeWorkspaceRoute(path, historyMode = 'push') {
  if (historyMode === 'replace') replaceWorkspaceRoute(path);
  else if (historyMode === 'push') pushWorkspaceRoute(path);
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
  if (!breadcrumb) return;
  breadcrumb.replaceChildren();

  const root = document.createElement('a');
  root.className = 'workspace-breadcrumb-link';
  root.href = buildWorkspaceHref('/');
  root.textContent = 'Workspace';
  root.addEventListener('click', event => {
    if (!isUnmodifiedPrimaryNavigation(event)) return;
    event.preventDefault();
    void openWorkspacePath('/', { historyMode: 'push' });
  });
  breadcrumb.appendChild(root);

  let parsed;
  try { parsed = parseWorkspacePath(path || '/', { allowRoot: true }); }
  catch (_) { return; }
  let current = '';
  parsed.segments.forEach(segment => {
    current += `/${segment}`;
    const separator = document.createElement('span');
    separator.className = 'workspace-breadcrumb-separator';
    separator.textContent = ' / ';
    breadcrumb.appendChild(separator);

    const link = document.createElement('a');
    link.className = 'workspace-breadcrumb-link';
    link.href = buildWorkspaceHref(current);
    link.textContent = segment;
    const targetPath = current;
    link.addEventListener('click', event => {
      if (!isUnmodifiedPrimaryNavigation(event)) return;
      event.preventDefault();
      void openWorkspacePath(targetPath, { historyMode: 'push' });
    });
    breadcrumb.appendChild(link);
  });
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
  if (isDirectory) row.setAttribute('aria-expanded', String(expanded));

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = `workspace-tree-toggle${isDirectory ? '' : ' invisible'}`;
  toggle.setAttribute('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${entry.name}`);
  toggle.innerHTML = `<i data-lucide="${expanded ? 'chevron-down' : 'chevron-right'}"></i>`;
  toggle.addEventListener('click', event => {
    event.stopPropagation();
    if (isDirectory) void toggleDirectory(entry);
  });

  const link = document.createElement('a');
  link.className = 'workspace-tree-link';
  link.href = buildWorkspaceHref(entry.path);
  link.innerHTML = `<i data-lucide="${isDirectory ? (expanded ? 'folder-open' : 'folder') : 'file-text'}"></i><span class="workspace-tree-name">${escapeHtml(entry.name)}</span>`;
  link.addEventListener('click', event => {
    if (!isUnmodifiedPrimaryNavigation(event)) return;
    event.preventDefault();
    void selectEntry(entry, { historyMode: 'push' });
  });
  link.addEventListener('keydown', event => {
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

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'workspace-tree-more';
  more.title = 'Actions';
  more.setAttribute('aria-label', `Actions for ${entry.name}`);
  more.innerHTML = '<i data-lucide="more-horizontal"></i>';
  more.addEventListener('click', event => {
    event.stopPropagation();
    openWorkspaceNodeMenu(event.currentTarget, entry);
  });

  row.append(toggle, link, more);
  return row;
}

function appendTreeEntries(container, entries) {
  for (const entry of entries) {
    const row = treeRow(entry);
    container.appendChild(row);
    if (entry.type !== 'directory' || !expandedDirectoryIds.has(entry.id)) continue;
    const childWrap = document.createElement('div');
    childWrap.className = 'workspace-tree-children';
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
  if (!rootChildren) tree.innerHTML = '<div class="workspace-tree-placeholder">Loading Workspace…</div>';
  else if (rootChildren.length === 0) tree.innerHTML = '<div class="workspace-tree-placeholder">Workspace is empty</div>';
  else appendTreeEntries(tree, rootChildren);
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
  if (children.length === 0) folderGrid.innerHTML = '<div class="workspace-folder-empty">This folder is empty.</div>';
  else for (const child of children) folderGrid.appendChild(folderCard(child));
  folderView.classList.remove('hidden');
  initializeIcons();
}

function folderCard(entry) {
  const wrapper = document.createElement('div');
  wrapper.className = 'workspace-folder-card';
  wrapper.dataset.nodeId = entry.id;

  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', entry.type === 'directory' ? 'folder' : 'file-text');

  const link = document.createElement('a');
  link.className = 'workspace-folder-card-main';
  link.href = buildWorkspaceHref(entry.path);
  link.innerHTML = `<span class="workspace-folder-card-name">${escapeHtml(entry.name)}</span><span class="workspace-folder-card-meta">${entry.type === 'directory' ? 'Folder' : `${entry.lineCount || 0} lines`}</span>`;
  link.addEventListener('click', event => {
    if (!isUnmodifiedPrimaryNavigation(event)) return;
    event.preventDefault();
    void selectEntry(entry, { historyMode: 'push' });
  });

  const more = document.createElement('button');
  more.type = 'button';
  more.className = 'workspace-folder-card-more';
  more.title = 'Actions';
  more.setAttribute('aria-label', `Actions for ${entry.name}`);
  more.innerHTML = '<i data-lucide="more-horizontal"></i>';
  more.addEventListener('click', event => {
    event.stopPropagation();
    openWorkspaceNodeMenu(event.currentTarget, entry);
  });

  wrapper.append(icon, link, more);
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

async function selectEntry(entry, { historyMode = 'push' } = {}) {
  selectedNode = { id: entry.id ?? null, type: entry.type, path: entry.path };
  renderTree();
  if (entry.type === 'directory') await showDirectory(selectedNode);
  else await showFile(selectedNode);
  writeWorkspaceRoute(selectedNode.path, historyMode);
}

function showWorkspaceNotFound(requestedPath = '') {
  const { emptyState, selectionView, searchResults } = elements();
  searchResults?.classList.add('hidden');
  selectionView?.classList.remove('hidden');
  clearViews();
  if (!emptyState) return;
  emptyState.replaceChildren();
  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', 'file-question');
  const title = document.createElement('h2');
  title.textContent = 'Workspace item not found';
  const description = document.createElement('p');
  description.textContent = requestedPath ? `“${requestedPath}” does not exist in this Workspace.` : 'This Workspace URL is not valid.';
  const rootLink = document.createElement('a');
  rootLink.className = 'workspace-not-found-link';
  rootLink.href = buildWorkspaceHref('/');
  rootLink.textContent = 'Open Workspace root';
  rootLink.addEventListener('click', event => {
    if (!isUnmodifiedPrimaryNavigation(event)) return;
    event.preventDefault();
    void openWorkspacePath('/', { historyMode: 'replace' });
  });
  emptyState.append(icon, title, description, rootLink);
  emptyState.classList.remove('hidden');
  setBreadcrumb('/');
  initializeIcons();
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
  try { await move(entry.path, destination); }
  catch (error) { showError(error, 'Could not rename Workspace item'); }
}

async function moveEntry(entry) {
  const destinationRaw = prompt(`Move ${entry.path} to exact destination path:`, entry.path);
  if (destinationRaw == null) return;
  const destination = destinationRaw.trim();
  if (!destination || destination === entry.path) return;
  try { await move(entry.path, destination); }
  catch (error) { showError(error, 'Could not move Workspace item'); }
}

async function deleteEntry(entry) {
  if (!confirm(`Delete ${entry.path}?`)) return;
  try {
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
  } catch (error) {
    showError(error, 'Could not delete Workspace item');
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
    await selectEntry({ id: result.id, type: 'directory', path: result.path, name }, { historyMode: 'push' });
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
    await selectEntry({ id: result.id, type: 'file', path: result.path, name }, { historyMode: 'push' });
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
        await selectEntry(selectedNode, { historyMode: 'replace' });
        return;
      } catch (_) {
        selectedNode = { id: null, type: 'directory', path: '/' };
      }
    }
    renderTree();
    await selectEntry({ id: null, type: 'directory', path: '/' }, { historyMode: 'replace' });
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
    const link = document.createElement('a');
    link.className = 'workspace-search-result';
    link.href = buildWorkspaceHref(match.path);
    link.innerHTML = `
      <i data-lucide="${match.type === 'directory' ? 'folder' : 'file-text'}"></i>
      <span class="workspace-search-result-main">
        <span class="workspace-search-result-path">${escapeHtml(match.path)}</span>
        ${match.excerpt ? `<span class="workspace-search-result-excerpt">${escapeHtml(match.excerpt)}</span>` : ''}
        ${Number.isInteger(match.lineIndex) ? `<span class="workspace-search-result-line">Line index ${match.lineIndex}</span>` : ''}
      </span>`;
    link.addEventListener('click', async event => {
      if (!isUnmodifiedPrimaryNavigation(event)) return;
      event.preventDefault();
      const searchInput = elements().searchInput;
      if (searchInput) searchInput.value = '';
      hideSearchResults();
      await openWorkspacePath(match.path, { historyMode: 'push' });
    });
    searchResults.appendChild(link);
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

function activateWorkspaceSurface() {
  const { view, chatView, navBtn, sidebar } = elements();
  if (!view || !chatView) return false;
  chatView.classList.add('hidden');
  view.classList.remove('hidden');
  navBtn?.classList.add('active');
  navBtn?.setAttribute('aria-current', 'page');
  document.title = 'Workspace — ChatUI';
  if (window.matchMedia('(max-width: 767px)').matches) sidebar?.classList.add('collapsed');
  return true;
}

export async function openWorkspacePath(workspacePath = '/', { historyMode = 'none', invalid = false } = {}) {
  if (!activateWorkspaceSurface()) return false;
  workspaceOpenedOnce = true;

  if (invalid || workspacePath == null) {
    showWorkspaceNotFound('');
    return false;
  }

  try {
    await loadDirectoryChildren('/', null);
    const parsed = parseWorkspacePath(workspacePath || '/', { allowRoot: true });
    if (parsed.path === '/') {
      renderTree();
      await selectEntry({ id: null, type: 'directory', path: '/' }, { historyMode });
      return true;
    }

    const node = await resolveWorkspacePath(parsed.path);
    await revealPath(node.path);
    await selectEntry({ id: node.id, type: node.type, path: node.path, name: node.name }, { historyMode });
    if (node.path !== parsed.path && historyMode !== 'none') replaceWorkspaceRoute(node.path);
    return true;
  } catch (error) {
    console.warn('Workspace route could not be resolved:', error);
    showWorkspaceNotFound(workspacePath);
    return false;
  }
}

export async function openWorkspaceView(options = {}) {
  return openWorkspacePath('/', { historyMode: options.historyMode || 'push' });
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
  const selectedWasMutated = detail.nodeId && detail.nodeId === selectedNode.id;

  if (detail.operation?.startsWith('delete') && selectedWasMutated) {
    selectedNode = { id: null, type: 'directory', path: '/' };
  } else if (detail.operation === 'move' && selectedWasMutated && detail.path) {
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
        await selectEntry(selectedNode, { historyMode: selectedWasMutated ? 'replace' : 'none' });
      } catch (_) {
        selectedNode = { id: null, type: 'directory', path: '/' };
        renderTree();
        await selectEntry(selectedNode, { historyMode: selectedWasMutated ? 'replace' : 'none' });
      }
    } else {
      renderTree();
      await selectEntry(selectedNode, { historyMode: selectedWasMutated ? 'replace' : 'none' });
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

  if (navBtn) navBtn.href = buildWorkspaceHref('/');
  navBtn?.addEventListener('click', event => {
    if (!isUnmodifiedPrimaryNavigation(event)) return;
    event.preventDefault();
    void openWorkspacePath('/', { historyMode: 'push' });
  });
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
