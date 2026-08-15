import { AppState } from '../state.js';
export const TaskHierarchyMethods = {
  initTaskHierarchy() {
    this.collapsedSubtaskParents = this.collapsedSubtaskParents || new Set();
    this.subtaskFamilyRenderSeq = 0;
  },

  createTaskDisplayUnit(task) {
    if (!task?.parentTaskId) return this.createTaskFamily(task);
    return this.createStandaloneFilteredSubtask(task);
  },

  createStandaloneFilteredSubtask(task) {
    const card = this.createTaskCard(task, { isSubtask: false });
    card.classList.add('standalone-filtered-subtask');
    card.dataset.filteredStandaloneSubtask = 'true';
    return card;
  },

  createTaskFamily(parentTask) {
    const parent = parentTask;
    const children = window.WorkspaceControls?.sortTasks(AppState.getSubtasks(parent.id))
      || AppState.getSubtasks(parent.id);
    const family = document.createElement('div');
    family.className = 'task-family';
    family.dataset.parentId = parent.id;
    family.dataset.dragRoot = 'true';

    const listId = `subtask-list-${++this.subtaskFamilyRenderSeq}`;
    family.appendChild(this.createTaskCard(parent, {
      showExpander: children.length > 0,
      subtaskListId: listId
    }));

    const list = document.createElement('div');
    list.className = 'subtask-list';
    list.id = listId;
    list.dataset.subtaskParentId = parent.id;
    list.hidden = children.length > 0 && this.isParentCollapsed(parent.id);
    children.forEach(child => list.appendChild(this.createSubtaskDragItem(child, parent.id)));
    family.appendChild(list);
    return family;
  },

  createSubtaskDragItem(task, parentTaskId) {
    const item = document.createElement('div');
    item.className = 'subtask-drag-item';
    item.dataset.taskId = task.id;
    item.dataset.parentTaskId = parentTaskId;
    item.dataset.dragSubtask = 'true';
    item.appendChild(this.createTaskCard(task, { isSubtask: true }));
    return item;
  },

  createSubtaskExpander(parentTask, listId) {
    const collapsed = this.isParentCollapsed(parentTask.id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'task-expander';
    button.dataset.taskExpander = parentTask.id;
    button.textContent = collapsed ? '›' : '⌄';
    button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
    button.setAttribute('aria-controls', listId);
    button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} subtasks for ${parentTask.title}`);
    button.addEventListener('click', e => {
      e.stopPropagation();
      this.toggleParentCollapsed(parentTask.id);
    });
    return button;
  },

  isParentCollapsed(parentTaskId) {
    return this.collapsedSubtaskParents?.has(parentTaskId) || false;
  },

  toggleParentCollapsed(parentTaskId) {
    if (!this.collapsedSubtaskParents) this.collapsedSubtaskParents = new Set();
    const collapsed = !this.collapsedSubtaskParents.has(parentTaskId);
    if (collapsed) this.collapsedSubtaskParents.add(parentTaskId);
    else this.collapsedSubtaskParents.delete(parentTaskId);
    this.syncParentCollapseDom(parentTaskId);
  },

  syncParentCollapseDom(parentTaskId) {
    const collapsed = this.isParentCollapsed(parentTaskId);
    document.querySelectorAll('.task-family').forEach(family => {
      if (family.dataset.parentId !== parentTaskId) return;
      const list = family.querySelector(':scope > .subtask-list');
      const button = family.querySelector('[data-task-expander]');
      if (list) list.hidden = collapsed;
      if (button) {
        button.textContent = collapsed ? '›' : '⌄';
        button.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
        const parent = AppState.getTask(parentTaskId);
        button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} subtasks for ${parent?.title || 'task'}`);
      }
    });
  },

  renderParentEditSubtasks() {
    if (!this.parentSubtasksSection || !this.parentSubtasksList) return;
    const parent = this.editingTaskId ? AppState.getTask(this.editingTaskId) : null;
    if (!parent || parent.parentTaskId) {
      this.parentSubtasksSection.hidden = true;
      this.parentSubtasksList.innerHTML = '';
      return;
    }

    const children = window.WorkspaceControls?.sortTasks(AppState.getSubtasks(parent.id))
      || AppState.getSubtasks(parent.id);
    this.parentSubtasksSection.hidden = false;
    this.parentSubtasksCount.textContent = String(children.length);
    this.parentSubtasksList.innerHTML = '';

    if (!children.length) {
      const empty = document.createElement('div');
      empty.className = 'parent-subtasks-empty';
      empty.textContent = 'No subtasks yet';
      this.parentSubtasksList.appendChild(empty);
      return;
    }

    children.forEach(child => {
      this.parentSubtasksList.appendChild(this.createTaskCard(child, {
        isSubtask: true,
        compact: true,
        hideProjectMeta: true
      }));
    });
  },

  refreshAfterTaskMutation() {
    this.render();
    if (this.addTaskModal?.classList.contains('active') && this.editingTaskId) {
      this.renderParentEditSubtasks();
    }
  }
};
