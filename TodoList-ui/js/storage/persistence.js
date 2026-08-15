import { TodoDbSchema } from './db-schema.js';
import { TodoDb } from './db.js';
import { TodoRepositories } from './repositories.js';
import { TodoStorageMappers } from './mappers.js';
import { TaskModel } from '../task-model.js';
import { AppSeedData, AppState } from '../state.js';
import { AppStateSync } from '../state-sync.js';

export const AppPersistence = (() => {
  const { STORES } = TodoDbSchema;
  const allStores = Object.values(STORES);
  const repo = () => TodoRepositories;
  const mapper = () => TodoStorageMappers;

  async function initialize() {
    await TodoDb.open();
    const initialized = await TodoDb.withTransaction(STORES.APP_META, 'readonly', tx =>
      repo().get(tx, STORES.APP_META, 'initialized')
    );
    if (!initialized?.value) await seedFirstRun();
  }

  async function seedFirstRun() {
    const seed = AppSeedData;
    const now = mapper().nowIso();
    await TodoDb.withTransaction(allStores, 'readwrite', async tx => {
      const projects = (seed.projects || []).map((item, index) => ({
        ...item, parentId: item.parentId || null, sortOrder: index, createdAt: now, updatedAt: now
      }));
      const tags = (seed.tags || []).map((item, index) => ({
        ...item, parentId: item.parentId || null, sortOrder: index, createdAt: now, updatedAt: now
      }));
      const validTags = new Set(tags.map(item => item.id));
      const tasks = (seed.tasks || []).map((item, index) => TaskModel.normalizeTask({
        ...item, sortOrder: index, createdAt: item.createdAt || now, updatedAt: now
      }));

      await repo().putMany(tx, STORES.PROJECTS, projects);
      await repo().putMany(tx, STORES.TAGS, tags);
      await repo().putMany(tx, STORES.REMINDER_DEFINITIONS, mapper().builtinDefinitions());

      for (const task of tasks) {
        await repo().put(tx, STORES.TASKS, mapper().taskToRow(task));
        const tagRows = task.tags.filter(id => validTags.has(id)).map(tagId => ({ taskId: task.id, tagId }));
        await repo().putMany(tx, STORES.TASK_TAGS, tagRows);
        const reminderIds = (task.reminders || []).filter(id => id && id !== 'none');
        await repo().putMany(tx, STORES.TASK_REMINDERS,
          reminderIds.map((reminderId, sortOrder) => ({ taskId: task.id, reminderId, sortOrder })));
        const repeatRow = mapper().repeatToRow(task.id, task.repeat);
        if (repeatRow) await repo().put(tx, STORES.TASK_REPEAT_RULES, repeatRow);
      }

      await repo().putMany(tx, STORES.APP_SETTINGS, [
        { key: 'sortKey', value: 'custom' },
        { key: 'sortDirection', value: 'asc' },
        { key: 'groupKey', value: 'none' }
      ]);
      await repo().put(tx, STORES.APP_META, { key: 'dataVersion', value: 1 });
      await repo().put(tx, STORES.APP_META, { key: 'initialized', value: true });
    });
  }

  async function readAll() {
    return TodoDb.withTransaction(allStores, 'readonly', async tx => {
      const [projects, tags, tasks, taskTags, reminderDefinitions, taskReminders, repeatRules, settings] = await Promise.all([
        repo().getAll(tx, STORES.PROJECTS), repo().getAll(tx, STORES.TAGS), repo().getAll(tx, STORES.TASKS),
        repo().getAll(tx, STORES.TASK_TAGS), repo().getAll(tx, STORES.REMINDER_DEFINITIONS),
        repo().getAll(tx, STORES.TASK_REMINDERS), repo().getAll(tx, STORES.TASK_REPEAT_RULES),
        repo().getAll(tx, STORES.APP_SETTINGS)
      ]);
      return { projects, tags, tasks, taskTags, reminderDefinitions, taskReminders, repeatRules, settings };
    });
  }

  function repairHierarchy(rows) {
    const byId = new Map(rows.map(row => [row.id, row]));
    const changed = new Set();
    for (const row of rows) {
      if (!row.parentId) continue;
      if (!byId.has(row.parentId) || row.parentId === row.id) {
        row.parentId = null;
        changed.add(row);
        continue;
      }
      const seen = new Set([row.id]);
      let cursor = row;
      while (cursor?.parentId) {
        if (seen.has(cursor.parentId)) {
          row.parentId = null;
          changed.add(row);
          break;
        }
        seen.add(cursor.parentId);
        cursor = byId.get(cursor.parentId);
        if (!cursor) break;
      }
    }
    return [...changed];
  }

  function repairData(data) {
    const repairs = { projects: repairHierarchy(data.projects), tags: repairHierarchy(data.tags), tasks: [], taskTags: [], taskReminders: [], repeatRules: [] };
    const projectIds = new Set(data.projects.map(row => row.id));
    const taskById = new Map(data.tasks.map(row => [row.id, row]));
    const tagIds = new Set(data.tags.map(row => row.id));
    const reminderIds = new Set(data.reminderDefinitions.map(row => row.id));

    for (const task of data.tasks) {
      let changed = false;
      if (task.projectId && !projectIds.has(task.projectId)) { task.projectId = null; changed = true; }
      if (task.parentTaskId) {
        const parent = taskById.get(task.parentTaskId);
        if (!parent || parent.id === task.id || parent.parentTaskId) {
          task.parentTaskId = null;
          changed = true;
        } else if ((task.projectId || null) !== (parent.projectId || null)) {
          task.projectId = parent.projectId || null;
          changed = true;
        }
      }
      if (changed) repairs.tasks.push(task);
    }

    data.taskTags = data.taskTags.filter(row => {
      const valid = taskById.has(row.taskId) && tagIds.has(row.tagId);
      if (!valid) repairs.taskTags.push(row);
      return valid;
    });
    data.taskReminders = data.taskReminders.filter(row => {
      const valid = taskById.has(row.taskId) && reminderIds.has(row.reminderId);
      if (!valid) repairs.taskReminders.push(row);
      return valid;
    });
    data.repeatRules = data.repeatRules.filter(row => {
      const valid = taskById.has(row.taskId);
      if (!valid) repairs.repeatRules.push(row);
      return valid;
    });
    return repairs;
  }

  async function persistRepairs(repairs) {
    const hasRepairs = Object.values(repairs).some(items => items.length);
    if (!hasRepairs) return;
    console.warn('TodoListDB repaired invalid relationships during hydration.', repairs);
    await TodoDb.withTransaction([
      STORES.PROJECTS, STORES.TAGS, STORES.TASKS, STORES.TASK_TAGS, STORES.TASK_REMINDERS, STORES.TASK_REPEAT_RULES
    ], 'readwrite', async tx => {
      await repo().putMany(tx, STORES.PROJECTS, repairs.projects);
      await repo().putMany(tx, STORES.TAGS, repairs.tags);
      await repo().putMany(tx, STORES.TASKS, repairs.tasks);
      await repo().deleteMany(tx, STORES.TASK_TAGS, repairs.taskTags.map(row => [row.taskId, row.tagId]));
      await repo().deleteMany(tx, STORES.TASK_REMINDERS, repairs.taskReminders.map(row => [row.taskId, row.reminderId]));
      await repo().deleteMany(tx, STORES.TASK_REPEAT_RULES, repairs.repeatRules.map(row => row.taskId));
    });
  }

  async function hydrateState() {
    const data = await readAll();
    const repairs = repairData(data);
    await persistRepairs(repairs);

    const tagsByTask = new Map();
    data.taskTags.forEach(row => {
      if (!tagsByTask.has(row.taskId)) tagsByTask.set(row.taskId, []);
      tagsByTask.get(row.taskId).push(row.tagId);
    });
    const remindersByTask = new Map();
    [...data.taskReminders].sort((a, b) => a.sortOrder - b.sortOrder).forEach(row => {
      if (!remindersByTask.has(row.taskId)) remindersByTask.set(row.taskId, []);
      remindersByTask.get(row.taskId).push(row.reminderId);
    });
    const repeatByTask = new Map(data.repeatRules.map(row => [row.taskId, mapper().repeatFromRow(row)]));
    const tasks = [...data.tasks].sort((a, b) => a.sortOrder - b.sortOrder).map(row => mapper().taskFromRow(
      row,
      tagsByTask.get(row.id) || [],
      remindersByTask.has(row.id) ? remindersByTask.get(row.id) : ['none'],
      repeatByTask.get(row.id) || null
    ));
    const settings = Object.fromEntries(data.settings.map(item => [item.key, item.value]));

    AppStateSync.hydrate({
      projects: [...data.projects].sort((a, b) => a.sortOrder - b.sortOrder),
      tags: [...data.tags].sort((a, b) => a.sortOrder - b.sortOrder),
      tasks,
      reminderDefinitions: data.reminderDefinitions,
      settings
    });
    return AppState;
  }

  function reportError(message, error) {
    console.error(message, error);
    let banner = document.getElementById('storage-error-banner');
    if (!banner) {
      banner = document.createElement('div');
      banner.id = 'storage-error-banner';
      Object.assign(banner.style, {
        position: 'fixed', left: '50%', bottom: '18px', transform: 'translateX(-50%)', zIndex: '9999',
        maxWidth: 'min(520px, calc(100vw - 24px))', padding: '10px 14px', borderRadius: '10px',
        background: 'var(--bg-secondary, #171717)', color: 'var(--text-primary, #fff)',
        border: '1px solid var(--border-color, #444)', boxShadow: '0 8px 30px rgba(0,0,0,.35)', fontSize: '13px'
      });
      document.body.appendChild(banner);
    }
    banner.textContent = message;
    clearTimeout(reportError.timer);
    reportError.timer = setTimeout(() => banner.remove(), 7000);
  }

  return { initialize, hydrateState, reportError };
})();
