import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  normalizeRepeat,
  normalizeTaskUpdateInput,
  normalizeTaxonomyCreateInput,
  resolveFinalSchedule
} from '../TodoList-ui/js/tools/todo-tool-normalizers.js';
import { makeTreeLines } from '../TodoList-ui/js/tools/todo-tool-read-selectors.js';
import { todoMutationFingerprint } from '../ChatUI/js/todo/todo-mutation-replay-guard.js';
import {
  beginCustomToolGenerationContext,
  clearCustomToolGenerationContext,
  getCustomToolGenerationContext
} from '../ChatUI/js/tools/custom-tool-generation-context.js';

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

const defaultProject = normalizeTaxonomyCreateInput({ name: 'Project' }, 'Project');
const defaultTag = normalizeTaxonomyCreateInput({ name: 'Tag' }, 'Tag');
assert.equal(defaultProject.data.icon, '●', 'Project default icon must match the Todo UI/service default.');
assert.equal(defaultTag.data.icon, '●', 'Tag default icon must match the Todo UI/service default.');

const orphanPageTree = makeTreeLines([
  { id: 'child-1', parentId: 'parent-not-in-page', name: 'Child' }
]);
assert.match(orphanPageTree, /Child \[child-1\]/, 'Paginated taxonomy children must still appear in the informational tree.');

beginCustomToolGenerationContext({
  messages: [{ id: 'user-turn-1', role: 'user' }],
  generationId: 'generation-1',
  generationMode: 'regenerate'
});
assert.equal(getCustomToolGenerationContext().userTurnId, 'user-turn-1');
assert.equal(getCustomToolGenerationContext().generationMode, 'regenerate', 'Regenerate mode must be explicit, not inferred from assistant existence.');
clearCustomToolGenerationContext('generation-1');
assert.equal(getCustomToolGenerationContext().generationMode, 'normal');

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
const selectorSource = await readFile(new URL('../TodoList-ui/js/tools/todo-tool-read-selectors.js', import.meta.url), 'utf8');
const managerSource = await readFile(new URL('../shell/js/frame-manager.js', import.meta.url), 'utf8');
const normalizerSource = await readFile(new URL('../TodoList-ui/js/tools/todo-tool-normalizers.js', import.meta.url), 'utf8');
const streamingSource = await readFile(new URL('../ChatUI/js/chat/streaming.js', import.meta.url), 'utf8');
const regenerateSource = await readFile(new URL('../ChatUI/js/chat/regenerate.js', import.meta.url), 'utf8');
const todoBridgeSource = await readFile(new URL('../TodoList-ui/js/embedded/shell-bridge.js', import.meta.url), 'utf8');
const shellBridgeSource = await readFile(new URL('../shell/js/frame-bridge.js', import.meta.url), 'utf8');
assert(executorSource.includes('this._tail.then(work, work)'), 'Todo tool queue must recover after a previous rejected call.');
assert(executorSource.includes('this._tail = run.catch(() => {})'), 'Todo tool queue tail must stay recoverable.');
assert(executorSource.includes('failRunningStages(operations)'), 'Failed multi-stage Todo operations must label the attempted stage as failed.');
assert(executorSource.includes("const parentChanged = spec.parentSpecified && (current.parentId || null) !== targetParentId"), 'Repeating the same taxonomy parent must not reorder the entity to bottom.');
assert(executorSource.includes('const prePositionPatch = { ...remainingPatch }'), 'Hierarchy+position updates must apply safe sort-affecting fields before taking a Custom-order snapshot.');
assert(executorSource.includes('syncViewFromCurrentFilter?.();'), 'Workspace navigation must synchronize the new target view before applying a requested viewType.');
assert(managerSource.includes('record.readyPromise = null'), 'Shared frame readiness promise must clear after settlement.');
assert(!normalizerSource.includes('Object.protype'), 'Runtime Object.prototype typo must never return.');
assert(selectorSource.includes('const includeCounts = args.includeCounts !== false'), 'Project/Tag counts must default to included.');
assert(selectorSource.includes("resolvedDetail === 'full' && !exactIds && totalMatched > 10"), 'Broad full task reads over 10 matches must downgrade to summary.');
assert(selectorSource.includes('rowIds.has(rawParent)'), 'Paginated taxonomy tree output must promote missing-parent rows for display.');
assert(streamingSource.includes("generationMode = 'normal'"), 'Streaming must carry explicit custom-tool generation mode.');
assert(regenerateSource.includes("generationMode: 'regenerate'"), 'Regenerate must explicitly mark its tool generation mode.');
assert(todoBridgeSource.includes('Boolean(originalResult?.meta?.mutationOccurred)'), 'Todo oversized fallback must preserve committed mutation state.');
assert(shellBridgeSource.includes('Boolean(result?.meta?.mutationOccurred)'), 'Shell oversized fallback must preserve committed mutation state.');

console.log('Todo tool pure-JS verification passed.');
