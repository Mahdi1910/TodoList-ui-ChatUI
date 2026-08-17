/**
 * workspace-storage.js - Low-level IndexedDB primitives for Workspace metadata and Markdown content.
 */

import { openDatabase, getRequestPromise, waitForTransaction } from '../storage/database.js';

export const WORKSPACE_NODE_STORE = 'workspaceNodes';
export const WORKSPACE_FILE_STORE = 'workspaceFiles';

export async function getWorkspaceNodeById(nodeId) {
  if (!nodeId) return null;
  const db = await openDatabase();
  const tx = db.transaction(WORKSPACE_NODE_STORE, 'readonly');
  const done = waitForTransaction(tx);
  const result = await getRequestPromise(tx.objectStore(WORKSPACE_NODE_STORE).get(nodeId));
  await done;
  return result || null;
}

export async function getWorkspaceFileByNodeId(nodeId) {
  if (!nodeId) return null;
  const db = await openDatabase();
  const tx = db.transaction(WORKSPACE_FILE_STORE, 'readonly');
  const done = waitForTransaction(tx);
  const result = await getRequestPromise(tx.objectStore(WORKSPACE_FILE_STORE).get(nodeId));
  await done;
  return result || null;
}

export async function getAllWorkspaceNodes() {
  const db = await openDatabase();
  const tx = db.transaction(WORKSPACE_NODE_STORE, 'readonly');
  const done = waitForTransaction(tx);
  const result = await getRequestPromise(tx.objectStore(WORKSPACE_NODE_STORE).getAll());
  await done;
  return result || [];
}

export async function getAllWorkspaceFiles() {
  const db = await openDatabase();
  const tx = db.transaction(WORKSPACE_FILE_STORE, 'readonly');
  const done = waitForTransaction(tx);
  const result = await getRequestPromise(tx.objectStore(WORKSPACE_FILE_STORE).getAll());
  await done;
  return result || [];
}

export async function listWorkspaceChildren(parentId) {
  const db = await openDatabase();
  const tx = db.transaction(WORKSPACE_NODE_STORE, 'readonly');
  const done = waitForTransaction(tx);
  const store = tx.objectStore(WORKSPACE_NODE_STORE);
  const result = parentId == null
    ? (await getRequestPromise(store.getAll())).filter(node => node.parentId == null)
    : await getRequestPromise(store.index('parentId').getAll(parentId));
  await done;
  return result || [];
}

export async function findWorkspaceChild(parentId, nameKey) {
  const children = await listWorkspaceChildren(parentId);
  return children.find(node => node.nameKey === nameKey) || null;
}

export async function createWorkspaceDirectoryNode(node) {
  const db = await openDatabase();
  const tx = db.transaction(WORKSPACE_NODE_STORE, 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(WORKSPACE_NODE_STORE).add(node);
  await done;
  return node;
}

export async function createWorkspaceDirectoryNodes(nodes) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const db = await openDatabase();
  const tx = db.transaction(WORKSPACE_NODE_STORE, 'readwrite');
  const done = waitForTransaction(tx);
  const store = tx.objectStore(WORKSPACE_NODE_STORE);
  nodes.forEach(node => store.add(node));
  await done;
  return nodes;
}

export async function createWorkspaceFilePair(node, fileRecord) {
  const db = await openDatabase();
  const tx = db.transaction([WORKSPACE_NODE_STORE, WORKSPACE_FILE_STORE], 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(WORKSPACE_NODE_STORE).add(node);
  tx.objectStore(WORKSPACE_FILE_STORE).add(fileRecord);
  await done;
  return { node, fileRecord };
}

export async function updateWorkspaceFilePair(node, fileRecord) {
  const db = await openDatabase();
  const tx = db.transaction([WORKSPACE_NODE_STORE, WORKSPACE_FILE_STORE], 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(WORKSPACE_NODE_STORE).put(node);
  tx.objectStore(WORKSPACE_FILE_STORE).put(fileRecord);
  await done;
  return { node, fileRecord };
}

export async function updateWorkspaceNode(node) {
  const db = await openDatabase();
  const tx = db.transaction(WORKSPACE_NODE_STORE, 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(WORKSPACE_NODE_STORE).put(node);
  await done;
  return node;
}

export async function deleteWorkspaceFilePair(nodeId) {
  const db = await openDatabase();
  const tx = db.transaction([WORKSPACE_NODE_STORE, WORKSPACE_FILE_STORE], 'readwrite');
  const done = waitForTransaction(tx);
  tx.objectStore(WORKSPACE_NODE_STORE).delete(nodeId);
  tx.objectStore(WORKSPACE_FILE_STORE).delete(nodeId);
  await done;
}

export async function deleteWorkspaceSubtree(nodeIds, fileNodeIds) {
  const db = await openDatabase();
  const tx = db.transaction([WORKSPACE_NODE_STORE, WORKSPACE_FILE_STORE], 'readwrite');
  const done = waitForTransaction(tx);
  const nodeStore = tx.objectStore(WORKSPACE_NODE_STORE);
  const fileStore = tx.objectStore(WORKSPACE_FILE_STORE);
  nodeIds.forEach(nodeId => nodeStore.delete(nodeId));
  fileNodeIds.forEach(nodeId => fileStore.delete(nodeId));
  await done;
}

export async function replaceWorkspaceSnapshot(nodes, files) {
  if (!Array.isArray(nodes) || !Array.isArray(files)) throw new TypeError('Workspace replacement requires node and file arrays.');
  const db = await openDatabase();
  const tx = db.transaction([WORKSPACE_NODE_STORE, WORKSPACE_FILE_STORE], 'readwrite');
  const done = waitForTransaction(tx);
  const nodeStore = tx.objectStore(WORKSPACE_NODE_STORE);
  const fileStore = tx.objectStore(WORKSPACE_FILE_STORE);
  nodeStore.clear();
  fileStore.clear();
  nodes.forEach(node => nodeStore.add(node));
  files.forEach(file => fileStore.add(file));
  await done;
  return { nodeCount: nodes.length, fileCount: files.length };
}