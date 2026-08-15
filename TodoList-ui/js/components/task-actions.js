import { AppPersistence } from '../storage/persistence.js';
import { AppDataService } from '../storage/data-service.js';
import { AppState } from '../state.js';
export const TaskActionMethods = {
  initTaskActions() {
    this.taskActionMenu = document.getElementById('task-action-menu');
    this.taskActionAddBtn = this.taskActionMenu?.querySelector('[data-task-action="add-subtask"]');
    this.taskActionLinkBtn = this.taskActionMenu?.querySelector('[data-task-action="link-parent"]');
    this.taskActionUnlinkBtn = this.taskActionMenu?.querySelector('[data-task-action="unlink"]');
    this.taskActionDeleteBtn = this.taskActionMenu?.querySelector('[data-task-action="delete"]');
    this.taskActionTargetId = null;
    this.taskActionAnchor = null;
    this.createTaskParentPicker();

    this.taskActionMenu?.addEventListener('click', e => {
      e.stopPropagation();
      const button = e.target.closest('[data-task-action]');
      const action = button?.dataset.taskAction;
      if (!action || button.disabled) return;
      if (action === 'add-subtask') this.handleTaskActionAddSubtask();
      if (action === 'link-parent') this.openTaskParentPicker();
      if (action === 'unlink') this.handleTaskActionUnlink();
      if (action === 'delete') this.handleTaskActionDelete();
    });

    this.taskParentPicker?.addEventListener('click', e => {
      e.stopPropagation();
      const option = e.target.closest('[data-parent-task-option]');
      if (option) this.handleTaskActionLinkParent(option.dataset.parentTaskOption);
    });

    document.addEventListener('click', e => {
      if (!this.taskParentPicker?.hidden) {
        if (this.taskParentPicker.contains(e.target) || this.taskActionMenu?.contains(e.target)) return;
        this.closeTaskParentPicker(false);
        return;
      }
      if (!this.taskActionMenu?.hidden && !this.taskActionMenu.contains(e.target)) {
        this.closeTaskActionMenu(false);
      }
    });

    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape' || this.taskActionMenu?.hidden) return;
      e.preventDefault();
      if (!this.taskParentPicker?.hidden) {
        this.closeTaskParentPicker(true);
        return;
      }
      this.closeTaskActionMenu(true);
    });
  },

  createTaskParentPicker() {
    document.getElementById('task-parent-picker')?.remove();
    const picker = document.createElement('div');
    picker.id = 'task-parent-picker';
    picker.className = 'task-parent-picker';
    picker.hidden = true;
    picker.setAttribute('role', 'menu');
    picker.setAttribute('aria-label', 'Link task to parent');
    document.body.appendChild(picker);
    this.taskParentPicker = picker;
  },

  createTaskMoreButton(task) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'action-btn task-more-btn';
    button.textContent = '•••';
    button.title = 'Task actions';
    button.setAttribute('aria-haspopup', 'menu');
    button.setAttribute('aria-expanded', 'false');
    button.setAttribute('aria-label', `More actions for ${task.title}`);
    button.addEventListener('click', e => {
      e.stopPropagation();
      this.openTaskActionMenu(task.id, button);
    });
    return button;
  },

  getEligibleParentTasks(taskId) {
    return AppState.getRootTasks()
      .filter(task => task.id !== taskId && !task.completed)
      .sort((a, b) => (a.sortOrder - b.sortOrder) || String(a.title).localeCompare(String(b.title)));
  },

  openTaskActionMenu(taskId, anchor) {
    const task = AppState.getTask(taskId);
    if (!task || !this.taskActionMenu) return;

    this.closeTaskActionMenu(false);
    window.WorkspaceControls?.closeMenu();
    window.SidebarComponent?.closeSidebarActionMenus();
    this.closeAllContextMenus();
    window.SubtaskEditorComponent?.closeMenus();

    const isSubtask = AppState.isSubtask(task);
    const hasChildren = !isSubtask && AppState.hasSubtasks(task.id);
    const eligibleParents = isSubtask ? [] : this.getEligibleParentTasks(task.id);
    this.taskActionTargetId = task.id;
    this.taskActionAnchor = anchor;

    this.taskActionAddBtn.hidden = isSubtask;
    this.taskActionLinkBtn.hidden = isSubtask;
    this.taskActionUnlinkBtn.hidden = !isSubtask;
    if (!isSubtask) {
      const disabled = hasChildren || eligibleParents.length === 0;
      this.taskActionLinkBtn.disabled = disabled;
      this.taskActionLinkBtn.setAttribute('aria-expanded', 'false');
      if (hasChildren) {
        this.taskActionLinkBtn.title = 'Move or unlink this task’s subtasks first';
      } else if (!eligibleParents.length) {
        this.taskActionLinkBtn.title = 'No eligible parent tasks';
      } else {
        this.taskActionLinkBtn.removeAttribute('title');
      }
    }

    this.taskActionMenu.hidden = false;
    anchor?.setAttribute('aria-expanded', 'true');
    this.positionTaskActionMenu(anchor);
    this.taskActionMenu.querySelector('button:not([hidden]):not(:disabled)')?.focus();
  },

  positionTaskActionMenu(anchor) {
    if (!anchor || !this.taskActionMenu) return;
    const rect = anchor.getBoundingClientRect();
    const menuRect = this.taskActionMenu.getBoundingClientRect();
    const gap = 6;
    const left = Math.max(8, Math.min(window.innerWidth - menuRect.width - 8, rect.right - menuRect.width));
    let top = rect.bottom + gap;
    if (top + menuRect.height > window.innerHeight - 8) {
      top = Math.max(8, rect.top - menuRect.height - gap);
    }
    this.taskActionMenu.style.left = `${left}px`;
    this.taskActionMenu.style.top = `${top}px`;
  },

  openTaskParentPicker() {
    const task = AppState.getTask(this.taskActionTargetId);
    if (!task || task.parentTaskId || AppState.hasSubtasks(task.id)) return;
    const parents = this.getEligibleParentTasks(task.id);
    if (!parents.length) return;

    this.taskParentPicker.innerHTML = parents.map(parent =>
      `<button type="button" role="menuitem" data-parent-task-option="${this.escapeTaskActionText(parent.id)}">${this.escapeTaskActionText(parent.title)}</button>`
    ).join('');
    this.taskParentPicker.hidden = false;
    this.taskActionLinkBtn?.setAttribute('aria-expanded', 'true');
    this.positionTaskParentPicker();
    this.taskParentPicker.querySelector('button')?.focus();
  },

  positionTaskParentPicker() {
    if (!this.taskParentPicker || this.taskParentPicker.hidden || !this.taskActionMenu) return;
    const margin = 8;
    const gap = 6;
    const menuRect = this.taskActionMenu.getBoundingClientRect();
    const pickerRect = this.taskParentPicker.getBoundingClientRect();
    let left = menuRect.left - pickerRect.width - gap;
    if (left < margin) left = menuRect.right + gap;
    left = Math.min(Math.max(margin, left), window.innerWidth - pickerRect.width - margin);
    const top = Math.min(
      Math.max(margin, menuRect.top),
      window.innerHeight - pickerRect.height - margin
    );
    this.taskParentPicker.style.left = `${left}px`;
    this.taskParentPicker.style.top = `${top}px`;
  },

  closeTaskParentPicker(restoreFocus = false) {
    if (!this.taskParentPicker || this.taskParentPicker.hidden) return;
    this.taskParentPicker.hidden = true;
    this.taskParentPicker.innerHTML = '';
    this.taskActionLinkBtn?.setAttribute('aria-expanded', 'false');
    if (restoreFocus) this.taskActionLinkBtn?.focus();
  },

  closeTaskActionMenu(restoreFocus = false) {
    if (!this.taskActionMenu || this.taskActionMenu.hidden) return;
    const anchor = this.taskActionAnchor;
    this.closeTaskParentPicker(false);
    this.taskActionMenu.hidden = true;
    anchor?.setAttribute('aria-expanded', 'false');
    this.taskActionTargetId = null;
    this.taskActionAnchor = null;
    if (restoreFocus && anchor?.isConnected) anchor.focus();
  },

  handleTaskActionAddSubtask() {
    const task = AppState.getTask(this.taskActionTargetId);
    const trigger = this.taskActionAnchor;
    if (!task || AppState.isSubtask(task)) return;
    this.closeTaskActionMenu(false);
    window.SubtaskEditorComponent?.openCreate(task.id, trigger);
  },

  async handleTaskActionLinkParent(parentId) {
    const taskId = this.taskActionTargetId;
    if (!taskId || !parentId) return;
    try {
      await AppDataService.linkTaskToParent(taskId, parentId);
      this.closeTaskParentPicker(false);
      this.closeTaskActionMenu(false);
      this.refreshAfterTaskMutation();
    } catch (error) {
      AppPersistence.reportError('Could not link this task to the selected parent.', error);
    }
  },

  async handleTaskActionUnlink() {
    const taskId = this.taskActionTargetId;
    if (!taskId) return;
    try {
      await AppDataService.unlinkTask(taskId);
      this.closeTaskActionMenu(false);
      this.refreshAfterTaskMutation();
    } catch (error) {
      AppPersistence.reportError('Could not unlink this subtask.', error);
    }
  },

  async handleTaskActionDelete() {
    const task = AppState.getTask(this.taskActionTargetId);
    if (!task) return;
    const subtaskCount = AppState.getSubtasks(task.id).length;
    if (!task.parentTaskId && subtaskCount > 0) {
      const ok = window.confirm(`Delete "${task.title}" and its ${subtaskCount} ${subtaskCount === 1 ? 'subtask' : 'subtasks'}?`);
      if (!ok) return;
    }
    this.closeTaskActionMenu(false);
    try {
      await AppDataService.deleteTaskFamily(task.id);
      this.refreshAfterTaskMutation?.();
    } catch (error) {
      AppPersistence.reportError('Could not delete this task.', error);
    }
  },

  escapeTaskActionText(value) {
    const div = document.createElement('div');
    div.textContent = value ?? '';
    return div.innerHTML;
  }
};
