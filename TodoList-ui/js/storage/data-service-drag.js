import { TodoStorageMappers } from './mappers.js';
import { TodoRepositories } from './repositories.js';
import { TodoDb } from './db.js';
import { TodoDbSchema } from './db-schema.js';
import { AppState } from '../state.js';
import { AppStateSync } from '../state-sync.js';
export const DataServiceDragMethods = {
  customOrderScopeKey(parentTaskId = null) {
    return parentTaskId || '__root__';
  },

  validateCustomOrderSnapshot(orderSnapshot = []) {
    if (!Array.isArray(orderSnapshot) || !orderSnapshot.length) {
      throw new Error('Custom order snapshot is missing.');
    }

    const scopes = new Map();
    const seenTaskIds = new Set();

    orderSnapshot.forEach(rawScope => {
      const parentTaskId = rawScope?.parentTaskId || null;
      const key = this.customOrderScopeKey(parentTaskId);
      if (scopes.has(key)) throw new Error('Custom order snapshot contains a duplicate sibling scope.');
      if (!Array.isArray(rawScope?.orderedIds)) throw new Error('Custom order snapshot contains an invalid scope.');

      const localIds = new Set();
      const orderedIds = rawScope.orderedIds.map(id => {
        if (typeof id !== 'string' || !id) throw new Error('Custom order snapshot contains an invalid task ID.');
        if (localIds.has(id) || seenTaskIds.has(id)) throw new Error('Custom order snapshot contains a duplicate task.');
        const task = AppState.getTask(id);
        if (!task) throw new Error('Custom order snapshot references a missing task.');
        if ((task.parentTaskId || null) !== parentTaskId) {
          throw new Error('Custom order snapshot contains a task in the wrong sibling scope.');
        }
        localIds.add(id);
        seenTaskIds.add(id);
        return id;
      });

      const expectedIds = AppState.getSiblingTaskIds(parentTaskId);
      if (orderedIds.length !== expectedIds.length || expectedIds.some(id => !localIds.has(id))) {
        throw new Error('Custom order snapshot does not cover a complete sibling scope.');
      }

      scopes.set(key, { parentTaskId, orderedIds });
    });

    const expectedParents = [
      null,
      ...AppState.getRootTasks()
        .filter(task => AppState.hasSubtasks(task.id))
        .map(task => task.id)
    ];

    if (scopes.size !== expectedParents.length) {
      throw new Error('Custom order snapshot does not cover the complete task hierarchy.');
    }

    return expectedParents.map(parentTaskId => {
      const scope = scopes.get(this.customOrderScopeKey(parentTaskId));
      if (!scope) throw new Error('Custom order snapshot is missing a sibling scope.');
      return scope;
    });
  },

  applyCustomOrderSnapshot(copies, changedIds, orderSnapshot) {
    const normalized = this.validateCustomOrderSnapshot(orderSnapshot);
    normalized.forEach(scope => {
      scope.orderedIds.forEach((id, sortOrder) => {
        const copy = copies.get(id);
        if (!copy) throw new Error('Custom order snapshot could not be applied.');
        if (copy.sortOrder !== sortOrder) {
          copy.sortOrder = sortOrder;
          changedIds.add(id);
        }
      });
    });
    return normalized;
  },

  getCustomOrderScopeIds(normalizedSnapshot, parentTaskId = null, excludeTaskId = null) {
    const key = this.customOrderScopeKey(parentTaskId);
    const scope = normalizedSnapshot.find(item => this.customOrderScopeKey(item.parentTaskId) === key);
    if (!scope) throw new Error('Custom order snapshot is missing the requested sibling scope.');
    return scope.orderedIds.filter(id => id !== excludeTaskId);
  },

  activateCustomSort(orderSnapshot) {
    return this.enqueue(async () => {
      const copies = new Map(AppState.tasks.map(task => [task.id, {
        ...task,
        tags: [...(task.tags || [])],
        reminders: [...(task.reminders || [])]
      }]));
      const changed = new Set();
      this.applyCustomOrderSnapshot(copies, changed, orderSnapshot);

      const S = TodoDbSchema.STORES;
      await TodoDb.withTransaction([S.TASKS, S.APP_SETTINGS], 'readwrite', async tx => {
        for (const id of changed) {
          await TodoRepositories.put(tx, S.TASKS, TodoStorageMappers.taskToRow(copies.get(id)));
        }
        await TodoRepositories.put(tx, S.APP_SETTINGS, { key: 'sortKey', value: 'custom' });
      });

      if (changed.size) {
        AppStateSync.replaceTasks([...changed].map(id => copies.get(id)));
      }
      AppStateSync.setSetting('sortKey', 'custom');
      return true;
    });
  },

  commitTaskDrag({ taskId, orderedVisibleIds = [], sourceContext = null, destination = null } = {}) {
    return this.enqueue(async () => {
      const task = AppState.getTask(taskId);
      if (!task || task.parentTaskId) throw new Error('Only root tasks can be reordered.');

      const currentRootIds = AppState.getRootTaskIds();
      const visibleIds = [...new Set(orderedVisibleIds)].filter(id => currentRootIds.includes(id));
      const visibleSet = new Set(visibleIds);
      let visibleIndex = 0;
      const nextRootIds = currentRootIds.map(id => visibleSet.has(id) ? visibleIds[visibleIndex++] : id);
      const orderById = new Map(nextRootIds.map((id, index) => [id, index]));
      const rootCopies = new Map(AppState.getRootTasks().map(item => [item.id, {
        ...item, sortOrder: orderById.get(item.id) ?? item.sortOrder
      }]));

      const sameGroup = sourceContext && destination &&
        sourceContext.groupType !== 'none' && sourceContext.groupType === destination.groupType;
      const metadataChanged = Boolean(sameGroup && sourceContext.groupKey !== destination.groupKey);
      const moved = rootCopies.get(taskId);
      const key = destination?.groupKey ?? '';
      let nextTags = [...task.tags];
      let projectChanged = false;

      if (metadataChanged) {
        if (destination.groupType === 'priority') {
          if (!['', 'low', 'medium', 'high'].includes(key)) throw new Error('Invalid priority destination.');
          moved.priority = key;
        } else if (destination.groupType === 'date') {
          moved.dueDate = key || null;
        } else if (destination.groupType === 'project') {
          moved.project = this.validateProjectId(key || '');
          projectChanged = moved.project !== task.project;
        } else if (destination.groupType === 'tag') {
          if (key) this.validateTagIds([key]);
          nextTags = sourceContext.groupKey ? nextTags.filter(tag => tag !== sourceContext.groupKey) : nextTags;
          if (key && !nextTags.includes(key)) nextTags.push(key);
          moved.tags = nextTags;
        }
        moved.updatedAt = TodoStorageMappers.nowIso();
      }

      const updatedChildren = projectChanged
        ? AppState.getSubtasks(taskId).map(child => ({
          ...child, project: moved.project, updatedAt: moved.updatedAt
        }))
        : [];
      const S = TodoDbSchema.STORES;
      const stores = [S.TASKS, S.APP_SETTINGS];
      if (metadataChanged && destination.groupType === 'tag') stores.push(S.TASK_TAGS);

      await TodoDb.withTransaction(stores, 'readwrite', async tx => {
        for (const root of rootCopies.values()) {
          await TodoRepositories.put(tx, S.TASKS, TodoStorageMappers.taskToRow(root));
        }
        for (const child of updatedChildren) {
          await TodoRepositories.put(tx, S.TASKS, TodoStorageMappers.taskToRow(child));
        }
        if (metadataChanged && destination.groupType === 'tag') {
          await TodoRepositories.replaceRelations(tx, S.TASK_TAGS, 'by_task_id', taskId,
            nextTags.map(tagId => ({ taskId, tagId })));
        }
        await TodoRepositories.put(tx, S.APP_SETTINGS, { key: 'sortKey', value: 'custom' });
      });

      AppStateSync.replaceTasks([...rootCopies.values(), ...updatedChildren]);
      AppStateSync.setSetting('sortKey', 'custom');
      return true;
    });
  }
};
