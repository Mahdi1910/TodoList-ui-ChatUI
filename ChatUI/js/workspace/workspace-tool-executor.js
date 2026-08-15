/**
 * workspace-tool-executor.js - Permission-checked bridge from Gemini function calls to Workspace service methods.
 */

import { state } from '../state/store.js';
import { WORKSPACE_FUNCTION_NAMES } from './workspace-tool-definitions.js';
import {
  createDirectory,
  deleteDirectory,
  deleteFile,
  editBlock,
  getFileInfo,
  listDirectory,
  move,
  readFile,
  readMultipleFiles,
  searchWorkspace,
  toWorkspaceToolError,
  writeFile
} from './workspace-service.js';

function disabledResult() {
  return {
    ok: false,
    error: {
      code: 'WORKSPACE_DISABLED',
      message: 'Workspace access was disabled before this operation could run.'
    }
  };
}

export function isWorkspaceToolName(name) {
  return WORKSPACE_FUNCTION_NAMES.has(name);
}

export async function executeWorkspaceToolCall(functionCall, context = {}) {
  if (!state.tools?.workspace) return disabledResult();
  const name = functionCall?.name;
  if (!isWorkspaceToolName(name)) {
    return { ok: false, error: { code: 'INTERNAL_WORKSPACE_ERROR', message: 'Unsupported Workspace function call.' } };
  }
  const args = functionCall?.args && typeof functionCall.args === 'object' ? functionCall.args : {};
  const signal = context.signal;

  try {
    switch (name) {
      case 'workspace_list_directory':
        return await listDirectory(args.path, args.depth, { signal });
      case 'workspace_read_file':
        return await readFile(args.path, args.offset, args.length, { signal });
      case 'workspace_read_multiple_files':
        return await readMultipleFiles(args.paths, { signal });
      case 'workspace_write_file':
        return await writeFile(args.path, args.content, args.mode);
      case 'workspace_edit_block':
        return await editBlock(args.path, args.old_string, args.new_string, args.expected_replacements);
      case 'workspace_create_directory':
        return await createDirectory(args.path);
      case 'workspace_move':
        return await move(args.source, args.destination);
      case 'workspace_delete_file':
        return await deleteFile(args.path);
      case 'workspace_delete_directory':
        return await deleteDirectory(args.path, args.recursive === true, { signal });
      case 'workspace_get_file_info':
        return await getFileInfo(args.path);
      case 'workspace_search':
        return await searchWorkspace(args.path, args.query, args.search_type || 'both', args.max_results, { signal });
      default:
        return { ok: false, error: { code: 'INTERNAL_WORKSPACE_ERROR', message: 'Unsupported Workspace function call.' } };
    }
  } catch (error) {
    if (error?.name === 'AbortError') throw error;
    return toWorkspaceToolError(error);
  }
}
