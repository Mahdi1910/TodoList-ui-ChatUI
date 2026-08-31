import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeAfter,
  normalizeTaskCreateInput,
  normalizeTaskUpdateInput
} from '../TodoList-ui/js/tools/todo-tool-normalizers.js';
import {
  captureTodoTaskSnapshot,
  enrichTodoToolResult
} from '../TodoList-ui/js/tools/todo-tool-result-enricher.js';

function expectInvalid(work, pattern) {
  let error = null;
  try { work(); } catch (caught) { error = caught; }
  assert(error, 'Expected validation to fail.');
  if (pattern) assert.match(String(error.message || error), pattern);
}

assert.deepEqual(normalizeAfter({
  taskId: 'task-training',
  hours: 1,
  minutes: 10
}), {
  taskId: 'task-training',
  hours: 1,
  minutes: 10
});
expectInvalid(() => normalizeAfter({ taskId: 'task-training', hours: 0, minutes: 0 }), /at least 1 minute/i);
expectInvalid(() => normalizeAfter({ taskId: 'task-training', hours: 25, minutes: 0 }), /0 to 24/i);
expectInvalid(() => normalizeAfter({ taskId: 'task-training', hours: 0, minutes: 60 }), /0 to 59/i);
expectInvalid(() => normalizeAfter({
  taskId: 'task-training',
  hours: 0,
  minutes: 20,
  resolvedAt: '2026-08-30T12:00:00.000Z'
}), /read-only/i);

const created = normalizeTaskCreateInput({
  title: 'Shower',
  after: { taskId: 'task-training', hours: 0, minutes: 20 }
});
assert.deepEqual(created.taskData.after, { taskId: 'task-training', hours: 0, minutes: 20 });

const current = {
  id: 'task-shower',
  title: 'Shower',
  dueDate: null,
  dueTime: null,
  repeat: null,
  after: { taskId: 'task-training', hours: 0, minutes: 20, resolvedAt: null }
};
const cleared = normalizeTaskUpdateInput(current, { id: 'task-shower', after: null });
assert.equal(Object.prototype.hasOwnProperty.call(cleared.patch, 'after'), true);
assert.equal(cleared.patch.after, null);

const before = [
  {
    id: 'task-a',
    title: 'Daily A [[task:task-b]]',
    completed: false,
    dueDate: '2026-08-30',
    dueTime: '08:00 AM',
    after: null
  },
  {
    id: 'task-b',
    title: 'One-time B',
    completed: false,
    dueDate: null,
    dueTime: null,
    after: null
  },
  {
    id: 'task-c',
    title: 'C after B',
    completed: false,
    dueDate: null,
    dueTime: null,
    after: { taskId: 'task-b', hours: 0, minutes: 10, resolvedAt: null }
  }
];
const after = [
  {
    id: 'task-a',
    title: 'Daily A [[task:task-b]]',
    completed: true,
    completedAt: '2026-08-30T12:00:00.000Z',
    dueDate: '2026-08-30',
    dueTime: '08:00 AM',
    after: null
  },
  {
    id: 'task-b',
    title: 'One-time B',
    completed: true,
    completedAt: '2026-08-30T12:00:01.000Z',
    dueDate: null,
    dueTime: null,
    after: null
  },
  {
    id: 'task-c',
    title: 'C after B',
    completed: false,
    completedAt: null,
    dueDate: '2026-08-30',
    dueTime: '12:10 PM',
    after: { taskId: 'task-b', hours: 0, minutes: 10, resolvedAt: '2026-08-30T12:00:01.000Z' }
  },
  {
    id: 'task-a-next',
    title: 'Daily A [[task:task-b]]',
    completed: false,
    completedAt: null,
    dueDate: '2026-08-31',
    dueTime: '08:00 AM',
    after: null
  }
];
const result = {
  ok: true,
  data: {
    items: [{
      inputIndex: 0,
      id: 'task-a',
      finalTask: {
        id: 'task-a',
        title: 'Daily A [[task:task-b]]',
        completed: true,
        dueDate: '2026-08-30',
        dueTime: '08:00 AM'
      }
    }]
  },
  meta: { mutationOccurred: true }
};

enrichTodoToolResult({
  functionName: 'todo_update_tasks',
  args: { tasks: [{ id: 'task-a', completed: true }] },
  result,
  beforeTasks: captureTodoTaskSnapshot(before),
  currentTasks: after
});

