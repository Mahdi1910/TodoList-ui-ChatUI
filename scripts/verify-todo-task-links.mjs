import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');
const asDataUrl = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
const importSource = async source => import(asDataUrl(source));

const taskLinksSource = await read('TodoList-ui/js/task-links.js');
const { TaskLinks } = await importSource(taskLinksSource);

assert.equal(TaskLinks.tokenFor('task-abc-123'), '[[task:task-abc-123]]');
assert.throws(() => TaskLinks.tokenFor('abc-123'), /invalid/i);

const parsed = TaskLinks.parseTitle('Shower after [[task:task-training]] please');
assert.deepEqual(parsed, [
  { type: 'text', text: 'Shower after ' },
  { type: 'task', taskId: 'task-training', raw: '[[task:task-training]]' },
  { type: 'text', text: ' please' }
]);
assert.deepEqual(TaskLinks.extractTaskIds('[[task:task-a]] and [[task:task-a]] plus [[task:task-b]]'), ['task-a', 'task-b']);

for (const ordinary of [
  'task-a',
  '[task:task-a]',
  '[[task:abc]]',
  '[[task: task-a]]',
  '[[todo:task-a]]',
  '[[task:task-a]'
]) {
  assert.deepEqual(TaskLinks.extractTaskIds(ordinary), [], `${ordinary} must remain ordinary title text`);
}

const displayTasks = [
  { id: 'task-a', title: 'Morning training' },
  { id: 'task-b', title: 'Shower after [[task:task-a]]' }
];
assert.equal(
  TaskLinks.displayTitleText('Shower after [[task:task-a]]', displayTasks),
  'Shower after Morning training'
);
displayTasks[0].title = 'Evening training';
assert.equal(
  TaskLinks.displayTitleText('Shower after [[task:task-a]]', displayTasks),
  'Shower after Evening training',
  'Display labels must resolve the referenced task by ID at render time'
);
assert.equal(TaskLinks.displayTitleText('Follow [[task:task-missing]]', displayTasks), 'Follow Missing task');

const oneWayPair = [
  { id: 'task-a', title: 'A [[task:task-b]]', completed: false },
  { id: 'task-b', title: 'B', completed: false }
];
assert.deepEqual(TaskLinks.activeLinkedComponentIds('task-a', oneWayPair), ['task-a', 'task-b']);
assert.deepEqual(TaskLinks.activeLinkedComponentIds('task-b', oneWayPair), ['task-b', 'task-a'],
  'A one-way title token must create a bidirectional completion relationship');

const group = [
  { id: 'task-a', title: 'A [[task:task-b]]', completed: false },
  { id: 'task-b', title: 'B [[task:task-c]]', completed: false },
  { id: 'task-c', title: 'C', completed: false }
];
assert.deepEqual(TaskLinks.activeLinkedComponentIds('task-a', group), ['task-a', 'task-b', 'task-c']);
group[1].completed = true;
assert.deepEqual(TaskLinks.activeLinkedComponentIds('task-a', group), ['task-a'],
  'Already-completed historical tasks must not bridge a new completion cascade');

const taskLinksUrl = asDataUrl(taskLinksSource);
const completionSource = (await read('TodoList-ui/js/task-link-completion.js'))
  .replace("import { TaskLinks } from './task-links.js';", `const { TaskLinks } = await import('${taskLinksUrl}');`);
const { installTaskLinkCompletion } = await importSource(completionSource);

function createMockRuntime({ startFrom = 'task-a' } = {}) {
  const tasks = [
    {
      id: 'task-a',
      title: 'Daily A [[task:task-b]]',
      completed: false,
      repeat: { mode: 'daily' }
    },
    {
      id: 'task-b',
      title: 'One-time B',
      completed: false,
      repeat: null
    }
  ];
  const state = {
    tasks,
    getTask(id) { return tasks.find(task => task.id === id) || null; }
  };
  let nextCounter = 0;
  const completionCalls = [];
  const service = {
    async toggleTaskStatus(id) {
      const task = state.getTask(id);
      if (!task) throw new Error('Task not found.');
      completionCalls.push(id);
      task.completed = !task.completed;
      if (task.completed && task.repeat) {
        nextCounter += 1;
        tasks.push({
          ...task,
          id: `task-a-next-${nextCounter}`,
          completed: false
        });
      }
      return task;
    }
  };
  installTaskLinkCompletion(service, state);
  return { tasks, state, service, completionCalls, startFrom };
}

