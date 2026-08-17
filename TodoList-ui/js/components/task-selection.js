import { AppState } from '../state.js';
import { TaskFilter } from '../task-filter.js';
import { TaskSelectionActions } from './task-selection-actions.js';
import { TaskSelectionMenus } from './task-selection-menus.js';

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function checkSvg() {
  const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  icon.classList.add('check-icon');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />';
  return icon;
}

export const TaskSelectionController = {
  selectionMode: false,
  selectedTaskIds: new Set(),
  batchBusy: false,
  installed: false,
  initialized: false,

  install({ tasks, sidebar, workspace, schedule }) {
    if (this.installed) return;
    this.installed = true;
    this.tasks = tasks;
    this.sidebar = sidebar;
    this.workspace = workspace;
    this.schedule = schedule;

    Object.defineProperty(tasks, 'selectionMode', {
      configurable: true,
      get: () => this.selectionMode
    });
    Object.defineProperty(tasks, 'selectionBatchBusy', {
      configurable: true,
      get: () => this.batchBusy
    });
    tasks.enterSelectionMode = () => this.enterSelectionMode();
    tasks.exitSelectionMode = options => this.exitSelectionMode(options);

    const originalRender = tasks.render.bind(tasks);
    tasks.render = (...args) => {
      const result = originalRender(...args);
      if (this.initialized) this.afterRender();
      return result;
    };

    const originalOpenModal = tasks.openModal.bind(tasks);
    tasks.openModal = taskToEdit => {
      if (!taskToEdit && this.selectionMode) {
        this.menus?.togglePanel();
        return;
      }
      return originalOpenModal(taskToEdit);
    };

    if (typeof tasks.getTaskDragTarget === 'function') {
      const originalGetTaskDragTarget = tasks.getTaskDragTarget.bind(tasks);
      tasks.getTaskDragTarget = target => this.selectionMode ? null : originalGetTaskDragTarget(target);
    }

    if (sidebar && typeof sidebar.selectFilter === 'function') {
      const originalSelectFilter = sidebar.selectFilter.bind(sidebar);
      sidebar.selectFilter = target => {
        if (this.batchBusy) return;
        if (this.selectionMode) this.exitSelectionMode({ render: false });
        return originalSelectFilter(target);
      };
    }

    if (workspace && typeof workspace.openMenu === 'function') {
      const originalOpenMenu = workspace.openMenu.bind(workspace);
      workspace.openMenu = (...args) => {
        const result = originalOpenMenu(...args);
        this.syncWorkspaceMenuAction();
        return result;
      };
    }
  },

  init() {
    if (this.initialized) return;
    this.initialized = true;
    this.ensureStylesheet();
    this.normalFabMarkup = this.getFab()?.innerHTML || '';
    this.actions = new TaskSelectionActions(this);
    this.menus = new TaskSelectionMenus(this, this.actions);
    this.menus.init();
    this.ensureWorkspaceMenuAction();
    this.bindSelectionEvents();
    this.afterRender();
  },

  ensureStylesheet() {
    if (document.querySelector('link[data-task-selection-style]')) return;
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = new URL('../../css/components/task-selection.css', import.meta.url).href;
    link.dataset.taskSelectionStyle = 'true';
    document.head.appendChild(link);
  },

  getFab() {
    return this.tasks?.openAddTaskBtn || document.getElementById('btn-open-add-task');
  },

  blockingModalActive() {
    return Boolean(document.querySelector('.modal-overlay.active'));
  },

  ensureWorkspaceMenuAction() {
    const menu = this.workspace?.menu || document.getElementById('workspace-menu');
    if (!menu || menu.querySelector('[data-workspace-selection-action]')) return;
    const divider = document.createElement('div');
    divider.className = 'workspace-menu-divider selection-workspace-divider';
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'workspace-select-action';
    button.dataset.workspaceSelectionAction = 'true';
    button.setAttribute('role', 'menuitem');
    button.addEventListener('click', event => {
      event.stopPropagation();
      if (button.disabled) return;
      this.workspace?.closeMenu?.();
      if (this.selectionMode) this.exitSelectionMode();
      else this.enterSelectionMode();
    });
    menu.append(divider, button);
    this.workspaceSelectionButton = button;
    this.syncWorkspaceMenuAction();
  },

  syncWorkspaceMenuAction() {
    const button = this.workspaceSelectionButton || document.querySelector('[data-workspace-selection-action]');
    if (!button) return;
    button.textContent = this.selectionMode ? 'Cancel Selection' : 'Select';
    button.disabled = this.batchBusy || (!this.selectionMode && this.blockingModalActive());
    button.title = button.disabled && !this.selectionMode ? 'Close the current Todo dialog first' : '';
  },

  bindSelectionEvents() {
    document.addEventListener('change', event => {
      if (!this.selectionMode || this.batchBusy) return;
      const checkbox = event.target.closest?.('.task-card .task-checkbox');
      if (!checkbox || checkbox.classList.contains('selection-container-checkbox')) return;
      const card = checkbox.closest('.task-card[data-id]');
      if (!card) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.setTaskSelected(card.dataset.id, checkbox.checked);
    }, true);

    document.addEventListener('click', event => {
      if (!this.selectionMode || this.batchBusy) return;
      const card = event.target.closest?.('.task-card[data-id]');
      if (!card) return;
      if (event.target.closest('.task-checkbox-wrapper,button,input,a,select,textarea,[data-task-expander]')) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.toggleTaskSelection(card.dataset.id);
    }, true);

    document.addEventListener('keydown', event => {
      if (!this.selectionMode || this.batchBusy) return;
      if (event.key !== 'Enter' && event.key !== ' ') return;
      const details = event.target.closest?.('.task-details');
      const card = details?.closest('.task-card[data-id]');
      if (!details || !card) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.toggleTaskSelection(card.dataset.id);
    }, true);

    document.addEventListener('keydown', event => this.handleSelectionEscape(event));
  },

  handleSelectionEscape(event) {
    if (!this.selectionMode || this.batchBusy || event.key !== 'Escape' || event.defaultPrevented) return;
    if (this.blockingModalActive()) return;
    if (this.workspace?.menu?.classList.contains('open')) return;
    if (this.tasks?.taskActionMenu && !this.tasks.taskActionMenu.hidden) return;
    if (this.menus?.closeTopLayer()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      return;
    }
    event.preventDefault();
    event.stopImmediatePropagation();
    this.exitSelectionMode();
  },

  enterSelectionMode() {
    if (this.selectionMode || this.batchBusy || this.blockingModalActive()) return false;
    this.workspace?.closeMenu?.();
    this.tasks?.closeAllContextMenus?.();
    this.tasks?.closeTaskActionMenu?.(false);
    window.SubtaskEditorComponent?.closeMenus?.();
    this.tasks?.cancelPendingTaskDrag?.();
    this.tasks?.cancelPendingTouchDrag?.();
    this.tasks?.cancelTaskDrag?.();
    this.selectionMode = true;
    this.selectedTaskIds.clear();
    document.body.classList.add('task-selection-mode');
    this.tasks?.render?.();
    this.syncWorkspaceMenuAction();
    return true;
  },

  exitSelectionMode({ render = true } = {}) {
    if (!this.selectionMode || this.batchBusy) return false;
    this.menus?.closePicker?.(false);
    this.menus?.closePanel?.(false);
    this.selectionMode = false;
    this.selectedTaskIds.clear();
    document.body.classList.remove('task-selection-mode', 'task-selection-busy');
    if (render) this.tasks?.render?.();
    else this.syncFab();
    this.syncWorkspaceMenuAction();
    return true;
  },

  setBatchBusy(value) {
    this.batchBusy = Boolean(value);
    document.body.classList.toggle('task-selection-busy', this.batchBusy);
    this.syncFab();
    this.syncWorkspaceMenuAction();
    this.menus?.syncPanel?.();
    this.syncCardStates();
  },

  getSelectionCount() {
    return this.selectedTaskIds.size;
  },

  expandRenderedTaskIds(rows = []) {
    const ids = [];
    for (const row of rows) {
      if (!row?.id) continue;
      ids.push(row.id);
      if (!row.parentTaskId) ids.push(...AppState.getSubtasks(row.id).map(task => task.id));
    }
    return unique(ids);
  },

  currentDisplayRows() {
    return TaskFilter.getDisplayTasks?.() || AppState.getFilteredTasks();
  },

  currentSelectableIds() {
    return this.expandRenderedTaskIds(this.currentDisplayRows());
  },

  pruneSelection() {
    const allowed = new Set(this.currentSelectableIds());
    for (const id of [...this.selectedTaskIds]) {
      if (!allowed.has(id) || !AppState.getTask(id)) this.selectedTaskIds.delete(id);
    }
  },

  setTaskSelected(taskId, selected) {
    if (!this.selectionMode || this.batchBusy || !AppState.getTask(taskId)) return;
    const visible = new Set(this.currentSelectableIds());
    if (!visible.has(taskId)) return;
    if (selected) this.selectedTaskIds.add(taskId);
    else this.selectedTaskIds.delete(taskId);
    this.syncSelectionUi();
  },

  toggleTaskSelection(taskId) {
    this.setTaskSelected(taskId, !this.selectedTaskIds.has(taskId));
  },

  setContainerSelection(ids = []) {
    if (!this.selectionMode || this.batchBusy) return;
    const concrete = unique(ids).filter(id => AppState.getTask(id));
    if (!concrete.length) return;
    const allSelected = concrete.every(id => this.selectedTaskIds.has(id));
    concrete.forEach(id => {
      if (allSelected) this.selectedTaskIds.delete(id);
      else this.selectedTaskIds.add(id);
    });
    this.syncSelectionUi();
  },

  syncSelectionUi() {
    if (!this.selectionMode) return this.syncFab();
    this.pruneSelection();
    this.syncCardStates();
    this.syncContainerSelectors();
    this.syncFab();
    this.syncWorkspaceMenuAction();
    this.menus?.syncPanel?.();
  },

  syncCardStates() {
    document.querySelectorAll('.task-card[data-id]').forEach(card => {
      const id = card.dataset.id;
      const selected = this.selectionMode && this.selectedTaskIds.has(id);
      card.classList.toggle('is-bulk-selected', selected);
      const checkbox = card.querySelector(':scope .task-checkbox-wrapper .task-checkbox');
      if (checkbox && !checkbox.classList.contains('selection-container-checkbox')) {
        const task = AppState.getTask(id);
        checkbox.checked = this.selectionMode ? selected : Boolean(task?.completed);
        checkbox.disabled = Boolean(this.selectionMode && this.batchBusy);
        checkbox.setAttribute('aria-label', this.selectionMode
          ? `${selected ? 'Unselect' : 'Select'} task: ${task?.title || 'task'}`
          : `Mark ${task?.title || 'task'} as ${task?.completed ? 'active' : 'completed'}`);
      }
      const details = card.querySelector(':scope .task-left > .task-details, .task-details');
      if (details) {
        const task = AppState.getTask(id);
        if (this.selectionMode) {
          details.setAttribute('aria-pressed', selected ? 'true' : 'false');
          details.setAttribute('aria-label', `${selected ? 'Unselect' : 'Select'} task: ${task?.title || 'task'}`);
          details.setAttribute('title', `${selected ? 'Unselect' : 'Select'} task`);
        } else {
          details.removeAttribute('aria-pressed');
        }
      }
    });
  },

  createContainerSelector(ids, label) {
    const concrete = unique(ids).filter(id => AppState.getTask(id));
    const selectedCount = concrete.filter(id => this.selectedTaskIds.has(id)).length;
    const allSelected = concrete.length > 0 && selectedCount === concrete.length;
    const partial = selectedCount > 0 && selectedCount < concrete.length;

    const wrapper = document.createElement('span');
    wrapper.className = 'task-checkbox-wrapper selection-container-selector';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'task-checkbox selection-container-checkbox';
    checkbox.checked = allSelected;
    checkbox.indeterminate = partial;
    checkbox.disabled = concrete.length === 0 || this.batchBusy;
    checkbox.setAttribute('aria-checked', partial ? 'mixed' : allSelected ? 'true' : 'false');
    checkbox.setAttribute('aria-label', `${allSelected ? 'Unselect' : 'Select'} ${label}`);
    wrapper.classList.toggle('is-indeterminate', partial);
    wrapper.append(checkbox, checkSvg());
    const partialMark = document.createElement('span');
    partialMark.className = 'selection-partial-mark';
    partialMark.setAttribute('aria-hidden', 'true');
    wrapper.appendChild(partialMark);

    wrapper.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', event => {
      event.stopPropagation();
      this.setContainerSelection(concrete);
    });
    return wrapper;
  },

  wrapCollapseHeader(button, ids, label, extraClass = '') {
    if (!button) return null;
    let wrapper = button.parentElement?.classList.contains('selection-header-row') ? button.parentElement : null;
    if (!wrapper) {
      wrapper = document.createElement('div');
      wrapper.className = `selection-header-row ${extraClass}`.trim();
      button.parentNode?.insertBefore(wrapper, button);
      wrapper.appendChild(button);
    }
    wrapper.querySelector(':scope > .selection-container-selector')?.remove();
    wrapper.prepend(this.createContainerSelector(ids, label));
    return wrapper;
  },

  decorateListContainers(rows) {
    const activeRows = rows.filter(task => !task.completed);
    const completedRows = rows.filter(task => task.completed);
    const groupKey = this.workspace?.groupKey || 'none';

    const activeHeader = document.querySelector('#active-tasks-container > .section-header-title');
    if (activeHeader) {
      if (groupKey === 'none') {
        const ids = this.expandRenderedTaskIds(activeRows);
        activeHeader.hidden = false;
        activeHeader.querySelector(':scope > .selection-container-selector')?.remove();
        activeHeader.prepend(this.createContainerSelector(ids, 'all active tasks'));
        if (this.tasks?.activeCountEl) this.tasks.activeCountEl.textContent = `${ids.length} ${ids.length === 1 ? 'task' : 'tasks'}`;
      } else {
        activeHeader.hidden = true;
      }
    }

    const completedIds = this.expandRenderedTaskIds(completedRows);
    const completedButton = this.tasks?.completedSectionToggle || document.querySelector('.completed-section-toggle');
    this.wrapCollapseHeader(completedButton, completedIds, 'all completed tasks', 'selection-completed-header');
    if (this.tasks?.completedCountEl) {
      this.tasks.completedCountEl.textContent = `${completedIds.length} ${completedIds.length === 1 ? 'task' : 'tasks'}`;
    }

    if (groupKey !== 'none') {
      const groups = this.tasks.getTaskGroups?.(activeRows, groupKey) || [];
      const sections = [...this.tasks.activeListEl.querySelectorAll(':scope > .task-group-section')];
      sections.forEach((section, index) => {
        const group = groups[index];
        const header = section.querySelector('.task-group-header');
        if (!group || !header) return;
        const ids = this.expandRenderedTaskIds(group.tasks);
        this.wrapCollapseHeader(header, ids, `all ${group.label} tasks`, 'selection-group-header');
        const count = header.querySelector('.task-group-count');
        if (count) count.textContent = String(ids.length);
      });
    }
  },

  decorateKanbanContainers(rows) {
    const groupKey = this.workspace?.groupKey || 'none';
    const groups = groupKey === 'none'
      ? [{ key: 'all', label: 'Active', tasks: [...rows] }]
      : (this.tasks.getTaskGroups?.(rows, groupKey) || []);
    const columns = [...this.tasks.kanbanBoardEl.querySelectorAll(':scope > .kanban-column')];

    columns.forEach((column, index) => {
      const group = groups[index];
      if (!group) return;
      const activeRows = group.tasks.filter(task => !task.completed);
      const completedRows = group.tasks.filter(task => task.completed);
      const activeIds = this.expandRenderedTaskIds(activeRows);
      const completedIds = this.expandRenderedTaskIds(completedRows);

      if (groupKey === 'none') {
        let activeHeader = column.querySelector(':scope > .selection-kanban-active-header');
        if (!activeHeader) {
          activeHeader = document.createElement('div');
          activeHeader.className = 'selection-header-row selection-kanban-active-header';
          const label = document.createElement('span');
          label.className = 'selection-lane-title';
          label.textContent = 'Active';
          activeHeader.appendChild(label);
          const list = column.querySelector(':scope > .kanban-active-list');
          column.insertBefore(activeHeader, list);
        }
        activeHeader.querySelector(':scope > .selection-container-selector')?.remove();
        activeHeader.prepend(this.createContainerSelector(activeIds, 'all active tasks'));
        activeHeader.querySelector('.selection-lane-count')?.remove();
        const count = document.createElement('span');
        count.className = 'selection-lane-count';
        count.textContent = String(activeIds.length);
        activeHeader.appendChild(count);
      } else {
        const title = column.querySelector(':scope > .kanban-column-title');
        const wrapper = this.wrapCollapseHeader(title, activeIds, `all active tasks in ${group.label}`, 'selection-kanban-column-header');
        if (wrapper) {
          wrapper.querySelector('.selection-lane-count')?.remove();
          const count = document.createElement('span');
          count.className = 'selection-lane-count';
          count.textContent = String(activeIds.length);
          wrapper.appendChild(count);
        }
      }

      const completedButton = column.querySelector('.kanban-completed-header');
      this.wrapCollapseHeader(
        completedButton,
        completedIds,
        `completed tasks in ${groupKey === 'none' ? 'this view' : group.label}`,
        'selection-kanban-completed-header'
      );
      const completedCount = completedButton?.querySelector('.kanban-completed-count');
      if (completedCount) completedCount.textContent = String(completedIds.length);
    });
  },

  syncContainerSelectors() {
    if (!this.selectionMode) return;
    const rows = this.currentDisplayRows();
    const viewType = this.workspace?.viewType || 'list';
    if (viewType === 'kanban') this.decorateKanbanContainers(rows);
    else this.decorateListContainers(rows);
  },

  syncFab() {
    const fab = this.getFab();
    if (!fab) return;
    if (!this.selectionMode) {
      if (this.normalFabMarkup) fab.innerHTML = this.normalFabMarkup;
      fab.disabled = false;
      fab.classList.remove('selection-action-fab');
      fab.setAttribute('aria-label', 'Add Task');
      fab.removeAttribute('aria-haspopup');
      fab.removeAttribute('aria-expanded');
      return;
    }
    fab.textContent = '•••';
    fab.classList.add('selection-action-fab');
    fab.disabled = this.batchBusy || this.getSelectionCount() === 0;
    fab.setAttribute('aria-label', `${this.getSelectionCount()} selected task actions`);
    fab.setAttribute('aria-haspopup', 'dialog');
    fab.setAttribute('aria-expanded', this.menus?.isPanelOpen() ? 'true' : 'false');
  },

  afterRender() {
    if (!this.selectionMode) {
      document.body.classList.remove('task-selection-mode', 'task-selection-busy');
      const activeHeader = document.querySelector('#active-tasks-container > .section-header-title');
      if (activeHeader) activeHeader.hidden = true;
      document.querySelectorAll('.selection-container-selector').forEach(control => {
        if (control.closest('.selection-completed-header')) control.style.display = 'none';
      });
      this.syncFab();
      this.syncWorkspaceMenuAction();
      return;
    }

    document.body.classList.add('task-selection-mode');
    this.pruneSelection();
    this.syncCardStates();
    this.syncContainerSelectors();
    this.syncFab();
    this.syncWorkspaceMenuAction();
    this.menus?.syncPanel?.();
  }
};
