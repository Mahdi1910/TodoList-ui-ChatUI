import { AppPersistence } from '../storage/persistence.js';
import { AppDataService } from '../storage/data-service.js';
export const SidebarTaxonomyDragCommitMethods = {
  isTaxonomyPreviewUnchanged(session) {
    const initial = session?.initialPreview;
    if (!initial) return false;
    return initial.depth === session.previewDepth &&
      (initial.parentId || null) === (session.previewParentId || null) &&
      (initial.beforeEntityId || null) === (session.previewBeforeEntityId || null) &&
      (initial.afterEntityId || null) === (session.previewAfterEntityId || null);
  },

  async commitTaxonomyDrag() {
    const session = this.taxonomyDragSession;
    if (!session) return;
    if (session.dropDomainActive === false || this.isTaxonomyPreviewUnchanged(session)) {
      this.cleanupTaxonomyDrag(true);
      return;
    }

    const entityType = session.entityType;
    try {
      await AppDataService.commitTaxonomyDrag({
        entityType,
        entityId: session.entityId,
        targetParentId: session.previewParentId,
        beforeEntityId: session.previewBeforeEntityId,
        afterEntityId: session.previewAfterEntityId
      });
      this.cleanupTaxonomyDrag(false);
      this.refreshTaxonomyAfterDrag(entityType);
    } catch (error) {
      this.cleanupTaxonomyDrag(false);
      this.refreshTaxonomyAfterDrag(entityType);
      AppPersistence?.reportError?.(`Could not save the ${entityType} hierarchy change.`, error);
    }
  },

  cancelTaxonomyDrag() {
    if (!this.taxonomyDragSession) return;
    this.cleanupTaxonomyDrag(true);
  },

  cleanupTaxonomyDrag(render = false) {
    const session = this.taxonomyDragSession;
    if (!session) return;
    const entityType = session.entityType;
    this.stopTaxonomyDragAutoScroll();
    if (session.inputType === 'pointer' && session.pointerId != null) {
      try { this.sidebarEl.releasePointerCapture(session.pointerId); } catch (_) {}
    }
    this.cancelPendingTaxonomyTouch?.();
    session.dragUnit?.remove();
    session.placeholder?.remove();
    this.clearTaxonomyRevealHosts?.();
    document.body.classList.remove('sidebar-taxonomy-drag-active');
    this.taxonomyDragSession = null;
    this.taxonomyDragSuppressClickUntil = performance.now() + 450;
    if (render) this.refreshTaxonomyAfterDrag(entityType);
  },

  refreshTaxonomyAfterDrag(entityType) {
    if (entityType === 'tag') {
      this.renderTags();
      window.TasksComponent?.renderTagMenu();
    } else {
      this.renderProjects();
      window.TasksComponent?.renderProjectMenu();
    }
    this.syncCurrentView();
    this.updateCounts();
    window.TasksComponent?.render();
  },

  captureTaxonomyRects(hosts) {
    const rects = new Map();
    [...new Set((hosts || []).filter(Boolean))].forEach(host => {
      this.getTaxonomyDirectNodes(host).forEach(node => {
        if (!node.classList.contains('is-dragging')) rects.set(node, node.getBoundingClientRect());
      });
    });
    return rects;
  },

  animateTaxonomyShift(beforeRects) {
    if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    beforeRects?.forEach((before, node) => {
      if (!node.isConnected) return;
      const after = node.getBoundingClientRect();
      const dx = before.left - after.left;
      const dy = before.top - after.top;
      if (!dx && !dy) return;
      node.style.transition = 'none';
      node.style.transform = `translate(${dx}px, ${dy}px)`;
      requestAnimationFrame(() => {
        node.style.transition = 'transform var(--transition-fast)';
        node.style.transform = '';
      });
    });
  },

  getTaxonomyDragEdgeSpeed(position, start, end) {
    const zone = 55;
    const maxSpeed = 18;
    if (position < start + zone) {
      return -maxSpeed * Math.max(0, Math.min(1, (start + zone - position) / zone));
    }
    if (position > end - zone) {
      return maxSpeed * Math.max(0, Math.min(1, (position - (end - zone)) / zone));
    }
    return 0;
  },

  startTaxonomyDragAutoScroll() {
    this.stopTaxonomyDragAutoScroll();
    const tick = () => {
      const session = this.taxonomyDragSession;
      const scroller = this.taxonomyDragScrollEl;
      if (!session || !scroller) return;
      const rect = scroller.getBoundingClientRect();
      const speed = this.getTaxonomyDragEdgeSpeed(session.y, rect.top, rect.bottom);
      if (speed) {
        const before = scroller.scrollTop;
        scroller.scrollTop += speed;
        if (before !== scroller.scrollTop) this.resolveTaxonomyDrop(session.x, session.y);
      }
      this.taxonomyDragScrollFrame = requestAnimationFrame(tick);
    };
    this.taxonomyDragScrollFrame = requestAnimationFrame(tick);
  },

  stopTaxonomyDragAutoScroll() {
    if (this.taxonomyDragScrollFrame) cancelAnimationFrame(this.taxonomyDragScrollFrame);
    this.taxonomyDragScrollFrame = null;
  }
};
