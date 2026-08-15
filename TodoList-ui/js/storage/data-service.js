import { RepeatEngine } from '../repeat/repeat-engine.js';
import { TaskModel } from '../task-model.js';
import { AppState } from '../state.js';
import { AppStateSync } from '../state-sync.js';
import { TodoDbSchema } from './db-schema.js';
import { TodoDb } from './db.js';
import { TodoRepositories } from './repositories.js';
import { TodoStorageMappers } from './mappers.js';
import { DataServiceTaxonomyMethods } from './data-service-taxonomy.js';
import { DataServiceReminderMethods } from './data-service-reminders.js';
import { DataServiceTaxonomyDragMethods } from './data-service-taxonomy-drag.js';
import { DataServiceDragMethods } from './data-service-drag.js';
import { DataServiceHierarchyMethods } from './data-service-hierarchy.js';

let AppDataService;

(() => {
  const engine = () => RepeatEngine;

  function copyTask(task, overrides = {}) {
    return {
      ...task,
      tags: [...(task.tags || [])],
      reminders: [...(task.reminders || [])],
      repeat: task.repeat ? engine().clone(task.repeat) : null,
      repeatState: task.repeatState ? { ...task.repeatState } : null,
      ...overrides
    };
  }

  function activeRepeat(task) {
    return Boolean(task?.repeat && task.repeat.mode !== 'none');
  }

  function nextRepeatState(service, task) {
    const current = engine().createInitialRepeatState(task.repeat, task.dueDate, task.repeatState || {});
    return {
      ...current,
      seriesId: current.seriesId || service.createId('series'),
      occurrenceNumber: Math.max(1, Number(current.occurrenceNumber) || 1) + 1
    };
  }

  function replaceTaskMemory(copies, additions = []) {
    AppStateSync.replaceTasks(copies, additions);
  }

  async function persistTaskRows(tasks) {
    const S = TodoDbSchema.STORES;
    await TodoDb.withTransaction(S.TASKS, 'readwrite', async tx => {
      for (const task of tasks) {
        await TodoRepositories.put(tx, S.TASKS, TodoStorageMappers.taskToRow(task));
      }
    });
  }

  async function persistTaskAggregates(service, tasks) {
    const S = TodoDbSchema.STORES;
    await TodoDb.withTransaction([
      S.TASKS, S.TASK_TAGS, S.REMINDER_DEFINITIONS, S.TASK_REMINDERS, S.TASK_REPEAT_RULES
    ], 'readwrite', async tx => {
      for (const task of tasks) await service.writeTaskAggregate(tx, task, []);
    });
  }

  function chooseSlotTemplates(service, children) {
    const groups = new Map();
    children.forEach(child => {
      const slot = child.familySlotId || service.createId('slot');
      child.familySlotId = slot;
      if (!groups.has(slot)) groups.set(slot, []);
      groups.get(slot).push(child);
    });
    const score = task => {
      if (activeRepeat(task)) return 3;
      if (!task.completed) return 2;
      return 1;
    };
    return [...groups.values()].map(items => [...items].sort((a, b) => {
      const difference = score(b) - score(a);
      if (difference) return difference;
      return String(b.dueDate || b.createdAt || '').localeCompare(String(a.dueDate || a.createdAt || ''));
    })[0]);
  }

  async function uncompleteTask(task) {
    const updated = copyTask(task, { completed: false, updatedAt: TodoStorageMappers.nowIso() });
    await persistTaskRows([updated]);
    replaceTaskMemory([updated]);
    return updated;
  }

  async function completePlainSubtask(task) {
    const updated = copyTask(task, { completed: true, updatedAt: TodoStorageMappers.nowIso() });
    await persistTaskRows([updated]);
    replaceTaskMemory([updated]);
    return updated;
  }

  async function completeRepeatingSubtask(service, task) {
    const now = TodoStorageMappers.nowIso();
    const slot = task.familySlotId || service.createId('slot');
    const nextDate = engine().calculateNextOccurrence(task.dueDate, task.repeat, task.repeatState || {});
    const oldTask = copyTask(task, {
      completed: true,
      familySlotId: slot,
      repeat: null,
      repeatState: null,
      updatedAt: now
    });

    if (!nextDate) {
      await persistTaskAggregates(service, [oldTask]);
      replaceTaskMemory([oldTask]);
      return oldTask;
    }

    const nextTask = copyTask(task, {
      id: service.createId('task'),
      completed: false,
      familySlotId: slot,
      dueDate: nextDate,
      repeat: engine().clone(task.repeat),
      repeatState: nextRepeatState(service, task),
      createdAt: now,
      updatedAt: now
    });
    await persistTaskAggregates(service, [oldTask, nextTask]);
    replaceTaskMemory([oldTask], [nextTask]);
    return nextTask;
  }

  async function completeNonRepeatingRoot(root) {
    const now = TodoStorageMappers.nowIso();
    const family = [root, ...AppState.getSubtasks(root.id)].map(task =>
      copyTask(task, { completed: true, updatedAt: now }));
    await persistTaskRows(family);
    replaceTaskMemory(family);
    return family[0];
  }

  async function finishRepeatingRootWithoutNext(service, root, children) {
    const now = TodoStorageMappers.nowIso();
    const oldRoot = copyTask(root, {
      completed: true,
      repeat: null,
      repeatState: null,
      updatedAt: now
    });
    const oldChildren = children.map(child => copyTask(child, {
      completed: true,
      familySlotId: child.familySlotId || service.createId('slot'),
      updatedAt: now
    }));
    await persistTaskAggregates(service, [oldRoot, ...oldChildren]);
    replaceTaskMemory([oldRoot, ...oldChildren]);
    return oldRoot;
  }

  async function completeRepeatingRoot(service, root) {
    const children = AppState.getSubtasks(root.id).map(child => copyTask(child));
    const nextDate = engine().calculateNextOccurrence(root.dueDate, root.repeat, root.repeatState || {});
    if (!nextDate) return finishRepeatingRootWithoutNext(service, root, children);

    const now = TodoStorageMappers.nowIso();
    const oldRoot = copyTask(root, {
      completed: true,
      repeat: null,
      repeatState: null,
      updatedAt: now
    });
    const nextRoot = copyTask(root, {
      id: service.createId('task'),
      parentTaskId: null,
      familySlotId: null,
      completed: false,
      dueDate: nextDate,
      repeat: engine().clone(root.repeat),
      repeatState: nextRepeatState(service, root),
      createdAt: now,
      updatedAt: now
    });

    const templates = chooseSlotTemplates(service, children);
    const templateIds = new Set(templates.map(task => task.id));
    const oldChildren = children.map(child => {
      const transferRepeat = templateIds.has(child.id) && activeRepeat(child);
      return copyTask(child, {
        completed: true,
        repeat: transferRepeat ? null : child.repeat,
        repeatState: transferRepeat ? null : child.repeatState,
        updatedAt: now
      });
    });

    const nextChildren = templates.map(template => copyTask(template, {
      id: service.createId('task'),
      parentTaskId: nextRoot.id,
      project: nextRoot.project || '',
      familySlotId: template.familySlotId,
      completed: false,
      repeat: activeRepeat(template) ? engine().clone(template.repeat) : null,
      repeatState: activeRepeat(template) ? { ...template.repeatState } : null,
      createdAt: now,
      updatedAt: now
    }));

    await persistTaskAggregates(service, [oldRoot, ...oldChildren, nextRoot, ...nextChildren]);
    replaceTaskMemory([oldRoot, ...oldChildren], [nextRoot, ...nextChildren]);
    return nextRoot;
  }

  const AppDataServiceCore = {
    _writeQueue: Promise.resolve(),

    enqueue(work) {
      const run = this._writeQueue.then(work, work);
      this._writeQueue = run.catch(() => {});
      return run;
    },

    whenIdle() {
      return this.enqueue(async () => undefined);
    },

    createId(prefix) {
      const value = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      return `${prefix}-${value}`;
    },

    validateProjectId(projectId) {
      if (!projectId) return '';
      if (!AppState.getProject(projectId)) throw new Error('The selected project no longer exists.');
      return projectId;
    },

    validateTagIds(tagIds = []) {
      return [...new Set(tagIds)].filter(Boolean).map(tagId => {
        if (!AppState.getTag(tagId)) throw new Error('A selected tag no longer exists.');
        return tagId;
      });
    },

    nextRootSortOrder() {
      const values = AppState.getRootTasks().map(task => task.sortOrder).filter(Number.isFinite);
      return values.length ? Math.min(...values) - 1 : 0;
    },

    nextSubtaskSortOrder(parentTaskId) {
      const values = AppState.getSubtasks(parentTaskId).map(task => task.sortOrder).filter(Number.isFinite);
      return values.length ? Math.max(...values) + 1 : 0;
    },

    buildTask(taskData = {}, existing = null) {
      const now = TodoStorageMappers.nowIso();
      const parentId = existing?.parentTaskId || taskData.parentTaskId || null;
      const parent = parentId ? AppState.validateParentTaskId(parentId) : null;
      if (parentId && !parent) throw new Error('The parent task is invalid.');
      const title = String(taskData.title ?? existing?.title ?? '').trim();
      if (!title) throw new Error('Task title is required.');
      const project = parent
        ? (parent.project || '')
        : this.validateProjectId(taskData.project ?? existing?.project ?? '');
      const tags = this.validateTagIds(taskData.tags ?? existing?.tags ?? []);
      const reminderData = this.resolveReminders(taskData.reminders ?? existing?.reminders ?? []);
      const priority = taskData.priority ?? existing?.priority ?? '';
      if (!['', 'low', 'medium', 'high'].includes(priority)) throw new Error('Invalid task priority.');

      const selectedRepeat = taskData.repeat !== undefined ? taskData.repeat : existing?.repeat;
      const normalizedRepeat = engine().normalizeRepeatRule(selectedRepeat);
      const selectedDate = taskData.dueDate !== undefined ? taskData.dueDate : existing?.dueDate;
      const dueDate = normalizedRepeat.mode !== 'none' && !selectedDate ? engine().today() : (selectedDate || null);
      const task = TaskModel.normalizeTask({
        id: existing?.id || this.createId('task'),
        title,
        description: String(taskData.description ?? existing?.description ?? ''),
        project,
        parentTaskId: parent?.id || null,
        priority,
        tags,
        reminders: reminderData.ids.length ? reminderData.ids : ['none'],
        repeat: normalizedRepeat.mode === 'none' ? null : normalizedRepeat,
        dueDate,
        dueTime: taskData.dueTime !== undefined ? taskData.dueTime : (existing?.dueTime || null),
        completed: existing?.completed || false,
        sortOrder: existing?.sortOrder ?? (parent
          ? this.nextSubtaskSortOrder(parent.id)
          : this.nextRootSortOrder()),
        createdAt: existing?.createdAt || now,
        updatedAt: now
      });

      task.familySlotId = task.parentTaskId
        ? (existing?.familySlotId || taskData.familySlotId || this.createId('slot'))
        : null;

      if (!task.repeat) {
        task.repeatState = null;
      } else {
        const preserve = existing?.repeat && existing?.repeatState &&
          engine().samePattern(existing.repeat, task.repeat) && existing.dueDate === task.dueDate;
        if (preserve) {
          task.repeatState = { ...existing.repeatState, _needsRepair: false };
        } else {
          task.repeatState = engine().createInitialRepeatState(task.repeat, task.dueDate, {
            seriesId: this.createId('series'),
            occurrenceNumber: 1
          });
        }
      }

      return { task, reminderDefinitions: reminderData.definitions };
    },

    async writeTaskAggregate(tx, task, reminderDefinitions = []) {
      const S = TodoDbSchema.STORES;
      const R = TodoRepositories;
      await R.put(tx, S.TASKS, TodoStorageMappers.taskToRow(task));
      await R.replaceRelations(tx, S.TASK_TAGS, 'by_task_id', task.id,
        (task.tags || []).map(tagId => ({ taskId: task.id, tagId })));
      await R.putMany(tx, S.REMINDER_DEFINITIONS, reminderDefinitions);
      const reminderIds = (task.reminders || []).filter(id => id && id !== 'none');
      await R.replaceRelations(tx, S.TASK_REMINDERS, 'by_task_id', task.id,
        reminderIds.map((reminderId, sortOrder) => ({ taskId: task.id, reminderId, sortOrder })));
      const repeatRow = TodoStorageMappers.repeatToRow(task.id, task.repeat, task.repeatState);
      if (repeatRow) await R.put(tx, S.TASK_REPEAT_RULES, repeatRow);
      else await R.remove(tx, S.TASK_REPEAT_RULES, task.id);
    },

    createTask(taskData = {}) {
      return this.enqueue(async () => {
        const { task, reminderDefinitions } = this.buildTask(taskData);
        const S = TodoDbSchema.STORES;
        await TodoDb.withTransaction([
          S.TASKS, S.TASK_TAGS, S.REMINDER_DEFINITIONS, S.TASK_REMINDERS, S.TASK_REPEAT_RULES
        ], 'readwrite', tx => this.writeTaskAggregate(tx, task, reminderDefinitions));
        AppStateSync.upsertReminderDefinitions(reminderDefinitions);
        replaceTaskMemory([], [task]);
        return AppState.getTask(task.id);
      });
    },

    updateTask(taskId, taskData = {}) {
      return this.enqueue(async () => {
        const existing = AppState.getTask(taskId);
        if (!existing) throw new Error('Task not found.');
        const { task, reminderDefinitions } = this.buildTask(taskData, existing);
        const children = !existing.parentTaskId ? AppState.getSubtasks(existing.id) : [];
        const projectChanged = !existing.parentTaskId && existing.project !== task.project;
        const updatedChildren = projectChanged
          ? children.map(child => ({ ...child, project: task.project, updatedAt: task.updatedAt }))
          : [];
        const S = TodoDbSchema.STORES;
        await TodoDb.withTransaction([
          S.TASKS, S.TASK_TAGS, S.REMINDER_DEFINITIONS, S.TASK_REMINDERS, S.TASK_REPEAT_RULES
        ], 'readwrite', async tx => {
          await this.writeTaskAggregate(tx, task, reminderDefinitions);
          for (const child of updatedChildren) {
            await TodoRepositories.put(tx, S.TASKS, TodoStorageMappers.taskToRow(child));
          }
        });
        AppStateSync.upsertReminderDefinitions(reminderDefinitions);
        replaceTaskMemory([task, ...updatedChildren]);
        return AppState.getTask(task.id);
      });
    },

    toggleTaskStatus(taskId) {
      return this.enqueue(async () => {
        const task = AppState.getTask(taskId);
        if (!task) throw new Error('Task not found.');
        if (task.completed) return uncompleteTask(task);
        if (task.parentTaskId) {
          return activeRepeat(task) ? completeRepeatingSubtask(this, task) : completePlainSubtask(task);
        }
        return activeRepeat(task) ? completeRepeatingRoot(this, task) : completeNonRepeatingRoot(task);
      });
    },

    repairRepeatState() {
      return this.enqueue(async () => {
        const changed = [];
        for (const source of AppState.tasks) {
          const task = copyTask(source);
          let dirty = false;
          if (task.parentTaskId && !task.familySlotId) {
            task.familySlotId = this.createId('slot');
            dirty = true;
          }
          if (activeRepeat(task)) {
            if (!task.dueDate) {
              task.dueDate = engine().today();
              dirty = true;
            }
            const previous = task.repeatState || {};
            if (!previous.seriesId || previous._needsRepair) {
              task.repeatState = engine().createInitialRepeatState(task.repeat, task.dueDate, previous);
              task.repeatState.seriesId = previous.seriesId || this.createId('series');
              dirty = true;
            }
            if (task.repeatState) delete task.repeatState._needsRepair;
          }
          if (dirty) changed.push(task);
        }

        if (changed.length) {
          const S = TodoDbSchema.STORES;
          await TodoDb.withTransaction([S.TASKS, S.TASK_REPEAT_RULES], 'readwrite', async tx => {
            for (const task of changed) {
              await TodoRepositories.put(tx, S.TASKS, TodoStorageMappers.taskToRow(task));
              const row = TodoStorageMappers.repeatToRow(task.id, task.repeat, task.repeatState);
              if (row) await TodoRepositories.put(tx, S.TASK_REPEAT_RULES, row);
            }
          });
          replaceTaskMemory(changed);
        }
        return changed.length;
      });
    },

    deleteTaskFamily(taskId) {
      return this.enqueue(async () => {
        const task = AppState.getTask(taskId);
        if (!task) return false;
        const ids = task.parentTaskId ? [task.id] : [task.id, ...AppState.getSubtaskIds(task.id)];
        const S = TodoDbSchema.STORES;
        await TodoDb.withTransaction([
          S.TASKS, S.TASK_TAGS, S.TASK_REMINDERS, S.TASK_REPEAT_RULES
        ], 'readwrite', async tx => {
          for (const id of ids) {
            await TodoRepositories.deleteByIndex(tx, S.TASK_TAGS, 'by_task_id', id);
            await TodoRepositories.deleteByIndex(tx, S.TASK_REMINDERS, 'by_task_id', id);
            await TodoRepositories.remove(tx, S.TASK_REPEAT_RULES, id);
            await TodoRepositories.remove(tx, S.TASKS, id);
          }
        });
        AppStateSync.removeTasks(ids);
        return true;
      });
    },

    setSetting(key, value) {
      return this.enqueue(async () => {
        const S = TodoDbSchema.STORES;
        await TodoDb.withTransaction(S.APP_SETTINGS, 'readwrite', tx =>
          TodoRepositories.put(tx, S.APP_SETTINGS, { key, value })
        );
        AppStateSync.setSetting(key, value);
        return value;
      });
    }
  };

  AppDataService = {
    ...AppDataServiceCore,
    ...DataServiceTaxonomyMethods,
    ...DataServiceReminderMethods,
    ...DataServiceTaxonomyDragMethods,
    ...DataServiceDragMethods,
    ...DataServiceHierarchyMethods
  };

})();

export { AppDataService };
