import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const checks = [
  'scripts/verify-runtime-syntax.mjs',
  'scripts/verify-runtime-module-graph.mjs',
  'scripts/verify-chatui-state-races.mjs',
  'scripts/verify-gemini-streaming-fixtures.mjs',
  'scripts/verify-todo-bridge-behavior.mjs',
  'scripts/verify-chatui-backup-restore.mjs',
  'scripts/verify-workspace-zip-security.mjs',
  'scripts/verify-chatui-markdown-security.mjs',
  'scripts/verify-chatui-plan7.mjs',
  'scripts/verify-chatui-plan8.mjs',
  'scripts/verify-chatui-plan9.mjs',
  'scripts/verify-chatui-plan10.mjs',
  'scripts/verify-chatui-plan11.mjs',
  'scripts/verify-chatui-plan12.mjs',
  'scripts/verify-chatui-plan13.mjs',
  'scripts/verify-chatui-plan14.mjs',
  'scripts/verify-chatui-plan15.mjs',
  'scripts/verify-chatui-plan16.mjs',
  'scripts/verify-todo-tools.mjs',
  'scripts/verify-todo-after-duration.mjs',
  'scripts/verify-todo-task-links.mjs',
  'scripts/verify-file-uri-recovery.mjs',
  'scripts/verify-integration.mjs'
];

for (const script of checks) {
  if (!fs.existsSync(script)) throw new Error(`Required regression check is missing: ${script}`);
  console.log(`\n=== ${script} ===`);
  const result = spawnSync(process.execPath, [script], { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`Regression check failed: ${script}`);
    process.exit(result.status || 1);
  }
}

console.log(`\nCanonical ChatUI regression suite passed (${checks.length} checks).`);
