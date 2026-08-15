export const RepeatEngine = (() => {
  const VALID_MODES = new Set(['none', 'daily', 'weekly', 'monthly', 'yearly', 'custom']);
  const VALID_UNITS = new Set(['day', 'week', 'month', 'year']);
  const VALID_ENDS = new Set(['never', 'date', 'count']);

  function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function formatDate(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  function parseDate(value) {
    if (typeof value !== 'string') return null;
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) return null;

    const y = Number(match[1]);
    const m = Number(match[2]);
    const d = Number(match[3]);
    const candidate = new Date(2000, 0, 1, 12, 0, 0, 0);
    candidate.setFullYear(y, m - 1, d);
    candidate.setHours(12, 0, 0, 0);

    if (
      candidate.getFullYear() !== y ||
      candidate.getMonth() !== m - 1 ||
      candidate.getDate() !== d
    ) return null;

    return candidate;
  }

  function today() {
    return formatDate(new Date());
  }

  function addDays(date, count) {
    const next = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12, 0, 0, 0);
    next.setDate(next.getDate() + count);
    return next;
  }

  function daysInMonth(year, monthIndex) {
    return new Date(year, monthIndex + 1, 0).getDate();
  }

  function clampDayToMonth(year, monthIndex, desiredDay) {
    return Math.max(1, Math.min(Number(desiredDay) || 1, daysInMonth(year, monthIndex)));
  }

  function normalizeEnd(repeat) {
    const legacy = repeat?.custom || {};
    const source = repeat?.end || {};
    const type = VALID_ENDS.has(source.type) ? source.type
      : (legacy.endType === 'date' ? 'date' : legacy.endType === 'count' ? 'count' : 'never');
    return {
      type,
      date: type === 'date' ? (source.date || legacy.endDate || null) : null,
      count: type === 'count'
        ? Math.max(1, Math.min(200, Number(source.count ?? legacy.endCount) || 1))
        : null
    };
  }

  function normalizeRepeatRule(input) {
    const source = input && typeof input === 'object' ? input : {};
    const mode = VALID_MODES.has(source.mode) ? source.mode : 'none';
    const custom = source.custom && typeof source.custom === 'object' ? source.custom : {};
    const interval = Math.max(1, Math.min(99, Number(custom.interval) || 1));
    const unit = VALID_UNITS.has(custom.unit) ? custom.unit : 'day';
    const weekdays = [...new Set((Array.isArray(custom.weekdays) ? custom.weekdays : [])
      .map(Number).filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort((a, b) => a - b);
    const monthDays = [...new Set((Array.isArray(custom.monthDays) ? custom.monthDays : [])
      .map(Number).filter(day => Number.isInteger(day) && day >= 1 && day <= 31))].sort((a, b) => a - b);
    const yearDates = {};
    if (custom.yearDates && typeof custom.yearDates === 'object') {
      Object.entries(custom.yearDates).forEach(([month, values]) => {
        const monthIndex = Number(month);
        if (!Number.isInteger(monthIndex) || monthIndex < 0 || monthIndex > 11 || !Array.isArray(values)) return;
        const clean = [...new Set(values.map(Number)
          .filter(day => Number.isInteger(day) && day >= 1 && day <= 31))].sort((a, b) => a - b);
        if (clean.length) yearDates[monthIndex] = clean;
      });
    }
    return { mode, custom: { interval, unit, weekdays, monthDays, yearDates }, end: normalizeEnd(source) };
  }

  function validateRepeatRule(input) {
    const repeat = normalizeRepeatRule(input);
    if (repeat.mode === 'none') return { valid: true, repeat, message: '' };
    if (repeat.mode === 'custom') {
      const custom = repeat.custom;
      if (custom.unit === 'week' && !custom.weekdays.length) {
        return { valid: false, repeat, message: 'Select at least one weekday.' };
      }
      if (custom.unit === 'month' && !custom.monthDays.length) {
        return { valid: false, repeat, message: 'Select at least one day of the month.' };
      }
      if (custom.unit === 'year' && !Object.values(custom.yearDates).some(days => days.length)) {
        return { valid: false, repeat, message: 'Select at least one date in the year.' };
      }
    }
    if (repeat.end.type === 'date' && !parseDate(repeat.end.date)) {
      return { valid: false, repeat, message: 'Select a valid repeat end date.' };
    }
    return { valid: true, repeat, message: '' };
  }

  function createInitialRepeatState(repeat, dueDate, previous = {}) {
    const fallback = parseDate(dueDate) || parseDate(today());
    const anchor = parseDate(previous.anchorDate) || fallback;
    return {
      seriesId: previous.seriesId || null,
      occurrenceNumber: Math.max(1, Number(previous.occurrenceNumber) || 1),
      anchorDate: formatDate(anchor),
      anchorDay: Number.isInteger(previous.anchorDay) ? previous.anchorDay : anchor.getDate(),
      anchorMonth: Number.isInteger(previous.anchorMonth) ? previous.anchorMonth : anchor.getMonth()
    };
  }

  function monthDelta(anchor, candidate) {
    return (candidate.getFullYear() - anchor.getFullYear()) * 12 + candidate.getMonth() - anchor.getMonth();
  }

  function startOfWeek(date) {
    return addDays(date, -date.getDay());
  }

  function calculatePresetNextDate(current, repeat, state) {
    if (repeat.mode === 'daily') return formatDate(addDays(current, 1));
    if (repeat.mode === 'weekly') return formatDate(addDays(current, 7));
    if (repeat.mode === 'monthly') {
      const month = current.getMonth() + 1;
      const target = new Date(current.getFullYear(), month, 1, 12, 0, 0, 0);
      const desired = Number(state.anchorDay) || current.getDate();
      target.setDate(clampDayToMonth(target.getFullYear(), target.getMonth(), desired));
      return formatDate(target);
    }
    if (repeat.mode === 'yearly') {
      const year = current.getFullYear() + 1;
      const month = Number.isInteger(state.anchorMonth) ? state.anchorMonth : current.getMonth();
      const desired = Number(state.anchorDay) || current.getDate();
      return formatDate(new Date(year, month, clampDayToMonth(year, month, desired), 12, 0, 0, 0));
    }
    return null;
  }

  function calculateCustomWeek(current, repeat, state) {
    const interval = repeat.custom.interval;
    const weekdays = new Set(repeat.custom.weekdays);
    const anchor = parseDate(state.anchorDate) || current;
    const anchorWeek = startOfWeek(anchor);
    for (let offset = 1; offset <= 3660; offset++) {
      const candidate = addDays(current, offset);
      const weeks = Math.floor((startOfWeek(candidate) - anchorWeek) / 604800000);
      if (weeks >= 0 && weeks % interval === 0 && weekdays.has(candidate.getDay())) return formatDate(candidate);
    }
    return null;
  }

  function calculateCustomMonth(current, repeat, state) {
    const interval = repeat.custom.interval;
    const anchor = parseDate(state.anchorDate) || current;
    for (let step = 0; step <= 1200; step++) {
      const target = new Date(current.getFullYear(), current.getMonth() + step, 1, 12, 0, 0, 0);
      const delta = monthDelta(anchor, target);
      if (delta < 0 || delta % interval !== 0) continue;
      const candidates = [...new Set(repeat.custom.monthDays.map(day =>
        clampDayToMonth(target.getFullYear(), target.getMonth(), day)))].sort((a, b) => a - b);
      for (const day of candidates) {
        const date = new Date(target.getFullYear(), target.getMonth(), day, 12, 0, 0, 0);
        if (date > current) return formatDate(date);
      }
    }
    return null;
  }

  function calculateCustomYear(current, repeat, state) {
    const interval = repeat.custom.interval;
    const anchor = parseDate(state.anchorDate) || current;
    for (let step = 0; step <= 400; step++) {
      const year = current.getFullYear() + step;
      if (year < anchor.getFullYear() || (year - anchor.getFullYear()) % interval !== 0) continue;
      const candidates = [];
      Object.entries(repeat.custom.yearDates).forEach(([month, days]) => {
        const monthIndex = Number(month);
        days.forEach(day => candidates.push(new Date(
          year, monthIndex, clampDayToMonth(year, monthIndex, day), 12, 0, 0, 0
        )));
      });
      const unique = [...new Map(candidates.map(date => [formatDate(date), date])).values()]
        .sort((a, b) => a - b);
      const next = unique.find(date => date > current);
      if (next) return formatDate(next);
    }
    return null;
  }

  function calculateCustomNextDate(current, repeat, state) {
    const custom = repeat.custom;
    if (custom.unit === 'day') return formatDate(addDays(current, custom.interval));
    if (custom.unit === 'week') return calculateCustomWeek(current, repeat, state);
    if (custom.unit === 'month') return calculateCustomMonth(current, repeat, state);
    if (custom.unit === 'year') return calculateCustomYear(current, repeat, state);
    return null;
  }

  function canGenerateNextOccurrence(nextDate, repeat, state) {
    if (!nextDate) return false;
    if (repeat.end.type === 'date') return nextDate <= repeat.end.date;
    if (repeat.end.type === 'count') return state.occurrenceNumber < repeat.end.count;
    return true;
  }

  function calculateNextOccurrence(currentDueDate, inputRepeat, inputState = {}) {
    const validation = validateRepeatRule(inputRepeat);
    if (!validation.valid || validation.repeat.mode === 'none') return null;
    const current = parseDate(currentDueDate) || parseDate(today());
    const state = createInitialRepeatState(validation.repeat, formatDate(current), inputState);
    const nextDate = validation.repeat.mode === 'custom'
      ? calculateCustomNextDate(current, validation.repeat, state)
      : calculatePresetNextDate(current, validation.repeat, state);
    return canGenerateNextOccurrence(nextDate, validation.repeat, state) ? nextDate : null;
  }

  function samePattern(a, b) {
    const left = normalizeRepeatRule(a);
    const right = normalizeRepeatRule(b);
    return JSON.stringify({ mode: left.mode, custom: left.custom }) ===
      JSON.stringify({ mode: right.mode, custom: right.custom });
  }

  return {
    clone, formatDate, parseDate, today, addDays, clampDayToMonth,
    normalizeRepeatRule, validateRepeatRule, createInitialRepeatState,
    calculatePresetNextDate, calculateCustomNextDate, calculateNextOccurrence,
    canGenerateNextOccurrence, samePattern
  };
})();
