import { AppState } from '../state.js';
import { TaskFilter } from '../task-filter.js';
import { TaxonomyOrder } from '../taxonomy-order.js';
import { TodoStorageMappers } from '../storage/mappers.js';
import { normalizeDate, normalizeIdArray, normalizePagination, normalizeQuery, TodoToolValidationError } from './todo-tool-normalizers.js';

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function reminderMinutes(task) {
  const builtin = new Map(TodoStorageMappers.BUILTIN_REMINDERS.map(item => [item.id, item.minutesBefore]));
  return (task.reminders || [])
    .filter(id => id && id !== 'none')
    .map(id => {
      if (builtin.has(id)) return builtin.get(id);
      const stored = AppState.getReminderDefinition(id);
      return stored ? Number(stored.minutesBefore) || 0 : null;
    })
    .filter(value => value != null);
}

function repeatForAi(repeat) {
  if (!repeat || repeat.mode === 'none') return null;
  const output = clone(repeat);
  const dates = output?.custom?.yearDates;
  if (dates && !Array.isArray(dates) && typeof dates === 'object') {
    output.custom.yearDates = Object.entries(dates)
      .map(([month, days]) => ({ month: Number(month) + 1, days: [...days] }))
      .sort((a, b) => a.month - b.month);
  }
  return output;
}

export function serializeTaskSummary(task) {
  const project = task.project ? AppState.getProject(task.project) : null;
  return {
    id: task.id,
    title: task.title,
    project: project ? { id: project.id, name: project.name } : null,
    parentTaskId: task.parentTaskId || null,
    priority: task.priority || 'none',
    tags: (task.tags || []).map(id => {
      const tag = AppState.getTag(id);
      return { id, name: tag?.name || 'Unknown Tag' };
    }),
    completed: Boolean(task.completed),
    dueDate: task.dueDate || null,
    dueTime: task.dueTime || null,
    reminders: reminderMinutes(task).map(minutesBefore => ({ minutesBefore })),
    repeat: task.repeat ? { mode: task.repeat.mode, end: clone(task.repeat.end || null) } : null
  };
}

export function serializeTaskFull(task) {
  return {
    ...serializeTaskSummary(task),
    description: String(task.description || '').slice(0, 4000),
    repeat: repeatForAi(task.repeat),
    repeatOccurrence: task.repeatState ? {
      seriesId: task.repeatState.seriesId || null,
      occurrenceNumber: Math.max(1, Number(task.repeatState.occurrenceNumber) || 1)
    } : null,
    customSiblingIndex: AppState.getSiblingTaskIds(task.parentTaskId || null).indexOf(task.id),
    createdAt: task.createdAt || null,
    updatedAt: task.updatedAt || null,
    childIds: AppState.getSubtaskIds(task.id)
  };
}

function expandFamilyRows(rows) {
  const output = [];
  const seen = new Set();
  for (const task of rows) {
    if (!task || seen.has(task.id)) continue;
    output.push(task);
    seen.add(task.id);
    if (!task.parentTaskId) {
      const children = AppState.getSubtasks(task.id);
      const ordered = window.WorkspaceControls?.sortTasks?.(children) || children;
      for (const child of ordered) {
        if (!seen.has(child.id)) {
          output.push(child);
          seen.add(child.id);
        }
      }
    }
  }
  return output;
}

function currentViewOrder() {
  const filtered = TaskFilter.getDisplayTasks();
  const active = filtered.filter(task => !task.completed);
  const completed = filtered.filter(task => task.completed);
  const controls = window.WorkspaceControls;
  const tasksComponent = window.TasksComponent;
  const groupKey = controls?.groupKey || 'none';
  const orderedActive = [];

  if (groupKey !== 'none' && typeof tasksComponent?.getTaskGroups === 'function') {
    for (const group of tasksComponent.getTaskGroups(active, groupKey)) {
      const groupRows = controls?.sortTasks?.(group.tasks) || group.tasks;
      orderedActive.push(...groupRows);
    }
  } else {
    orderedActive.push(...(controls?.sortTasks?.(active) || active));
  }

  const orderedCompleted = controls?.sortTasks?.(completed) || completed;
  return expandFamilyRows([...orderedActive, ...orderedCompleted]);
}

function stableTaskCompare(a, b) {
  const order = (Number.isFinite(a?.sortOrder) ? a.sortOrder : 0) - (Number.isFinite(b?.sortOrder) ? b.sortOrder : 0);
  if (order) return order;
  const created = String(a?.createdAt || '').localeCompare(String(b?.createdAt || ''));
  if (created) return created;
  return String(a?.id || '').localeCompare(String(b?.id || ''));
}

