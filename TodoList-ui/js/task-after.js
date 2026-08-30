export const TaskAfter = (() => {
  const UNITS = new Set(['minute', 'hour']);

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function validate(after) {
    if (after == null) return { valid: true, after: null };
    if (!after || typeof after !== 'object' || Array.isArray(after)) {
      return { valid: false, message: 'After settings are invalid.' };
    }
    const taskId = typeof after.taskId === 'string' ? after.taskId.trim() : '';
    const unit = String(after.unit || '');
    const amount = Number(after.amount);
    if (!taskId) return { valid: false, message: 'Choose the task this task should follow.' };
    if (!UNITS.has(unit)) return { valid: false, message: 'After delay must use minutes or hours.' };
    const max = unit === 'hour' ? 24 : 60;
    if (!Number.isInteger(amount) || amount < 1 || amount > max) {
      return { valid: false, message: `After delay must be between 1 and ${max} ${unit}${max === 1 ? '' : 's'}.` };
    }
    let resolvedAt = null;
    if (after.resolvedAt != null) {
      if (typeof after.resolvedAt !== 'string' || !Number.isFinite(Date.parse(after.resolvedAt))) {
        return { valid: false, message: 'After resolution time is invalid.' };
      }
      resolvedAt = after.resolvedAt;
    }
    return { valid: true, after: { taskId, amount, unit, resolvedAt } };
  }

  function normalize(after) {
    const check = validate(after);
    return check.valid ? check.after : null;
  }

  function isPending(after) {
    const normalized = normalize(after);
    return Boolean(normalized && !normalized.resolvedAt);
  }

  function sameSpec(a, b) {
    const left = normalize(a);
    const right = normalize(b);
    if (!left || !right) return left === right;
    return left.taskId === right.taskId && left.amount === right.amount && left.unit === right.unit;
  }

  function delayMilliseconds(after) {
    const normalized = normalize(after);
    if (!normalized) return 0;
    return normalized.amount * (normalized.unit === 'hour' ? 60 : 1) * 60 * 1000;
  }

  function formatDate(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
  }

  function formatTime(date) {
    const rawHour = date.getHours();
    const period = rawHour >= 12 ? 'PM' : 'AM';
    const hour = rawHour % 12 || 12;
    const minute = String(date.getMinutes()).padStart(2, '0');
    return `${String(hour).padStart(2, '0')}:${minute} ${period}`;
  }

  function resolveSchedule(after, completedAt) {
    const normalized = normalize(after);
    const completed = typeof completedAt === 'string' ? new Date(completedAt) : null;
    if (!normalized || !completed || !Number.isFinite(completed.getTime())) return null;
    const due = new Date(completed.getTime() + delayMilliseconds(normalized));
    return {
      dueDate: formatDate(due),
      dueTime: formatTime(due),
      resolvedAt: completed.toISOString()
    };
  }

  function wouldCreateCycle(taskId, sourceTaskId, tasks = []) {
    if (!taskId || !sourceTaskId) return false;
    const byId = new Map((tasks || []).filter(Boolean).map(task => [task.id, task]));
    let cursorId = sourceTaskId;
    const seen = new Set();
    while (cursorId && !seen.has(cursorId)) {
      if (cursorId === taskId) return true;
      seen.add(cursorId);
      const cursor = byId.get(cursorId);
      cursorId = normalize(cursor?.after)?.taskId || null;
    }
    return false;
  }

  function eligibleSources(tasks = [], currentTaskId = null) {
    return [...tasks]
      .filter(task => task && !task.completed && task.id !== currentTaskId)
      .filter(task => !wouldCreateCycle(currentTaskId, task.id, tasks))
      .sort((a, b) => {
        const created = String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
        return created || String(b.id || '').localeCompare(String(a.id || ''));
      });
  }

  function formatDelay(after) {
    const normalized = normalize(after);
    if (!normalized) return '';
    const label = normalized.amount === 1 ? normalized.unit : `${normalized.unit}s`;
    return `${normalized.amount} ${label}`;
  }

  return {
    UNITS,
    clone,
    validate,
    normalize,
    isPending,
    sameSpec,
    delayMilliseconds,
    resolveSchedule,
    wouldCreateCycle,
    eligibleSources,
    formatDelay
  };
})();
