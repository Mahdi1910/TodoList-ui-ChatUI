import { TaskAfter } from '../task-after.js';
import { AppState } from '../state.js';
import { AppStateSync } from '../state-sync.js';
import { TodoDbSchema } from './db-schema.js';
import { TodoDb } from './db.js';
import { TodoRepositories } from './repositories.js';
import { TodoStorageMappers } from './mappers.js';

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function cloneTask(task, overrides = {}) {
  return {
    ...task,
    tags: [...(task.tags || [])],
    reminders: [...(task.reminders || [])],
    repeat: task.repeat ? JSON.parse(JSON.stringify(task.repeat)) : null,
    repeatState: task.repeatState ? { ...task.repeatState } : null,
    after: task.after ? TaskAfter.clone(task.after) : null,
    ...overrides
  };
}

export const DataServiceAfterMethods = {
  resolveTaskAfterInput(taskData = {}, existing = null, taskId = null) {
    const afterSpecified = own(taskData, 'after');
    const touchesAbsoluteSchedule = ['dueDate', 'dueTime', 'repeat'].some(key => own(taskData, key));
    let after = afterSpecified
      ? TaskAfter.normalize(taskData.after)
      : (existing?.after ? TaskAfter.clone(existing.after) : null);

    // An explicit absolute schedule replaces an existing After dependency when
    // the caller did not explicitly send After in the same update.
    if (!afterSpecified && touchesAbsoluteSchedule) after = null;
    if (!after) return null;

    const check = TaskAfter.validate(after);
    if (!check.valid) throw new Error(check.message);
    after = check.after;

    const source = AppState.getTask(after.taskId);
    if (!source) throw new Error('The selected After task no longer exists.');
    if (taskId && source.id === taskId) throw new Error('A task cannot be scheduled after itself.');
    if (taskId && TaskAfter.wouldCreateCycle(taskId, source.id, AppState.tasks)) {
      throw new Error('This After relationship would create a task cycle.');
    }

    const sameExistingSpec = Boolean(existing?.after && TaskAfter.sameSpec(existing.after, after));
    if (sameExistingSpec && existing.after.resolvedAt && !after.resolvedAt) {
      after.resolvedAt = existing.after.resolvedAt;
    }

    if (!after.resolvedAt && source.completed) {
      throw new Error('Completed tasks cannot start a new After schedule.');
    }
    return after;
  },

  normalizePendingAfterTask(task) {
    if (!TaskAfter.isPending(task?.after)) return task;
    return cloneTask(task, {
      dueDate: null,
      dueTime: null,
      repeat: null,
      repeatState: null
    });
  },

  async resolveAfterDependentsInternal() {
    const changed = [];
    const now = TodoStorageMappers.nowIso();
    for (const sourceTask of AppState.tasks) {
      if (sourceTask.completed || !TaskAfter.isPending(sourceTask.after)) continue;
      const predecessor = AppState.getTask(sourceTask.after.taskId);
      if (!predecessor?.completedAt) continue;
      const schedule = TaskAfter.resolveSchedule(sourceTask.after, predecessor.completedAt);
      if (!schedule) continue;
      changed.push(cloneTask(sourceTask, {
        dueDate: schedule.dueDate,
        dueTime: schedule.dueTime,
        after: { ...sourceTask.after, resolvedAt: schedule.resolvedAt },
        updatedAt: now
      }));
    }
    if (!changed.length) return [];

    const S = TodoDbSchema.STORES;
    await TodoDb.withTransaction(S.TASKS, 'readwrite', async tx => {
      for (const task of changed) {
        await TodoRepositories.put(tx, S.TASKS, TodoStorageMappers.taskToRow(task));
      }
    });
    AppStateSync.replaceTasks(changed);
    return changed;
  },

  repairAfterDependencies() {
    return this.enqueue(async () => {
      const changed = new Map();
      const removeRepeatIds = new Set();
      const now = TodoStorageMappers.nowIso();
      const tasks = AppState.tasks.map(task => cloneTask(task));
      const byId = new Map(tasks.map(task => [task.id, task]));

      for (const task of tasks) {
        if (!task.after) continue;
        const check = TaskAfter.validate(task.after);
        const source = check.valid ? byId.get(check.after.taskId) : null;
        const cyclic = check.valid && TaskAfter.wouldCreateCycle(task.id, check.after.taskId, tasks);
        if (!check.valid || !source || source.id === task.id || cyclic || (task.completed && !task.after.resolvedAt)) {
          task.after = null;
          task.updatedAt = now;
          changed.set(task.id, task);
          continue;
        }
        if (TaskAfter.isPending(task.after)) {
          if (task.dueDate || task.dueTime || task.repeat) {
            task.dueDate = null;
            task.dueTime = null;
            if (task.repeat) removeRepeatIds.add(task.id);
            task.repeat = null;
            task.repeatState = null;
            task.updatedAt = now;
            changed.set(task.id, task);
          }
        }
      }

      if (changed.size || removeRepeatIds.size) {
        const S = TodoDbSchema.STORES;
        await TodoDb.withTransaction([S.TASKS, S.TASK_REPEAT_RULES], 'readwrite', async tx => {
          for (const task of changed.values()) {
            await TodoRepositories.put(tx, S.TASKS, TodoStorageMappers.taskToRow(task));
          }
          for (const id of removeRepeatIds) await TodoRepositories.remove(tx, S.TASK_REPEAT_RULES, id);
        });
        AppStateSync.replaceTasks([...changed.values()]);
      }

      const resolved = await this.resolveAfterDependentsInternal();
      return changed.size + resolved.length;
    });
  },

  async clearAfterDependentsInTransaction(tx, deletedIds = []) {
    const ids = new Set(deletedIds);
    const now = TodoStorageMappers.nowIso();
    const changed = AppState.tasks
      .filter(task => !ids.has(task.id) && task.after && ids.has(task.after.taskId))
      .map(task => cloneTask(task, { after: null, updatedAt: now }));
    for (const task of changed) {
      await TodoRepositories.put(tx, TodoDbSchema.STORES.TASKS, TodoStorageMappers.taskToRow(task));
    }
    return changed;
  }
};
