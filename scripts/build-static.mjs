import { cp, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const dist = path.join(root, 'dist');

const runtimeEntries = [
  'index.html',
  'shell',
  'ChatUI/index.html',
  'ChatUI/css',
  'ChatUI/html',
  'ChatUI/js',
  'TodoList-ui/index.html',
  'TodoList-ui/css',
  'TodoList-ui/html',
  'TodoList-ui/js'
];

async function exists(target) {
  try { await stat(target); return true; }
  catch (_) { return false; }
}

async function copyEntry(relative) {
  const source = path.join(root, relative);
  if (!(await exists(source))) throw new Error(`Required runtime entry is missing: ${relative}`);
  const destination = path.join(dist, relative);
  await mkdir(path.dirname(destination), { recursive: true });
  await cp(source, destination, { recursive: true, force: true });
}

await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
for (const entry of runtimeEntries) await copyEntry(entry);

console.log(`Built combined static application at ${dist}`);
console.log('Runtime allow-list only: agent notes, implementation plans, repository metadata, backups, and local server files were not copied.');
