import { AppState } from '../state.js';
import { TaxonomyOrder } from '../taxonomy-order.js';
import { AppDataService } from '../storage/data-service.js';
import { RepeatEngine } from '../repeat/repeat-engine.js';
import { isTodoToolName } from './todo-tool-registry.js';
import {
  TodoToolValidationError,
  assertPlainObject,
  normalizeDeleteEnvelope,
  normalizeId,
  normalizeMutationEnvelope,
  normalizePosition,
  normalizeTaskCreateInput,
  normalizeTaskUpdateInput,
  normalizeTaxonomyCreateInput,
  normalizeTaxonomyUpdateInput,
  toolError
} from './todo-tool-normalizers.js';
import {
  currentViewTaskIds,
  listTaxonomy,
  makeTreeLines,
  selectTasks,
  serializeTaskFull
} from './todo-tool-read-selectors.js';
import { TodoToolUiGuard } from './todo-tool-ui-guard.js';
import { TodoToolUiSync } from './todo-tool-ui-sync.js';

const REQUEST_TTL_MS = 10 * 60 * 1000;
const MAX_SETTLED_REQUESTS = 200;

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stableValue(value[key])]))
}

function fingerprint(value) {
  return JSON.stringify(stableValue(value));
}

function toolDomain(name) {
  if (name.includes('project')) return 'project';
  if (name.includes('tag')) return 'tag';
  if (name.includes('workspace')) return 'workspace';
  return 'task';
}

function overview(message, affectedCount = 0, tree = '') {
  return { message, affectedCount, ...(tree ? { tree } : {}) };
}

function success(data, message, meta = {}, tree = '') {
  return { ok: true, overview: overview(message, meta.affectedCount ?? 0, tree), data, meta };
}

function failure(code, message, details = {}, data = undefined, meta = {}) {
  return {
    ok: false,
    overview: overview(message, meta.affectedCount ?? 0),
    error: { code, message, details },
    ...(data !== undefined ? { data } : {}),
    meta
  };
}

function taskListTree(tasks = [], max = 20) {
  const rows = tasks.slice(0, max);
  if (!rows.length) return '';
  const ids = new Set(rows.map(task => task.id));
  const byParent = new Map();
  for (const task of rows) {
    const parent = task.parentTaskId && ids.has(task.parentTaskId) ? task.parentTaskId : null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(task);
  }
  const output = [];
  const walk = (parentId, prefix) => {
    const children = byParent.get(parentId) || [];
    children.forEach((task, index) => {
      const last = index === children.length - 1;
      output.push(`${prefix}${last ? '└─' : '├─'} ${task.title} [${task.id}]`);
      walk(task.id, `${prefix}${last ? '   ' : '│  '}`);
    });
  };
  walk(null, '');
  return output.join('\n');
}

function taskTree(task) {
  if (!task) return '';
  const parent = task.parentTaskId ? AppState.getTask(task.parentTaskId) : null;
  if (parent) return `${parent.title} [${parent.id}]\n└─ ${task.title} [${task.id}]`;
  const children = AppState.getSubtasks(task.id);
  return [
    `${task.title} [${task.id}]`,
    ...children.slice(0, 12).map((child, index) => `${index === children.length - 1 ? '└─' : '├─'} ${child.title} [${child.id}]`)
  ].join('\n');
}

function cleanRegistry(registry) {
  const now = Date.now();
  for (const [id, entry] of registry) {
    if (entry.status === 'pending' || entry.status === 'queued') continue;
    if (now - (entry.settledAt || entry.createdAt || now) > REQUEST_TTL_MS) registry.delete(id);
  }
  const settled = [...registry.entries()]
    .filter(([, entry]) => !['pending', 'queued'].includes(entry.status))
    .sort((a, b) => (a[1].settledAt || 0) - (b[1].settledAt || 0));
  while (settled.length > MAX_SETTLED_REQUESTS) {
    const [id] = settled.shift();
    registry.delete(id);
  }
}

function entityOrError(type, id) {
  const entity = type === 'project' ? AppState.getProject(id) : AppState.getTag(id);
  if (!entity) throw new TodoToolValidationError(`${type === 'project' ? 'Project' : 'Tag'} not found.`, { id }, `${type.toUpperCase()}_NOT_FOUND`);
  return entity;
}

function taskOrError(id) {
  const task = AppState.getTask(id);
  if (!task) throw new TodoToolValidationError('Task not found.', { id }, 'TASK_NOT_FOUND');
  return task;
}

function validateProject(id) {
  if (!id) return null;
  return entityOrError('project', id);
}

function validateTags(ids = []) {
  ids.forEach(id => entityOrError('tag', id));
}

function positionRefsForTasks(taskId, parentTaskId, position) {
  if (!position) return { beforeTaskId: null, afterTaskId: null };
  const siblings = AppState.getSiblingTaskIds(parentTaskId).filter(id => id !== taskId);
  if (position.placement === 'top') return { beforeTaskId: siblings[0] || null, afterTaskId: null };
  if (position.placement === 'bottom') return { beforeTaskId: null, afterTaskId: siblings.at(-1) || null };
  const relative = taskOrError(position.relativeToId);
  if ((relative.parentTaskId || null) !== (parentTaskId || null) || relative.id === taskId) {
    throw new TodoToolValidationError('Position target is not in the legal task sibling scope.', {
      taskId, relativeToId: relative.id, parentTaskId: parentTaskId || null
    }, 'POSITION_CONFLICT');
  }
  return position.placement === 'before'
    ? { beforeTaskId: relative.id, afterTaskId: null }
    : { beforeTaskId: null, afterTaskId: relative.id };
}

