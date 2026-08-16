import { RepeatEngine } from '../repeat/repeat-engine.js';
import { TodoStorageMappers } from '../storage/mappers.js';

const MAX_ID = 512;
const MAX_TITLE = 500;
const MAX_DESCRIPTION = 4000;
const MAX_QUERY = 1000;
const MAX_REMINDER_MINUTES = 86400;
const PRIORITIES = new Set(['none', 'low', 'medium', 'high']);
const POSITIONS = new Set(['top', 'bottom', 'before', 'after']);
const REPEAT_MODES = new Set(['daily', 'weekly', 'monthly', 'yearly', 'custom']);
const REPEAT_UNITS = new Set(['day', 'week', 'month', 'year']);
const END_TYPES = new Set(['never', 'date', 'count']);

export class TodoToolValidationError extends Error {
  constructor(message, details = {}, code = 'INVALID_ARGUMENT') {
    super(message);
    this.name = 'TodoToolValidationError';
    this.code = code;
    this.details = details;
  }
}

function fail(message, details = {}, code = 'INVALID_ARGUMENT') {
  throw new TodoToolValidationError(message, details, code);
}

export function assertPlainObject(value, label = 'value') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(`${label} must be an object.`);
  return value;
}

export function normalizeId(value, label = 'id', { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  const id = value.trim();
  if (!id || id.length > MAX_ID) fail(`${label} is invalid.`);
  return id;
}

export function normalizeIdArray(value, label, { max = 50, allowEmpty = true } = {}) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  if (!allowEmpty && value.length === 0) fail(`${label} cannot be empty.`);
  if (value.length > max) fail(`${label} can contain at most ${max} IDs.`);
  const ids = value.map((item, index) => normalizeId(item, `${label}[${index}]`));
  return [...new Set(ids)];
}

function normalizeText(value, label, max, { allowEmpty = true } = {}) {
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  const text = value.trim();
  if (!allowEmpty && !text) fail(`${label} is required.`);
  if (text.length > max) fail(`${label} is too long.`);
  return text;
}

export function normalizeTitle(value, label = 'title') {
  return normalizeText(value, label, MAX_TITLE, { allowEmpty: false });
}

export function normalizeDescription(value, label = 'description') {
  if (typeof value !== 'string') fail(`${label} must be a string.`);
  if (value.length > MAX_DESCRIPTION) fail(`${label} is too long.`);
  return value;
}

export function normalizeQuery(value) {
  return normalizeText(value, 'query', MAX_QUERY, { allowEmpty: false });
}

export function normalizeDate(value, label = 'date', { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    fail(`${label} must use YYYY-MM-DD.`);
  }
  const parsed = RepeatEngine.parseDate(value);
  if (!parsed) fail(`${label} is not a real calendar date.`);
  return value;
}

export function normalizeTime(value, label = 'time', { nullable = false } = {}) {
  if (value == null && nullable) return null;
  if (typeof value !== 'string' || !/^(0[1-9]|1[0-2]):[0-5]\d (AM|PM)$/.test(value)) {
    fail(`${label} must use hh:mm AM/PM, for example 01:05 PM.`);
  }
  return value;
}

export function normalizePriority(value) {
  if (typeof value !== 'string' || !PRIORITIES.has(value)) fail('priority must be none, low, medium, or high.');
  return value === 'none' ? '' : value;
}

export function normalizePosition(value, label = 'position') {
  if (value == null) return null;
  const source = assertPlainObject(value, label);
  const placement = String(source.placement || '');
  if (!POSITIONS.has(placement)) fail(`${label}.placement must be top, bottom, before, or after.`);
  const relativeToId = source.relativeToId == null ? null : normalizeId(source.relativeToId, `${label}.relativeToId`);
  if ((placement === 'before' || placement === 'after') && !relativeToId) {
    fail(`${label}.relativeToId is required for ${placement}.`);
  }
  if ((placement === 'top' || placement === 'bottom') && relativeToId) {
    fail(`${label}.relativeToId is not used for ${placement}.`);
  }
  return { placement, relativeToId };
}

