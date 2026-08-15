import { ModalFocusManager } from './modal-focus.js';
import { TaxonomyOrder } from '../taxonomy-order.js';
import { AppPersistence } from '../storage/persistence.js';
import { AppDataService } from '../storage/data-service.js';
import { AppState } from '../state.js';
export const SubtaskEditorComponent = {
  editingSubtaskId: null,
  parentTaskId: null,
  selectedPriority: '',
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
    this.modal = document.getElementById('subtask-modal');
    this.card = document.getElementById('subtask-editor-card');
    this.form = document.getElementById('subtask-form');
    this.heading = document.getElementById('subtask-editor-heading');
    this.parentLabel = document.getElementById('subtask-parent-label');
    this.titleInput = document.getElementById('subtask-title-input');
    this.descInput = document.getElementById('subtask-desc-input');
    this.btnDate = document.getElementById('btn-subtask-date');
    this.btnPriority = document.getElementById('btn-subtask-priority');
    this.btnTags = document.getElementById('btn-subtask-tags');
    this.menuPriority = document.getElementById('subtask-menu-priority');
    this.menuTags = document.getElementById('subtask-menu-tags');
    this.projectLock = document.getElementById('subtask-project-lock');
    this.btnClose = document.getElementById('btn-close-subtask');
    this.btnCancel = document.getElementById('btn-cancel-subtask');
    this.btnSubmit = document.getElementById('btn-submit-subtask');
    this.bindEditorFocusContinuity();
    this.bindEvents();
    this.initKeyboardAdjustment();
  },

  isEditorTypingInput(element) {
    return Boolean(
      element &&
      element.isConnected &&
      (element === this.titleInput || element === this.descInput) &&
      this.modal?.classList.contains('active')
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
    [this.btnPriority, this.btnTags]
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

  getMenuInteractionFromClick(event) {
    return event?.detail === 0 ? 'keyboard' : 'pointer';
  },

  handleMenuPointerDown(event, menu) {
    if (!event.target.closest('.context-menu-item')) return;
    const preserved = this.getMenuPortalMap().get(menu)?.preserveEditorFocus || null;
    if (preserved && document.activeElement === preserved) event.preventDefault();
  },

  bindEvents() {
    this.btnClose?.addEventListener('click', () => this.close());
    this.btnCancel?.addEventListener('click', () => this.close());
    this.form?.addEventListener('submit', e => {
      e.preventDefault();
      this.submit();
    });
    this.modal?.addEventListener('click', e => {
      if (e.target === this.modal) this.close();
    });
    this.modal?.addEventListener('keydown', e => this.handleKeydown(e));

    const captureDate = () => {
      this.pendingDateTypingSnapshot = this.captureTypingSnapshot();
    };
    this.btnDate?.addEventListener('pointerdown', captureDate);
    this.btnDate?.addEventListener('mousedown', () => {
      if (!this.pendingDateTypingSnapshot) captureDate();
    });
    this.btnDate?.addEventListener('pointercancel', () => { this.pendingDateTypingSnapshot = null; });
    this.btnDate?.addEventListener('keydown', () => { this.pendingDateTypingSnapshot = null; });
    this.btnDate?.addEventListener('click', event => {
      const snapshot = event.detail === 0 ? null : this.pendingDateTypingSnapshot;
      this.pendingDateTypingSnapshot = null;
      this.openSchedule(snapshot);
    });

    this.btnPriority?.addEventListener('click', e => {
      e.stopPropagation();
      const interaction = this.getMenuInteractionFromClick(e);
      this.toggleMenu(this.menuPriority, this.btnPriority, {
        interaction,
        preserveEditorFocus: interaction === 'pointer' ? this.getActiveEditorInput() : null
      });
    });
    this.btnTags?.addEventListener('click', e => {
      e.stopPropagation();
      const interaction = this.getMenuInteractionFromClick(e);
      this.toggleMenu(this.menuTags, this.btnTags, {
        interaction,
        preserveEditorFocus: interaction === 'pointer' ? this.getActiveEditorInput() : null
      });
    });
    this.menuPriority?.addEventListener('mousedown', e => this.handleMenuPointerDown(e, this.menuPriority));
    this.menuTags?.addEventListener('mousedown', e => this.handleMenuPointerDown(e, this.menuTags));
    this.menuPriority?.addEventListener('click', e => {
      const item = e.target.closest('[data-subtask-priority]');
      if (!item) return;
      e.stopPropagation();
      this.selectedPriority = item.dataset.subtaskPriority;
      this.syncPriorityUI();
      this.closeMenus();
    });
    this.menuTags?.addEventListener('click', e => {
      const item = e.target.closest('[data-subtask-tag]');
      if (!item) return;
      e.stopPropagation();
      const tagId = item.dataset.subtaskTag;
      if (this.selectedTags.includes(tagId)) this.selectedTags = this.selectedTags.filter(id => id !== tagId);
      else this.selectedTags.push(tagId);
      this.syncTagUI();
    });
    document.addEventListener('click', () => this.closeMenus());
  },

  openCreate(parentTaskId, trigger = null) {
    const parent = AppState.validateParentTaskId(parentTaskId);
    if (!parent) return;
    this.lastFocusedElement = trigger || document.activeElement;
    this.editingSubtaskId = null;
    this.parentTaskId = parent.id;
    this.titleInput.value = '';
    this.descInput.value = '';
    this.resetDraft();
    this.heading.textContent = 'New Subtask';
    this.btnSubmit.textContent = 'Add Subtask';
    this.open(parent);
  },

  openEdit(subtaskId, trigger = null) {
    const task = AppState.getTask(subtaskId);
    if (!task?.parentTaskId) return;
    const parent = AppState.validateParentTaskId(task.parentTaskId);
    if (!parent) return;
    this.lastFocusedElement = trigger || document.activeElement;
    this.editingSubtaskId = task.id;
    this.parentTaskId = parent.id;
    const normalized = task;
    this.titleInput.value = normalized.title;
    this.descInput.value = normalized.description || '';
    this.selectedPriority = normalized.priority || '';
    this.selectedTags = [...normalized.tags];
    this.selectedDueDate = normalized.dueDate;
    this.selectedDueTime = normalized.dueTime;
    this.selectedReminders = Array.isArray(normalized.reminders) ? [...normalized.reminders] : ['on_time'];
    this.selectedRepeat = normalized.repeat ? JSON.parse(JSON.stringify(normalized.repeat)) : null;
    this.heading.textContent = 'Edit Subtask';
    this.btnSubmit.textContent = 'Save Changes';
    this.open(parent);
  },

  open(parent) {
    window.TasksComponent?.closeTaskActionMenu(false);
    this.parentLabel.textContent = `Parent: ${parent.title}`;
    const project = parent.project ? AppState.getProject(parent.project) : null;
    this.projectLock.textContent = project ? `${project.icon} ${project.name} 🔑` : 'Inbox 🔑';
    this.renderTagMenu();
    this.syncPriorityUI();
    this.syncTagUI();
    this.syncScheduleUI();
    this.closeMenus();
    ModalFocusManager.open(this.modal, {
      trigger: this.lastFocusedElement,
      initialFocus: this.titleInput,
      fallbackFocus: window.TasksComponent?.openAddTaskBtn
    });
    window.TasksComponent?.syncTaskModalBodyState();
  },

  close() {
    if (!this.modal?.classList.contains('active')) return;
    this.cancelPendingDateOpen();
    this.closeMenus();
    ModalFocusManager.close(this.modal, {
      fallbackFocus: window.TasksComponent?.openAddTaskBtn
    });
    if (this.card) this.card.style.marginBottom = '0px';
    this.editingSubtaskId = null;
    this.parentTaskId = null;
    this.lastFocusedElement = null;
    this.typingFocusTarget = null;
    window.TasksComponent?.syncTaskModalBodyState();
  },

  resetDraft() {
    this.selectedPriority = '';
    this.selectedTags = [];
    this.selectedDueDate = null;
    this.selectedDueTime = null;
    this.selectedReminders = ['on_time'];
    this.selectedRepeat = null;
  },

  async submit() {
    const title = this.titleInput?.value.trim();
    if (!title) return this.titleInput?.reportValidity();
    const payload = {
      title,
      description: this.descInput?.value.trim() || '',
      dueDate: this.selectedDueDate,
      dueTime: this.selectedDueTime,
      reminders: [...this.selectedReminders],
      repeat: this.selectedRepeat ? JSON.parse(JSON.stringify(this.selectedRepeat)) : null,
      priority: this.selectedPriority,
      tags: [...this.selectedTags]
    };
    this.btnSubmit.disabled = true;
    try {
      if (this.editingSubtaskId) await AppDataService.updateTask(this.editingSubtaskId, payload);
      else await AppDataService.createTask({ ...payload, parentTaskId: this.parentTaskId });
      this.close();
      window.TasksComponent?.refreshAfterTaskMutation();
    } catch (error) {
      AppPersistence.reportError('Could not save this subtask. Your form has been kept open.', error);
    } finally {
      this.btnSubmit.disabled = false;
    }
  },

  async openSchedule(snapshot = null) {
    const generation = ++this.dateOpenGeneration;
    this.closeMenus();
    const initialHeight = snapshot?.viewportHeight ?? window.visualViewport?.height ?? null;
    if (snapshot?.element === document.activeElement) snapshot.element.blur();

    if (snapshot) {
      const recovered = await this.waitForKeyboardViewportRecovery(generation, initialHeight);
      if (!recovered || generation !== this.dateOpenGeneration) return;
      if (!this.modal?.classList.contains('active') || !this.isEditorTypingInput(snapshot.element)) return;
    }

    window.ScheduleComponent?.open(
      this.selectedDueDate,
      this.selectedDueTime,
      this.selectedReminders,
      this.selectedRepeat,
      result => {
        this.selectedDueDate = result?.dueDate ?? null;
        this.selectedDueTime = result?.dueTime ?? null;
        this.selectedReminders = Array.isArray(result?.reminders) ? [...result.reminders] : ['on_time'];
        this.selectedRepeat = result?.repeat ? JSON.parse(JSON.stringify(result.repeat)) : null;
        this.syncScheduleUI();
      },
      snapshot ? {
        returnFocusTarget: snapshot.element,
        afterClose: () => {
          if (generation === this.dateOpenGeneration) this.restoreTypingSnapshot(snapshot);
        }
      } : null
    );
  },

  syncScheduleUI() {
    const hasSchedule = Boolean(
      this.selectedDueDate ||
      this.selectedDueTime ||
      (this.selectedRepeat && this.selectedRepeat.mode !== 'none')
    );
    this.btnDate?.classList.toggle('active', hasSchedule);
    if (!this.btnDate) return;
    const datePart = this.selectedDueDate || 'No date';
    const timePart = this.selectedDueTime ? `, ${this.selectedDueTime}` : '';
    const repeatPart = this.selectedRepeat && this.selectedRepeat.mode !== 'none' ? ' 🔁' : '';
    this.btnDate.title = hasSchedule ? `Scheduled: ${datePart}${timePart}${repeatPart}` : 'Set Date';
  },

  renderTagMenu() {
    if (!this.menuTags) return;
    this.menuTags.innerHTML = '';
    const renderLevel = (parentId, depth = 0) => {
      TaxonomyOrder.getChildren('tag', parentId).forEach(tag => {
        const item = document.createElement('div');
        item.className = 'context-menu-item multiselect';
        item.dataset.subtaskTag = tag.id;
        item.style.paddingLeft = `${12 + depth * 16}px`;
        item.innerHTML = `<span class="check-box-icon"></span><span>${tag.icon} ${this.escapeText(tag.name)}</span>`;
        this.menuTags.appendChild(item);
        renderLevel(tag.id, depth + 1);
      });
    };
    renderLevel(null);
  },

  syncPriorityUI() {
    this.menuPriority?.querySelectorAll('[data-subtask-priority]').forEach(item => {
      item.classList.toggle('selected', item.dataset.subtaskPriority === this.selectedPriority);
    });
    this.btnPriority?.classList.toggle('active', Boolean(this.selectedPriority));
  },

  syncTagUI() {
    this.menuTags?.querySelectorAll('[data-subtask-tag]').forEach(item => {
      item.classList.toggle('selected', this.selectedTags.includes(item.dataset.subtaskTag));
    });
    this.btnTags?.classList.toggle('active', this.selectedTags.length > 0);
  },

  getMenuPortalMap() {
    if (!this._menuPortals) this._menuPortals = new Map();
    return this._menuPortals;
  },

  getMenuTrigger(menu, fallback = null) {
    return this.getMenuPortalMap().get(menu)?.trigger || fallback || menu?.previousElementSibling || null;
  },

  mountMenu(menu, trigger, preserveEditorFocus = null) {
    const portals = this.getMenuPortalMap();
    if (portals.has(menu)) {
      portals.get(menu).preserveEditorFocus = preserveEditorFocus;
      return;
    }
    const placeholder = document.createComment(`subtask-context-menu:${menu.id || 'menu'}`);
    const parent = menu.parentNode;
    parent?.insertBefore(placeholder, menu);
    if (!this.modal) return;
    this.modal.appendChild(menu);
    menu.classList.add('context-menu-portal');
    portals.set(menu, { placeholder, parent, trigger, host: this.modal, preserveEditorFocus });
  },

  restoreMenu(menu) {
    const portals = this.getMenuPortalMap();
    const portal = portals.get(menu);
    if (!portal) return;
    menu.classList.remove('context-menu-portal');
    menu.style.removeProperty('top');
    menu.style.removeProperty('left');
    menu.style.removeProperty('right');
    menu.style.removeProperty('bottom');
    menu.style.removeProperty('max-height');
    if (portal.placeholder?.parentNode) portal.placeholder.replaceWith(menu);
    else portal.parent?.appendChild(menu);
    portals.delete(menu);
  },

  positionMenu(menu, trigger = this.getMenuTrigger(menu)) {
    if (!menu?.classList.contains('open') || !trigger || !this.modal) return;
    const hostRect = this.modal.getBoundingClientRect();
    const triggerRect = trigger.getBoundingClientRect();
    const gap = 8;
    const edge = 8;
    const spaceAbove = Math.max(0, triggerRect.top - hostRect.top - gap - edge);
    const spaceBelow = Math.max(0, hostRect.bottom - triggerRect.bottom - gap - edge);

    menu.style.top = '0px';
    menu.style.left = '0px';
    menu.style.bottom = 'auto';
    menu.style.right = 'auto';
    menu.style.maxHeight = `${Math.max(80, Math.floor(Math.max(spaceAbove, spaceBelow)))}px`;

    const preferredHeight = Math.min(menu.scrollHeight, 320);
    const openAbove = spaceAbove >= Math.min(preferredHeight, 140) || spaceAbove >= spaceBelow;
    const available = Math.max(80, Math.floor(openAbove ? spaceAbove : spaceBelow));
    menu.style.maxHeight = `${available}px`;

    const rect = menu.getBoundingClientRect();
    const left = Math.min(
      Math.max(edge, triggerRect.left - hostRect.left),
      Math.max(edge, hostRect.width - rect.width - edge)
    );
    let top = openAbove
      ? triggerRect.top - hostRect.top - gap - rect.height
      : triggerRect.bottom - hostRect.top + gap;
    top = Math.min(Math.max(edge, top), Math.max(edge, hostRect.height - rect.height - edge));

    menu.style.left = `${Math.round(left)}px`;
    menu.style.top = `${Math.round(top)}px`;
  },

  positionOpenMenus() {
    [this.menuPriority, this.menuTags].forEach(menu => {
      if (menu?.classList.contains('open')) this.positionMenu(menu);
    });
  },

  toggleMenu(menu, trigger = null, { preserveEditorFocus = null } = {}) {
    if (!menu) return;
    const open = menu.classList.contains('open');
    this.closeMenus();
    window.TasksComponent?.closeTaskActionMenu(false);
    if (!open) {
      const resolvedTrigger = trigger || menu.previousElementSibling;
      this.mountMenu(menu, resolvedTrigger, preserveEditorFocus);
      menu.classList.add('open');
      this.positionMenu(menu, resolvedTrigger);
      requestAnimationFrame(() => this.positionMenu(menu, resolvedTrigger));
    }
  },

  closeMenus() {
    [this.menuPriority, this.menuTags].forEach(menu => {
      if (!menu) return;
      menu.classList.remove('open');
      this.restoreMenu(menu);
    });
  },

  handleKeydown(e) {
    if (e.key === 'Escape') {
      if (this.menuPriority?.classList.contains('open') || this.menuTags?.classList.contains('open')) {
        this.closeMenus();
      } else {
        e.preventDefault();
        this.close();
      }
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...this.modal.querySelectorAll('button, input, [tabindex]:not([tabindex="-1"])')]
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
    if (!window.visualViewport) return;
    const adjust = () => {
      if (!this.modal?.classList.contains('active')) return;
      const viewport = window.visualViewport;
      const height = window.innerHeight - viewport.height - viewport.offsetTop;
      this.card.style.marginBottom = height > 50 ? `${height}px` : '0px';
      this.positionOpenMenus();
    };
    window.visualViewport.addEventListener('resize', adjust);
    window.visualViewport.addEventListener('scroll', adjust);
  },

  escapeText(value) {
    const div = document.createElement('div');
    div.textContent = value;
    return div.innerHTML;
  }
};

window.SubtaskEditorComponent = SubtaskEditorComponent;