function allTaskOrder() {
  const roots = AppState.tasks.filter(task => !task.parentTaskId).sort(stableTaskCompare);
  const output = [];
  const seen = new Set();
  for (const root of roots) {
    output.push(root);
    seen.add(root.id);
    const children = AppState.tasks.filter(task => task.parentTaskId === root.id).sort(stableTaskCompare);
    for (const child of children) { output.push(child); seen.add(child.id); }
  }
  AppState.tasks.filter(task => !seen.has(task.id)).sort(stableTaskCompare).forEach(task => output.push(task));
  return output;
}

function tagTree(tagId, descendants) {
  return new Set([tagId, ...(descendants ? AppState.getTagDescendantIds(tagId) : [])]);
}

function projectTree(projectId, descendants) {
  return new Set([projectId, ...(descendants ? AppState.getProjectDescendantIds(projectId) : [])]);
}

function validateKnownIds(ids, getter, label) {
  ids.forEach(id => {
    if (!getter(id)) throw new TodoToolValidationError(`${label} not found.`, { id }, `${label.toUpperCase()}_NOT_FOUND`);
  });
}

export function selectTasks(args = {}) {
  const detail = ['auto', 'summary', 'full'].includes(args.detail) ? args.detail : 'auto';
  const { offset } = normalizePagination({ ...args, limit: Math.min(Number(args.limit ?? 20) || 20, 20) }, { defaultLimit: 20, maxLimit: 20 });
  let requestedLimit = args.limit == null ? (detail === 'full' ? 10 : 20) : Number(args.limit);
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) throw new TodoToolValidationError('limit must be a positive integer.');
  requestedLimit = Math.min(requestedLimit, 20);

  let ordered = args.scope === 'current_view' ? currentViewOrder() : allTaskOrder();
  if (args.includeSubtasks === false) ordered = ordered.filter(task => !task.parentTaskId);

  if (args.ids != null) {
    const ids = normalizeIdArray(args.ids, 'ids', { max: 50 });
    const wanted = new Set(ids);
    ordered = ordered.filter(task => wanted.has(task.id));
  }
  if (args.query != null) {
    const query = normalizeQuery(args.query).toLocaleLowerCase();
    ordered = ordered.filter(task =>
      String(task.title || '').toLocaleLowerCase().includes(query) ||
      String(task.description || '').toLocaleLowerCase().includes(query)
    );
  }

  if (args.projectIds != null) {
    const projectIds = normalizeIdArray(args.projectIds, 'projectIds', { max: 20 });
    validateKnownIds(projectIds, id => AppState.getProject(id), 'project');
    const descendants = args.includeProjectDescendants !== false;
    const allowed = new Set();
    projectIds.forEach(id => projectTree(id, descendants).forEach(value => allowed.add(value)));
    ordered = ordered.filter(task => allowed.has(task.project));
  }

  if (args.tagIds != null) {
    const tagIds = normalizeIdArray(args.tagIds, 'tagIds', { max: 20 });
    validateKnownIds(tagIds, id => AppState.getTag(id), 'tag');
    const descendants = args.includeTagDescendants !== false;
    const trees = tagIds.map(id => tagTree(id, descendants));
    const match = args.tagMatch === 'all' ? 'all' : 'any';
    ordered = ordered.filter(task => {
      const assigned = new Set(task.tags || []);
      const treeMatches = trees.map(tree => [...tree].some(id => assigned.has(id)));
      return match === 'all' ? treeMatches.every(Boolean) : treeMatches.some(Boolean);
    });
  }

  if (args.dueFrom != null) {
    const from = normalizeDate(args.dueFrom, 'dueFrom');
    ordered = ordered.filter(task => task.dueDate && task.dueDate >= from);
  }
  if (args.dueTo != null) {
    const to = normalizeDate(args.dueTo, 'dueTo');
    ordered = ordered.filter(task => task.dueDate && task.dueDate <= to);
  }
  if (args.completed != null) ordered = ordered.filter(task => Boolean(task.completed) === Boolean(args.completed));
  if (args.priorities != null) {
    if (!Array.isArray(args.priorities)) throw new TodoToolValidationError('priorities must be an array.');
    const priorities = new Set(args.priorities.map(value => value === 'none' ? '' : value));
    for (const value of priorities) {
      if (!['', 'low', 'medium', 'high'].includes(value)) throw new TodoToolValidationError('priorities contains an invalid value.');
    }
    ordered = ordered.filter(task => priorities.has(task.priority || ''));
  }
  if (Object.prototype.hasOwnProperty.call(args, 'parentTaskId')) {
    const parent = args.parentTaskId == null ? null : String(args.parentTaskId);
    ordered = ordered.filter(task => (task.parentTaskId || null) === parent);
  }

  const exactIds = Array.isArray(args.ids) && args.ids.length <= 10;
  let resolvedDetail = detail === 'auto' ? (exactIds ? 'full' : 'summary') : detail;
  if (resolvedDetail === 'full' && requestedLimit > 10) resolvedDetail = 'summary';
  if (resolvedDetail === 'full' && Array.isArray(args.ids) && args.ids.length > 10) resolvedDetail = 'summary';
  const max = resolvedDetail === 'full' ? 10 : 20;
  requestedLimit = Math.min(requestedLimit, max);
  const totalMatched = ordered.length;
  const page = ordered.slice(offset, offset + requestedLimit);
  const serializer = resolvedDetail === 'full' ? serializeTaskFull : serializeTaskSummary;
  return {
    tasks: page.map(serializer),
    totalMatched,
    offset,
    returnedCount: page.length,
    hasMore: offset + page.length < totalMatched,
    detail: resolvedDetail,
    ...(totalMatched > 10 && resolvedDetail !== 'full' ? {
      fullDetailsHint: 'Full details are available for at most 10 tasks per call. Request the IDs you want in groups of up to 10.'
    } : {})
  };
}

