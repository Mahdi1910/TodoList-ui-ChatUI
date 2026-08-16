import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeRepeat,
  normalizeTaskUpdateInput,
  resolveFinalSchedule
} from '../TodoList-ui/js/tools/todo-tool-normalizers.js';
import { todoMutationFingerprint } from '../ChatUI/js/todo/todo-mutation-replay-guard.js';

function expectInvalid(work, pattern) {
  let error = null;
  try { work(); } catch (caught) { error = caught; }
  assert(error, 'Expected validation to fail.');
  if (pattern) assert.match(String(error.message || error), pattern);
}

const baseTask = {
  id: 'task-1',
  title: 'Task',
  description: '',
  project: 'project-1',
  parentTaskId: 'parent-1',
  priority: '',
  tags: [],
  dueDate: null,
  dueTime: null,
  reminders: [],
  repeat: null,
  completed: false
};

const projectClear = normalizeTaskUpdateInput(baseTask, { id: 'task-1', projectId: null });
assert.equal(projectClear.projectSpecified, true);
assert.equal(projectClear.projectId, null);
assert.equal(projectClear.patch.project, '');

const timeOnly = resolveFinalSchedule(null, { dueTime: '05:30 PM' });
assert.equal(timeOnly.dueDate, new Date().toLocaleDateString('en-CA'));
assert.equal(timeOnly.scheduleResolution?.reason, 'time_requires_date');

const repeatOnly = resolveFinalSchedule(null, { repeat: { mode: 'daily', end: { type: 'never' } } });
assert.equal(repeatOnly.dueDate, new Date().toLocaleDateString('en-CA'));
assert.equal(repeatOnly.scheduleResolution?.reason, 'repeat_requires_date');

expectInvalid(() => resolveFinalSchedule(null, {
  dueDate: '2026-08-20',
  repeat: { mode: 'daily', end: { type: 'date', date: '2026-08-10' } }
}), /cannot be before/i);

expectInvalid(() => normalizeRepeat({
  mode: 'custom',
  custom: { interval: 1, unit: 'year', yearDates: [{ month: 2, days: [30] }] },
  end: { type: 'never' }
}), /impossible date/i);

const leap = normalizeRepeat({
  mode: 'custom',
  custom: { interval: 1, unit: 'year', yearDates: [{ month: 2, days: [29] }] },
  end: { type: 'never' }
});
assert.deepEqual(leap.custom.yearDates[1], [29]);

const fpA = todoMutationFingerprint('todo_create_tasks', {
  tasks: [{ title: 'A', tagIds: ['x', 'y'] }],
  duplicateConfirmationToken: 'one'
});
const fpB = todoMutationFingerprint('todo_create_tasks', {
  duplicateConfirmationToken: 'two',
  tasks: [{ tagIds: ['x', 'y'], title: 'A' }]
});
assert.equal(fpA, fpB, 'Confirmation token and object key order must not change replay identity.');
const fpOrder = todoMutationFingerprint('todo_create_tasks', { tasks: [{ title: 'B' }, { title: 'A' }] });
assert.notEqual(fpA, fpOrder, 'Ordered mutation arrays must remain order-sensitive.');

const executorSource = await readFile(new URL('../TodoList-ui/js/tools/todo-tool-executor.js', import.meta.url), 'utf8');
const managerSource = await readFile(new URL('../shell/js/frame-manager.js', import.meta.url), 'utf8');
const normalizerSource = await readFile(new URL('../TodoList-ui/js/tools/todo-tool-normalizers.js', import.meta.url), 'utf8');
assert(executorSource.includes('this._tail.then(work, work)'), 'Todo tool queue must recover after a previous rejected call.');
assert(executorSource.includes('this._tail = run.catch(() => {})'), 'Todo tool queue tail must stay recoverable.');
assert(managerSource.includes('record.readyPromise = null'), 'Shared frame readiness promise must clear after settlement.');
assert(!normalizerSource.includes('Object.protype'), 'Runtime Object.prototype typo must never return.');

console.log('Todo tool pure-JS verification passed.');
