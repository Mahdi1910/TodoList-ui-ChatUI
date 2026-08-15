export const TaskDragTouchMethods = {
  initTaskTouchDrag() {
    if (!this.dragWorkspace) return;
    this.touchDragPending = null;
    this.dragWorkspace.addEventListener('touchstart', e => this.onTaskTouchStart(e), { passive: true });
    document.addEventListener('touchmove', e => this.onTaskTouchMove(e), { passive: false });
    document.addEventListener('touchend', e => this.onTaskTouchEnd(e), { passive: true });
    document.addEventListener('touchcancel', e => this.onTaskTouchCancel(e), { passive: true });
  },

  findTouchByIdentifier(list, identifier) {
    for (const touch of list || []) {
      if (touch.identifier === identifier) return touch;
    }
    return null;
  },

  cancelPendingTouchDrag() {
    if (this.touchDragPending?.timer) clearTimeout(this.touchDragPending.timer);
    this.touchDragPending = null;
  },

  onTaskTouchStart(e) {
    if (e.touches.length !== 1) {
      this.cancelPendingTouchDrag();
      if (this.dragSession?.inputType === 'touch') this.cancelTaskDrag();
      return;
    }
    if (this.dragSession || this.touchDragPending) return;
    const target = this.getTaskDragTarget?.(e.target);
    if (!target) return;
    const touch = e.changedTouches[0] || e.touches[0];
    if (!touch) return;
    this.touchDragPending = {
      ...target,
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      x: touch.clientX,
      y: touch.clientY,
      timer: setTimeout(() => this.activateTouchTaskDrag(), 300)
    };
  },

  activateTouchTaskDrag() {
    const pending = this.touchDragPending;
    if (!pending?.unit?.isConnected || this.dragSession) return this.cancelPendingTouchDrag();
    this.touchDragPending = null;
    this.beginTaskDragSession(pending, 'touch');
  },

  onTaskTouchMove(e) {
    if (this.dragSession?.inputType === 'touch') {
      const touch = this.findTouchByIdentifier(e.touches, this.dragSession.touchIdentifier);
      if (!touch) return;
      if (e.cancelable) e.preventDefault();
      this.dragSession.x = touch.clientX;
      this.dragSession.y = touch.clientY;
      this.positionFloatingFamily(touch.clientX, touch.clientY);
      this.updateTaskDropTarget(touch.clientX, touch.clientY);
      return;
    }

    const pending = this.touchDragPending;
    if (!pending) return;
    const touch = this.findTouchByIdentifier(e.touches, pending.identifier);
    if (!touch) return;
    pending.x = touch.clientX;
    pending.y = touch.clientY;
    const distance = Math.hypot(touch.clientX - pending.startX, touch.clientY - pending.startY);
    if (distance > 8) this.cancelPendingTouchDrag();
  },

  onTaskTouchEnd(e) {
    if (this.dragSession?.inputType === 'touch') {
      const ended = this.findTouchByIdentifier(e.changedTouches, this.dragSession.touchIdentifier);
      if (ended) this.commitTaskDrag();
      return;
    }
    const pending = this.touchDragPending;
    if (!pending) return;
    const ended = this.findTouchByIdentifier(e.changedTouches, pending.identifier);
    if (ended) this.cancelPendingTouchDrag();
  },

  onTaskTouchCancel(e) {
    if (this.dragSession?.inputType === 'touch') {
      const cancelled = this.findTouchByIdentifier(e.changedTouches, this.dragSession.touchIdentifier);
      if (cancelled) this.cancelTaskDrag();
      return;
    }
    const pending = this.touchDragPending;
    if (!pending) return;
    const cancelled = this.findTouchByIdentifier(e.changedTouches, pending.identifier);
    if (cancelled) this.cancelPendingTouchDrag();
  }
};
