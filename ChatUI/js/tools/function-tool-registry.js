/**
 * function-tool-registry.js - Generic boundary for client-executed Gemini custom functions.
 */
import { WORKSPACE_FUNCTION_DECLARATIONS } from '../workspace/workspace-tool-definitions.js';
import { executeWorkspaceToolCall, isWorkspaceToolName } from '../workspace/workspace-tool-executor.js';
import { TODO_FUNCTION_DECLARATIONS, TODO_FUNCTION_NAMES } from '../todo/todo-tool-definitions.js';
import { executeTodoToolCall } from '../todo/todo-tool-executor.js';
import { TodoMutationReplayGuard } from '../todo/todo-mutation-replay-guard.js';
import { isTodoBridgeSupported } from '../todo/todo-bridge-client.js';
import { getCustomToolGenerationContext } from './custom-tool-generation-context.js';

export function getCustomFunctionDeclarations(activeTools = {}) {
  const declarations = [];
  if (activeTools.workspace) declarations.push(...WORKSPACE_FUNCTION_DECLARATIONS);
  if (activeTools.todo && isTodoBridgeSupported()) {
    const hints = TodoMutationReplayGuard.getPendingConfirmationHints();
    declarations.push(...TODO_FUNCTION_DECLARATIONS.map(declaration => {
      const relevant = hints.filter(hint => hint.functionName === declaration.name);
      if (!relevant.length) return declaration;
      const note = relevant.map(hint => `Pending duplicate confirmation token: ${hint.token}. Use it only if the current user explicitly confirms repeating the previously blocked exact mutation.`).join(' ');
      return { ...declaration, description: `${declaration.description} ${note}` };
    }));
  }
  return declarations;
}

export function isCustomFunctionCallSupported(name) {
  return isWorkspaceToolName(name) || TODO_FUNCTION_NAMES.has(String(name || ''));
}

export async function executeCustomFunctionCall(functionCall, context = {}) {
  if (isWorkspaceToolName(functionCall?.name)) return executeWorkspaceToolCall(functionCall, context);
  if (TODO_FUNCTION_NAMES.has(String(functionCall?.name || ''))) {
    const generationContext = getCustomToolGenerationContext();
    return executeTodoToolCall(functionCall, {
      ...generationContext,
      ...context,
      userTurnId: context.userTurnId || generationContext.userTurnId,
      generationMode: context.generationMode || generationContext.generationMode,
      generationAttemptId: context.generationAttemptId || generationContext.generationAttemptId || String(functionCall?.id || ''),
      providerCapabilities: { ...(context.providerCapabilities || {}), todo: isTodoBridgeSupported() }
    });
  }
  return {
    ok: false,
    error: { code: 'INTERNAL_TOOL_ERROR', message: `Unsupported client function: ${String(functionCall?.name || 'unknown')}` }
  };
}
