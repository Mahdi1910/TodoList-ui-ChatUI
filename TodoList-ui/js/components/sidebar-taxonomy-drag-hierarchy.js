import { TaxonomyOrder } from '../taxonomy-order.js';
export const SidebarTaxonomyDragHierarchyMethods = {
  getTaxonomyContainer(entityType) {
    return entityType === 'tag' ? this.tagListEl : this.projectListEl;
  },

  getTaxonomyNodeRow(node) {
    return node?.querySelector(':scope > .sidebar-nav-item') || null;
  },

  getTaxonomyChildHost(node) {
    return node?.querySelector(':scope > .sidebar-tree-children') || null;
  },

  getTaxonomyDirectNodes(host) {
    if (!host) return [];
    return [...host.children].filter(element =>
      element.classList?.contains('sidebar-tree-node') && element !== this.taxonomyDragSession?.dragUnit
    );
  },

  getTaxonomyNodeById(entityType, entityId) {
    const container = this.getTaxonomyContainer(entityType);
    if (!container || !entityId) return null;
    return [...container.querySelectorAll('.sidebar-tree-node')]
      .find(node => node.dataset.taxonomyType === entityType && node.dataset.entityId === entityId) || null;
  },

  getTaxonomyDepth(node) {
    const value = Number(node?.dataset.depth);
    return Number.isFinite(value) ? value : 0;
  },

  isValidTaxonomyParent(entityType, entityId, parentId) {
    if (!parentId) return true;
    if (parentId === entityId) return false;
    const parent = TaxonomyOrder.getEntity(entityType, parentId);
    if (!parent) return false;
    return !TaxonomyOrder.getDescendantIds(entityType, entityId).includes(parentId);
  },

  buildTaxonomySourceAncestorZones(entityType, entityId, sourceDepth = null) {
    const zones = new Map();
    let current = TaxonomyOrder.getEntity(entityType, entityId);
    if (!current) return zones;

    let zoneDepth = Number.isFinite(sourceDepth)
      ? sourceDepth
      : TaxonomyOrder.getDepth(entityType, entityId);
    let parentId = current.parentId || null;
    const seen = new Set([entityId]);

    while (parentId && zoneDepth > 0 && !seen.has(parentId)) {
      zones.set(parentId, zoneDepth);
      seen.add(parentId);
      current = TaxonomyOrder.getEntity(entityType, parentId);
      parentId = current?.parentId || null;
      zoneDepth -= 1;
    }
    return zones;
  },

  shouldSuppressSourceAncestorForcedZone(parentId, zoneDepth) {
    const session = this.taxonomyDragSession;
    if (!session || !parentId) return false;
    const sourceZoneDepth = session.sourceAncestorZoneDepths?.get(parentId);
    return sourceZoneDepth === zoneDepth && session.horizontalDepthIntent < zoneDepth;
  },

  measureTaxonomyIndent(container) {
    const rootNode = this.getTaxonomyDirectNodes(container)[0] || null;
    const rootRow = this.getTaxonomyNodeRow(rootNode);
    const rootX = rootRow?.getBoundingClientRect().left ?? container.getBoundingClientRect().left;
    let indentStep = 0;

    const childNode = rootNode ? this.getTaxonomyDirectNodes(this.getTaxonomyChildHost(rootNode))[0] : null;
    const childRow = this.getTaxonomyNodeRow(childNode);
    if (rootRow && childRow) indentStep = childRow.getBoundingClientRect().left - rootX;
    if (!indentStep) {
      const cssValue = parseFloat(getComputedStyle(this.sidebarEl || container).getPropertyValue('--sidebar-tree-indent'));
      indentStep = Number.isFinite(cssValue) && cssValue > 0 ? cssValue : 18;
    }
    return { rootX, indentStep, hysteresis: Math.max(4, Math.min(10, indentStep * 0.22)) };
  },

  updateTaxonomyDepthIntent(floatingLeft, measurement) {
    const session = this.taxonomyDragSession;
    if (!session) return;
    session.rootAlignmentX = measurement.rootX;
    session.indentStep = measurement.indentStep;
    const { rootX, indentStep, hysteresis } = measurement;
    let depth = Math.max(0, session.horizontalDepthIntent || 0);

    while (floatingLeft >= rootX + (depth + 0.5) * indentStep + hysteresis) depth += 1;
    while (depth > 0 && floatingLeft <= rootX + (depth - 0.5) * indentStep - hysteresis) depth -= 1;
    session.horizontalDepthIntent = depth;
  },

  getVisibleTaxonomyNodes(container) {
    return [...container.querySelectorAll('.sidebar-tree-node')]
      .filter(node => node !== this.taxonomyDragSession?.dragUnit && node.offsetParent !== null)
      .map(node => ({
        node,
        row: this.getTaxonomyNodeRow(node),
        id: node.dataset.entityId,
        depth: this.getTaxonomyDepth(node),
        parentId: node.dataset.parentId || null
      }))
      .filter(item => item.row);
  },

  resolveTaxonomyInsertionIndex(flat, y) {
    for (let index = 0; index < flat.length; index += 1) {
      const rect = flat[index].row.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) return index;
    }
    return flat.length;
  },

  resolveTaxonomySiblingSlot(host, y) {
    const nodes = this.getTaxonomyDirectNodes(host).filter(node => node.offsetParent !== null);
    let previous = null;
    for (const node of nodes) {
      const rect = node.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        return {
          host,
          beforeNode: node,
          beforeEntityId: node.dataset.entityId || null,
          afterEntityId: previous?.dataset.entityId || null
        };
      }
      previous = node;
    }
    return {
      host,
      beforeNode: null,
      beforeEntityId: null,
      afterEntityId: previous?.dataset.entityId || null
    };
  },

  findForcedTaxonomyChildZone(container, y) {
    const session = this.taxonomyDragSession;
    const candidates = [];
    container.querySelectorAll('.sidebar-tree-children').forEach(host => {
      const direct = this.getTaxonomyDirectNodes(host).filter(node => node.offsetParent !== null);
      if (!direct.length) return;
      const parentId = host.dataset.treeParentId || null;
      if (!this.isValidTaxonomyParent(session.entityType, session.entityId, parentId)) return;
      const parentNode = host.closest('.sidebar-tree-node');
      const zoneDepth = this.getTaxonomyDepth(parentNode) + 1;
      if (this.shouldSuppressSourceAncestorForcedZone(parentId, zoneDepth)) return;
      const rect = host.getBoundingClientRect();
      if (y < rect.top - 3 || y > rect.bottom + 3) return;
      candidates.push({ host, parentId, depth: zoneDepth });
    });
    return candidates.sort((a, b) => b.depth - a.depth)[0] || null;
  },

  resolveTaxonomyParentForDepth(flat, insertionIndex, requestedDepth) {
    const session = this.taxonomyDragSession;
    if (requestedDepth <= 0 || insertionIndex <= 0) return { depth: 0, parentId: null, host: session.container };
    const previous = flat[insertionIndex - 1];
    let depth = Math.min(requestedDepth, previous.depth + 1);

    while (depth > 0) {
      let candidate = null;
      for (let index = insertionIndex - 1; index >= 0; index -= 1) {
        if (flat[index].depth === depth - 1) {
          candidate = flat[index];
          break;
        }
      }
      if (candidate && this.isValidTaxonomyParent(session.entityType, session.entityId, candidate.id)) {
        const host = this.getTaxonomyChildHost(candidate.node);
        if (host) return { depth, parentId: candidate.id, host };
      }
      depth -= 1;
    }
    return { depth: 0, parentId: null, host: session.container };
  },

  clearTaxonomyRevealHosts(exceptHost = null) {
    document.querySelectorAll('.sidebar-tree-children[data-drag-reveal="true"]').forEach(host => {
      if (host !== exceptHost) delete host.dataset.dragReveal;
    });
  },

  applyTaxonomyPreview(preview) {
    const session = this.taxonomyDragSession;
    if (!session || !preview?.host) return;
    const placeholder = session.placeholder;
    if (preview.host.classList.contains('sidebar-tree-children')) preview.host.dataset.dragReveal = 'true';
    this.clearTaxonomyRevealHosts(preview.host);

    const unchanged = placeholder.parentElement === preview.host && placeholder.nextElementSibling === preview.beforeNode;
    if (!unchanged) {
      const oldHost = placeholder.parentElement;
      const rects = this.captureTaxonomyRects?.([oldHost, preview.host]);
      if (preview.beforeNode) preview.host.insertBefore(placeholder, preview.beforeNode);
      else preview.host.appendChild(placeholder);
      if (rects) this.animateTaxonomyShift?.(rects);
    }

    placeholder.dataset.previewDepth = String(preview.depth);
    session.previewDepth = preview.depth;
    session.previewParentId = preview.parentId || null;
    session.previewBeforeEntityId = preview.beforeEntityId || null;
    session.previewAfterEntityId = preview.afterEntityId || null;
    session.forcedChildZone = Boolean(preview.forced);
  },

  resolveTaxonomyDrop(x, y) {
    const session = this.taxonomyDragSession;
    if (!session?.container) return;
    const domain = session.container.closest('.sidebar-section') || session.container;
    const insideDomain = document.elementsFromPoint(x, y).some(element => element === domain || domain.contains(element));
    if (!insideDomain) {
      session.dropDomainActive = false;
      return;
    }
    session.dropDomainActive = true;

    const measurement = this.measureTaxonomyIndent(session.container);
    this.updateTaxonomyDepthIntent(x - session.offsetX, measurement);

    const forced = this.findForcedTaxonomyChildZone(session.container, y);
    if (forced) {
      const slot = this.resolveTaxonomySiblingSlot(forced.host, y);
      this.applyTaxonomyPreview({ ...slot, depth: forced.depth, parentId: forced.parentId, forced: true });
      return;
    }

    const flat = this.getVisibleTaxonomyNodes(session.container);
    const insertionIndex = this.resolveTaxonomyInsertionIndex(flat, y);
    const target = this.resolveTaxonomyParentForDepth(flat, insertionIndex, session.horizontalDepthIntent);
    const slot = this.resolveTaxonomySiblingSlot(target.host, y);
    this.applyTaxonomyPreview({ ...slot, depth: target.depth, parentId: target.parentId, forced: false });
  }
};
