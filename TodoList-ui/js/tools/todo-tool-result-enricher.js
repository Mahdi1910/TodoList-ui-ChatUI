import { TaskLinks } from '../task-links.js';

function own(object, key) {
  return Object.prototype.hasOwnProperty.call(object || {}, key);
}

function cloneAfter(after) {
  if (!after || typeof after !== 'object' || Array.isArray(after)) return null;
  const hours = Number(after.hours);
  const minutes = Number(after.minutes);
  return {
    taskId: typeof after.taskId === 'string' ? after.taskId : '',
    hours: Number.isInteger(hours) ? hours : 0,
    minutes: Number.isInteger(minutes) ? minutes : 0,
    resolvedAt: typeof after.resolvedAt === 'string' && after.resolvedAt ? after.resolvedAt : null
  };
}

function snapshotTask(task) {
  return {
    id: String(task?.id || ''),
    completed: Boolean(task?.completed),
    dueDate: task?.dueDate || null,
    dueTime: task?.dueTime || null,
    after: cloneAfter(task?.after)
  };
}

export function captureTodoTaskSnapshot(tasks = []) {
  return (tasks || []).filter(task => task?.id).map(snapshotTask);
}

function afterSignature(after) {
  const value = cloneAfter(after);
  return value ? JSON.stringify(value) : 'null';
}

function scheduleChanged(before, after) {
  return (before?.dueDate || null) !== (after?.dueDate || null) ||
    (before?.dueTime || null) !== (after?.dueTime || null) ||
    afterSignature(before?.after) !== afterSignature(after?.after);
}

function decorateTaskResult(taskResult, task, allTasks) {
  if (!taskResult || !task) return;
  taskResult.title = String(task.title || '');
  taskResult.displayTitle = TaskLinks.displayTitleText(task.title || '', allTasks);
  taskResult.completedAt = task.completedAt || null;
  taskResult.after = cloneAfter(task.after);
}

function decorateTaskResults(value, taskById, allTasks, seen = new WeakSet()) {
  if (!value || typeof value !== 'object') return;
  if (seen.has(value)) return;
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach(item => decorateTaskResults(item, taskById, allTasks, seen));
    return;
  }

  const id = typeof value.id === 'string' ? value.id : '';
  if (id && own(value, 'title') && taskById.has(id)) {
    decorateTaskResult(value, taskById.get(id), allTasks);
  }
  Object.values(value).forEach(item => decorateTaskResults(item, taskById, allTasks, seen));
}

function addId(output, value) {
  if (typeof value === 'string' && value) output.add(value);
}

function directCreateTaskIds(result) {
  const output = new Set();
  const data = result?.data;
  (Array.isArray(data?.items) ? data.items : []).forEach(item => addId(output, item?.id));
  (Array.isArray(data?.succeeded) ? data.succeeded : []).forEach(item => addId(output, item?.id));
  addId(output, data?.failed?.result?.data?.id);
  return output;
}

function directTaskIds(functionName, args, result) {
  if (functionName === 'todo_create_tasks') return directCreateTaskIds(result);
  const output = new Set();
  if (functionName === 'todo_update_tasks') {
    (Array.isArray(args?.tasks) ? args.tasks : []).forEach(task => addId(output, task?.id));
  }
  return output;
}

function observedTaskSideEffects(functionName, args, result, beforeTasks, currentTasks) {
  if (!['todo_create_tasks', 'todo_update_tasks'].includes(functionName)) return null;
  const beforeById = new Map((beforeTasks || []).filter(task => task?.id).map(task => [task.id, task]));
  const directIds = directTaskIds(functionName, args, result);

  const completedTaskIds = [];
  const createdTaskIds = [];
  const scheduleChangedTaskIds = [];
  const afterResolvedTaskIds = [];
  const afterRewiredTaskIds = [];

  for (const task of currentTasks || []) {
    if (!task?.id) continue;
    const before = beforeById.get(task.id) || null;
    if (!before) createdTaskIds.push(task.id);
    if (task.completed && !before?.completed) completedTaskIds.push(task.id);
    if (!before || directIds.has(task.id)) continue;

    const after = snapshotTask(task);
    if (scheduleChanged(before, after)) scheduleChangedTaskIds.push(task.id);

    const beforeAfter = cloneAfter(before.after);
    const currentAfter = cloneAfter(task.after);
    if (beforeAfter && !beforeAfter.resolvedAt && currentAfter?.resolvedAt) {
      afterResolvedTaskIds.push(task.id);
    }
    if (beforeAfter && !beforeAfter.resolvedAt) {
      const sourceChanged = (beforeAfter.taskId || null) !== (currentAfter?.taskId || null);
      const dependencyCleared = !currentAfter;
      if (sourceChanged || dependencyCleared) afterRewiredTaskIds.push(task.id);
    }
  }

  const createdRepeatOccurrenceIds = createdTaskIds.filter(id => !directIds.has(id));
  return {
    completedTaskIds,
    linkedCompletedTaskIds: completedTaskIds.filter(id => !directIds.has(id)),
    createdRepeatOccurrenceIds,
    scheduleChangedTaskIds,
    afterResolvedTaskIds,
    afterRewiredTaskIds
  };
}

export function enrichTodoToolResult({
  functionName = '',
  args = {},
  result = null,
  beforeTasks = [],
  currentTasks = []
} = {}) {
  if (!result || typeof result !== 'object') return result;
  if (result.__todoResultEnriched === true) return result;

  const taskById = new Map((currentTasks || []).filter(task => task?.id).map(task => [task.id, task]));
  decorateTaskResults(result.data, taskById, currentTasks || []);

  const sideEffects = observedTaskSideEffects(functionName, args, result, beforeTasks, currentTasks);
  if (sideEffects && result.data && typeof result.data === 'object') {
    result.data.todoSideEffects = sideEffects;
  }

  try {
    Object.defineProperty(result, '__todoResultEnriched', { value: true, enumerable: false });
  } catch (_) {}
  return result;
}
