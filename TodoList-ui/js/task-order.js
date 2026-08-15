export const TaskOrderMethods = {
  compareTaskOrder(a, b) {
    return (a.sortOrder - b.sortOrder) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  },

  orderTasks(tasks = []) {
    const source = [...tasks];
    const roots = source.filter(task => !task.parentTaskId).sort(this.compareTaskOrder);
    const children = new Map();
    source.filter(task => task.parentTaskId).forEach(task => {
      if (!children.has(task.parentTaskId)) children.set(task.parentTaskId, []);
      children.get(task.parentTaskId).push(task);
    });
    children.forEach(items => items.sort(this.compareTaskOrder));

    const ordered = [];
    roots.forEach(root => ordered.push(root, ...(children.get(root.id) || [])));
    const included = new Set(ordered.map(task => task.id));
    source.filter(task => !included.has(task.id)).sort(this.compareTaskOrder).forEach(task => ordered.push(task));
    return ordered;
  },

  getRootTaskSlots() {
    const slots = [];
    this.tasks.forEach((task, index) => {
      if (!task.parentTaskId) slots.push(index);
    });
    return slots;
  },

  getRootTaskIds() {
    return this.tasks.filter(task => !task.parentTaskId).map(task => task.id);
  },

  getSiblingTasks(parentTaskId = null) {
    const parentId = parentTaskId || null;
    return this.tasks
      .filter(task => (task.parentTaskId || null) === parentId)
      .sort(this.compareTaskOrder);
  },

  getSiblingTaskIds(parentTaskId = null) {
    return this.getSiblingTasks(parentTaskId).map(task => task.id);
  },

  getVisibleRootIds(tasks = []) {
    const seen = new Set();
    return tasks.filter(task => {
      if (task.parentTaskId || seen.has(task.id)) return false;
      seen.add(task.id);
      return true;
    }).map(task => task.id);
  },

  getRootOrderSnapshot() {
    return this.getRootTaskIds();
  }
};
