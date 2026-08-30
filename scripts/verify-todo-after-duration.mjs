import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = path => readFile(path, 'utf8');
const importSource = async source => import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);

const taskAfterSource = await read('TodoList-ui/js/task-after.js');
const { TaskAfter } = await importSource(taskAfterSource);

const combined = TaskAfter.validate({
  taskId: 'training',
  hours: 1,
  minutes: 10,
  resolvedAt: null
});
assert.equal(combined.valid, true);
assert.deepEqual(combined.after, {
  taskId: 'training',
  hours: 1,
  minutes: 10,
  resolvedAt: null
});
assert.equal(TaskAfter.delayMilliseconds(combined.after), 70 * 60 * 1000);
assert.equal(TaskAfter.formatDelay(combined.after), '1 hour 10 minutes');
assert.equal(TaskAfter.formatDelay({ taskId: 'training', hours: 2, minutes: 3 }), '2 hours 3 minutes');
assert.equal(TaskAfter.formatDelay({ taskId: 'training', hours: 0, minutes: 20 }), '20 minutes');
assert.equal(TaskAfter.formatDelay({ taskId: 'training', hours: 1, minutes: 0 }), '1 hour');

const legacyMinutes = TaskAfter.normalize({ taskId: 'training', amount: 20, unit: 'minute' });
assert.deepEqual(legacyMinutes, { taskId: 'training', hours: 0, minutes: 20, resolvedAt: null });
const legacyHours = TaskAfter.normalize({ taskId: 'training', amount: 2, unit: 'hour' });
assert.deepEqual(legacyHours, { taskId: 'training', hours: 2, minutes: 0, resolvedAt: null });
const legacySixtyMinutes = TaskAfter.normalize({ taskId: 'training', amount: 60, unit: 'minute' });
assert.deepEqual(legacySixtyMinutes, { taskId: 'training', hours: 1, minutes: 0, resolvedAt: null });

assert.equal(TaskAfter.validate({ taskId: 'training', hours: 0, minutes: 0 }).valid, false);
assert.equal(TaskAfter.validate({ taskId: 'training', hours: 25, minutes: 0 }).valid, false);
assert.equal(TaskAfter.validate({ taskId: 'training', hours: 0, minutes: 60 }).valid, false);
assert.equal(TaskAfter.sameSpec(
  { taskId: 'training', hours: 1, minutes: 10 },
  { taskId: 'training', amount: 70, unit: 'minute' }
), true);

const chain = [
  { id: 'training', after: null },
  { id: 'shower', after: { taskId: 'training', hours: 0, minutes: 20 } },
  { id: 'banana', after: { taskId: 'shower', hours: 0, minutes: 10 } }
];
assert.equal(TaskAfter.wouldCreateCycle('training', 'banana', chain), true);
assert.equal(TaskAfter.wouldCreateCycle('banana', 'training', chain), false);

const scheduleAfter = await read('TodoList-ui/js/components/schedule-after.js');
assert.match(scheduleAfter, /<span>Mode<\/span><span>Hours<\/span><span>Minutes<\/span>/);
assert.match(scheduleAfter, /id="wheel-after-hours"/);
assert.match(scheduleAfter, /id="wheel-after-minutes"/);
assert.match(scheduleAfter, /hours: 0, minutes: 0/);
assert.match(scheduleAfter, /TaskAfter\.MAX_HOURS \+ 1/);
assert.match(scheduleAfter, /TaskAfter\.MAX_MINUTES \+ 1/);
assert.doesNotMatch(scheduleAfter, /wheel-after-unit/);
assert.doesNotMatch(scheduleAfter, /wheel-after-amount/);

const schedule = await read('TodoList-ui/js/components/schedule.js');
assert.match(schedule, /draftAfter: null, \/\/ \{ taskId, hours, minutes, resolvedAt \}/);
assert.match(schedule, /wheelAfterHours/);
assert.doesNotMatch(schedule, /wheelAfterAmount/);

const wheelCss = await read('TodoList-ui/css/components/schedule-wheels.css');
const timeContainerRule = wheelCss.match(/\.time-picker-container\s*\{([^}]*)\}/s)?.[1] || '';
const afterContainerRule = wheelCss.match(/\.after-wheels-container\s*\{([^}]*)\}/s)?.[1] || '';
assert.match(timeContainerRule, /height:\s*200px\s*;/);
assert.match(wheelCss, /\.wheel-item\s*\{[^}]*height:\s*40px\s*;/s);
assert.doesNotMatch(afterContainerRule, /height\s*:/, 'After must inherit the Time picker viewport height.');
assert.doesNotMatch(wheelCss, /\.after-wheels-container\s*\{[^}]*height:\s*160px\s*;/s);

const mappers = await read('TodoList-ui/js/storage/mappers.js');
assert.match(mappers, /afterHours: after\?\.hours \?\? null/);
assert.match(mappers, /afterMinutes: after\?\.minutes \?\? null/);
assert.match(mappers, /afterAmount/);
assert.match(mappers, /afterUnit/);

const backupValidation = await read('TodoList-ui/js/storage/backup-validation.js');
assert.match(backupValidation, /afterHours/);
assert.match(backupValidation, /afterMinutes/);
assert.match(backupValidation, /afterAmount/);
assert.match(backupValidation, /afterUnit/);

const schema = await read('TodoList-ui/js/storage/db-schema.js');
assert.match(schema, /const DATA_VERSION = 3;/);

console.log('Todo After combined-duration and wheel-alignment verification passed.');
