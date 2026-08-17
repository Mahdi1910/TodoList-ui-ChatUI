import { isTodoMutationToolName } from './todo-tool-registry.js';

function busyResult() {
  return {
    ok: false,
    overview: {
      message: 'Todo is busy applying a manual multi-select change. Try the Todo action again after it finishes.',
      affectedCount: 0
    },
    error: {
      code: 'TODO_BUSY',
      message: 'Todo is busy applying a manual multi-select change.',
      details: { reason: 'MANUAL_SELECTION_BATCH' }
    },
    meta: { mutationOccurred: false }
  };
}

class TodoMutationCoordinatorImpl {
  constructor() {
    this.owner = null;
    this.aiCount = 0;
    this.manualWaiting = false;
    this.manualWaiters = [];
  }

  tryAcquireAi() {
    if (this.owner === 'manual' || this.manualWaiting) return null;
    this.owner = 'ai';
    this.aiCount += 1;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      this.aiCount = Math.max(0, this.aiCount - 1);
      if (this.aiCount === 0) {
        this.owner = null;
        const waiter = this.manualWaiters.shift();
        waiter?.();
      }
    };
  }

  async acquireManual() {
    if (this.owner === 'manual') {
      throw new Error('A manual Todo multi-select batch is already running.');
    }
    this.manualWaiting = true;
    if (this.owner === 'ai' && this.aiCount > 0) {
      await new Promise(resolve => this.manualWaiters.push(resolve));
    }
    this.owner = 'manual';
    this.manualWaiting = false;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (this.owner === 'manual') this.owner = null;
    };
  }

  isManualBusy() {
    return this.owner === 'manual' || this.manualWaiting;
  }
}

export const TodoMutationCoordinator = new TodoMutationCoordinatorImpl();

export function installTodoToolMutationCoordination(todoToolExecutor) {
  if (!todoToolExecutor || todoToolExecutor.__mutationCoordinatorInstalled) return;
  const originalExecuteRequest = todoToolExecutor.executeRequest.bind(todoToolExecutor);

  todoToolExecutor.executeRequest = function executeRequestWithCoordination(payload = {}) {
    if (!isTodoMutationToolName(payload.functionName)) {
      return originalExecuteRequest(payload);
    }

    const release = TodoMutationCoordinator.tryAcquireAi();
    if (!release) return Promise.resolve(busyResult());

    let result;
    try {
      result = originalExecuteRequest(payload);
    } catch (error) {
      release();
      throw error;
    }
    return Promise.resolve(result).finally(release);
  };

  todoToolExecutor.__mutationCoordinatorInstalled = true;
}
