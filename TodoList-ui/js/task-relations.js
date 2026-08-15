export const TaskRelationMethods = {
    getTask(taskId) {
      return this.tasks.find(task => task.id === taskId) || null;
    },

    isSubtask(taskOrId) {
      const task = typeof taskOrId === 'string' ? this.getTask(taskOrId) : taskOrId;
      return Boolean(task?.parentTaskId);
    },

    getSubtasks(parentTaskId) {
      return this.tasks.filter(task => task.parentTaskId === parentTaskId);
    },

    getSubtaskIds(parentTaskId) {
      return this.getSubtasks(parentTaskId).map(task => task.id);
    },

    hasSubtasks(parentTaskId) {
      return this.tasks.some(task => task.parentTaskId === parentTaskId);
    },

    getRootTasks(tasks = this.tasks) {
      return tasks.filter(task => !task.parentTaskId);
    },

    validateParentTaskId(parentTaskId) {
      if (!parentTaskId || typeof parentTaskId !== 'string') return null;
      const parent = this.getTask(parentTaskId);
      if (!parent || parent.parentTaskId) return null;
      return parent;
    }
};
