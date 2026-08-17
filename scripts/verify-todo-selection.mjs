import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseDueTimeMinutes, sortTasksByDueDate } from '../TodoList-ui/js/components/task-sort-utils.js';

assert.equal(parseDueTimeMinutes('12:00 AM'), 0);
assert.equal(parseDueTimeMinutes('01:00 AM'), 60);
assert.equal(parseDueTimeMinutes('11:59 AM'), 719);
assert.equal(parseDueTimeMinutes('12:00 PM'), 720);
assert.equal(parseDueTimeMinutes('12:18 PM'), 738);
assert.equal(parseDueTimeMinutes('03:57 PM'), 957);
assert.equal(parseDueTimeMinutes('11:59 PM'), 1439);
assert.equal(parseDueTimeMinutes(''), null);
assert.equal(parseDueTimeMinutes('99:77 PM'), null);
assert.equal(parseDueTimeMinutes('not-a-time'), null);

const sameDay = [
  { id: 'a', dueDate: '2026-08-17', dueTime: '03:57 PM' },
  { id: 'b', dueDate: '2026-08-17', dueTime: '12:18 PM' },
  { id: 'c', dueDate: '2026-08-17', dueTime: '08:15 PM' },
  { id: 'd', dueDate: '2026-08-17', dueTime: null },
  { id: 'e', dueDate: '2026-08-17', dueTime: 'bad legacy value' },
  { id: 'f', dueDate: null, dueTime: null }
];
assert.deepEqual(
  sortTasksByDueDate(sameDay, 'asc').map(task => task.id),
  ['d', 'e', 'b', 'a', 'c', 'f'],
  'Ascending due-date sort must use real clock time, preserve the date-only bucket first, and keep No Date last.'
);
assert.deepEqual(
  sortTasksByDueDate(sameDay, 'desc').map(task => task.id),
  ['c', 'a', 'b', 'd', 'e', 'f'],
  'Descending due-date sort must reverse dated/time order while keeping No Date last.'
);

const dates = [
  { id: 'early', dueDate: '2026-08-01', dueTime: '11:59 PM' },
  { id: 'late', dueDate: '2026-08-20', dueTime: '12:00 AM' },
  { id: 'none', dueDate: null, dueTime: null }
];
assert.deepEqual(sortTasksByDueDate(dates, 'asc').map(task => task.id), ['early', 'late', 'none']);
assert.deepEqual(sortTasksByDueDate(dates, 'desc').map(task => task.id), ['late', 'early', 'none']);

const [selection, actions, menus, coordinator, appMain, css] = await Promise.all([
  readFile('TodoList-ui/js/components/task-selection.js', 'utf8'),
  readFile('TodoList-ui/js/components/task-selection-actions.js', 'utf8'),
  readFile('TodoList-ui/js/components/task-selection-menus.js', 'utf8'),
  readFile('TodoList-ui/js/tools/todo-mutation-coordinator.js', 'utf8'),
  readFile('TodoList-ui/js/app-main.js', 'utf8'),
  readFile('TodoList-ui/css/components/task-selection.css', 'utf8')
]);

assert(selection.includes('selectedTaskIds: new Set()'), 'Selection must have one central Set of task IDs.');
assert(selection.includes('selection-container-checkbox'), 'Container selection circles are missing.');
assert(selection.includes('event.stopImmediatePropagation()'), 'Select mode must intercept the existing task completion event path.');
assert(selection.includes('aria-pressed'), 'Task-body keyboard selection state is missing.');
assert(selection.includes('cancelPendingTaskDrag') && selection.includes('cancelPendingTouchDrag'), 'Select mode must cancel pending drag gestures.');
assert(actions.includes('TodoMutationCoordinator.acquireManual'), 'Manual multi-select batches must use the Todo mutation coordinator.');
assert(actions.includes('Subtasks inherit their parent Project.'), 'Project/subtask inheritance protection is missing.');
assert(actions.includes('repeat?.end') || actions.includes("repeat?.end"), 'Bulk Date repeat-end validation is missing.');
assert(menus.includes("'Done'") && menus.includes("'Date'") && menus.includes("'Priority'"), 'First action row is incomplete.');
assert(menus.includes("'Tags'") && menus.includes("'Project'") && menus.includes("'Delete'"), 'Second action row is incomplete.');
assert(menus.includes('Link Parent Task'), 'Link Parent Task text action is missing.');
assert(!menus.includes('Pin'), 'Pin must not be added.');
assert(coordinator.includes('TODO_BUSY') && coordinator.includes('tryAcquireAi'), 'Todo AI/manual mutation coordination is missing.');
assert(appMain.includes('TaskSelectionController.install') && appMain.includes('installTodoToolMutationCoordination'), 'Todo startup wiring is incomplete.');
assert(css.includes('.task-selection-mode .task-checkbox:checked') && css.includes('var(--accent-color)'), 'Select-mode circle must keep the same shape with accent selection styling.');
assert(css.includes('.bulk-date-only #tab-sched-time'), 'Bulk Date must hide non-date scheduling controls.');

console.log('Todo due-date sort + multi-select static verification passed.');