export function normalizeReminders(value) {
  if (!Array.isArray(value)) fail('reminders must be an array.');
  if (value.length > 20) fail('reminders can contain at most 20 entries.');
  const builtinByMinutes = new Map(TodoStorageMappers.BUILTIN_REMINDERS.map(item => [item.minutesBefore, item.id]));
  const ids = [];
  for (let index = 0; index < value.length; index += 1) {
    const item = assertPlainObject(value[index], `reminders[${index}]`);
    const minutes = Number(item.minutesBefore);
    if (!Number.isInteger(minutes) || minutes < 0 || minutes > MAX_REMINDER_MINUTES) {
      fail(`reminders[${index}].minutesBefore must be an integer from 0 to ${MAX_REMINDER_MINUTES}.`);
    }
    const builtin = builtinByMinutes.get(minutes);
    if (builtin) {
      ids.push(builtin);
      continue;
    }
    const day = Math.floor(minutes / 1440);
    const remaining = minutes - day * 1440;
    const hr = Math.floor(remaining / 60);
    const min = remaining - hr * 60;
    ids.push(`custom-${day}d-${hr}h-${min}m`);
  }
  return [...new Set(ids)];
}

function uniqueIntegers(value, label, min, max) {
  if (!Array.isArray(value)) fail(`${label} must be an array.`);
  const output = [];
  const seen = new Set();
  value.forEach((raw, index) => {
    const number = Number(raw);
    if (!Number.isInteger(number) || number < min || number > max) {
      fail(`${label}[${index}] must be an integer from ${min} to ${max}.`);
    }
    if (!seen.has(number)) {
      seen.add(number);
      output.push(number);
    }
  });
  return output.sort((a, b) => a - b);
}

function isPossibleMonthDay(month, day) {
  if (month === 2 && day === 29) return true;
  const year = 2025;
  const date = new Date(year, month - 1, day, 12, 0, 0, 0);
  return date.getMonth() === month - 1 && date.getDate() === day;
}

export function normalizeRepeat(value, label = 'repeat') {
  if (value == null) return null;
  const source = assertPlainObject(value, label);
  const mode = String(source.mode || '');
  if (!REPEAT_MODES.has(mode)) fail(`${label}.mode is invalid.`);

  const customSource = source.custom && typeof source.custom === 'object' && !Array.isArray(source.custom)
    ? source.custom : {};
  const interval = customSource.interval == null ? 1 : Number(customSource.interval);
  if (!Number.isInteger(interval) || interval < 1 || interval > 99) fail(`${label}.custom.interval must be 1..99.`);
  const unit = customSource.unit == null ? 'day' : String(customSource.unit);
  if (!REPEAT_UNITS.has(unit)) fail(`${label}.custom.unit is invalid.`);

  const weekdays = customSource.weekdays == null ? [] : uniqueIntegers(customSource.weekdays, `${label}.custom.weekdays`, 0, 6);
  const monthDays = customSource.monthDays == null ? [] : uniqueIntegers(customSource.monthDays, `${label}.custom.monthDays`, 1, 31);
  const yearDates = {};
  if (customSource.yearDates != null) {
    if (!Array.isArray(customSource.yearDates)) fail(`${label}.custom.yearDates must be an array.`);
    customSource.yearDates.forEach((entry, index) => {
      const row = assertPlainObject(entry, `${label}.custom.yearDates[${index}]`);
      const month = Number(row.month);
      if (!Number.isInteger(month) || month < 1 || month > 12) fail(`${label}.custom.yearDates[${index}].month must be 1..12.`);
      const days = uniqueIntegers(row.days, `${label}.custom.yearDates[${index}].days`, 1, 31);
      days.forEach(day => {
        if (!isPossibleMonthDay(month, day)) fail(`${label}.custom.yearDates contains an impossible date: ${month}/${day}.`);
      });
      if (days.length) yearDates[month - 1] = [...new Set([...(yearDates[month - 1] || []), ...days])].sort((a, b) => a - b);
    });
  }

  if (mode === 'custom') {
    if (unit === 'week' && weekdays.length === 0) fail(`${label}.custom.weekdays requires at least one weekday.`);
    if (unit === 'month' && monthDays.length === 0) fail(`${label}.custom.monthDays requires at least one day.`);
    if (unit === 'year' && Object.keys(yearDates).length === 0) fail(`${label}.custom.yearDates requires at least one date.`);
  }

  const endSource = source.end && typeof source.end === 'object' && !Array.isArray(source.end) ? source.end : { type: 'never' };
  const endType = String(endSource.type || 'never');
  if (!END_TYPES.has(endType)) fail(`${label}.end.type is invalid.`);
  let endDate = null;
  let endCount = null;
  if (endType === 'date') endDate = normalizeDate(endSource.date, `${label}.end.date`);
  if (endType === 'count') {
    endCount = Number(endSource.count);
    if (!Number.isInteger(endCount) || endCount < 1 || endCount > 200) fail(`${label}.end.count must be 1..200.`);
  }

  return {
    mode,
    custom: { interval, unit, weekdays, monthDays, yearDates },
    end: { type: endType, date: endDate, count: endCount }
  };
}