assert.equal(result.data.items[0].finalTask.title, 'Daily A [[task:task-b]]', 'raw task title must remain authoritative');
assert.equal(result.data.items[0].finalTask.displayTitle, 'Daily A One-time B');
assert.equal(result.data.items[0].finalTask.completedAt, '2026-08-30T12:00:00.000Z');
assert.equal(result.data.items[0].finalTask.after, null);
assert.deepEqual(result.data.todoSideEffects.completedTaskIds, ['task-a', 'task-b']);
assert.deepEqual(result.data.todoSideEffects.linkedCompletedTaskIds, ['task-b']);
assert.deepEqual(result.data.todoSideEffects.createdRepeatOccurrenceIds, ['task-a-next']);
assert.deepEqual(result.data.todoSideEffects.scheduleChangedTaskIds, ['task-c']);
assert.deepEqual(result.data.todoSideEffects.afterResolvedTaskIds, ['task-c']);
assert.deepEqual(result.data.todoSideEffects.afterRewiredTaskIds, []);

const readResult = {
  ok: true,
  data: {
    tasks: [{
      id: 'task-c',
      title: 'C after B',
      completed: false,
      dueDate: '2026-08-30',
      dueTime: '12:10 PM'
    }]
  },
  meta: { mutationOccurred: false }
};
enrichTodoToolResult({
  functionName: 'todo_find_tasks',
  result: readResult,
  currentTasks: after
});
assert.deepEqual(readResult.data.tasks[0].after, {
  taskId: 'task-b',
  hours: 0,
  minutes: 10,
  resolvedAt: '2026-08-30T12:00:01.000Z'
});
assert.equal(readResult.data.tasks[0].completedAt, null);
assert.equal(readResult.data.tasks[0].displayTitle, 'C after B');

const rewiredBefore = captureTodoTaskSnapshot([
  { id: 'task-root', title: 'Root', completed: false, after: null },
  { id: 'task-skip', title: 'Skip', completed: false, after: { taskId: 'task-root', hours: 0, minutes: 20, resolvedAt: null } },
  { id: 'task-downstream', title: 'Downstream', completed: false, after: { taskId: 'task-skip', hours: 0, minutes: 7, resolvedAt: null } }
]);
const rewiredCurrent = [
  { id: 'task-root', title: 'Root', completed: false, after: null },
  { id: 'task-skip', title: 'Skip', completed: true, completedAt: '2026-08-30T12:00:00.000Z', after: null },
  { id: 'task-downstream', title: 'Downstream', completed: false, after: { taskId: 'task-root', hours: 0, minutes: 7, resolvedAt: null } }
];
const rewiredResult = { ok: true, data: { items: [{ inputIndex: 0, id: 'task-skip', finalTask: { id: 'task-skip', title: 'Skip' } }] }, meta: { mutationOccurred: true } };
enrichTodoToolResult({
  functionName: 'todo_update_tasks',
  args: { tasks: [{ id: 'task-skip', completed: true }] },
  result: rewiredResult,
  beforeTasks: rewiredBefore,
  currentTasks: rewiredCurrent
});
assert.deepEqual(rewiredResult.data.todoSideEffects.afterRewiredTaskIds, ['task-downstream']);
assert.deepEqual(rewiredResult.data.todoSideEffects.scheduleChangedTaskIds, ['task-downstream']);

const definitions = await readFile(new URL('../ChatUI/js/todo/todo-tool-definitions.js', import.meta.url), 'utf8');
assert.match(definitions, /const AFTER =/);
assert.match(definitions, /after:\s*\{ \.\.\.AFTER, nullable: true/);
assert.match(definitions, /\[\[task:<ID>\]\]/);
assert.match(definitions, /displayTitle/);
assert.match(definitions, /linked tasks/i);

const serviceAfter = await readFile(new URL('../TodoList-ui/js/storage/data-service-after.js', import.meta.url), 'utf8');
assert.match(serviceAfter, /if \(!afterSpecified && touchesAbsoluteSchedule\) after = null;/,
  'Absolute scheduling without After must continue to clear an existing dependency in Todo itself.');
assert.match(serviceAfter, /wouldCreateCycle/,
  'After cycle prevention must remain owned by Todo, not ChatUI.');

console.log('ChatUI Todo After/task-link exposure verification passed.');
