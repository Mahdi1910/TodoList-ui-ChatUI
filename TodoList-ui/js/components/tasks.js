import { ModalFocusManager } from './modal-focus.js';
import { AppPersistence } from '../storage/persistence.js';
import { AppDataService } from '../storage/data-service.js';
import { AppState } from '../state.js';
import { TaskMenuMethods } from './task-menus.js';
import { TaskTaxonomyMenuOrderMethods } from './task-taxonomy-menu-order.js';
import { TaskActionMethods } from './task-actions.js';
import { TaskGroupMethods } from './task-groups.js';
import { TaskHierarchyMethods } from './task-hierarchy.js';
import { TaskKanbanMethods } from './task-kanban.js';
import { TaskDragMethods } from './task-drag.js';
import { TaskDragHierarchyMethods } from './task-drag-hierarchy.js';
import { TaskDragTouchMethods } from './task-drag-touch.js';
import { TaskDragCommitMethods } from './task-drag-commit.js';
import { TaskRendererMethods } from './task-renderer.js';

const TasksCore = {
  editingTaskId: null,
  selectedPriority: '',
  selectedProject: '',
  selectedTags: [],
  selectedDueDate: null,
  selectedDueTime: null,
  selectedReminders: ['on_time'],
  selectedRepeat: null,
  lastFocusedElement: null,
  typingFocusTarget: null,
  pendingDateTypingSnapshot: null,
  dateOpenGeneration: 0,

  init() {
    this.activeListEl = document.getElementById('active-task-list');
    this.completedListEl = document.getElementById('completed-task-list');
    this.completedSectionEl = document.getElementById('completed-tasks-container');
    this.activeEmptyStateEl = document.getElementById('active-empty-state');
    this.activeCountEl = document.getElementById('active-tasks-count');
    this.completedCountEl = document.getElementById('completed-tasks-count');
    this.listViewEl = document.getElementById('list-view');
    this.kanbanViewEl = document.getElementById('kanban-view');
    this.kanbanBoardEl = document.getElementById('kanban-board');
    this.kanbanEmptyStateEl = document.getElementById('kanban-empty-state');
    this.addTaskModal = document.getElementById('add-task-modal');
    this.quickCard = document.getElementById('quick-input-card');
    this.openAddTaskBtn = document.getElementById('btn-open-add-task');
    this.submitTaskBtn = document.getElementById('btn-submit-quick-task');
    this.form = document.getElementById('add-task-form');
    this.titleInput = document.getElementById('task-title-input');
    this.descInput = document.getElementById('task-desc-input');
    this.btnDate = document.getElementById('btn-pop-date');
    this.btnPriority = document.getElementById('btn-pop-priority');
    this.btnTags = document.getElementById('btn-pop-tags');
    this.btnProject = document.getElementById('btn-pop-project');
    this.btnAddSubtask = document.getElementById('btn-add-subtask-from-editor');
    this.menuPriority = document.getElementById('menu-priority');
    this.menuTags = document.getElementById('menu-tags');
    this.menuProject = document.getElementById('menu-project');
    this.parentSubtasksSection = document.getElementById('parent-subtasks-section');
    this.parentSubtasksList = document.getElementById('parent-subtasks-list');
    this.parentSubtasksCount = document.getElementById('parent-subtasks-count');
    this.renderProjectMenu();
    this.renderTagMenu();
    this.initTaskActions();
    this.initTaskHierarchy();
    this.initTaskDrag();
    this.bindEditorFocusContinuity();
    this.bindEvents();
    this.bindDateTrigger();
    this.initKeyboardAdjustment();
    this.render();
  },

  isEditorTypingInput(element) {
    return Boolean(
      element &&
      element.isConnected &&
      (element === this.titleInput || element === this.descInput) &&
      this.addTaskModal?.classList.contains('active')
    );
  },

  getActiveEditorInput() {
    return this.isEditorTypingInput(document.activeElement) ? document.activeElement : null;
  },

  rememberTypingFocus(element = this.getActiveEditorInput()) {
    if (this.isEditorTypingInput(element)) this.typingFocusTarget = element;
    return this.typingFocusTarget;
  },

  bindAuxiliaryFocusGuard(control) {
    if (!control) return;
    control.addEventListener('pointerdown', () => this.rememberTypingFocus());
    control.addEventListener('mousedown', event => {
      const activeInput = this.getActiveEditorInput();
      if (!activeInput) return;
      this.typingFocusTarget = activeInput;
      event.preventDefault();
    });
  },

  bindEditorFocusContinuity() {
    [this.titleInput, this.descInput].forEach(input => {
      input?.addEventListener('focus', () => { this.typingFocusTarget = input; });
    });
    [this.btnPriority, this.btnTags, this.btnProject]
      .forEach(control => this.bindAuxiliaryFocusGuard(control));
  },

  captureTypingSnapshot() {
    const element = this.getActiveEditorInput();
    if (!element) return null;
    return {
      element,
      selectionStart: typeof element.selectionStart === 'number' ? element.selectionStart : null,
      selectionEnd: typeof element.selectionEnd === 'number' ? element.selectionEnd : null,
      selectionDirection: element.selectionDirection || 'none',
      scrollTop: Number(element.scrollTop) || 0,
      scrollLeft: Number(element.scrollLeft) || 0,
      viewportHeight: window.visualViewport?.height ?? null
    };
  },

  restoreTypingSnapshot(snapshot) {
    const element = snapshot?.element;
    if (!snapshot || !this.isEditorTypingInput(element)) return;
    try {
      if (document.activeElement !== element) element.focus({ preventScroll: true });
    } catch (_) {
      element.focus();
    }
    if (typeof element.setSelectionRange === 'function' && snapshot.selectionStart != null && snapshot.selectionEnd != null) {
      const max = element.value?.length ?? 0;
      const start = Math.max(0, Math.min(max, snapshot.selectionStart));
      const end = Math.max(start, Math.min(max, snapshot.selectionEnd));
      try {
        element.setSelectionRange(start, end, snapshot.selectionDirection || 'none');
      } catch (_) {}
    }
    element.scrollTop = snapshot.scrollTop;
    element.scrollLeft = snapshot.scrollLeft;
    this.typingFocusTarget = element;
  },

  waitForKeyboardViewportRecovery(generation, initialHeight = null) {
    return new Promise(resolve => {
      const viewport = window.visualViewport;
      if (!viewport || !window.matchMedia?.('(pointer: coarse)').matches) {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve(generation === this.dateOpenGeneration)));
        return;
      }

      const startHeight = Number(initialHeight) || viewport.height;
      let lastHeight = viewport.height;
      let stableFrames = 0;
      let sawResize = false;
      let rafId = null;
      let timeoutId = null;
      let finished = false;

      const cleanup = () => {
        if (rafId != null) cancelAnimationFrame(rafId);
        if (timeoutId != null) clearTimeout(timeoutId);
        viewport.removeEventListener('resize', onResize);
      };
      const finish = ok => {
        if (finished) return;
        finished = true;
        cleanup();
        resolve(ok);
      };
      const onResize = () => {
        sawResize = true;
        stableFrames = 0;
      };
      const tick = () => {
        if (generation !== this.dateOpenGeneration) return finish(false);
        const height = viewport.height;
        if (Math.abs(height - lastHeight) < 1.5) stableFrames += 1;
        else stableFrames = 0;
        lastHeight = height;
        const expanded = height >= startHeight + 32;
        if (sawResize && expanded && stableFrames >= 2) return finish(true);
        rafId = requestAnimationFrame(tick);
      };

      viewport.addEventListener('resize', onResize);
      timeoutId = setTimeout(() => finish(generation === this.dateOpenGeneration), 550);
      rafId = requestAnimationFrame(tick);
    });
  },

  cancelPendingDateOpen() {
    this.dateOpenGeneration += 1;
    this.pendingDateTypingSnapshot = null;
  },

  async openScheduleFromDate(snapshot = null) {
    const generation = ++this.dateOpenGeneration;
    this.closeAllContextMenus();
    const initialHeight = snapshot?.viewportHeight ?? window.visualViewport?.height ?? null;
    if (snapshot?.element === document.activeElement) snapshot.element.blur();

    if (snapshot) {
      const recovered = await this.waitForKeyboardViewportRecovery(generation, initialHeight);
      if (!recovered || generation !== this.dateOpenGeneration) return;
      if (!this.addTaskModal?.classList.contains('active') || !this.isEditorTypingInput(snapshot.element)) return;
    }

    window.ScheduleComponent?.open(
      this.selectedDueDate,
      this.selectedDueTime,
      this.selectedReminders,
      this.selectedRepeat,
      result => {
        if (typeof result === 'object' && result !== null) {
          this.selectedDueDate = result.dueDate;
          this.selectedDueTime = result.dueTime;
          this.selectedReminders = result.reminders || ['on_time'];
          this.selectedRepeat = result.repeat || null;
        } else {
          this.selectedDueDate = result;
        }
        this.syncDateButton();
      },
      snapshot ? {
        returnFocusTarget: snapshot.element,
        afterClose: () => {
          if (generation === this.dateOpenGeneration) this.restoreTypingSnapshot(snapshot);
        }
      } : null
    );
  },

  bindDateTrigger() {
    if (!this.btnDate) return;
    const capture = () => {
      this.pendingDateTypingSnapshot = this.captureTypingSnapshot();
    };
    this.btnDate.addEventListener('pointerdown', capture);
    this.btnDate.addEventListener('mousedown', () => {
      if (!this.pendingDateTypingSnapshot) capture();
    });
    this.btnDate.addEventListener('pointercancel', () => { this.pendingDateTypingSnapshot = null; });
    this.btnDate.addEventListener('keydown', () => { this.pendingDateTypingSnapshot = null; });
    this.btnDate.addEventListener('click', event => {
      const snapshot = event.detail === 0 ? null : this.pendingDateTypingSnapshot;
      this.pendingDateTypingSnapshot = null;
      this.openScheduleFromDate(snapshot);
    });
  },

  bindEvents() {
    this.openAddTaskBtn?.addEventListener('click', () => this.openModal());
    this.addTaskModal?.addEventListener('click', e => {
      if (e.target === this.addTaskModal) this.closeModal();
    });
    this.form?.addEventListener('submit', e => {
      e.preventDefault();
      this.submitTask();
    });
    this.addTaskModal?.addEventListener('keydown', e => this.handleModalKeydown(e));
    this.btnAddSubtask?.addEventListener('click', () => {
      const parent = this.editingTaskId ? AppState.getTask(this.editingTaskId) : null;
      if (!parent || parent.parentTaskId) return;
      this.closeAllContextMenus();
      window.SubtaskEditorComponent?.openCreate(parent.id, this.btnAddSubtask);
    });
    document.addEventListener('click', () => this.closeAllContextMenus());
    this.bindContextMenu(this.btnPriority, this.menuPriority, 'single', 'priority');
    this.bindProjectMenuTrigger();
    this.bindTagMenuTrigger();
  },

  handleModalKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      this.closeModal();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...this.addTaskModal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')]
      .filter(el => !el.disabled && el.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable.at(-1);
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  },

  initKeyboardAdjustment() {
    const queueSync = () => {
      if (this.quickViewportFrame != null) cancelAnimationFrame(this.quickViewportFrame);
      this.quickViewportFrame = requestAnimationFrame(() => {
        this.quickViewportFrame = null;
        this.syncQuickInputViewport();
      });
    };
    this.queueQuickInputViewportSync = queueSync;
    window.visualViewport?.addEventListener('resize', queueSync);
    window.visualViewport?.addEventListener('scroll', queueSync);
    window.addEventListener('resize', queueSync);
  },

  syncQuickInputViewport() {
    if (!this.addTaskModal?.classList.contains('active')) return;
    const viewport = window.visualViewport;
    const values = {
      '--quick-vv-top': viewport?.offsetTop ?? 0,
      '--quick-vv-left': viewport?.offsetLeft ?? 0,
      '--quick-vv-width': viewport?.width ?? window.innerWidth,
      '--quick-vv-height': viewport?.height ?? window.innerHeight
    };
    Object.entries(values).forEach(([property, value]) =>
      this.addTaskModal.style.setProperty(property, `${Math.max(0, value)}px`)
    );
  },

  resetQuickInputViewport() {
    if (this.quickViewportFrame != null) cancelAnimationFrame(this.quickViewportFrame);
    this.quickViewportFrame = null;
    ['--quick-vv-top', '--quick-vv-left', '--quick-vv-width', '--quick-vv-height']
      .forEach(property => this.addTaskModal?.style.removeProperty(property));
  },

  syncUIFromState() {
    this.menuPriority?.querySelectorAll('.context-menu-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.priority === this.selectedPriority);
    });
    this.btnPriority?.classList.toggle('active', Boolean(this.selectedPriority));

    this.menuProject?.querySelectorAll('.context-menu-item').forEach(item => {
      item.classList.toggle('selected', item.dataset.project === this.selectedProject);
    });
    this.btnProject?.classList.toggle('active', Boolean(this.selectedProject));

    this.menuTags?.querySelectorAll('.context-menu-item').forEach(item => {
      item.classList.toggle('selected', this.selectedTags.includes(item.dataset.tag));
    });
    this.btnTags?.classList.toggle('active', this.selectedTags.length > 0);
    [this.menuPriority, this.menuTags, this.menuProject].forEach(menu => menu && this.syncMenuSelection(menu));
    this.syncDateButton();
  },

  syncDateButton() {
    const hasSchedule = Boolean(
      this.selectedDueDate ||
      this.selectedDueTime ||
      (this.selectedRepeat && this.selectedRepeat.mode !== 'none')
    );
    this.btnDate?.classList.toggle('active', hasSchedule);
    if (!this.btnDate) return;
    const datePart = this.selectedDueDate || 'No date';
    const timePart = this.selectedDueTime ? `, ${this.selectedDueTime}` : '';
    const repPart = this.selectedRepeat && this.selectedRepeat.mode !== 'none' ? ' 🔁' : '';
    this.btnDate.title = hasSchedule ? `Scheduled: ${datePart}${timePart}${repPart}` : 'Set Date';
  },

  async submitTask() {
    if (!this.titleInput?.value.trim()) return this.titleInput?.reportValidity();
    const payload = {
      title: this.titleInput.value.trim(),
      description: this.descInput?.value.trim() || '',
      dueDate: this.selectedDueDate,
      dueTime: this.selectedDueTime,
      reminders: [...this.selectedReminders],
      repeat: this.selectedRepeat ? JSON.parse(JSON.stringify(this.selectedRepeat)) : null,
      project: this.selectedProject,
      priority: this.selectedPriority,
      tags: [...this.selectedTags]
    };
    this.submitTaskBtn.disabled = true;
    try {
      if (this.editingTaskId) await AppDataService.updateTask(this.editingTaskId, payload);
      else await AppDataService.createTask({ ...payload, parentTaskId: null });
      this.closeModal();
      this.render();
    } catch (error) {
      AppPersistence.reportError('Could not save this task. Your form has been kept open.', error);
    } finally {
      this.submitTaskBtn.disabled = false;
    }
  },

  resetSelections(useCurrentContext = false) {
    this.selectedPriority = '';
    this.selectedProject = '';
    this.selectedTags = [];
    this.selectedDueDate = null;
    if (useCurrentContext) {
      if (AppState.currentFilterType === 'project') this.selectedProject = AppState.currentFilter;
      else if (AppState.currentFilterType === 'tag') this.selectedTags = [AppState.currentFilter];
      else if (AppState.currentFilterType === 'smart' && AppState.currentFilter === 'today') {
        this.selectedDueDate = AppState.getTodayDateStr();
      }
    }
    this.selectedDueTime = null;
    this.selectedReminders = ['on_time'];
    this.selectedRepeat = null;
    this.syncUIFromState();
    this.closeAllContextMenus();
  },

  openModal(taskToEdit = null) {
    if (taskToEdit && AppState.isSubtask(taskToEdit)) {
      window.SubtaskEditorComponent?.openEdit(taskToEdit.id);
      return;
    }
    this.lastFocusedElement = document.activeElement;

    if (taskToEdit) {
      const normalized = taskToEdit;
      this.editingTaskId = normalized.id;
      this.titleInput.value = normalized.title;
      this.descInput.value = normalized.description || '';
      this.selectedPriority = normalized.priority || '';
      this.selectedProject = normalized.project || '';
      this.selectedTags = [...normalized.tags];
      this.selectedDueDate = normalized.dueDate;
      this.selectedDueTime = normalized.dueTime;
      this.selectedReminders = Array.isArray(normalized.reminders) ? [...normalized.reminders] : ['on_time'];
      this.selectedRepeat = normalized.repeat ? JSON.parse(JSON.stringify(normalized.repeat)) : null;
      this.syncUIFromState();
      this.btnAddSubtask.hidden = false;
      this.renderParentEditSubtasks();
      this.submitTaskBtn.title = 'Save Changes';
      this.submitTaskBtn.setAttribute('aria-label', 'Save Changes');
    } else {
      this.editingTaskId = null;
      this.titleInput.value = '';
      this.descInput.value = '';
      this.resetSelections(true);
      this.btnAddSubtask.hidden = true;
      this.parentSubtasksSection.hidden = true;
      this.parentSubtasksList.innerHTML = '';
      this.submitTaskBtn.title = 'Add Task';
      this.submitTaskBtn.setAttribute('aria-label', 'Add Task');
    }

    ModalFocusManager.open(this.addTaskModal, {
      trigger: this.lastFocusedElement,
      initialFocus: this.titleInput,
      fallbackFocus: this.openAddTaskBtn
    });
    this.syncTaskModalBodyState();
    this.syncQuickInputViewport();
  },

  closeModal() {
    this.cancelPendingDateOpen();
    this.closeAllContextMenus();
    this.closeTaskActionMenu(false);
    ModalFocusManager.close(this.addTaskModal, {
      fallbackFocus: this.openAddTaskBtn
    });
    this.resetQuickInputViewport();
    this.editingTaskId = null;
    this.titleInput.value = '';
    this.descInput.value = '';
    this.btnAddSubtask.hidden = true;
    this.parentSubtasksSection.hidden = true;
    this.parentSubtasksList.innerHTML = '';
    this.resetSelections();
    this.syncTaskModalBodyState();
    this.lastFocusedElement = null;
    this.typingFocusTarget = null;
  },

  syncTaskModalBodyState() {
    const rootOpen = this.addTaskModal?.classList.contains('active');
    const childOpen = document.getElementById('subtask-modal')?.classList.contains('active');
    document.body.classList.toggle('modal-open', Boolean(rootOpen || childOpen));
  }
};

export const TasksComponent = {
  ...TasksCore,
  ...TaskMenuMethods,
  ...TaskTaxonomyMenuOrderMethods,
  ...TaskActionMethods,
  ...TaskGroupMethods,
  ...TaskHierarchyMethods,
  ...TaskKanbanMethods,
  ...TaskDragMethods,
  ...TaskDragHierarchyMethods,
  ...TaskDragTouchMethods,
  ...TaskDragCommitMethods,
  ...TaskRendererMethods
};

window.TasksComponent = TasksComponent;
