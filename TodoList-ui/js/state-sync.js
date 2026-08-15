import { AppState } from './state.js';
import { TaskModel } from './task-model.js';
import { TaskOrderMethods } from './task-order.js';

export const AppStateSync = (() => {
  const state = () => AppState;
  const normalizeTask = task => TaskModel.normalizeTask(task);

  function orderTasks(tasks = []) {
    return TaskOrderMethods.orderTasks(tasks);
  }

  function hydrate({ projects = [], tags = [], tasks = [], reminderDefinitions = [], settings = {} } = {}) {
    const appState = state();
    appState.projects = projects.map(item => ({ ...item }));
    appState.tags = tags.map(item => ({ ...item }));
    appState.tasks = orderTasks(tasks.map(normalizeTask));
    appState.reminderDefinitions = reminderDefinitions.map(item => ({ ...item }));
    appState.settings = { sortKey: 'custom', sortDirection: 'asc', groupKey: 'none', ...settings };
    return appState;
  }

  function replaceTasks(changedTasks = [], additions = []) {
    const appState = state();
    const changed = new Map(changedTasks.filter(Boolean).map(task => {
      const normalized = normalizeTask(task);
      return [normalized.id, normalized];
    }));
    const existingIds = new Set(appState.tasks.map(task => task.id));
    const next = appState.tasks.map(task => changed.get(task.id) || task);

    additions.filter(Boolean).forEach(task => {
      const normalized = normalizeTask(task);
      if (changed.has(normalized.id)) return;
      if (existingIds.has(normalized.id)) {
        const index = next.findIndex(item => item.id === normalized.id);
        if (index >= 0) next[index] = normalized;
      } else {
        next.push(normalized);
        existingIds.add(normalized.id);
      }
    });

    changed.forEach((task, id) => {
      if (!existingIds.has(id)) {
        next.push(task);
        existingIds.add(id);
      }
    });

    appState.tasks = orderTasks(next);
    return appState.tasks;
  }

  function removeTasks(taskIds = []) {
    const ids = new Set(taskIds);
    if (!ids.size) return state().tasks;
    state().tasks = orderTasks(state().tasks.filter(task => !ids.has(task.id)));
    return state().tasks;
  }

  function taxonomyItems(entityType) {
    return entityType === 'tag' ? state().tags : state().projects;
  }

  function setTaxonomyItems(entityType, items) {
    if (entityType === 'tag') state().tags = items;
    else state().projects = items;
  }

  function upsertTaxonomyEntity(entityType, entity) {
    if (!entity?.id) return null;
    const items = taxonomyItems(entityType);
    const copy = { ...entity };
    const index = items.findIndex(item => item.id === copy.id);
    if (index >= 0) items[index] = copy;
    else items.push(copy);
    return copy;
  }

  function applyTaxonomyChanges(entityType, copies, changedIds) {
    const items = taxonomyItems(entityType);
    const changed = changedIds instanceof Set ? changedIds : new Set(changedIds || []);
    const byId = new Map(items.map(item => [item.id, item]));
    changed.forEach(id => {
      const copy = copies?.get?.(id);
      if (copy) byId.set(id, { ...copy });
    });
    setTaxonomyItems(entityType, items.map(item => byId.get(item.id) || item));
    return taxonomyItems(entityType);
  }

  function removeTaxonomyEntity(entityType, entityId) {
    setTaxonomyItems(entityType, taxonomyItems(entityType).filter(item => item.id !== entityId));
    const filterType = entityType === 'tag' ? 'tag' : 'project';
    if (state().currentFilterType === filterType && state().currentFilter === entityId) {
      state().currentFilter = 'inbox';
      state().currentFilterType = 'smart';
    }
  }

  function upsertReminderDefinitions(definitions = []) {
    const appState = state();
    const byId = new Map(appState.reminderDefinitions.map(item => [item.id, item]));
    definitions.filter(Boolean).forEach(definition => {
      if (definition.id) byId.set(definition.id, { ...definition });
    });
    appState.reminderDefinitions = [...byId.values()];
    return appState.reminderDefinitions;
  }

  function removeReminderDefinition(reminderId) {
    state().reminderDefinitions = state().reminderDefinitions.filter(item => item.id !== reminderId);
    return state().reminderDefinitions;
  }

  function removeReminderFromTasks(reminderId) {
    const changed = state().tasks
      .filter(task => (task.reminders || []).includes(reminderId))
      .map(task => {
        const reminders = (task.reminders || []).filter(id => id !== reminderId);
        return { ...task, reminders: reminders.length ? reminders : ['none'] };
      });
    if (changed.length) replaceTasks(changed);
    return changed;
  }

  function setSetting(key, value) {
    state().settings = { ...state().settings, [key]: value };
    return value;
  }

  return {
    hydrate,
    replaceTasks,
    removeTasks,
    upsertTaxonomyEntity,
    applyTaxonomyChanges,
    removeTaxonomyEntity,
    upsertReminderDefinitions,
    removeReminderDefinition,
    removeReminderFromTasks,
    setSetting
  };
})();