function taxonomyCounts(type, entityId) {
  const isProject = type === 'project';
  const descendants = isProject ? AppState.getProjectDescendantIds(entityId) : AppState.getTagDescendantIds(entityId);
  const tree = new Set([entityId, ...descendants]);
  const direct = AppState.tasks.filter(task => {
    if (task.completed) return false;
    return isProject ? task.project === entityId : (task.tags || []).includes(entityId);
  }).length;
  const total = AppState.tasks.filter(task => {
    if (task.completed) return false;
    return isProject ? tree.has(task.project) : (task.tags || []).some(id => tree.has(id));
  }).length;
  return { activeDirectTaskCount: direct, activeTreeTaskCount: total };
}

export function listTaxonomy(type, args = {}) {
  const normalizedType = type === 'tag' ? 'tag' : 'project';
  const { offset, limit } = normalizePagination(args, { defaultLimit: 25, maxLimit: 50 });
  let flattened = TaxonomyOrder.flattenTree(normalizedType);
  if (args.ids != null) {
    const ids = normalizeIdArray(args.ids, 'ids', { max: 50 });
    const wanted = new Set(ids);
    flattened = flattened.filter(row => wanted.has(row.item.id));
  }
  if (args.query != null) {
    const query = normalizeQuery(args.query).toLocaleLowerCase();
    flattened = flattened.filter(row => String(row.item.name || '').toLocaleLowerCase().includes(query));
  }
  const totalMatched = flattened.length;
  const page = flattened.slice(offset, offset + limit);
  const includeCounts = args.includeCounts === true;
  const items = page.map(({ item, depth }) => ({
    id: item.id,
    name: item.name,
    icon: item.icon || '●',
    parentId: item.parentId || null,
    viewType: item.viewType === 'kanban' ? 'kanban' : 'list',
    depth,
    childrenIds: TaxonomyOrder.getChildren(normalizedType, item.id).map(child => child.id),
    customSiblingIndex: TaxonomyOrder.getSiblingIds(normalizedType, item.parentId || null).indexOf(item.id),
    ...(includeCounts ? taxonomyCounts(normalizedType, item.id) : {})
  }));
  return {
    items,
    totalMatched,
    offset,
    returnedCount: items.length,
    hasMore: offset + items.length < totalMatched
  };
}

export function currentViewTaskIds(limit = 100) {
  return currentViewOrder().slice(0, Math.max(1, limit)).map(task => task.id);
}

export function makeTreeLines(items, { idKey = 'id', parentKey = 'parentId', labelKey = 'name', max = 30 } = {}) {
  const rows = items.slice(0, max);
  const byParent = new Map();
  rows.forEach(item => {
    const parent = item[parentKey] || null;
    if (!byParent.has(parent)) byParent.set(parent, []);
    byParent.get(parent).push(item);
  });
  const output = [];
  const walk = (parentId, prefix) => {
    const children = byParent.get(parentId) || [];
    children.forEach((item, index) => {
      const last = index === children.length - 1;
      output.push(`${prefix}${last ? '└─' : '├─'} ${item[labelKey] || 'Item'} [${item[idKey]}]`);
      walk(item[idKey], `${prefix}${last ? '   ' : '│  '}`);
    });
  };
  walk(null, '');
  return output.join('\n');
}
