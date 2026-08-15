import { TodoDbSchema } from './db-schema.js';

export const AppBackupValidation = (() => {
  const FORMAT = 'TodoListBackup';
  const FORMAT_VERSION = 1;
  const DATA_VERSION = 1;

  const isObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
  const isId = value => typeof value === 'string' && value.length > 0;
  const keyPair = (a, b) => `${a}\u0000${b}`;

  function fail(message) {
    throw new Error(message);
  }

  function requireUnique(rows, keyOf, label) {
    const seen = new Set();
    rows.forEach((row, index) => {
      const key = keyOf(row);
      if (key === null || key === undefined || key === '') fail(`${label} row ${index + 1} has an invalid key.`);
      if (seen.has(key)) fail(`${label} contains a duplicate key.`);
      seen.add(key);
    });
  }

  function requireOrderedEntity(row, label) {
    if (!isObject(row) || !isId(row.id)) fail(`${label} has an invalid id.`);
    if (row.parentId !== null && row.parentId !== undefined && !isId(row.parentId)) fail(`${label} has an invalid parent id.`);
    if (!Number.isFinite(row.sortOrder)) fail(`${label} has an invalid sort order.`);
  }

  function validateHierarchy(rows, label) {
    const byId = new Map(rows.map(row => [row.id, row]));
    for (const row of rows) {
      if (!row.parentId) continue;
      if (row.parentId === row.id) fail(`${label} cannot be its own parent.`);
      if (!byId.has(row.parentId)) fail(`${label} references a missing parent.`);
      const seen = new Set([row.id]);
      let cursor = row;
      while (cursor?.parentId) {
        if (seen.has(cursor.parentId)) fail(`${label} hierarchy contains a cycle.`);
        seen.add(cursor.parentId);
        cursor = byId.get(cursor.parentId);
      }
    }
  }

  function validateEnvelope(snapshot) {
    if (!isObject(snapshot) || snapshot.format !== FORMAT) fail('This is not a TodoList backup file.');
    if (!Number.isInteger(snapshot.formatVersion)) fail('This backup has an invalid format version.');
    if (snapshot.formatVersion > FORMAT_VERSION) fail('This backup was created by a newer unsupported data format.');
    if (snapshot.formatVersion !== FORMAT_VERSION) fail('This backup format version is not supported.');
    if (typeof snapshot.createdAt !== 'string' || !Number.isFinite(Date.parse(snapshot.createdAt))) fail('This backup has an invalid creation date.');
    if (!isObject(snapshot.database) || !isObject(snapshot.stores) || !isObject(snapshot.preferences)) fail('This backup is missing required metadata.');
    if (snapshot.database.name !== TodoDbSchema.NAME) fail('This backup belongs to a different database.');
    if (!Number.isInteger(snapshot.database.schemaVersion) || snapshot.database.schemaVersion > TodoDbSchema.VERSION) {
      fail('This backup uses a newer unsupported database schema.');
    }
    if (!Number.isInteger(snapshot.database.dataVersion) || snapshot.database.dataVersion > DATA_VERSION) {
      fail('This backup uses a newer unsupported data version.');
    }
  }

  function validateStores(stores) {
    const names = Object.values(TodoDbSchema.STORES);
    names.forEach(name => { if (!Array.isArray(stores[name])) fail(`Backup store "${name}" is missing or invalid.`); });

    const { projects, tags, tasks, task_tags: taskTags, reminder_definitions: definitions,
      task_reminders: taskReminders, task_repeat_rules: repeatRules,
      app_settings: settings, app_meta: meta } = stores;

    projects.forEach(row => requireOrderedEntity(row, 'Project'));
    tags.forEach(row => requireOrderedEntity(row, 'Tag'));
    tasks.forEach(row => {
      if (!isObject(row) || !isId(row.id)) fail('A Task has an invalid id.');
      if (row.projectId !== null && row.projectId !== undefined && !isId(row.projectId)) fail('A Task has an invalid project id.');
      if (row.parentTaskId !== null && row.parentTaskId !== undefined && !isId(row.parentTaskId)) fail('A Task has an invalid parent id.');
      if (!Number.isFinite(row.sortOrder)) fail('A Task has an invalid sort order.');
      if (![0, 1].includes(row.completed)) fail('A Task has an invalid completion value.');
    });
    taskTags.forEach(row => { if (!isObject(row) || !isId(row.taskId) || !isId(row.tagId)) fail('A Task-Tag relation is invalid.'); });
    definitions.forEach(row => { if (!isObject(row) || !isId(row.id)) fail('A reminder definition has an invalid id.'); });
    taskReminders.forEach(row => {
      if (!isObject(row) || !isId(row.taskId) || !isId(row.reminderId) || !Number.isFinite(row.sortOrder)) fail('A Task-Reminder relation is invalid.');
    });
    repeatRules.forEach(row => {
      if (!isObject(row) || !isId(row.taskId)) fail('A Repeat rule has an invalid Task id.');
      if (row.weekdays !== undefined && !Array.isArray(row.weekdays)) fail('A Repeat rule has invalid weekdays.');
      if (row.monthDays !== undefined && !Array.isArray(row.monthDays)) fail('A Repeat rule has invalid month days.');
      if (row.yearDates !== undefined && !isObject(row.yearDates)) fail('A Repeat rule has invalid year dates.');
    });
    settings.forEach(row => { if (!isObject(row) || !isId(row.key)) fail('An application setting has an invalid key.'); });
    meta.forEach(row => { if (!isObject(row) || !isId(row.key)) fail('An application metadata row has an invalid key.'); });

    requireUnique(projects, row => row.id, 'Projects');
    requireUnique(tags, row => row.id, 'Tags');
    requireUnique(tasks, row => row.id, 'Tasks');
    requireUnique(taskTags, row => keyPair(row.taskId, row.tagId), 'Task-Tag relations');
    requireUnique(definitions, row => row.id, 'Reminder definitions');
    requireUnique(taskReminders, row => keyPair(row.taskId, row.reminderId), 'Task-Reminder relations');
    requireUnique(repeatRules, row => row.taskId, 'Repeat rules');
    requireUnique(settings, row => row.key, 'Application settings');
    requireUnique(meta, row => row.key, 'Application metadata');

    validateHierarchy(projects, 'Project');
    validateHierarchy(tags, 'Tag');

    const projectIds = new Set(projects.map(row => row.id));
    const tagIds = new Set(tags.map(row => row.id));
    const taskById = new Map(tasks.map(row => [row.id, row]));
    const reminderIds = new Set(definitions.map(row => row.id));

    tasks.forEach(row => {
      if (row.projectId && !projectIds.has(row.projectId)) fail('A Task references a missing Project.');
      if (!row.parentTaskId) return;
      if (row.parentTaskId === row.id) fail('A Task cannot be its own parent.');
      const parent = taskById.get(row.parentTaskId);
      if (!parent) fail('A Subtask references a missing parent Task.');
      if (parent.parentTaskId) fail('A Subtask cannot be nested below another Subtask.');
    });
    taskTags.forEach(row => {
      if (!taskById.has(row.taskId) || !tagIds.has(row.tagId)) fail('A Task-Tag relation references missing data.');
    });
    taskReminders.forEach(row => {
      if (!taskById.has(row.taskId) || !reminderIds.has(row.reminderId)) fail('A Task-Reminder relation references missing data.');
    });
    repeatRules.forEach(row => { if (!taskById.has(row.taskId)) fail('A Repeat rule references a missing Task.'); });
  }

  function validate(snapshot) {
    validateEnvelope(snapshot);
    validateStores(snapshot.stores);
    const theme = snapshot.preferences.theme === 'light' ? 'light' : 'dark';
    return { ...snapshot, preferences: { ...snapshot.preferences, theme } };
  }

  function summary(snapshot) {
    return {
      createdAt: snapshot.createdAt,
      tasks: snapshot.stores.tasks.length,
      projects: snapshot.stores.projects.length,
      tags: snapshot.stores.tags.length
    };
  }

  return { FORMAT, FORMAT_VERSION, DATA_VERSION, validate, summary };
})();
