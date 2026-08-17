export function parseDueTimeMinutes(value) {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return null;
  const match = text.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  const period = match[3].toUpperCase();
  if (!Number.isInteger(hour) || hour < 1 || hour > 12) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  const normalizedHour = (hour % 12) + (period === 'PM' ? 12 : 0);
  return normalizedHour * 60 + minute;
}

export function sortTasksByDueDate(tasks = [], direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1;
  return [...tasks].sort((a, b) => {
    const aDate = typeof a?.dueDate === 'string' && a.dueDate ? a.dueDate : null;
    const bDate = typeof b?.dueDate === 'string' && b.dueDate ? b.dueDate : null;

    if (Boolean(aDate) !== Boolean(bDate)) return aDate ? -1 : 1;
    if (!aDate) return 0;

    const dateResult = aDate.localeCompare(bDate);
    if (dateResult) return dateResult * factor;

    const aMinutes = parseDueTimeMinutes(a?.dueTime);
    const bMinutes = parseDueTimeMinutes(b?.dueTime);
    const aTimed = Number.isInteger(aMinutes);
    const bTimed = Number.isInteger(bMinutes);

    if (aTimed !== bTimed) return (aTimed ? 1 : -1) * factor;
    if (!aTimed) return 0;

    const timeResult = aMinutes - bMinutes;
    return timeResult ? timeResult * factor : 0;
  });
}

export function installWorkspaceDueDateSort(workspaceControls) {
  if (!workspaceControls || workspaceControls.__dueDateSortInstalled) return;
  const originalSortTasks = workspaceControls.sortTasks.bind(workspaceControls);
  workspaceControls.sortTasks = function sortTasks(tasks) {
    const sortKey = this.normalizeSortKey(this.sortKey);
    if (sortKey === 'dueDate') {
      return sortTasksByDueDate(tasks, this.sortDirection);
    }
    return originalSortTasks(tasks);
  };
  workspaceControls.__dueDateSortInstalled = true;
}
