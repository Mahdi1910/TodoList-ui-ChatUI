import { TaxonomyOrder } from '../taxonomy-order.js';
export const SidebarTaxonomyDragMethods = {
  initTaxonomyDrag() {
    if (!this.sidebarEl || !this.projectListEl || !this.tagListEl) return;
    this.assertTaxonomyDragIntegration();
    this.taxonomyDragScrollEl = this.sidebarEl.querySelector('.sidebar-content');
    this.taxonomyDragLayer = document.createElement('div');
    this.taxonomyDragLayer.className = 'sidebar-taxonomy-drag-layer';
    document.body.appendChild(this.taxonomyDragLayer);
    this.taxonomyDragPending = null;
    this.taxonomyDragSession = null;
    this.taxonomyDragSuppressClickUntil = 0;

    this.sidebarEl.addEventListener('pointerdown', e => this.onTaxonomyPointerDown(e));
    document.addEventListener('pointermove', e => this.onTaxonomyPointerMove(e), { passive: false });
    document.addEventListener('pointerup', e => this.onTaxonomyPointerUp(e));
    document.addEventListener('pointercancel', e => this.onTaxonomyPointerCancel(e));
    document.addEventListener('click', e => {
      if (performance.now() < this.taxonomyDragSuppressClickUntil) {
        e.preventDefault();
        e.stopImmediatePropagation();
      }
    }, true);
    document.addEventListener('keydown', e => {
      if (e.key === 'Escape' && this.taxonomyDragSession) {
        e.preventDefault();
        this.cancelTaxonomyDrag();
      }
    });
    window.addEventListener('blur', () => this.taxonomyDragSession && this.cancelTaxonomyDrag());
    document.addEventListener('contextmenu', e => {
      if (this.taxonomyDragPending || this.taxonomyTouchPending || this.taxonomyDragSession) e.preventDefault();
    });
    this.initTaxonomyTouchDrag();
  },

  assertTaxonomyDragIntegration() {
    const required = [
      'resolveTaxonomyDrop', 'measureTaxonomyIndent', 'applyTaxonomyPreview',
      'resolveTaxonomySiblingSlot', 'buildTaxonomySourceAncestorZones',
      'shouldSuppressSourceAncestorForcedZone', 'commitTaxonomyDrag', 'cancelTaxonomyDrag',
      'startTaxonomyDragAutoScroll', 'initTaxonomyTouchDrag'
    ];
    const missing = required.filter(name => typeof this[name] !== 'function');
    if (missing.length) throw new Error(`Sidebar taxonomy drag integration is incomplete: ${missing.join(', ')}`);
  },

  getTaxonomyDragTarget(target) {
    if (document.querySelector('.modal-overlay.active')) return null;
    if (window.TasksComponent?.dragSession) return null;
    if (target.closest('button,input,a,select,textarea,.project-more-menu,.tag-more-menu')) return null;
    const node = target.closest('.sidebar-tree-node');
    if (!node) return null;
    const row = this.getTaxonomyNodeRow(node);
    if (!row || !row.contains(target)) return null;
    const entityType = node.dataset.taxonomyType === 'tag' ? 'tag' : 'project';
    const entityId = node.dataset.entityId;
    const entity = TaxonomyOrder.getEntity(entityType, entityId);
    const container = this.getTaxonomyContainer(entityType);
    const sourceHost = node.parentElement;
    if (!entity || !container || !sourceHost || !container.contains(node)) return null;
    return {
      entityType,
      entityId,
      entity,
      node,
      row,
      container,
      sourceHost,
      sourceParentId: entity.parentId || null,
      sourceDepth: this.getTaxonomyDepth(node)
    };
  },

  onTaxonomyPointerDown(e) {
    if (e.pointerType === 'touch') return;
    if (!e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    const target = this.getTaxonomyDragTarget(e.target);
    if (!target || this.taxonomyDragSession) return;
    this.cancelPendingTaxonomyDrag();
    this.taxonomyDragPending = {
      ...target,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      timer: setTimeout(() => this.activatePointerTaxonomyDrag(), 300)
    };
  },

  cancelPendingTaxonomyDrag() {
    if (this.taxonomyDragPending?.timer) clearTimeout(this.taxonomyDragPending.timer);
    this.taxonomyDragPending = null;
  },

  onTaxonomyPointerMove(e) {
    const session = this.taxonomyDragSession;
    if (session?.pointerId === e.pointerId) {
      e.preventDefault();
      session.x = e.clientX;
      session.y = e.clientY;
      this.positionFloatingTaxonomy(e.clientX, e.clientY);
      this.resolveTaxonomyDrop(e.clientX, e.clientY);
      return;
    }
    const pending = this.taxonomyDragPending;
    if (!pending || pending.pointerId !== e.pointerId) return;
    pending.x = e.clientX;
    pending.y = e.clientY;
    if (Math.hypot(e.clientX - pending.startX, e.clientY - pending.startY) > 8) {
      this.cancelPendingTaxonomyDrag();
    }
  },

  activatePointerTaxonomyDrag() {
    const pending = this.taxonomyDragPending;
    if (!pending?.node?.isConnected || this.taxonomyDragSession) return this.cancelPendingTaxonomyDrag();
    this.taxonomyDragPending = null;
    this.beginTaxonomyDragSession(pending, 'pointer');
  },

  buildInitialTaxonomyPreview(pending) {
    const siblings = this.getTaxonomyDirectNodes(pending.sourceHost);
    const index = siblings.indexOf(pending.node);
    const previous = index > 0 ? siblings[index - 1] : null;
    const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
    return {
      depth: pending.sourceDepth,
      parentId: pending.sourceParentId,
      beforeEntityId: next?.dataset.entityId || null,
      afterEntityId: previous?.dataset.entityId || null
    };
  },

  beginTaxonomyDragSession(pending, inputType) {
    if (!pending.node?.isConnected || !pending.container?.isConnected) return;
    this.closeSidebarActionMenus();
    window.WorkspaceControls?.closeMenu();
    window.TasksComponent?.closeTaskActionMenu(false);
    window.SubtaskEditorComponent?.closeMenus?.();

    const rect = pending.node.getBoundingClientRect();
    const measurement = this.measureTaxonomyIndent(pending.container);
    const initialPreview = this.buildInitialTaxonomyPreview(pending);
    const sourceAncestorZoneDepths = this.buildTaxonomySourceAncestorZones(
      pending.entityType,
      pending.entityId,
      pending.sourceDepth
    );
    const placeholder = document.createElement('div');
    placeholder.className = 'sidebar-taxonomy-placeholder';
    placeholder.style.height = `${Math.max(36, rect.height)}px`;
    placeholder.dataset.previewDepth = String(pending.sourceDepth);
    pending.sourceHost.insertBefore(placeholder, pending.node);

    this.taxonomyDragLayer.appendChild(pending.node);
    pending.node.classList.add('is-dragging');
    pending.node.style.width = `${rect.width}px`;
    pending.node.style.left = `${rect.left}px`;
    pending.node.style.top = `${rect.top}px`;

    this.taxonomyDragSession = {
      inputType,
      pointerId: inputType === 'pointer' ? pending.pointerId : null,
      touchIdentifier: inputType === 'touch' ? pending.identifier : null,
      entityType: pending.entityType,
      entityId: pending.entityId,
      sourceParentId: pending.sourceParentId,
      sourceDepth: pending.sourceDepth,
      sourceHost: pending.sourceHost,
      sourceAncestorZoneDepths,
      dragUnit: pending.node,
      container: pending.container,
      placeholder,
      offsetX: pending.x - rect.left,
      offsetY: pending.y - rect.top,
      x: pending.x,
      y: pending.y,
      horizontalDepthIntent: pending.sourceDepth,
      previewDepth: initialPreview.depth,
      previewParentId: initialPreview.parentId,
      previewBeforeEntityId: initialPreview.beforeEntityId,
      previewAfterEntityId: initialPreview.afterEntityId,
      initialPreview: { ...initialPreview },
      forcedChildZone: false,
      dropDomainActive: true,
      rootAlignmentX: measurement.rootX,
      indentStep: measurement.indentStep
    };

    document.body.classList.add('sidebar-taxonomy-drag-active');
    this.taxonomyDragSuppressClickUntil = performance.now() + 700;
    if (inputType === 'pointer') {
      try { this.sidebarEl.setPointerCapture(pending.pointerId); } catch (_) {}
    }
    this.positionFloatingTaxonomy(this.taxonomyDragSession.x, this.taxonomyDragSession.y);
    this.startTaxonomyDragAutoScroll();
  },

  positionFloatingTaxonomy(x, y) {
    const session = this.taxonomyDragSession;
    if (!session) return;
    session.dragUnit.style.left = `${x - session.offsetX}px`;
    session.dragUnit.style.top = `${y - session.offsetY}px`;
  },

  onTaxonomyPointerUp(e) {
    if (this.taxonomyDragSession?.pointerId === e.pointerId) return this.commitTaxonomyDrag();
    if (this.taxonomyDragPending?.pointerId === e.pointerId) this.cancelPendingTaxonomyDrag();
  },

  onTaxonomyPointerCancel(e) {
    if (this.taxonomyDragSession?.pointerId === e.pointerId) this.cancelTaxonomyDrag();
    if (this.taxonomyDragPending?.pointerId === e.pointerId) this.cancelPendingTaxonomyDrag();
  }
};
