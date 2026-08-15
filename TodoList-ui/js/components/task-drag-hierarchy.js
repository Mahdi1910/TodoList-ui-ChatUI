import { AppState } from '../state.js';
export const TaskDragHierarchyMethods = {
  HIERARCHY_HYSTERESIS: 10,

  getRootCard(family) {
    return family?.querySelector(':scope > .task-card:not(.subtask-card)') || null;
  },

  getChildHost(family) {
    return family?.querySelector(':scope > .subtask-list') || null;
  },

  getRootFamilies(lane) {
    if (!lane) return [];
    return [...lane.children].filter(element =>
      element.classList?.contains('task-family') && element !== this.dragSession?.dragUnit
    );
  },

  getChildDragItems(host) {
    if (!host) return [];
    return [...host.children].filter(element =>
      element.classList?.contains('subtask-drag-item') && element !== this.dragSession?.dragUnit
    );
  },

  getTaskIdFromRootFamily(family) {
    return family?.dataset.parentId || null;
  },

  getTaskIdFromChildItem(item) {
    return item?.dataset.taskId || null;
  },

  measureHierarchyAlignment(lane, preferredFamily = null) {
    const family = preferredFamily || this.getRootFamilies(lane)[0] || null;
    const rootCard = this.getRootCard(family);
    const rootX = rootCard
      ? rootCard.getBoundingClientRect().left
      : lane.getBoundingClientRect().left + (parseFloat(getComputedStyle(lane).paddingLeft) || 0);

    const host = this.getChildHost(family) || this.dragSession?.sourceChildHost || null;
    let indent = this.dragSession?.hierarchyIndent || 0;
    if (host) {
      const style = getComputedStyle(host);
      indent = (parseFloat(style.marginLeft) || 0) + (parseFloat(style.paddingLeft) || 0);
    }
    if (!indent) indent = window.matchMedia?.('(max-width: 768px)').matches ? 28 : 44;

    return { rootX, childX: rootX + indent, indent };
  },

  buildInitialHierarchyPreview(target) {
    const { unit, level, parentId, sourceLane } = target;
    const siblings = level === 'subtask'
      ? this.getChildDragItems(unit.parentElement)
      : this.getRootFamilies(sourceLane);
    const index = siblings.indexOf(unit);
    const previous = index > 0 ? siblings[index - 1] : null;
    const next = index >= 0 && index < siblings.length - 1 ? siblings[index + 1] : null;
    const idOf = level === 'subtask'
      ? item => this.getTaskIdFromChildItem(item)
      : item => this.getTaskIdFromRootFamily(item);

    return {
      level,
      parentId: parentId || null,
      beforeTaskId: idOf(next),
      afterTaskId: idOf(previous),
      forced: false
    };
  },

  updateHorizontalIntent(floatingLeft, alignment) {
    const session = this.dragSession;
    if (!session) return;
    session.rootAlignmentX = alignment.rootX;
    session.subtaskAlignmentX = alignment.childX;
    session.hierarchyIndent = alignment.indent;

    const midpoint = (alignment.rootX + alignment.childX) / 2;
    if (session.horizontalIntent === 'root') {
      if (floatingLeft >= midpoint + this.HIERARCHY_HYSTERESIS) session.horizontalIntent = 'subtask';
    } else if (floatingLeft <= midpoint - this.HIERARCHY_HYSTERESIS) {
      session.horizontalIntent = 'root';
    }
  },

  findForcedChildZone(lane, y) {
    for (const family of this.getRootFamilies(lane)) {
      const parentId = this.getTaskIdFromRootFamily(family);
      if (!parentId || parentId === this.dragSession?.taskId) continue;
      const host = this.getChildHost(family);
      if (!host || host.hidden) continue;
      const items = this.getChildDragItems(host).filter(item => item.offsetParent !== null);
      if (!items.length) continue;
      const rootRect = this.getRootCard(family)?.getBoundingClientRect();
      const lastRect = items.at(-1).getBoundingClientRect();
      if (!rootRect) continue;
      if (y >= rootRect.bottom - 2 && y <= lastRect.bottom + 4) {
        return { family, parentId, forced: true };
      }
    }
    return null;
  },

  resolveRootSlot(lane, y) {
    const families = this.getRootFamilies(lane);
    let previous = null;
    for (const family of families) {
      const card = this.getRootCard(family);
      if (!card) continue;
      const rect = card.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        return {
          beforeFamily: family,
          afterFamily: previous,
          beforeTaskId: this.getTaskIdFromRootFamily(family),
          afterTaskId: this.getTaskIdFromRootFamily(previous)
        };
      }
      previous = family;
    }
    return {
      beforeFamily: null,
      afterFamily: previous,
      beforeTaskId: null,
      afterTaskId: this.getTaskIdFromRootFamily(previous)
    };
  },

  resolveChildSlot(family, y) {
    const host = this.getChildHost(family);
    const items = this.getChildDragItems(host).filter(item => item.offsetParent !== null);
    let previous = null;
    for (const item of items) {
      const rect = item.getBoundingClientRect();
      if (y < rect.top + rect.height / 2) {
        return {
          host,
          beforeItem: item,
          afterItem: previous,
          beforeTaskId: this.getTaskIdFromChildItem(item),
          afterTaskId: this.getTaskIdFromChildItem(previous)
        };
      }
      previous = item;
    }
    return {
      host,
      beforeItem: null,
      afterItem: previous,
      beforeTaskId: null,
      afterTaskId: this.getTaskIdFromChildItem(previous)
    };
  },

  isEligibleDragParent(parentId) {
    const session = this.dragSession;
    const parent = AppState.getTask(parentId);
    const dragged = AppState.getTask(session?.taskId);
    if (!parent || parent.parentTaskId || !dragged || parent.id === dragged.id) return false;
    if (!dragged.parentTaskId && AppState.hasSubtasks(dragged.id)) return false;
    return true;
  },

  resolveCandidateParent(rootSlot) {
    const family = rootSlot.afterFamily;
    const parentId = this.getTaskIdFromRootFamily(family);
    return parentId && this.isEligibleDragParent(parentId) ? { family, parentId } : null;
  },

  clearDragRevealHosts(exceptHost = null) {
    document.querySelectorAll('.subtask-list[data-drag-reveal="true"]').forEach(host => {
      if (host !== exceptHost) delete host.dataset.dragReveal;
    });
  },

  applyHierarchyPreview(preview) {
    const session = this.dragSession;
    if (!session || !preview?.lane) return;
    const placeholder = session.placeholder;
    let destinationHost = preview.lane;
    let beforeElement = preview.beforeFamily || null;

    if (preview.level === 'subtask') {
      destinationHost = preview.childHost;
      beforeElement = preview.beforeItem || null;
      if (!destinationHost) return;
      if (destinationHost.hidden) destinationHost.dataset.dragReveal = 'true';
      this.clearDragRevealHosts(destinationHost);
    } else {
      this.clearDragRevealHosts();
    }

    const unchanged = placeholder.parentElement === destinationHost &&
      placeholder.nextElementSibling === beforeElement;
    if (!unchanged) {
      const oldHost = placeholder.parentElement;
      const rects = this.captureDragFamilyRects([oldHost, destinationHost]);
      if (beforeElement) destinationHost.insertBefore(placeholder, beforeElement);
      else destinationHost.appendChild(placeholder);
      this.animateDragFamilyShift(rects);
    }

    placeholder.classList.toggle('is-root-preview', preview.level === 'root');
    placeholder.classList.toggle('is-subtask-preview', preview.level === 'subtask');
    placeholder.dataset.previewLevel = preview.level;
    placeholder.style.width = '100%';

    session.currentLane = preview.lane;
    session.previewLevel = preview.level;
    session.previewParentId = preview.parentId || null;
    session.previewBeforeTaskId = preview.beforeTaskId || null;
    session.previewAfterTaskId = preview.afterTaskId || null;
    session.forcedChildZone = Boolean(preview.forced);
  },

  resolveHierarchyDrop(x, y) {
    const session = this.dragSession;
    if (!session) return;
    const lane = this.findDropLaneAtPoint(x, y);
    if (!lane) return;

    const alignment = this.measureHierarchyAlignment(lane);
    this.updateHorizontalIntent(x - session.offsetX, alignment);

    const forced = this.findForcedChildZone(lane, y);
    if (forced && this.isEligibleDragParent(forced.parentId)) {
      const childSlot = this.resolveChildSlot(forced.family, y);
      this.applyHierarchyPreview({
        level: 'subtask', parentId: forced.parentId, lane, forced: true,
        childHost: childSlot.host, beforeItem: childSlot.beforeItem,
        beforeTaskId: childSlot.beforeTaskId, afterTaskId: childSlot.afterTaskId
      });
      return;
    }

    const rootSlot = this.resolveRootSlot(lane, y);
    if (session.horizontalIntent === 'subtask') {
      const candidate = this.resolveCandidateParent(rootSlot);
      if (candidate) {
        const childSlot = this.resolveChildSlot(candidate.family, y);
        this.applyHierarchyPreview({
          level: 'subtask', parentId: candidate.parentId, lane, forced: false,
          childHost: childSlot.host, beforeItem: childSlot.beforeItem,
          beforeTaskId: childSlot.beforeTaskId, afterTaskId: childSlot.afterTaskId
        });
        return;
      }
    }

    this.applyHierarchyPreview({
      level: 'root', parentId: null, lane, forced: false,
      beforeFamily: rootSlot.beforeFamily,
      beforeTaskId: rootSlot.beforeTaskId,
      afterTaskId: rootSlot.afterTaskId
    });
  }
};
