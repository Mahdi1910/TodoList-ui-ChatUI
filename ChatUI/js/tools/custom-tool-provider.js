/**
 * custom-tool-provider.js - One provider classifier for client-executed tools.
 */
export function getCustomToolProvider(name = '') {
  const value = String(name || '');
  if (value.startsWith('workspace_')) return 'workspace';
  if (value.startsWith('todo_')) return 'todo';
  return 'unknown';
}