export function resolveFinalSchedule(current = null, input = {}) {
  const dueDate = Object.prototype.hasOwnProperty.call(input, 'dueDate')
    ? normalizeDate(input.dueDate, 'dueDate', { nullable: true })
    : (current?.dueDate || null);
  const dueTime = Object.prototype.hasOwnProperty.call(input, 'dueTime')
    ? normalizeTime(input.dueTime, 'dueTime', { nullable: true })
    : (current?.dueTime || null);
  const repeat = Object.prototype.hasOwnProperty.call(input, 'repeat')
    ? normalizeRepeat(input.repeat)
    : (current?.repeat ? RepeatEngine.clone(current.repeat) : null);

  let resolvedDate = dueDate;
  let reason = null;
  if (!resolvedDate && repeat && repeat.mode !== 'none') {
    resolvedDate = RepeatEngine.today();
    reason = 'repeat_requires_date';
  } else if (!resolvedDate && dueTime) {
    resolvedDate = RepeatEngine.today();
    reason = 'time_requires_date';
  }

  if (repeat?.end?.type === 'date' && resolvedDate && repeat.end.date < resolvedDate) {
    fail('Repeat end date cannot be before the task due date.', {
      dueDate: resolvedDate,
      repeatEndDate: repeat.end.date
    });
  }

  return {
    dueDate: resolvedDate,
    dueTime,
    repeat,
    scheduleResolution: reason ? { dueDateAssigned: resolvedDate, reason } : null
  };
}

export function normalizeTaskCreateInput(input) {
  const source = assertPlainObject(input, 'task');
  if (Object.prototype.hasOwnProperty.call(source, 'completed') && typeof source.completed !== 'boolean') fail('completed must be a boolean.');
  const schedule = resolveFinalSchedule(null, source);
  return {
    taskData: {
      title: normalizeTitle(source.title),
      description: source.description == null ? '' : normalizeDescription(source.description),
      project: source.projectId == null ? '' : normalizeId(source.projectId, 'projectId'),
      parentTaskId: source.parentTaskId == null ? null : normalizeId(source.parentTaskId, 'parentTaskId'),
      priority: source.priority == null ? '' : normalizePriority(source.priority),
      tags: source.tagIds == null ? [] : normalizeIdArray(source.tagIds, 'tagIds', { max: 50 }),
      dueDate: schedule.dueDate,
      dueTime: schedule.dueTime,
      reminders: source.reminders == null ? [] : normalizeReminders(source.reminders),
      repeat: schedule.repeat
    },
    completed: source.completed === true,
    position: normalizePosition(source.position),
    scheduleResolution: schedule.scheduleResolution
  };
}

export function normalizeTaskUpdateInput(current, input) {
  const source = assertPlainObject(input, 'task');
  if (Object.prototype.hasOwnProperty.call(source, 'completed') && typeof source.completed !== 'boolean') fail('completed must be a boolean.');
  const id = normalizeId(source.id, 'id');
  const patch = {};
  if (Object.prototype.hasOwnProperty.call(source, 'title')) patch.title = normalizeTitle(source.title);
  if (Object.prototype.hasOwnProperty.call(source, 'description')) patch.description = normalizeDescription(source.description);
  if (Object.prototype.hasOwnProperty.call(source, 'projectId')) {
    patch.project = source.projectId == null ? '' : normalizeId(source.projectId, 'projectId');
  }
  if (Object.prototype.hasOwnProperty.call(source, 'priority')) patch.priority = normalizePriority(source.priority);
  if (Object.prototype.hasOwnProperty.call(source, 'tagIds')) patch.tags = normalizeIdArray(source.tagIds, 'tagIds', { max: 50 });
  if (Object.prototype.hasOwnProperty.call(source, 'reminders')) patch.reminders = normalizeReminders(source.reminders);

  const touchesSchedule = ['dueDate', 'dueTime', 'repeat'].some(key => Object.prototype.hasOwnProperty.call(source, key));
  let scheduleResolution = null;
  if (touchesSchedule) {
    const schedule = resolveFinalSchedule(current, source);
    patch.dueDate = schedule.dueDate;
    patch.dueTime = schedule.dueTime;
    patch.repeat = schedule.repeat;
    scheduleResolution = schedule.scheduleResolution;
  }

  return {
    id,
    patch,
    parentTaskIdSpecified: Object.prototype.hasOwnProperty.call(source, 'parentTaskId'),
    parentTaskId: Object.prototype.hasOwnProperty.call(source, 'parentTaskId')
      ? (source.parentTaskId == null ? null : normalizeId(source.parentTaskId, 'parentTaskId'))
      : undefined,
    projectSpecified: Object.prototype.hasOwnProperty.call(source, 'projectId'),
    projectId: Object.protype.hasOwnProperty.call(source, 'projectId')
      ? (source.projectId == null ? null : normalizeId(source.projectId, 'projectId'))
      : undefined,
    completedSpecified: Object.prototype.hasOwnProperty.call(source, 'completed'),
    completed: Object.prototype.hasOwnProperty.call(source, 'completed') ? source.completed : undefined,
    position: normalizePosition(source.position),
    scheduleResolution
  };
}

