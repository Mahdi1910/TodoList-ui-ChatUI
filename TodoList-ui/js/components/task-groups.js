import { AppState } from '../state.js';
export const TaskGroupMethods = {
  getTaskGroups(tasks, groupKey) {
    if (groupKey === 'priority') return this.getPriorityGroups(tasks);
    if (groupKey === 'date') return this.getDateGroups(tasks);
    if (groupKey === 'project') return this.getProjectGroups(tasks);
    if (groupKey === 'tag') return this.getTagGroups(tasks);
    return [];
  },

  getPriorityGroups(tasks) {
    const definitions = [
      { key: '', label: 'None' },
      { key: 'low', label: 'Low' },
      { key: 'medium', label: 'Medium' },
      { key: 'high', label: 'High' }
    ];
    return definitions
      .map(group => ({ ...group, tasks: tasks.filter(task => (task.priority || '') === group.key) }))
      .filter(group => group.tasks.length);
  },

  getDateGroups(tasks) {
    const byDate = new Map();
    tasks.forEach(task => {
      const key = task.dueDate || '';
      if (!byDate.has(key)) byDate.set(key, []);
      byDate.get(key).push(task);
    });
    const keys = [...byDate.keys()].sort((a, b) => {
      if (!a) return -1;
      if (!b) return 1;
      return a.localeCompare(b);
    });
    return keys.map(key => ({
      key,
      label: key ? this.formatDateLabel(key) : 'No Date',
      tasks: byDate.get(key)
    }));
  },

  getProjectGroups(tasks) {
    const byProject = new Map();
    tasks.forEach(task => {
      const key = task.project || '';
      if (!byProject.has(key)) byProject.set(key, []);
      byProject.get(key).push(task);
    });
    const groups = [...byProject.entries()].map(([key, groupTasks]) => ({
      key,
      label: key ? (AppState.getProject(key)?.name || 'Unknown Project') : 'Inbox',
      tasks: groupTasks
    }));
    return groups.sort((a, b) => {
      if (!a.key) return -1;
      if (!b.key) return 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });
  },

  getTagGroups(tasks) {
    const byTag = new Map();
    tasks.forEach(task => {
      const tags = Array.isArray(task.tags) ? task.tags : [];
      const keys = tags.length ? tags : [''];
      keys.forEach(key => {
        if (!byTag.has(key)) byTag.set(key, []);
        byTag.get(key).push(task);
      });
    });
    const groups = [...byTag.entries()].map(([key, groupTasks]) => ({
      key,
      label: key ? (AppState.getTag(key)?.name || 'Unknown Tag') : 'No Tags',
      tasks: groupTasks
    }));
    return groups.sort((a, b) => {
      if (!a.key) return -1;
      if (!b.key) return 1;
      return a.label.localeCompare(b.label, undefined, { sensitivity: 'base' });
    });
  },

  renderTaskGroups(tasks, groupKey) {
    const groups = this.getTaskGroups(tasks, groupKey);
    groups.forEach(group => this.activeListEl.appendChild(this.createTaskGroupSection(groupKey, group)));
  },

  createTaskGroupSection(groupKey, group) {
    if (!this.collapsedTaskGroups) this.collapsedTaskGroups = new Set();
    const collapseKey = `${groupKey}:${group.key}`;
    const collapsed = this.collapsedTaskGroups.has(collapseKey);

    const section = document.createElement('section');
    section.className = 'task-group-section';
    section.dataset.groupType = groupKey;

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'task-group-header';
    header.setAttribute('aria-expanded', collapsed ? 'false' : 'true');

    const labelWrap = document.createElement('span');
    labelWrap.className = 'task-group-header-left';
    const chevron = document.createElement('span');
    chevron.className = 'task-group-chevron';
    chevron.textContent = collapsed ? '▶' : '▼';
    const label = document.createElement('span');
    label.className = 'task-group-label';
    label.textContent = group.label;
    labelWrap.append(chevron, label);

    const count = document.createElement('span');
    count.className = 'task-group-count';
    count.textContent = String(group.tasks.length);
    header.append(labelWrap, count);

    const list = document.createElement('div');
    list.className = 'task-list task-group-list';
    this.setDropLaneContext(list, 'active', groupKey, group.key);
    list.hidden = collapsed;
    const ordered = window.WorkspaceControls?.sortTasks(group.tasks) || [...group.tasks];
    ordered.forEach(task => list.appendChild(this.createTaskDisplayUnit(task)));

    header.addEventListener('click', () => {
      const shouldCollapse = header.getAttribute('aria-expanded') === 'true';
      header.setAttribute('aria-expanded', shouldCollapse ? 'false' : 'true');
      chevron.textContent = shouldCollapse ? '▶' : '▼';
      list.hidden = shouldCollapse;
      if (shouldCollapse) this.collapsedTaskGroups.add(collapseKey);
      else this.collapsedTaskGroups.delete(collapseKey);
    });

    section.append(header, list);
    return section;
  }
};
