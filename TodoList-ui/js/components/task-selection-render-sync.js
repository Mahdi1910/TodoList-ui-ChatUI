export function installTaskSelectionRenderSync(controller) {
  if (!controller || controller.__renderSyncInstalled) return;
  controller.__renderSyncInstalled = true;

  const originalSyncContainers = controller.syncContainerSelectors.bind(controller);
  controller.syncContainerSelectors = function syncContainerSelectors() {
    originalSyncContainers();
    if (!this.selectionMode || this.workspace?.viewType !== 'kanban') return;

    const groupKey = this.workspace?.groupKey || 'none';
    if (groupKey === 'none') return;

    const rows = this.currentDisplayRows();
    const groups = this.tasks.getTaskGroups?.(rows, groupKey) || [];
    const columns = [...this.tasks.kanbanBoardEl.querySelectorAll(':scope > .kanban-column')];

    columns.forEach((column, index) => {
      const group = groups[index];
      if (!group) return;
      const title = column.querySelector('.kanban-column-title');
      const wrapper = title?.closest('.selection-kanban-column-header');
      if (!wrapper) return;

      const activeIds = this.expandRenderedTaskIds(group.tasks.filter(task => !task.completed));
      wrapper.querySelector(':scope > .selection-container-selector')?.remove();
      wrapper.prepend(this.createContainerSelector(activeIds, `all active tasks in ${group.label}`));

      let count = wrapper.querySelector(':scope > .selection-lane-count');
      if (!count) {
        count = document.createElement('span');
        count.className = 'selection-lane-count';
        wrapper.appendChild(count);
      }
      count.textContent = String(activeIds.length);
    });
  };

  const originalSetBatchBusy = controller.setBatchBusy.bind(controller);
  controller.setBatchBusy = function setBatchBusy(value) {
    originalSetBatchBusy(value);
    if (!this.selectionMode) return;
    document.querySelectorAll('.selection-container-checkbox').forEach(checkbox => {
      const hasTargets = !checkbox.closest('.selection-container-selector')?.classList.contains('is-empty');
      checkbox.disabled = this.batchBusy || !hasTargets;
    });
  };
}
