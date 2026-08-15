export const SidebarTaxonomyDragTouchMethods = {
  initTaxonomyTouchDrag() {
    this.taxonomyTouchPending = null;
    this.sidebarEl.addEventListener('touchstart', e => this.onTaxonomyTouchStart(e), { passive: true });
    document.addEventListener('touchmove', e => this.onTaxonomyTouchMove(e), { passive: false });
    document.addEventListener('touchend', e => this.onTaxonomyTouchEnd(e), { passive: true });
    document.addEventListener('touchcancel', e => this.onTaxonomyTouchCancel(e), { passive: true });
  },

  findTaxonomyTouch(list, identifier) {
    for (const touch of list || []) {
      if (touch.identifier === identifier) return touch;
    }
    return null;
  },

  cancelPendingTaxonomyTouch() {
    if (this.taxonomyTouchPending?.timer) clearTimeout(this.taxonomyTouchPending.timer);
    this.taxonomyTouchPending = null;
  },

  onTaxonomyTouchStart(e) {
    if (e.touches.length !== 1) {
      this.cancelPendingTaxonomyTouch();
      if (this.taxonomyDragSession?.inputType === 'touch') this.cancelTaxonomyDrag();
      return;
    }
    if (this.taxonomyDragSession || this.taxonomyTouchPending) return;
    const target = this.getTaxonomyDragTarget(e.target);
    if (!target) return;
    const touch = e.changedTouches[0] || e.touches[0];
    if (!touch) return;
    this.taxonomyTouchPending = {
      ...target,
      identifier: touch.identifier,
      startX: touch.clientX,
      startY: touch.clientY,
      x: touch.clientX,
      y: touch.clientY,
      timer: setTimeout(() => this.activateTaxonomyTouchDrag(), 300)
    };
  },

  activateTaxonomyTouchDrag() {
    const pending = this.taxonomyTouchPending;
    if (!pending?.node?.isConnected || this.taxonomyDragSession) return this.cancelPendingTaxonomyTouch();
    this.taxonomyTouchPending = null;
    this.beginTaxonomyDragSession(pending, 'touch');
  },

  onTaxonomyTouchMove(e) {
    const session = this.taxonomyDragSession;
    if (session?.inputType === 'touch') {
      const touch = this.findTaxonomyTouch(e.touches, session.touchIdentifier);
      if (!touch) return;
      if (e.cancelable) e.preventDefault();
      session.x = touch.clientX;
      session.y = touch.clientY;
      this.positionFloatingTaxonomy(touch.clientX, touch.clientY);
      this.resolveTaxonomyDrop(touch.clientX, touch.clientY);
      return;
    }

    const pending = this.taxonomyTouchPending;
    if (!pending) return;
    const touch = this.findTaxonomyTouch(e.touches, pending.identifier);
    if (!touch) return;
    pending.x = touch.clientX;
    pending.y = touch.clientY;
    if (Math.hypot(touch.clientX - pending.startX, touch.clientY - pending.startY) > 8) {
      this.cancelPendingTaxonomyTouch();
    }
  },

  onTaxonomyTouchEnd(e) {
    const session = this.taxonomyDragSession;
    if (session?.inputType === 'touch') {
      const ended = this.findTaxonomyTouch(e.changedTouches, session.touchIdentifier);
      if (ended) this.commitTaxonomyDrag();
      return;
    }
    const pending = this.taxonomyTouchPending;
    if (!pending) return;
    const ended = this.findTaxonomyTouch(e.changedTouches, pending.identifier);
    if (ended) this.cancelPendingTaxonomyTouch();
  },

  onTaxonomyTouchCancel(e) {
    const session = this.taxonomyDragSession;
    if (session?.inputType === 'touch') {
      const cancelled = this.findTaxonomyTouch(e.changedTouches, session.touchIdentifier);
      if (cancelled) this.cancelTaxonomyDrag();
      return;
    }
    const pending = this.taxonomyTouchPending;
    if (!pending) return;
    const cancelled = this.findTaxonomyTouch(e.changedTouches, pending.identifier);
    if (cancelled) this.cancelPendingTaxonomyTouch();
  }
};
