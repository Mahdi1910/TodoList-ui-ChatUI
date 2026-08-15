import { RepeatEngine } from '../repeat/repeat-engine.js';

export const TodoStorageMappers = (() => {
  const BUILTIN_REMINDERS = Object.freeze([
    { id: 'on_time', label: 'On time', minutesBefore: 0 },
    { id: '5_min', label: '5m before', minutesBefore: 5 },
    { id: '10_min', label: '10m before', minutesBefore: 10 },
    { id: '15_min', label: '15m before', minutesBefore: 15 },
    { id: '30_min', label: '30m before', minutesBefore: 30 },
    { id: '1_hour', label: '1h before', minutesBefore: 60 },
    { id: '2_hour', label: '2h before', minutesBefore: 120 },
    { id: '3_hour', label: '3h before', minutesBefore: 180 },
    { id: '1_day', label: '1d before', minutesBefore: 1440 }
  ]);

  function nowIso() {
    return new Date().toISOString();
  }

  function createId(prefix) {
    const value = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    return `${prefix}-${value}`;
  }

  function taskToRow(task) {
    return {
      id: task.id,
      title: String(task.title || '').trim(),
      description: typeof task.description === 'string' ? task.description : '',
      projectId: task.project || null,
      parentTaskId: task.parentTaskId || null,
      familySlotId: task.familySlotId || null,
      priority: ['low', 'medium', 'high'].includes(task.priority) ? task.priority : '',
      completed: task.completed ? 1 : 0,
      dueDate: task.dueDate || null,
      dueTime: task.dueTime || null,
      sortOrder: Number.isFinite(task.sortOrder) ? task.sortOrder : 0,
      createdAt: task.createdAt || nowIso(),
      updatedAt: task.updatedAt || nowIso()
    };
  }

  function taskFromRow(row, tags = [], reminders = [], repeatData = null) {
    const mappedRepeat = repeatData?.repeat || null;
    const storedState = repeatData?.repeatState || null;
    const activeRepeat = mappedRepeat && mappedRepeat.mode !== 'none';
    const dueDate = activeRepeat && !row.dueDate ? RepeatEngine.today() : (row.dueDate || null);
    let repeat = null;
    let repeatState = null;

    if (activeRepeat) {
      repeat = RepeatEngine.normalizeRepeatRule(mappedRepeat);
      repeatState = RepeatEngine.createInitialRepeatState(repeat, dueDate, storedState || {});
      repeatState.seriesId = storedState?.seriesId || createId('series');
      repeatState._needsRepair = Boolean(storedState?._needsRepair || !row.dueDate);
    }

    return {
      id: row.id,
      title: row.title,
      description: row.description || '',
      project: row.projectId || '',
      parentTaskId: row.parentTaskId || null,
      familySlotId: row.familySlotId || null,
      priority: row.priority || '',
      completed: Boolean(row.completed),
      dueDate,
      dueTime: row.dueTime || null,
      tags: [...tags],
      reminders: reminders.length ? [...reminders] : [],
      repeat,
      repeatState,
      sortOrder: Number.isFinite(row.sortOrder) ? row.sortOrder : 0,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt || row.createdAt
    };
  }

  function repeatToRow(taskId, repeat, repeatState = null) {
    const normalized = RepeatEngine.normalizeRepeatRule(repeat);
    if (normalized.mode === 'none') return null;
    const custom = normalized.custom || {};
    const state = repeatState || {};
    return {
      taskId,
      mode: normalized.mode,
      interval: Number.isFinite(custom.interval) ? custom.interval : 1,
      unit: custom.unit || 'day',
      weekdays: Array.isArray(custom.weekdays) ? [...custom.weekdays] : [],
      monthDays: Array.isArray(custom.monthDays) ? [...custom.monthDays] : [],
      yearDates: custom.yearDates && typeof custom.yearDates === 'object'
        ? JSON.parse(JSON.stringify(custom.yearDates)) : {},
      endType: normalized.end.type,
      endDate: normalized.end.date,
      endCount: normalized.end.count,
      seriesId: state.seriesId || createId('series'),
      occurrenceNumber: Math.max(1, Number(state.occurrenceNumber) || 1),
      anchorDate: state.anchorDate || null,
      anchorDay: Number.isInteger(state.anchorDay) ? state.anchorDay : null,
      anchorMonth: Number.isInteger(state.anchorMonth) ? state.anchorMonth : null,
      updatedAt: nowIso()
    };
  }

  function repeatFromRow(row) {
    if (!row) return null;
    const legacy = {
      mode: row.mode,
      custom: {
        interval: Number.isFinite(row.interval) ? row.interval : 1,
        unit: row.unit || 'day',
        weekdays: Array.isArray(row.weekdays) ? [...row.weekdays] : [],
        monthDays: Array.isArray(row.monthDays) ? [...row.monthDays] : [],
        yearDates: row.yearDates && typeof row.yearDates === 'object'
          ? JSON.parse(JSON.stringify(row.yearDates)) : {},
        endType: row.endType || null,
        endDate: row.endDate || null,
        endCount: Number.isFinite(row.endCount) ? row.endCount : null
      }
    };
    const repeat = RepeatEngine.normalizeRepeatRule({
      ...legacy,
      end: {
        type: row.endType || legacy.custom.endType || 'never',
        date: row.endDate || legacy.custom.endDate || null,
        count: row.endCount ?? legacy.custom.endCount ?? null
      }
    });
    const repeatState = {
      seriesId: row.seriesId || createId('series'),
      occurrenceNumber: Math.max(1, Number(row.occurrenceNumber) || 1),
      anchorDate: row.anchorDate || null,
      anchorDay: Number.isInteger(row.anchorDay) ? row.anchorDay : null,
      anchorMonth: Number.isInteger(row.anchorMonth) ? row.anchorMonth : null,
      _needsRepair: !row.seriesId || !row.anchorDate ||
        !Number.isInteger(row.anchorDay) || !Number.isInteger(row.anchorMonth)
    };
    return { repeat, repeatState };
  }

  function builtinDefinitions() {
    const createdAt = nowIso();
    return BUILTIN_REMINDERS.map(item => ({
      ...item,
      type: 'builtin',
      isBuiltin: 1,
      createdAt
    }));
  }

  function customReminderToDefinition(custom) {
    if (!custom?.id) return null;
    const minutesBefore = Number(custom.day || 0) * 1440 + Number(custom.hr || 0) * 60 + Number(custom.min || 0);
    return {
      id: custom.id,
      label: custom.label || custom.id,
      type: 'custom',
      minutesBefore,
      isBuiltin: 0,
      createdAt: custom.createdAt || nowIso()
    };
  }

  function definitionToCustomReminder(definition) {
    if (!definition || definition.isBuiltin) return null;
    let total = Math.max(0, Number(definition.minutesBefore) || 0);
    const day = Math.floor(total / 1440);
    total -= day * 1440;
    const hr = Math.floor(total / 60);
    const min = total - hr * 60;
    return { id: definition.id, label: definition.label, day, hr, min };
  }

  return {
    BUILTIN_REMINDERS,
    nowIso,
    taskToRow,
    taskFromRow,
    repeatToRow,
    repeatFromRow,
    builtinDefinitions,
    customReminderToDefinition,
    definitionToCustomReminder
  };
})();
