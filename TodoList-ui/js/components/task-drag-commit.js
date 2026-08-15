import { AppPersistence } from '../storage/persistence.js';
import { AppDataService } from '../storage/data-service.js';
export const TaskDragCommitMethods = {
  async commitTaskDrag() {
    const session = this.dragSession;
    if (!session) return;
    const destination = this.getDropLaneContext(session.currentLane);
    if (this.isHierarchyPreviewUnchanged(session, destination)) {
      this.cleanupTaskDrag(true);
      return;
    }
    try {
      const workspace = window.WorkspaceControls;
      const startSortKey = workspace?.normalizeSortKey(session.startSortKey || 'custom') || 'custom';
      let customOrderSnapshot = null;

      if (startSortKey !== 'custom') {
        const currentSortKey = workspace?.normalizeSortKey(workspace.sortKey || 'custom') || 'custom';
        if (currentSortKey !== startSortKey) {
          throw new Error('The active sort changed while this task was being dragged.');
        }
        customOrderSnapshot = workspace.buildCustomOrderSnapshot();
      }

      await AppDataService.commitHierarchyDrag({
        taskId: session.taskId,
        targetLevel: session.previewLevel,
        targetParentId: session.previewParentId,
        beforeTaskId: session.previewBeforeTaskId,
        afterTaskId: session.previewAfterTaskId,
        sourceContext: session.sourceContext,
        destinationContext: destination,
        customOrderSnapshot
      });

      if (workspace) {
        workspace.sortKey = 'custom';
        workspace.syncUI();
      }
    } catch (error) {
      AppPersistence.reportError('Could not save the new task hierarchy or position.', error);
    }
    this.cleanupTaskDrag(true);
  },

  areTaskIdOrdersEqual(a = [], b = []) {
    return a.length === b.length && a.every((id, index) => id === b[index]);
  },

  hasDragMetadataChange(source, destination) {
    return Boolean(
      source && destination &&
      source.groupType !== 'none' && source.groupType === destination.groupType &&
      source.groupKey !== destination.groupKey
    );
  },

  isHierarchyPreviewUnchanged(session, destination) {
    if (!session?.initialPreview) return false;
    const initial = session.initialPreview;
    const sameHierarchy = initial.level === session.previewLevel &&
      (initial.parentId || null) === (session.previewParentId || null) &&
      (initial.beforeTaskId || null) === (session.previewBeforeTaskId || null) &&
      (initial.afterTaskId || null) === (session.previewAfterTaskId || null);
    const sameGroup = session.sourceContext?.groupType === destination?.groupType &&
      session.sourceContext?.groupKey === destination?.groupKey;
    return sameHierarchy && sameGroup;
  },

  cancelTaskDrag() {
    if (!this.dragSession) return;
    this.cleanupTaskDrag(true);
  },

  cleanupTaskDrag(render = false) {
    const session = this.dragSession;
    if (!session) return;
    this.stopTaskDragAutoScroll();
    if (session.inputType === 'pointer' && session.pointerId != null) {
      try { this.dragWorkspace.releasePointerCapture(session.pointerId); } catch (_) {}
    }
    this.cancelPendingTouchDrag?.();
    session.dragUnit?.remove();
    session.placeholder?.remove();
    document.querySelectorAll('.subtask-list[data-drag-reveal="true"]').forEach(host => {
      delete host.dataset.dragReveal;
    });
    document.body.classList.remove('task-drag-active');
    document.querySelectorAll('.task-drop-lane.is-drop-target').forEach(lane => lane.classList.remove('is-drop-target'));
    this.dragSession = null;
    this.dragSuppressClickUntil = performance.now() + 450;
    if (render) this.render();
  },

  getTaskDragEdgeSpeed(position, start, end) {
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

  startTaskDragAutoScroll() {
    this.stopTaskDragAutoScroll();
    const tick = () => {
      const session = this.dragSession;
      if (!session) return;
      let scrolled = false;
      const workspaceRect = this.dragWorkspace.getBoundingClientRect();
      const verticalSpeed = this.getTaskDragEdgeSpeed(session.y, workspaceRect.top, workspaceRect.bottom);
      if (verticalSpeed) {
        const before = this.dragWorkspace.scrollTop;
        this.dragWorkspace.scrollTop += verticalSpeed;
        scrolled = scrolled || before !== this.dragWorkspace.scrollTop;
      }
      const kanban = document.getElementById('kanban-view');
      if (kanban && kanban.offsetParent !== null) {
        const rect = kanban.getBoundingClientRect();
        const horizontalSpeed = this.getTaskDragEdgeSpeed(session.x, rect.left, rect.right);
        if (horizontalSpeed) {
          const before = kanban.scrollLeft;
          kanban.scrollLeft += horizontalSpeed;
          scrolled = scrolled || before !== kanban.scrollLeft;
        }
      }
      if (scrolled) this.updateTaskDropTarget(session.x, session.y);
      this.taskDragScrollFrame = requestAnimationFrame(tick);
    };
    this.taskDragScrollFrame = requestAnimationFrame(tick);
  },

  stopTaskDragAutoScroll() {
    if (this.taskDragScrollFrame) cancelAnimationFrame(this.taskDragScrollFrame);
    this.taskDragScrollFrame = null;
  }
};
