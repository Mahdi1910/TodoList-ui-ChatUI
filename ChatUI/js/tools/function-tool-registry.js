/**
 * function-tool-registry.js - Generic boundary for client-executed Gemini custom functions.
 */

import { WORKSPACE_FUNCTION_DECLARATIONS } from '../workspace/workspace-tool-definitions.js';
import { executeWorkspaceToolCall, isWorkspaceToolName } from '../workspace/workspace-tool-executor.js';

export function getCustomFunctionDeclarations(activeTools = {}) {
  const declarations = [];
  if (activeTools.workspace) declarations.push(...WORKSPACE_FUNCTION_DECLARATIONS);
  return declarations;
}

export function isCustomFunctionCallSupported(name) {
  return isWorkspaceToolName(name);
}

export async function executeCustomFunctionCall(functionCall, context = {}) {
  if (isWorkspaceToolName(functionCall?.name)) {
    return executeWorkspaceToolCall(functionCall, context);
  }
  return {
    ok: false,
    error: {
      code: 'INTERNAL_WORKSPACE_ERROR',
      message: `Unsupported client function: ${String(functionCall?.name || 'unknown')}`
    }
  };
}