function positionRefsForTaxonomy(type, entityId, parentId, position) {
  if (!position) return { beforeEntityId: null, afterEntityId: null };
  const siblings = TaxonomyOrder.getSiblingIds(type, parentId).filter(id => id !== entityId);
  if (position.placement === 'top') return { beforeEntityId: siblings[0] || null, afterEntityId: null };
  if (position.placement === 'bottom') return { beforeEntityId: null, afterEntityId: siblings.at(-1) || null };
  const relative = entityOrError(type, position.relativeToId);
  if ((relative.parentId || null) !== (parentId || null) || relative.id === entityId) {
    throw new TodoToolValidationError('Position target is not in the legal taxonomy sibling scope.', {
      entityId, relativeToId: relative.id, parentId: parentId || null
    }, 'POSITION_CONFLICT');
  }
  return position.placement === 'before'
    ? { beforeEntityId: relative.id, afterEntityId: null }
    : { beforeEntityId: null, afterEntityId: relative.id };
}

function taskCustomIndex(taskId) {
  const task = AppState.getTask(taskId);
  if (!task) return -1;
  return AppState.getSiblingTaskIds(task.parentTaskId || null).indexOf(taskId);
}

function taxonomyIndex(type, id) {
  const entity = TaxonomyOrder.getEntity(type, id);
  return entity ? TaxonomyOrder.getSiblingIds(type, entity.parentId || null).indexOf(id) : -1;
}

class AbortBeforeMutation extends Error {
  constructor(partial = false) {
    super('Todo request was stopped by the user.');
    this.name = 'AbortBeforeMutation';
    this.partial = partial;
  }
}

