export const TaskAfter = (() => {
  const LEGACY_UNITS = new Set(['minute', 'hour']);
  const MAX_HOURS = 24;
  const MAX_MINUTES = 59;

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function readDuration(after) {
    const hasCombinedDuration = Object.prototype.hasOwnProperty.call(after, 'hours') ||
      Object.prototype.hasOwnProperty.call(after, 'minutes');

    if (hasCombinedDuration) {
      return {
        hours: Number(after.hours ?? 0),
        minutes: Number(after.minutes ?? 0),
        legacyError: null
      };
    }

    const unit = String(after.unit || '');
    const amount = Number(after.amount);
    if (!LEGACY_UNITS.has(unit)) {
      return { hours: NaN, minutes: NaN, legacyError: 'After delay must use hours and minutes.' };
    }
    if (!Number.isInteger(amount) || amount < 0) {
      return { hours: NaN, minutes: NaN, legacyError: 'After delay is invalid.' };
    }

    const totalMinutes = unit === 'hour' ? amount * 60 : amount;
    return {
      hours: Math.floor(totalMinutes / 60),
      minutes: totalMinutes % 60,
      legacyError: null
    };
  }

  function validate(after) {
    if (after == null) return { valid: true, after: null };
    if (!after || typeof after !== 'object' || Array.isArray(after)) {
      return { valid: false, message: 'After settings are invalid.' };
    }

    const taskId = typeof after.taskId === 'string' ? after.taskId.trim() : '';
    if (!taskId) return { valid: false, message: 'Choose the task this task should follow.' };

    const duration = readDuration(after);
    if (duration.legacyError) return { valid: false, message: duration.legacyError };
    const { hours, minutes } = duration;
    if (!Number.isInteger(hours) || hours < 0 || hours > MAX_HOURS) {
      return { valid: false, message: `After hours must be between 0 and ${MAX_HOURS}.` };
    }
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_MINUTES) {
      return { valid: false, message: `After minutes must be between 0 and ${MAX_MINUTES}.` };
    }
    if (hours === 0 && minutes === 0) {
      return { valid: false, message: 'Choose at least 1 minute of After delay.' };
    }

    let resolvedAt = null;
    if (after.resolvedAt != null) {
      if (typeof after.resolvedAt !== 'string' || !Number.isFinite(Date.parse(after.resolvedAt))) {
        return { valid: false, message: 'After resolution time is invalid.' };
      }
      resolvedAt = after.resolvedAt;
    }

    return { valid: true, after: { taskId, hours, minutes, resolvedAt } };
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
    return left.taskId === right.taskId && left.hours === right.hours && left.minutes === right.minutes;
  }

  function delayMilliseconds(after) {
    const normalized = normalize(after);
    if (!normalized) return 0;
    return (normalized.hours * 60 + normalized.minutes) * 60 * 1000;
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
    const parts = [];
    if (normalized.hours) parts.push(`${normalized.hours} ${normalized.hours === 1 ? 'hour' : 'hours'}`);
    if (normalized.minutes) parts.push(`${normalized.minutes} ${normalized.minutes === 1 ? 'minute' : 'minutes'}`);
    return parts.join(' ');
  }

  return {
    LEGACY_UNITS,
    MAX_HOURS,
    MAX_MINUTES,
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