{
  const runtime = createMockRuntime({ startFrom: 'task-a' });
  await runtime.service.toggleTaskStatus(runtime.startFrom);
  assert.equal(runtime.state.getTask('task-a').completed, true);
  assert.equal(runtime.state.getTask('task-b').completed, true);
  assert.equal(runtime.state.getTask('task-a-next-1').completed, false,
    'The next Repeat occurrence must not join the already-snapshotted completion cascade');
  assert.deepEqual(runtime.completionCalls, ['task-a', 'task-b']);

  await runtime.service.toggleTaskStatus('task-a');
  assert.equal(runtime.state.getTask('task-a').completed, false);
  assert.equal(runtime.state.getTask('task-b').completed, true,
    'Uncompleting one historical task must not uncomplete its linked partner');
}

{
  const runtime = createMockRuntime({ startFrom: 'task-b' });
  await runtime.service.toggleTaskStatus(runtime.startFrom);
  assert.equal(runtime.state.getTask('task-b').completed, true);
  assert.equal(runtime.state.getTask('task-a').completed, true,
    'Completing the referenced side must complete the task containing the token too');
  assert.equal(runtime.state.getTask('task-a-next-1').completed, false);
  assert.deepEqual(runtime.completionCalls, ['task-b', 'task-a']);
}

{
  const tasks = [
    { id: 'task-parent', title: 'Parent', completed: false },
    { id: 'task-child', title: 'Child [[task:task-friend]]', completed: false, parentTaskId: 'task-parent' },
    { id: 'task-friend', title: 'Friend', completed: false }
  ];
  const state = {
    tasks,
    getTask(id) { return tasks.find(task => task.id === id) || null; }
  };
  const completionCalls = [];
  const service = {
    async toggleTaskStatus(id) {
      const task = state.getTask(id);
      if (!task) throw new Error('Task not found.');
      completionCalls.push(id);
      task.completed = !task.completed;
      if (id === 'task-parent' && task.completed) state.getTask('task-child').completed = true;
      return task;
    }
  };
  installTaskLinkCompletion(service, state);
  await service.toggleTaskStatus('task-parent');
  assert.equal(state.getTask('task-child').completed, true);
  assert.equal(state.getTask('task-friend').completed, true,
    'A subtask completed as a parent side effect must still propagate its task link');
  assert.deepEqual(completionCalls, ['task-parent', 'task-friend']);
}

const actions = await read('TodoList-ui/js/components/task-actions.js');
assert.match(actions, /data\.taskAction = 'copy-link'/);
assert.match(actions, /TaskLinks\.tokenFor\(task\.id\)/);
assert.match(actions, /navigator\.clipboard\?\.writeText/);

const renderer = await read('TodoList-ui/js/components/task-renderer.js');
assert.match(renderer, /TaskLinks\.parseTitle/);
assert.match(renderer, /task-title-link/);
assert.match(renderer, /openLinkedTask/);
assert.doesNotMatch(renderer, /title\.innerHTML\s*=\s*normalized\.title/,
  'User task titles must never be injected as HTML');

assert.match(completionSource, /const snapshotTasks =/);
assert.match(completionSource, /discoverLinksFromNewCompletions/);

const appMain = await read('TodoList-ui/js/app-main.js');
assert.match(appMain, /installTaskLinkCompletion\(AppDataService, AppState\)/);

console.log('Todo task-link token, rendering, repeat-snapshot, and completion verification passed.');