const TodoToolExecutorCore = {
  _tail: Promise.resolve(),
  _requests: new Map(),

  enqueue(work) {
    const run = this._tail.then(work, work);
    this._tail = run.catch(() => {});
    return run;
  },

  cancelRequest(requestId) {
    const entry = this._requests.get(String(requestId || ''));
    if (!entry) return false;
    entry.cancelled = true;
    return true;
  },

  assertNotCancelled(entry) {
    if (!entry.cancelled) return;
    throw new AbortBeforeMutation(Boolean(entry.mutationOccurred));
  },

  markMutation(entry) {
    entry.startedMutation = true;
    entry.mutationOccurred = true;
  },

  async mutationStage(entry, work) {
    this.assertNotCancelled(entry);
    entry.startedMutation = true;
    const result = await work();
    entry.mutationOccurred = true;
    return result;
  },

  executeRequest(payload = {}) {
    cleanRegistry(this._requests);
    const requestId = normalizeId(payload.requestId, 'requestId');
    const functionName = String(payload.functionName || '');
    if (!isTodoToolName(functionName)) {
      return Promise.resolve(failure('INVALID_ARGUMENT', 'Unknown Todo tool.', { functionName }));
    }
    const args = payload.args && typeof payload.args === 'object' ? payload.args : {};
    const requestFingerprint = fingerprint({ functionName, args });
    const existing = this._requests.get(requestId);
    if (existing) {
      if (existing.functionName !== functionName || existing.fingerprint !== requestFingerprint) {
        return Promise.resolve(failure('INVALID_ARGUMENT', 'requestId is already bound to a different Todo request.', { requestId }));
      }
      return existing.promise || Promise.resolve(existing.result);
    }

    const entry = {
      requestId,
      functionName,
      fingerprint: requestFingerprint,
      status: 'queued',
      createdAt: Date.now(),
      cancelled: false,
      startedMutation: false,
      mutationOccurred: false,
      result: null,
      promise: null,
      domain: toolDomain(functionName)
    };
    this._requests.set(requestId, entry);

    const run = this.enqueue(async () => {
      entry.status = 'pending';
      try {
        await AppDataService.whenIdle();
        this.assertNotCancelled(entry);
        const result = await this.dispatch(functionName, args, entry);
        entry.result = result;
        entry.status = result?.ok === false ? 'failed' : 'completed';
        return result;
      } catch (error) {
        if (entry.mutationOccurred) TodoToolUiSync.reconcile(entry.domain, { hierarchyChanged: true });
        let result;
        if (error instanceof AbortBeforeMutation) {
          result = error.partial
            ? failure('PARTIAL_FAILURE', 'Todo request was stopped after some changes were already saved.', { reason: 'REQUEST_ABORTED' }, undefined, { mutationOccurred: true })
            : failure('REQUEST_ABORTED', 'Todo request was stopped before any Todo mutation began.', {});
        } else {
          const mapped = toolError(error);
          result = failure(mapped.code, mapped.message, mapped.details, undefined, { mutationOccurred: entry.mutationOccurred });
        }
        entry.result = result;
        entry.status = 'failed';
        return result;
      } finally {
        entry.settledAt = Date.now();
        cleanRegistry(this._requests);
      }
    });
    entry.promise = run;
    return run;
  },

  async dispatch(name, args, entry) {
    switch (name) {
      case 'todo_find_tasks': return this.findTasks(args);
      case 'todo_create_tasks': return this.createTasks(args, entry);
      case 'todo_update_tasks': return this.updateTasks(args, entry);
      case 'todo_delete_tasks': return this.deleteTasks(args, entry);
      case 'todo_list_projects': return this.listEntities('project', args);
      case 'todo_create_projects': return this.createEntities('project', args, entry);
      case 'todo_update_projects': return this.updateEntities('project', args, entry);
      case 'todo_delete_projects': return this.deleteEntities('project', args, entry);
      case 'todo_list_tags': return this.listEntities('tag', args);
      case 'todo_create_tags': return this.createEntities('tag', args, entry);
      case 'todo_update_tags': return this.updateEntities('tag', args, entry);
      case 'todo_delete_tags': return this.deleteEntities('tag', args, entry);
      case 'todo_get_workspace': return this.getWorkspace();
      case 'todo_update_workspace': return this.updateWorkspace(args, entry);
      default: return failure('INVALID_ARGUMENT', 'Unknown Todo tool.', { name });
    }
  },

  findTasks(args) {
    const data = selectTasks(args || {});
    return success(data, `Found ${data.returnedCount} of ${data.totalMatched} matching tasks.`, {
      affectedCount: data.returnedCount,
      mutationOccurred: false
    }, taskListTree(data.tasks));
  },

  async applyTaskPosition(taskId, position, entry) {
    const task = taskOrError(taskId);
    const parentId = task.parentTaskId || null;
    const refs = positionRefsForTasks(taskId, parentId, position);
    const workspace = window.WorkspaceControls;
    const sortChangedToCustom = workspace?.normalizeSortKey?.(workspace.sortKey || 'custom') !== 'custom';
    const customOrderSnapshot = sortChangedToCustom ? workspace?.buildCustomOrderSnapshot?.() : null;
    await this.mutationStage(entry, () => AppDataService.commitHierarchyDrag({
      taskId,
      targetLevel: parentId ? 'subtask' : 'root',
      targetParentId: parentId,
      beforeTaskId: refs.beforeTaskId,
      afterTaskId: refs.afterTaskId,
      customOrderSnapshot
    }));
    if (workspace) {
      workspace.sortKey = 'custom';
      workspace.syncUI?.();
    }
    return { sortChangedToCustom, customSiblingIndex: taskCustomIndex(taskId) };
  },

  async applyTaskHierarchyPosition(taskId, targetParentId, position, entry) {
    const refs = positionRefsForTasks(taskId, targetParentId, position);
    const workspace = window.WorkspaceControls;
    const sortChangedToCustom = workspace?.normalizeSortKey?.(workspace.sortKey || 'custom') !== 'custom';
    const customOrderSnapshot = sortChangedToCustom ? workspace?.buildCustomOrderSnapshot?.() : null;
    await this.mutationStage(entry, () => AppDataService.commitHierarchyDrag({
      taskId,
      targetLevel: targetParentId ? 'subtask' : 'root',
      targetParentId,
      beforeTaskId: refs.beforeTaskId,
      afterTaskId: refs.afterTaskId,
      customOrderSnapshot
    }));
    if (workspace) {
      workspace.sortKey = 'custom';
      workspace.syncUI?.();
    }
    return { sortChangedToCustom, customSiblingIndex: taskCustomIndex(taskId) };
  },

  captureRepeatTransition(taskId, beforeIds, returned) {
    const oldTask = AppState.getTask(taskId);
    const created = AppState.tasks.filter(task => !beforeIds.has(task.id));
    if (!oldTask?.completed || created.length === 0) return null;
    let next = returned && returned.id !== taskId ? AppState.getTask(returned.id) : null;
    if (!next) next = created.find(task => !task.parentTaskId) || created[0];
    if (!next) return null;
    return {
      completedOccurrenceId: taskId,
      nextOccurrenceId: next.id,
      nextDueDate: next.dueDate || null,
      nextOccurrenceChildIds: next.parentTaskId ? [] : AppState.getSubtaskIds(next.id)
    };
  },

  async createTasks(args, entry) {
    const { items } = normalizeMutationEnvelope(args, 'tasks');
    const prepared = items.map(normalizeTaskCreateInput);
    const succeeded = [];
    let failed = null;

    for (let index = 0; index < prepared.length; index += 1) {
      this.assertNotCancelled(entry);
      const spec = prepared[index];
      const operations = { create: 'skipped', position: 'skipped', completion: 'skipped' };
      let itemMutation = false;
      let requestedId = null;
      let repeatTransition = null;
      let positionMeta = {};
      const beforeIds = new Set(AppState.tasks.map(task => task.id));
      try {
        const parent = spec.taskData.parentTaskId ? taskOrError(spec.taskData.parentTaskId) : null;
        if (parent) {
          if (parent.parentTaskId) throw new TodoToolValidationError('Parent must be a root task.', { parentTaskId: parent.id }, 'INVALID_PARENT');
          if (parent.completed) throw new TodoToolValidationError('Completed tasks cannot receive new subtasks.', { parentTaskId: parent.id }, 'INVALID_PARENT');
          if (spec.taskData.project && spec.taskData.project !== (parent.project || '')) {
            throw new TodoToolValidationError('A subtask must inherit its parent Project.', { parentProjectId: parent.project || null }, 'INVALID_ARGUMENT');
          }
          spec.taskData.project = parent.project || '';
        } else if (spec.taskData.project) validateProject(spec.taskData.project);
        validateTags(spec.taskData.tags);

        const created = await this.mutationStage(entry, () => AppDataService.createTask(spec.taskData));
        requestedId = created.id;
        itemMutation = true;
        operations.create = 'success';

        if (spec.position) {
          positionMeta = await this.applyTaskPosition(requestedId, spec.position, entry);
          operations.position = 'success';
        }
        if (spec.completed) {
          const beforeCompletionIds = new Set(AppState.tasks.map(task => task.id));
          const returned = await this.mutationStage(entry, () => AppDataService.toggleTaskStatus(requestedId));
          repeatTransition = this.captureRepeatTransition(requestedId, beforeCompletionIds, returned);
          operations.completion = 'success';
        }

        const finalTask = AppState.getTask(requestedId);
        const newIds = AppState.tasks.filter(task => !beforeIds.has(task.id)).map(task => task.id);
        succeeded.push({
          inputIndex: index,
          id: requestedId,
          operations,
          finalTask: finalTask ? serializeTaskFull(finalTask) : null,
          sideEffects: {
            createdTaskIds: newIds,
            repeatTransition,
            scheduleResolution: spec.scheduleResolution,
            ...positionMeta
          },
          mutationOccurred: itemMutation
        });
      } catch (error) {
        if (error instanceof AbortBeforeMutation) throw error;
        const mapped = toolError(error);
        const finalTask = requestedId && AppState.getTask(requestedId) ? serializeTaskFull(AppState.getTask(requestedId)) : null;
        const newIds = AppState.tasks.filter(task => !beforeIds.has(task.id)).map(task => task.id);
        failed = {
          inputIndex: index,
          result: failure(
            itemMutation ? 'PARTIAL_MUTATION' : mapped.code,
            itemMutation ? 'This task creation partially committed before a later stage failed.' : mapped.message,
            itemMutation ? { cause: mapped } : mapped.details,
            { id: requestedId, operations, finalTask, sideEffects: { createdTaskIds: newIds, repeatTransition, scheduleResolution: spec.scheduleResolution, ...positionMeta } },
            { mutationOccurred: itemMutation }
          )
        };
        break;
      }
    }

    const changed = entry.mutationOccurred || succeeded.some(item => item.mutationOccurred);
    if (changed) TodoToolUiSync.reconcile('task', { hierarchyChanged: true });
    if (failed) {
      const data = { succeeded, failed, unattempted: items.slice(failed.inputIndex + 1).map((_, i) => failed.inputIndex + 1 + i) };
      return failure(changed ? 'PARTIAL_FAILURE' : failed.result.error.code,
        changed ? 'Some task creation work was saved before a later stage/item failed.' : failed.result.error.message,
        changed ? { failed: failed.result.error } : failed.result.error.details,
        data,
        { mutationOccurred: changed, affectedCount: succeeded.length + (failed.result.meta?.mutationOccurred ? 1 : 0) });
    }
    return success({ items: succeeded }, `Created ${succeeded.length} ${succeeded.length === 1 ? 'task' : 'tasks'}.`, {
      mutationOccurred: changed,
      affectedCount: succeeded.length
    }, succeeded.length === 1 ? taskTree(AppState.getTask(succeeded[0].id)) : '');
  },

  async moveTaskHierarchy(taskId, current, targetParentId, entry) {
    const currentParent = current.parentTaskId || null;
    if (currentParent === targetParentId) return false;
    if (targetParentId) {
      const parent = taskOrError(targetParentId);
      if (parent.parentTaskId || parent.completed) {
        throw new TodoToolValidationError('Requested parent is not an active root task.', { parentTaskId: targetParentId }, 'INVALID_PARENT');
      }
      if (currentParent) {
        await this.mutationStage(entry, () => AppDataService.unlinkTask(taskId));
        await this.mutationStage(entry, () => AppDataService.linkTaskToParent(taskId, targetParentId));
      } else {
        await this.mutationStage(entry, () => AppDataService.linkTaskToParent(taskId, targetParentId));
      }
    } else if (currentParent) {
      await this.mutationStage(entry, () => AppDataService.unlinkTask(taskId));
    }
    return true;
  },

  async updateTasks(args, entry) {
    const { items } = normalizeMutationEnvelope(args, 'tasks');
    const rawIds = items.map((item, index) => normalizeId(assertPlainObject(item, `tasks[${index}]`).id, `tasks[${index}].id`));
    if (new Set(rawIds).size !== rawIds.length) throw new TodoToolValidationError('The same task ID cannot appear twice in one update batch.');

    const succeeded = [];
    let failed = null;
    for (let index = 0; index < items.length; index += 1) {
      this.assertNotCancelled(entry);
      const id = rawIds[index];
      const operations = { hierarchy: 'skipped', fields: 'skipped', position: 'skipped', completion: 'skipped' };
      let itemMutation = false;
      try {
        let current = taskOrError(id);
        const spec = normalizeTaskUpdateInput(current, items[index]);
        TodoToolUiGuard.assertTaskMutation({
          taskId: id,
          operation: 'update',
          completed: spec.completedSpecified ? spec.completed : undefined,
          parentTaskId: spec.parentTaskIdSpecified ? spec.parentTaskId : undefined
        });
        if (spec.patch.project) validateProject(spec.patch.project);
        if (spec.patch.tags) validateTags(spec.patch.tags);

        let targetParentId = current.parentTaskId || null;
        if (spec.parentTaskIdSpecified) targetParentId = spec.parentTaskId;
        else if (current.parentTaskId && spec.projectSpecified) targetParentId = null;

        if (targetParentId) {
          const parent = taskOrError(targetParentId);
          if (parent.parentTaskId || parent.completed) {
            throw new TodoToolValidationError('Requested parent is not an active root task.', { parentTaskId: targetParentId }, 'INVALID_PARENT');
          }
          const explicitProject = spec.projectSpecified ? (spec.projectId || '') : null;
          if (spec.projectSpecified && explicitProject !== (parent.project || '')) {
            throw new TodoToolValidationError('Final subtasks inherit the parent Project; the explicit Project conflicts.', {
              parentTaskId: targetParentId,
              parentProjectId: parent.project || null,
              requestedProjectId: spec.projectId
            });
          }
          delete spec.patch.project;
        }

        let positionMeta = {};
        let positionHandled = false;
        if ((current.parentTaskId || null) !== targetParentId) {
          if (spec.position) {
            positionMeta = await this.applyTaskHierarchyPosition(id, targetParentId, spec.position, entry);
            operations.position = 'success';
            positionHandled = true;
          } else {
            await this.moveTaskHierarchy(id, current, targetParentId, entry);
          }
          operations.hierarchy = 'success';
          itemMutation = true;
          current = taskOrError(id);
        }

        if (Object.keys(spec.patch).length) {
          await this.mutationStage(entry, () => AppDataService.updateTask(id, spec.patch));
          operations.fields = 'success';
          itemMutation = true;
          current = taskOrError(id);
        }

        if (spec.position && !positionHandled) {
          positionMeta = await this.applyTaskPosition(id, spec.position, entry);
          operations.position = 'success';
          itemMutation = true;
          current = taskOrError(id);
        }

        let repeatTransition = null;
        if (spec.completedSpecified && Boolean(current.completed) !== spec.completed) {
          const beforeIds = new Set(AppState.tasks.map(task => task.id));
          const returned = await this.mutationStage(entry, () => AppDataService.toggleTaskStatus(id));
          repeatTransition = spec.completed ? this.captureRepeatTransition(id, beforeIds, returned) : null;
          operations.completion = 'success';
          itemMutation = true;
        }

        const finalTask = AppState.getTask(id);
        succeeded.push({
          inputIndex: index,
          id,
          operations,
          finalTask: finalTask ? serializeTaskFull(finalTask) : null,
          sideEffects: {
            repeatTransition,
            scheduleResolution: spec.scheduleResolution,
            affectedChildTaskIds: finalTask && !finalTask.parentTaskId ? AppState.getSubtaskIds(id) : [],
            ...positionMeta
          },
          mutationOccurred: itemMutation
        });
      } catch (error) {
        if (error instanceof AbortBeforeMutation) throw error;
        const mapped = toolError(error);
        const partial = itemMutation;
        failed = {
          inputIndex: index,
          result: failure(partial ? 'PARTIAL_MUTATION' : mapped.code,
            partial ? 'This task update partially changed Todo before a later stage failed.' : mapped.message,
            partial ? { cause: mapped } : mapped.details,
            { id, operations, finalTask: AppState.getTask(id) ? serializeTaskFull(AppState.getTask(id)) : null },
            { mutationOccurred: partial })
        };
        break;
      }
    }

    const changedCount = succeeded.filter(item => item.mutationOccurred).length;
    const changed = entry.mutationOccurred || changedCount > 0;
    if (changed) TodoToolUiSync.reconcile('task', { hierarchyChanged: true });
    if (failed) {
      return failure(changed ? 'PARTIAL_FAILURE' : failed.result.error.code,
        changed ? 'Some task updates were saved before a later update failed.' : failed.result.error.message,
        { failed: failed.result.error },
        { succeeded, failed, unattempted: items.slice(failed.inputIndex + 1).map((_, i) => failed.inputIndex + 1 + i) },
        { mutationOccurred: changed, affectedCount: changedCount });
    }
    return success({ items: succeeded }, `Updated ${succeeded.length} ${succeeded.length === 1 ? 'task' : 'tasks'}.`, {
      mutationOccurred: changed,
      affectedCount: changedCount
    }, succeeded.length === 1 ? taskTree(AppState.getTask(succeeded[0].id)) : '');
  },

  async deleteTasks(args, entry) {
    const { ids } = normalizeDeleteEnvelope(args, 'taskIds');
    const deleted = new Set();
    const succeeded = [];
    let failed = null;
    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      this.assertNotCancelled(entry);
      try {
        const task = AppState.getTask(id);
        if (!task) {
          if (deleted.has(id)) continue;
          throw new TodoToolValidationError('Task not found.', { id }, 'TASK_NOT_FOUND');
        }
        TodoToolUiGuard.assertTaskMutation({ taskId: id, operation: 'delete' });
        const family = task.parentTaskId ? [task.id] : [task.id, ...AppState.getSubtaskIds(task.id)];
        await this.mutationStage(entry, () => AppDataService.deleteTaskFamily(id));
        family.forEach(taskId => deleted.add(taskId));
        succeeded.push({ inputIndex: index, requestedTaskId: id, deletedTaskIds: family, mutationOccurred: true });
      } catch (error) {
        if (error instanceof AbortBeforeMutation) throw error;
        const mapped = toolError(error);
        failed = { inputIndex: index, result: failure(mapped.code, mapped.message, mapped.details) };
        break;
      }
    }
    const changed = deleted.size > 0;
    if (changed) TodoToolUiSync.reconcile('task', { hierarchyChanged: true, deleted: true });
    if (failed) {
      return failure(changed ? 'PARTIAL_FAILURE' : failed.result.error.code,
        changed ? 'Some task deletions were saved before a later deletion failed.' : failed.result.error.message,
        changed ? { failed: failed.result.error } : failed.result.error.details,
        { succeeded, failed, unattempted: ids.slice(failed.inputIndex + 1), deletedTaskIds: [...deleted] },
        { mutationOccurred: changed, affectedCount: deleted.size });
    }
    return success({ deletedTaskIds: [...deleted], succeeded }, `Deleted ${deleted.size} ${deleted.size === 1 ? 'task' : 'tasks'}.`, {
      mutationOccurred: changed,
      affectedCount: deleted.size
    });
  },

  listEntities(type, args) {
    const data = listTaxonomy(type, args || {});
    const tree = makeTreeLines(data.items);
    return success(data, `Listed ${data.returnedCount} of ${data.totalMatched} ${type === 'project' ? 'projects' : 'tags'}.`, {
      mutationOccurred: false,
      affectedCount: data.returnedCount
    }, tree);
  },

  async applyTaxonomyPosition(type, id, parentId, position, entry) {
    const refs = positionRefsForTaxonomy(type, id, parentId, position);
    await this.mutationStage(entry, () => AppDataService.commitTaxonomyDrag({
      entityType: type,
      entityId: id,
      targetParentId: parentId,
      beforeEntityId: refs.beforeEntityId,
      afterEntityId: refs.afterEntityId
    }));
    return { customSiblingIndex: taxonomyIndex(type, id) };
  },

  async createEntities(type, args, entry) {
    const key = type === 'project' ? 'projects' : 'tags';
    const { items } = normalizeMutationEnvelope(args, key);
    const prepared = items.map(item => normalizeTaxonomyCreateInput(item, type === 'project' ? 'Project' : 'Tag'));
    const succeeded = [];
    let failed = null;
    for (let index = 0; index < prepared.length; index += 1) {
      let createdId = null;
      let itemMutation = false;
      const operations = { create: 'skipped', position: 'skipped' };
      let positionMeta = {};
      try {
        this.assertNotCancelled(entry);
        const spec = prepared[index];
        if (spec.data.parentId) entityOrError(type, spec.data.parentId);
        const method = type === 'project' ? 'createProject' : 'createTag';
        let created = await this.mutationStage(entry, () => AppDataService[method](spec.data));
        createdId = created.id;
        itemMutation = true;
        operations.create = 'success';
        if (spec.position) {
          positionMeta = await this.applyTaxonomyPosition(type, created.id, created.parentId || null, spec.position, entry);
          operations.position = 'success';
        }
        created = entityOrError(type, created.id);
        succeeded.push({ inputIndex: index, id: created.id, operations, finalEntity: { ...created }, sideEffects: positionMeta, mutationOccurred: true });
      } catch (error) {
        if (error instanceof AbortBeforeMutation) throw error;
        const mapped = toolError(error);
        failed = {
          inputIndex: index,
          result: failure(
            itemMutation ? 'PARTIAL_MUTATION' : mapped.code,
            itemMutation ? `This ${type} creation partially committed before a later stage failed.` : mapped.message,
            itemMutation ? { cause: mapped } : mapped.details,
            { id: createdId, operations, finalEntity: createdId && TaxonomyOrder.getEntity(type, createdId) ? { ...TaxonomyOrder.getEntity(type, createdId) } : null, sideEffects: positionMeta },
            { mutationOccurred: itemMutation }
          )
        };
        break;
      }
    }
    const changed = entry.mutationOccurred || succeeded.length > 0;
    if (changed) TodoToolUiSync.reconcile(type, { hierarchyChanged: true });
    if (failed) {
      return failure(changed ? 'PARTIAL_FAILURE' : failed.result.error.code,
        changed ? `Some ${type} creation work was saved before a later stage/item failed.` : failed.result.error.message,
        changed ? { failed: failed.result.error } : failed.result.error.details,
        { succeeded, failed, unattempted: items.slice(failed.inputIndex + 1).map((_, i) => failed.inputIndex + 1 + i) },
        { mutationOccurred: changed, affectedCount: succeeded.length + (failed.result.meta?.mutationOccurred ? 1 : 0) });
    }
    return success({ items: succeeded }, `Created ${succeeded.length} ${type === 'project' ? 'projects' : 'tags'}.`, {
      mutationOccurred: changed,
      affectedCount: succeeded.length
    }, makeTreeLines(succeeded.map(item => ({ id: item.id, name: item.finalEntity.name, parentId: item.finalEntity.parentId }))));
  },

  async updateEntities(type, args, entry) {
    const key = type === 'project' ? 'projects' : 'tags';
    const { items } = normalizeMutationEnvelope(args, key);
    const rawIds = items.map((item, index) => normalizeId(assertPlainObject(item, `${key}[${index}]`).id, `${key}[${index}].id`));
    if (new Set(rawIds).size !== rawIds.length) throw new TodoToolValidationError(`The same ${type} ID cannot appear twice in one update batch.`);
    const succeeded = [];
    let failed = null;

    for (let index = 0; index < items.length; index += 1) {
      const id = rawIds[index];
      const operations = { hierarchy: 'skipped', fields: 'skipped', position: 'skipped' };
      let itemMutation = false;
      try {
        this.assertNotCancelled(entry);
        let current = entityOrError(type, id);
        const spec = normalizeTaxonomyUpdateInput(items[index], type === 'project' ? 'Project' : 'Tag');
        const targetParentId = spec.parentSpecified ? (spec.data.parentId || null) : (current.parentId || null);
        if (targetParentId) entityOrError(type, targetParentId);
        if (type === 'project') TodoToolUiGuard.assertProjectMutation({ projectId: id, parentRelationshipChanges: spec.parentSpecified || !!spec.position });
        else TodoToolUiGuard.assertTagMutation({ tagId: id, parentRelationshipChanges: spec.parentSpecified || !!spec.position });
        TodoToolUiGuard.assertTaxonomyRelationshipSafe(type, id, targetParentId);

        if (spec.parentSpecified || spec.position) {
          const position = spec.position || { placement: 'bottom', relativeToId: null };
          const meta = await this.applyTaxonomyPosition(type, id, targetParentId, position, entry);
          operations.hierarchy = spec.parentSpecified ? 'success' : 'skipped';
          operations.position = spec.position ? 'success' : 'skipped';
          itemMutation = true;
          current = entityOrError(type, id);
          spec.positionMeta = meta;
        }

        const fieldData = { ...spec.data };
        delete fieldData.parentId;
        if (Object.keys(fieldData).length) {
          const method = type === 'project' ? 'updateProject' : 'updateTag';
          await this.mutationStage(entry, () => AppDataService[method](id, fieldData));
          operations.fields = 'success';
          itemMutation = true;
        }
        const finalEntity = { ...entityOrError(type, id) };
        succeeded.push({ inputIndex: index, id, operations, finalEntity, sideEffects: spec.positionMeta || {}, mutationOccurred: itemMutation });
      } catch (error) {
        if (error instanceof AbortBeforeMutation) throw error;
        const mapped = toolError(error);
        failed = {
          inputIndex: index,
          result: failure(itemMutation ? 'PARTIAL_MUTATION' : mapped.code,
            itemMutation ? `This ${type} update partially committed before a later stage failed.` : mapped.message,
            itemMutation ? { cause: mapped } : mapped.details,
            { id, operations, finalEntity: TaxonomyOrder.getEntity(type, id) ? { ...TaxonomyOrder.getEntity(type, id) } : null },
            { mutationOccurred: itemMutation })
        };
        break;
      }
    }

    const changed = succeeded.some(item => item.mutationOccurred) || entry.mutationOccurred;
    if (changed) TodoToolUiSync.reconcile(type, { hierarchyChanged: true });
    if (failed) {
      return failure(changed ? 'PARTIAL_FAILURE' : failed.result.error.code,
        changed ? `Some ${type} updates were saved before a later update failed.` : failed.result.error.message,
        { failed: failed.result.error },
        { succeeded, failed, unattempted: items.slice(failed.inputIndex + 1).map((_, i) => failed.inputIndex + 1 + i) },
        { mutationOccurred: changed, affectedCount: succeeded.length });
    }
    return success({ items: succeeded }, `Updated ${succeeded.length} ${type === 'project' ? 'projects' : 'tags'}.`, {
      mutationOccurred: changed,
      affectedCount: succeeded.length
    });
  },

  async deleteEntities(type, args, entry) {
    const key = type === 'project' ? 'projectIds' : 'tagIds';
    const { ids } = normalizeDeleteEnvelope(args, key);
    const deleted = [];
    const affectedTaskIds = new Set();
    const reparented = [];
    const succeeded = [];
    let failed = null;

    for (let index = 0; index < ids.length; index += 1) {
      const id = ids[index];
      this.assertNotCancelled(entry);
      try {
        entityOrError(type, id);
        if (type === 'project') TodoToolUiGuard.assertProjectMutation({ projectId: id, operation: 'delete', parentRelationshipChanges: true });
        else TodoToolUiGuard.assertTagMutation({ tagId: id, operation: 'delete', parentRelationshipChanges: true });
        const children = TaxonomyOrder.getChildren(type, id).map(child => child.id);
        const tasks = AppState.tasks.filter(task => type === 'project' ? task.project === id : (task.tags || []).includes(id)).map(task => task.id);
        const method = type === 'project' ? 'deleteProject' : 'deleteTag';
        await this.mutationStage(entry, () => AppDataService[method](id));
        deleted.push(id);
        tasks.forEach(taskId => affectedTaskIds.add(taskId));
        const itemReparented = [];
        children.forEach(childId => {
          const child = TaxonomyOrder.getEntity(type, childId);
          if (child) {
            const row = { id: childId, parentId: child.parentId || null };
            reparented.push(row);
            itemReparented.push(row);
          }
        });
        succeeded.push({ inputIndex: index, id, affectedTaskIds: tasks, reparented: itemReparented, mutationOccurred: true });
      } catch (error) {
        if (error instanceof AbortBeforeMutation) throw error;
        const mapped = toolError(error);
        failed = { inputIndex: index, result: failure(mapped.code, mapped.message, mapped.details) };
        break;
      }
    }

    const changed = deleted.length > 0;
    if (changed) TodoToolUiSync.reconcile(type, { hierarchyChanged: true, deleted: true });
    const sideData = type === 'project'
      ? { deletedProjectIds: deleted, unassignedTaskIds: [...affectedTaskIds], reparentedProjectIds: reparented }
      : { deletedTagIds: deleted, affectedTaskIds: [...affectedTaskIds], reparentedTagIds: reparented };
    if (failed) {
      return failure(changed ? 'PARTIAL_FAILURE' : failed.result.error.code,
        changed ? `Some ${type} deletions were saved before a later deletion failed.` : failed.result.error.message,
        changed ? { failed: failed.result.error } : failed.result.error.details,
        { ...sideData, succeeded, failed, unattempted: ids.slice(failed.inputIndex + 1) },
        { mutationOccurred: changed, affectedCount: deleted.length });
    }
    return success({ ...sideData, succeeded }, `Deleted ${deleted.length} ${type === 'project' ? 'projects' : 'tags'}.`, {
      mutationOccurred: changed,
      affectedCount: deleted.length
    });
  },

  workspaceState() {
    const sidebar = window.SidebarComponent;
    const workspace = window.WorkspaceControls;
    return {
      currentFilter: {
        type: AppState.currentFilterType,
        id: AppState.currentFilter,
        title: sidebar?.viewTitleEl?.textContent?.trim() || AppState.currentFilter
      },
      viewType: workspace?.viewType || 'list',
      sortKey: workspace?.normalizeSortKey?.(workspace.sortKey || 'custom') || 'custom',
      sortDirection: workspace?.sortDirection === 'desc' ? 'desc' : 'asc',
      groupKey: workspace?.groupKey || 'none',
      currentViewTaskIds: currentViewTaskIds(100),
      currentViewTaskCount: currentViewTaskIds(10000).length
    };
  },

  getWorkspace() {
    const data = this.workspaceState();
    return success(data, `Current To-Do view is ${data.currentFilter.title}.`, { mutationOccurred: false, affectedCount: 0 });
  },

  async updateWorkspace(args, entry) {
    const source = assertPlainObject(args || {}, 'arguments');
    const stages = { navigation: 'skipped', view: 'skipped', sort: 'skipped', sortDirection: 'skipped', group: 'skipped' };
    let mutationOccurred = false;
    try {
      if (source.navigation != null) {
        this.assertNotCancelled(entry);
        const nav = assertPlainObject(source.navigation, 'navigation');
        const type = String(nav.type || '');
        if (!['inbox', 'today', 'completed', 'project', 'tag'].includes(type)) {
          throw new TodoToolValidationError('navigation.type is invalid.');
        }
        if (type === 'project') {
          const id = normalizeId(nav.id, 'navigation.id');
          entityOrError('project', id);
          AppState.currentFilterType = 'project';
          AppState.currentFilter = id;
        } else if (type === 'tag') {
          const id = normalizeId(nav.id, 'navigation.id');
          entityOrError('tag', id);
          AppState.currentFilterType = 'tag';
          AppState.currentFilter = id;
        } else {
          AppState.currentFilterType = 'smart';
          AppState.currentFilter = type;
        }
        stages.navigation = 'success';
        mutationOccurred = true;
        this.markMutation(entry);
      }

      if (source.viewType != null) {
        if (!['list', 'kanban'].includes(source.viewType)) throw new TodoToolValidationError('viewType must be list or kanban.');
        this.assertNotCancelled(entry);
        const previous = window.WorkspaceControls?.viewType;
        const next = await window.WorkspaceControls?.setViewType?.(source.viewType, { persist: true, render: false });
        if (next !== source.viewType) throw new Error('Todo could not save the requested view.');
        stages.view = 'success';
        if (previous !== next) {
          mutationOccurred = true;
          this.markMutation(entry);
        }
      }

      if (source.sortKey != null) {
        const allowed = ['custom', 'dueDate', 'priority', 'name', 'createdAt'];
        if (!allowed.includes(source.sortKey)) throw new TodoToolValidationError('sortKey is invalid.');
        const controls = window.WorkspaceControls;
        const current = controls?.normalizeSortKey?.(controls.sortKey || 'custom') || 'custom';
        if (source.sortKey !== current) {
          if (source.sortKey === 'custom') {
            const snapshot = controls.buildCustomOrderSnapshot();
            await this.mutationStage(entry, () => AppDataService.activateCustomSort(snapshot));
          } else {
            await this.mutationStage(entry, () => AppDataService.setSetting('sortKey', source.sortKey));
          }
          controls.sortKey = source.sortKey;
          stages.sort = 'success';
          mutationOccurred = true;
        }
      }

      const finalSort = window.WorkspaceControls?.normalizeSortKey?.(window.WorkspaceControls?.sortKey || 'custom') || 'custom';
      if (source.sortDirection != null) {
        if (!['asc', 'desc'].includes(source.sortDirection)) throw new TodoToolValidationError('sortDirection must be asc or desc.');
        if (finalSort !== 'custom' && window.WorkspaceControls.sortDirection !== source.sortDirection) {
          await this.mutationStage(entry, () => AppDataService.setSetting('sortDirection', source.sortDirection));
          window.WorkspaceControls.sortDirection = source.sortDirection;
          stages.sortDirection = 'success';
          mutationOccurred = true;
        }
      }

      if (source.groupKey != null) {
        if (!['none', 'priority', 'date', 'project', 'tag'].includes(source.groupKey)) throw new TodoToolValidationError('groupKey is invalid.');
        if (window.WorkspaceControls.groupKey !== source.groupKey) {
          await this.mutationStage(entry, () => AppDataService.setSetting('groupKey', source.groupKey));
          window.WorkspaceControls.groupKey = source.groupKey;
          stages.group = 'success';
          mutationOccurred = true;
        }
      }

      TodoToolUiSync.reconcile('workspace');
      return success({ stages, workspace: this.workspaceState() }, 'Updated the To-Do workspace.', {
        mutationOccurred,
        affectedCount: mutationOccurred ? 1 : 0
      });
    } catch (error) {
      if (error instanceof AbortBeforeMutation) throw error;
      if (mutationOccurred) TodoToolUiSync.reconcile('workspace');
      const mapped = toolError(error);
      return failure(mutationOccurred ? 'PARTIAL_MUTATION' : mapped.code,
        mutationOccurred ? 'The To-Do workspace changed partially before a later stage failed.' : mapped.message,
        mutationOccurred ? { cause: mapped } : mapped.details,
        { stages, workspace: this.workspaceState() },
        { mutationOccurred, affectedCount: mutationOccurred ? 1 : 0 });
    }
  }
};

export const TodoToolExecutor = TodoToolExecutorCore;

export function isTodoMutationResult(result) {
  return Boolean(result?.meta?.mutationOccurred);
}
