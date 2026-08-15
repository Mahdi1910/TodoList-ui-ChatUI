import { TaskRelationMethods } from './task-relations.js';
import { TaskOrderMethods } from './task-order.js';

const seedTime = new Date().toISOString();
export const AppSeedData = {
    projects: [
      { id: 'personal', name: 'Personal', icon: '●', viewType: 'list', parentId: null },
      { id: 'work', name: 'Work', icon: '◆', viewType: 'list', parentId: null }
    ],
    tags: [
      { id: 'urgent', name: 'Urgent', icon: '!', viewType: 'list', parentId: null },
      { id: 'design', name: 'Design', icon: '◆', viewType: 'list', parentId: null },
      { id: 'personal', name: 'Personal', icon: '●', viewType: 'list', parentId: null },
      { id: 'work', name: 'Work', icon: '◆', viewType: 'list', parentId: null }
    ],
    tasks: [
      {
        id: 'task-1', title: 'Design Apple-style UI layout for Todo app', description: '',
        project: 'personal', priority: 'high', tags: ['design'], completed: false, createdAt: seedTime
      },
      {
        id: 'task-2', title: 'Setup modular CSS variables and dark/light themes', description: '',
        project: 'work', priority: 'medium', tags: ['urgent'], completed: true, createdAt: seedTime
      }
    ]
};

const AppStateCore = {
  theme: 'dark',
  isSidebarCollapsed: false,
  currentFilter: 'inbox',
  currentFilterType: 'smart',
  projects: [],
  tags: [],
  tasks: [],
  reminderDefinitions: [],
  settings: { sortKey: 'custom', sortDirection: 'asc', groupKey: 'none' },

  getProject(projectId) {
    return this.projects.find(project => project.id === projectId) || null;
  },

  getProjectDescendantIds(projectId) {
    const ids = [];
    const walk = parentId => this.projects
      .filter(project => project.parentId === parentId)
      .forEach(child => {
        ids.push(child.id);
        walk(child.id);
      });
    walk(projectId);
    return ids;
  },

  isProjectDescendant(projectId, possibleAncestorId) {
    let current = this.getProject(projectId);
    const seen = new Set();
    while (current?.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.parentId === possibleAncestorId) return true;
      current = this.getProject(current.parentId);
    }
    return false;
  },

  getTag(tagId) {
    return this.tags.find(tag => tag.id === tagId) || null;
  },

  getTagDescendantIds(tagId) {
    const ids = [];
    const walk = parentId => this.tags
      .filter(tag => tag.parentId === parentId)
      .forEach(child => {
        ids.push(child.id);
        walk(child.id);
      });
    walk(tagId);
    return ids;
  },

  getTagTreeTaskIds(tagId) {
    return [tagId, ...this.getTagDescendantIds(tagId)];
  },

  isTagDescendant(tagId, possibleAncestorId) {
    let current = this.getTag(tagId);
    const seen = new Set();
    while (current?.parentId && !seen.has(current.id)) {
      seen.add(current.id);
      if (current.parentId === possibleAncestorId) return true;
      current = this.getTag(current.parentId);
    }
    return false;
  },

  getReminderDefinition(reminderId) {
    return this.reminderDefinitions.find(definition => definition.id === reminderId) || null;
  },

  getCustomReminderDefinitions() {
    return this.reminderDefinitions.filter(definition => !definition.isBuiltin);
  },

  matchesFilter(task) {
    if (!task) return false;
    if (this.currentFilterType === 'project') {
      return [this.currentFilter, ...this.getProjectDescendantIds(this.currentFilter)].includes(task.project);
    }
    if (this.currentFilterType === 'tag') {
      const ids = this.getTagTreeTaskIds(this.currentFilter);
      return (task.tags || []).some(tagId => ids.includes(tagId));
    }
    if (this.currentFilter === 'completed') return Boolean(task.completed);
    if (this.currentFilter === 'today') return this.isTodayDate(task.dueDate);
    if (this.currentFilter === 'inbox') return !task.project;
    return !task.completed;
  },

  getTodayDateStr() {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  },

  isTodayDate(dateStr) {
    return typeof dateStr === 'string' && dateStr === this.getTodayDateStr();
  },

  getFilteredTasks() {
    return this.tasks.filter(task => this.matchesFilter(task));
  },

  getActiveTasks() {
    return this.tasks.filter(task => !task.completed);
  },

  getCompletedTasks() {
    return this.tasks.filter(task => task.completed);
  },

  countInbox() {
    return this.tasks.filter(task => !task.completed && !task.project).length;
  },

  countToday() {
    return this.tasks.filter(task => !task.completed && this.isTodayDate(task.dueDate)).length;
  },

  countCompleted() {
    return this.tasks.filter(task => task.completed).length;
  },

  countProject(projectId) {
    const ids = [projectId, ...this.getProjectDescendantIds(projectId)];
    return this.tasks.filter(task => !task.completed && ids.includes(task.project)).length;
  },

  countTag(tagId) {
    const ids = this.getTagTreeTaskIds(tagId);
    return this.tasks.filter(task => !task.completed && (task.tags || []).some(id => ids.includes(id))).length;
  }

};

export const AppState = {
  ...AppStateCore,
  ...TaskRelationMethods,
  ...TaskOrderMethods
};
