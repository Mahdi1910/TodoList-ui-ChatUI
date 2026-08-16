/**
 * todo-tool-executor.js - Chat-side permission/replay/RPC wrapper for Todo functions.
 */
import { TODO_FUNCTION_NAMES } from './todo-tool-definitions.js';
import {
  createTodoRequestId,
  invokeTodoTool,
  isTodoBridgeSupported
} from './todo-bridge-client.js';
import { TodoMutationReplayGuard } from './todo-mutation-replay-guard.js';

let lateListenerInstalled = false;

function failure(code, message, details = {}) {
  return {
    ok: false,
    overview: { message, affectedCount: 0 },
    error: { code, message, details },
    meta: { mutationOccurred: false }
  };
}

function installLateResultListener() {
  if (lateListenerInstalled) return;
  lateListenerInstalled = true;
  window.addEventListener('todo-tool-late-result', event => {
    const requestId = String(event?.detail?.requestId || '');
    if (!requestId) return;
    TodoMutationReplayGuard.recordLateResult(requestId, event.detail.result);
  });
}

installLateResultListener();

export function isTodoToolName(name) {
  return TODO_FUNCTION_NAMES.has(String(name || ''));
}

export async function executeTodoToolCall(functionCall, context = {}) {
  const name = String(functionCall?.name || '');
  if (!isTodoToolName(name)) return failure('INVALID_ARGUMENT', `Unsupported Todo function: ${name || 'unknown'}`);
  if (!context.activeTools?.todo) {
    return failure('TODO_TOOL_DISABLED', 'The To-Do tool is not enabled for this assistant generation.');
  }
  if (!context.providerCapabilities?.todo || !isTodoBridgeSupported()) {
    return failure('TODO_UNAVAILABLE', 'The combined-app Todo bridge is unavailable.');
  }

  const args = functionCall?.args && typeof functionCall.args === 'object' ? functionCall.args : {};
  const mutation = TodoMutationReplayGuard.isMutationTool(name);
  let replay = null;
  if (mutation) {
    replay = TodoMutationReplayGuard.beforeMutation({
      functionName: name,
      args,
      userTurnId: context.userTurnId || '',
      generationMode: context.generationMode || 'normal'
    });
    if (!replay.execute) return replay.result;
  }

  const requestId = createTodoRequestId();
  if (mutation) {
    TodoMutationReplayGuard.markPending({
      fingerprint: replay.fingerprint,
      requestId,
      userTurnId: context.userTurnId || '',
      generationMode: context.generationMode || 'normal',
      generationAttemptId: context.generationAttemptId || ''
    });
  }

  try {
    const response = await invokeTodoTool({
      requestId,
      functionName: name,
      args,
      signal: context.signal || null
    });
    if (mutation) TodoMutationReplayGuard.recordResult(requestId, response.result);
    return response.result;
  } catch (error) {
    if (mutation) {
      const dispatched = Boolean(error?.todoDispatched || error?.details?.dispatched);
      if ((error?.name === 'AbortError' || error?.code === 'BRIDGE_TIMEOUT') && dispatched) {
        TodoMutationReplayGuard.markUnknown(requestId);
      } else {
        TodoMutationReplayGuard.markFailedNoMutation(requestId, failure(
          error?.code || (error?.name === 'AbortError' ? 'REQUEST_ABORTED' : 'TODO_UNAVAILABLE'),
          error?.message || 'Todo request failed before mutation.'
        ));
      }
    }

    if (error?.name === 'AbortError') throw error;
    return failure(error?.code || 'TODO_UNAVAILABLE', error?.message || 'Todo request failed.', error?.details || {});
  }
}
