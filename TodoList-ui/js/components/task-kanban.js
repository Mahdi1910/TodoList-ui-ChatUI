export const TaskKanbanMethods = {
  renderKanban(tasks) {
    this.listViewEl.hidden = true;
    this.kanbanViewEl.hidden = false;
    this.kanbanBoardEl.innerHTML = '';
    if (!this.collapsedKanbanCompletedGroups) this.collapsedKanbanCompletedGroups = new Set();

    const hasTasks = tasks.length > 0;
    this.kanbanBoardEl.hidden = !hasTasks;
    this.kanbanEmptyStateEl.style.display = hasTasks ? 'none' : 'flex';
    if (!hasTasks) return;

    const groupKey = window.WorkspaceControls?.groupKey || 'none';
    const groups = groupKey === 'none'
      ? [{ key: 'all', label: '', tasks: [...tasks] }]
      : this.getTaskGroups(tasks, groupKey);

    this.kanbanBoardEl.classList.toggle('single-column', groupKey === 'none');
    groups.forEach((group, columnIndex) => {
      this.kanbanBoardEl.appendChild(this.createKanbanColumn(groupKey, group, columnIndex));
    });
  },

  createKanbanColumn(groupKey, group, columnIndex = 0) {
    const column = document.createElement('section');
    column.className = 'kanban-column';
    column.dataset.groupType = groupKey;
    column.dataset.groupKey = group.key;

    if (groupKey !== 'none') {
      const title = document.createElement('h2');
      title.className = 'kanban-column-title';
      title.textContent = group.label;
      column.appendChild(title);
    }

    const activeList = document.createElement('div');
    activeList.className = 'kanban-task-list kanban-active-list';
    this.setDropLaneContext(activeList, 'active', groupKey, group.key);
    const activeTasks = group.tasks.filter(task => !task.completed);
    const orderedActive = window.WorkspaceControls?.sortTasks(activeTasks) || [...activeTasks];
    orderedActive.forEach(task => activeList.appendChild(this.createTaskDisplayUnit(task)));
    column.appendChild(activeList);

    const completedTasks = group.tasks.filter(task => task.completed);
    const collapseKey = `${groupKey}:${group.key}`;
    const collapsed = this.collapsedKanbanCompletedGroups.has(collapseKey);
    const completedListId = `kanban-completed-list-${columnIndex}`;

    const completedHeader = document.createElement('button');
    completedHeader.type = 'button';
    completedHeader.className = 'kanban-completed-header';
    completedHeader.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    completedHeader.setAttribute('aria-controls', completedListId);
    completedHeader.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} completed tasks`);

    const completedLabel = document.createElement('span');
    completedLabel.textContent = 'Completed';
    const completedMeta = document.createElement('span');
    completedMeta.className = 'kanban-completed-meta';
    const completedCount = document.createElement('span');
    completedCount.className = 'kanban-completed-count';
    completedCount.textContent = String(completedTasks.length);
    const completedChevron = document.createElement('span');
    completedChevron.className = 'kanban-completed-chevron';
    completedChevron.setAttribute('aria-hidden', 'true');
    completedChevron.textContent = collapsed ? '▸' : '▾';
    completedMeta.append(completedCount, completedChevron);
    completedHeader.append(completedLabel, completedMeta);

    const completedList = document.createElement('div');
    completedList.id = completedListId;
    completedList.className = 'kanban-task-list kanban-completed-list';
    const orderedCompleted = window.WorkspaceControls?.sortTasks(completedTasks) || [...completedTasks];
    orderedCompleted.forEach(task => completedList.appendChild(this.createTaskDisplayUnit(task)));

    const syncCompletedState = isCollapsed => {
      completedList.hidden = isCollapsed;
      completedHeader.setAttribute('aria-expanded', isCollapsed ? 'false' : 'true');
      completedHeader.setAttribute('aria-label', `${isCollapsed ? 'Expand' : 'Collapse'} completed tasks`);
      completedChevron.textContent = isCollapsed ? '▸' : '▾';
      if (isCollapsed) this.clearDropLaneContext(completedList);
      else this.setDropLaneContext(completedList, 'completed', groupKey, group.key);
    };

    syncCompletedState(collapsed);
    completedHeader.addEventListener('click', () => {
      const shouldCollapse = completedHeader.getAttribute('aria-expanded') === 'true';
      if (shouldCollapse) this.collapsedKanbanCompletedGroups.add(collapseKey);
      else this.collapsedKanbanCompletedGroups.delete(collapseKey);
      syncCompletedState(shouldCollapse);
    });

    column.append(completedHeader, completedList);
    return column;
  }
};
