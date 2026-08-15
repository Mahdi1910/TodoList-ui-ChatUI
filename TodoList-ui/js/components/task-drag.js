import { AppState } from '../state.js';
export const TaskDragMethods = {
  initTaskDrag() {
    this.dragWorkspace = document.querySelector('.workspace-content');
    if (!this.dragWorkspace) return;
    this.assertTaskDragHierarchyIntegration();
    this.dragLayer = document.createElement('div');
    this.dragLayer.className = 'task-drag-layer';
    document.body.appendChild(this.dragLayer);
    this.dragPending = null;
    this.dragSession = null;
    this.dragSuppressClickUntil = 0;
    this.dragWorkspace.addEventListener('pointerdown', e => this.onTaskPointerDown(e));
    document.addEventListener('pointermove', e => this.onTaskPointerMove(e), { passive: false });
    document.addEventListener('pointerup', e => this.onTaskPointerUp(e));
    document.addEventListener('pointercancel', e => this.onTaskPointerCancel(e));
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.dragSession) {
        e.preventDefault();
        this.cancelTaskDrag();
      }
    });
    window.addEventListener('blur', () => this.dragSession && this.cancelTaskDrag());
    this.dragWorkspace.addEventListener('click', e => {
      if (performance.now() < this.dragSuppressClickUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener('contextmenu', e => {
      if (this.dragPending || this.touchDragPending || this.dragSession) e.preventDefault();
    });
    this.initTaskTouchDrag?.();
  },

  assertTaskDragHierarchyIntegration() {
    const required = [
      'resolveHierarchyDrop',
      'measureHierarchyAlignment',
      'buildInitialHierarchyPreview',
      'applyHierarchyPreview',
      'resolveRootSlot',
      'resolveChildSlot',
      'updateHorizontalIntent'
    ];
    const missing = required.filter(name => typeof this[name] !== 'function');
    if (missing.length) {
      throw new Error(`Task hierarchy drag integration is incomplete: ${missing.join(', ')}`);
    }
  },

  setDropLaneContext(element, lane, groupType = 'none', groupKey = 'all') {
    if (!element) return;
    element.classList.add('task-drop-lane');
    element.dataset.taskDropLane = lane;
    element.dataset.groupType = groupType;
    element.dataset.groupKey = groupKey ?? '';
  },

  clearDropLaneContext(element) {
    if (!element) return;
    element.classList.remove('task-drop-lane', 'is-drop-target');
    delete element.dataset.taskDropLane;
    delete element.dataset.groupType;
    delete element.dataset.groupKey;
  },

  getTaskDragTarget(target) {
    if (document.querySelector('.modal-overlay.active')) return null;
    if (target.closest('button,input,a,select,textarea,.task-checkbox-wrapper')) return null;

    const subtaskItem = target.closest('.subtask-drag-item');
    if (subtaskItem) {
      const task = AppState.getTask(subtaskItem.dataset.taskId);
      const sourceFamily = subtaskItem.closest('.task-family');
      const sourceLane = sourceFamily?.closest('[data-task-drop-lane]');
      if (!task?.parentTaskId || !sourceFamily || !sourceLane) return null;
      return {
        unit: subtaskItem,
        task,
        level: 'subtask',
        parentId: task.parentTaskId,
        sourceFamily,
        sourceLane
      };
    }

    const family = target.closest('.task-family');
    const rootCard = this.getRootCard(family);
    const sourceLane = family?.closest('[data-task-drop-lane]');
    if (!family || !rootCard || !rootCard.contains(target) || !sourceLane) return null;
    const task = AppState.getTask(family.dataset.parentId);
    if (!task || task.parentTaskId) return null;
    return { unit: family, task, level: 'root', parentId: null, sourceFamily: family, sourceLane };
  },

  onTaskPointerDown(e) {
    if (e.pointerType === 'touch') return;
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = this.getTaskDragTarget(e.target);
    if (!target) return;
    this.cancelPendingTaskDrag();
    this.dragPending = {
      ...target,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => this.activatePointerTaskDrag(), 300)
    };
  },

  cancelPendingTaskDrag() {
    if (this.dragPending?.timer) clearTimeout(this.dragPending.timer);
    this.dragPending = null;
  },

  onTaskPointerMove(e) {
    if (this.dragSession?.pointerId === e.pointerId) {
      e.preventDefault();
      this.dragSession.x = e.clientX;
      this.dragSession.y = e.clientY;
      this.positionFloatingFamily(e.clientX, e.clientY);
      this.updateTaskDropTarget(e.clientX, e.clientY);
      return;
    }
    if (!this.dragPending || this.dragPending.pointerId !== e.pointerId) return;
    this.dragPending.x = e.clientX;
    this.dragPending.y = e.clientY;
    const distance = Math.hypot(e.clientX - this.dragPending.startX, e.clientY - this.dragPending.startY);
    if (distance > 8) this.cancelPendingTaskDrag();
  },

  activatePointerTaskDrag() {
    const pending = this.dragPending;
    if (!pending?.unit?.isConnected || this.dragSession) return this.cancelPendingTaskDrag();
    this.dragPending = null;
    this.beginTaskDragSession(pending, 'pointer');
  },

  beginTaskDragSession(pending, inputType) {
    const task = AppState.getTask(pending.task.id);
    const sourceLane = pending.sourceLane;
    if (!task || !sourceLane || !pending.unit?.isConnected) return;

    this.closeTaskActionMenu?.(false);
    this.closeAllContextMenus?.();
    window.WorkspaceControls?.closeMenu();
    window.SidebarComponent?.closeSidebarActionMenus();
    window.SubtaskEditorComponent?.closeMenus();

    const rect = pending.unit.getBoundingClientRect();
    const alignment = this.measureHierarchyAlignment(sourceLane, pending.sourceFamily);
    const initialPreview = this.buildInitialHierarchyPreview(pending);

    const placeholder = document.createElement('div');
    placeholder.className = `task-drop-placeholder ${pending.level === 'subtask' ? 'is-subtask-preview' : 'is-root-preview'}`;
    placeholder.dataset.previewLevel = pending.level;
    placeholder.style.height = `${rect.height}px`;
    placeholder.style.width = '100%';
    pending.unit.parentElement.insertBefore(placeholder, pending.unit);

    this.dragLayer.appendChild(pending.unit);
    pending.unit.classList.add('is-dragging');
    pending.unit.style.width = `${rect.width}px`;
    pending.unit.style.left = `${rect.left}px`;
    pending.unit.style.top = `${rect.top}px`;

    this.dragSession = {
      inputType,
      pointerId: inputType === 'pointer' ? pending.pointerId : null,
      touchIdentifier: inputType === 'touch' ? pending.identifier : null,
      taskId: task.id,
      laneType: sourceLane.dataset.taskDropLane || 'active',
      dragUnit: pending.unit,
      sourceLevel: pending.level,
      sourceParentId: pending.parentId || null,
      sourceFamily: pending.sourceFamily,
      sourceChildHost: pending.level === 'subtask' ? placeholder.parentElement : null,
      placeholder,
      sourceLane,
      currentLane: sourceLane,
      sourceContext: this.getDropLaneContext(sourceLane),
      offsetX: pending.x - rect.left,
      offsetY: pending.y - rect.top,
      x: pending.x,
      y: pending.y,
      horizontalIntent: pending.level,
      previewLevel: initialPreview.level,
      previewParentId: initialPreview.parentId,
      previewBeforeTaskId: initialPreview.beforeTaskId,
      previewAfterTaskId: initialPreview.afterTaskId,
      forcedChildZone: false,
      initialPreview: { ...initialPreview },
      rootAlignmentX: alignment.rootX,
      subtaskAlignmentX: alignment.childX,
      hierarchyIndent: alignment.indent,
      startSortKey: window.WorkspaceControls?.sortKey || 'custom'
    };

    document.body.classList.add('task-drag-active');
    sourceLane.classList.add('is-drop-target');
    this.dragSuppressClickUntil = performance.now() + 700;
    if (inputType === 'pointer') {
      try { this.dragWorkspace.setPointerCapture(pending.pointerId); } catch (_) {}
    }
    this.positionFloatingFamily(this.dragSession.x, this.dragSession.y);
    this.startTaskDragAutoScroll();
  },

  positionFloatingFamily(x, y) {
    const session = this.dragSession;
    if (!session) return;
    session.dragUnit.style.left = `${x - session.offsetX}px`;
    session.dragUnit.style.top = `${y - session.offsetY}px`;
  },

  getDropLaneContext(lane) {
    return {
      lane: lane?.dataset.taskDropLane || '',
      groupType: lane?.dataset.groupType || 'none',
      groupKey: lane?.dataset.groupKey ?? 'all'
    };
  },

  isCompatibleDropLane(lane) {
    if (!lane || lane.offsetParent === null) return false;
    return lane.dataset.taskDropLane === this.dragSession?.laneType;
  },

  findDropLaneAtPoint(x, y) {
    for (const element of document.elementsFromPoint(x, y)) {
      const lane = element.closest?.('[data-task-drop-lane]');
      if (this.isCompatibleDropLane(lane)) return lane;
    }
    return null;
  },

  updateTaskDropTarget(x, y) {
    this.resolveHierarchyDrop(x, y);
  },

  captureDragFamilyRects(containers) {
    const rects = new Map();
    [...new Set((containers || []).filter(Boolean))].forEach(container => {
      [...container.children].forEach(element => {
        const movable = element.classList?.contains('task-family') || element.classList?.contains('subtask-drag-item');
        if (movable && !element.classList.contains('is-dragging')) {
          rects.set(element, element.getBoundingClientRect());
        }
      });
    });
    return rects;
  },

  animateDragFamilyShift(beforeRects) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    beforeRects.forEach((before, element) => {
      if (!element.isConnected) return;
      const after = element.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) return;
      element.style.transition = 'none';
      element.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        element.style.transition = 'transform var(--transition-fast)';
        element.style.transform = '';
      });
    });
  },

  collectVisibleDragOrder() {
    const session = this.dragSession;
    if (!session || session.previewLevel !== 'root') return [];
    const seen = new Set();
    const ordered = [];
    document.querySelectorAll(`[data-task-drop-lane="${session.laneType}"]`).forEach(lane => {
      if (lane.offsetParent === null) return;
      [...lane.children].forEach(element => {
        let id = null;
        if (element === session.placeholder) id = session.taskId;
        else if (element.classList?.contains('task-family')) id = element.dataset.parentId;
        if (!id || seen.has(id)) return;
        seen.add(id);
        ordered.push(id);
      });
    });
    return ordered;
  },

  onTaskPointerUp(e) {
    if (this.dragSession?.pointerId === e.pointerId) return this.commitTaskDrag();
    if (this.dragPending?.pointerId === e.pointerId) this.cancelPendingTaskDrag();
  },

  onTaskPointerCancel(e) {
    if (this.dragSession?.pointerId === e.pointerId) this.cancelTaskDrag();
    if (this.dragPending?.pointerId === e.pointerId) this.cancelPendingTaskDrag();
  }
};
