export const TodoDbSchema = (() => {
  const NAME = 'TodoListDB';
  const VERSION = 1;
  const STORES = Object.freeze({
    PROJECTS: 'projects',
    TAGS: 'tags',
    TASKS: 'tasks',
    TASK_TAGS: 'task_tags',
    REMINDER_DEFINITIONS: 'reminder_definitions',
    TASK_REMINDERS: 'task_reminders',
    TASK_REPEAT_RULES: 'task_repeat_rules',
    APP_SETTINGS: 'app_settings',
    APP_META: 'app_meta'
  });

  function createIndex(store, name, keyPath, options = {}) {
    if (!store.indexNames.contains(name)) store.createIndex(name, keyPath, options);
  }

  function createV1(db) {
    const projects = db.createObjectStore(STORES.PROJECTS, { keyPath: 'id' });
    createIndex(projects, 'by_parent_id', 'parentId');
    createIndex(projects, 'by_sort_order', 'sortOrder');

    const tags = db.createObjectStore(STORES.TAGS, { keyPath: 'id' });
    createIndex(tags, 'by_parent_id', 'parentId');
    createIndex(tags, 'by_sort_order', 'sortOrder');

    const tasks = db.createObjectStore(STORES.TASKS, { keyPath: 'id' });
    createIndex(tasks, 'by_project_id', 'projectId');
    createIndex(tasks, 'by_parent_task_id', 'parentTaskId');
    createIndex(tasks, 'by_completed', 'completed');
    createIndex(tasks, 'by_due_date', 'dueDate');
    createIndex(tasks, 'by_sort_order', 'sortOrder');
    createIndex(tasks, 'by_created_at', 'createdAt');

    const taskTags = db.createObjectStore(STORES.TASK_TAGS, { keyPath: ['taskId', 'tagId'] });
    createIndex(taskTags, 'by_task_id', 'taskId');
    createIndex(taskTags, 'by_tag_id', 'tagId');

    db.createObjectStore(STORES.REMINDER_DEFINITIONS, { keyPath: 'id' });

    const taskReminders = db.createObjectStore(STORES.TASK_REMINDERS, { keyPath: ['taskId', 'reminderId'] });
    createIndex(taskReminders, 'by_task_id', 'taskId');
    createIndex(taskReminders, 'by_reminder_id', 'reminderId');

    db.createObjectStore(STORES.TASK_REPEAT_RULES, { keyPath: 'taskId' });
    db.createObjectStore(STORES.APP_SETTINGS, { keyPath: 'key' });
    db.createObjectStore(STORES.APP_META, { keyPath: 'key' });
  }

  function upgrade(db, oldVersion) {
    if (oldVersion < 1) createV1(db);
  }

  return { NAME, VERSION, STORES, upgrade };
})();
