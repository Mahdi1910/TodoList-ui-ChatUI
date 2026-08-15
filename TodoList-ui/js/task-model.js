export const TaskModel = (() => {
  function normalizeTask(task = {}) {
    const source = task && typeof task === 'object' ? task : {};
    const now = new Date().toISOString();
    const legacyTags = Array.isArray(source.tags)
      ? source.tags
      : (source.tag ? String(source.tag).split(',') : []);

    return {
      ...source,
      description: typeof source.description === 'string' ? source.description : '',
      dueDate: typeof source.dueDate === 'string' && source.dueDate ? source.dueDate : null,
      dueTime: typeof source.dueTime === 'string' && source.dueTime ? source.dueTime : null,
      reminders: Array.isArray(source.reminders) ? [...source.reminders] : [],
      repeat: typeof source.repeat === 'object' && source.repeat ? source.repeat : null,
      priority: ['low', 'medium', 'high'].includes(source.priority) ? source.priority : '',
      parentTaskId: typeof source.parentTaskId === 'string' && source.parentTaskId ? source.parentTaskId : null,
      project: typeof source.project === 'string' ? source.project : '',
      tags: [...new Set(legacyTags.map(tag => String(tag).toLowerCase().trim()).filter(Boolean))],
      sortOrder: Number.isFinite(source.sortOrder) ? source.sortOrder : 0,
      createdAt: source.createdAt || now,
      updatedAt: source.updatedAt || source.createdAt || now
    };
  }

  return { normalizeTask };
})();