export function normalizeTaxonomyCreateInput(input, label) {
  const source = assertPlainObject(input, label.toLowerCase());
  if (source.viewType != null && !['list', 'kanban'].includes(source.viewType)) fail(`${label}.viewType must be list or kanban.`);
  return {
    data: {
      name: normalizeTitle(source.name, `${label}.name`),
      icon: source.icon == null ? ' ' : normalizeText(source.icon, `${label}.icon`, 16, { allowEmpty: false }),
      parentId: source.parentId == null ? null : normalizeId(source.parentId, `${label}.parentId`),
      viewType: source.viewType || 'list'
    },
    position: normalizePosition(source.position, `${label}.position`)
  };
}

export function normalizeTaxonomyUpdateInput(input, label) {
  const source = assertPlainObject(input, label.toLowerCase());
  const data = {};
  if (Object.prototype.hasOwnProperty.call(source, 'name')) data.name = normalizeTitle(source.name, `${label}.name`);
  if (Object.prototype.hasOwnProperty.call(source, 'icon')) data.icon = normalizeText(source.icon, `${label}.icon`, 16, { allowEmpty: false });
  if (Object.prototype.hasOwnProperty.call(source, 'parentId')) data.parentId = source.parentId == null ? null : normalizeId(source.parentId, `${label}.parentId`);
  if (Object.prototype.hasOwnProperty.call(source, 'viewType')) {
    if (!['list', 'kanban'].includes(source.viewType)) fail(`${label}.viewType must be list or kanban.`);
    data.viewType = source.viewType;
  }
  return {
    id: normalizeId(source.id, `${label}.id`),
    data,
    parentSpecified: Object.prototype.hasOwnProperty.call(source, 'parentId'),
    position: normalizePosition(source.position, `${label}.position`)
  };
}

export function normalizePagination(args = {}, { defaultLimit = 25, maxLimit = 50 } = {}) {
  const offset = args.offset == null ? 0 : Number(args.offset);
  const limit = args.limit == null ? defaultLimit : Number(args.limit);
  if (!Number.isInteger(offset) || offset < 0) fail('offset must be a non-negative integer.');
  if (!Number.isInteger(limit) || limit < 1 || limit > maxLimit) fail(`limit must be 1..${maxLimit}.`);
  return { offset, limit };
}

export function normalizeMutationEnvelope(args = {}, arrayKey) {
  const source = assertPlainObject(args, 'arguments');
  const items = source[arrayKey];
  if (!Array.isArray(items) || items.length < 1 || items.length > 10) {
    fail(`${arrayKey} must contain 1..10 items.`);
  }
  return {
    items,
    duplicateConfirmationToken: source.duplicateConfirmationToken == null
      ? null
      : normalizeText(source.duplicateConfirmationToken, 'duplicateConfirmationToken', 256, { allowEmpty: false })
  };
}

export function normalizeDeleteEnvelope(args = {}, key) {
  const source = assertPlainObject(args, 'arguments');
  const ids = normalizeIdArray(source[key], key, { max: 10, allowEmpty: false });
  if (ids.length < 1) fail(`${key} must contain at least one ID.`);
  return {
    ids,
    duplicateConfirmationToken: source.duplicateConfirmationToken == null
      ? null
      : normalizeText(source.duplicateConfirmationToken, 'duplicateConfirmationToken', 256, { allowEmpty: false })
  };
}

export function toolError(error, fallbackCode = 'INTERNAL_TODO_ERROR') {
  if (error instanceof TodoToolValidationError) {
    return { code: error.code, message: error.message, details: error.details || {} };
  }
  return {
    code: fallbackCode,
    message: error instanceof Error ? error.message : String(error || 'Todo operation failed.'),
    details: {}
  };
}
