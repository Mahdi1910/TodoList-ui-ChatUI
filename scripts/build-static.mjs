import { cp, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const runtimeEntries = [
  'index.html',
  'shell',
  'ChatUI/index.html',
  'ChatUI/embedded.html',
  'ChatUI/css',
  'ChatUI/html',
  'ChatUI/js',
  'TodoList-ui/index.html',
  'TodoList-ui/css',
  'TodoList-ui/js',
  'diary/index.html',
  'diary/css',
  'diary/src'
];

async function ensureExists(relativePath) {
  try { await stat(path.join(root, relativePath)); }
  catch { throw new Error(`Required runtime asset is missing: ${relativePath}`); }
}

await Promise.all(runtimeEntries.map(ensureExists));
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await copyFile(path.join(root, 'index.html'), path.join(dist, 'index.html'));
await cp(path.join(root, 'shell'), path.join(dist, 'shell'), { recursive: true });

for (const app of ['ChatUI', 'TodoList-ui', 'diary']) await mkdir(path.join(dist, app), { recursive: true });

await copyFile(path.join(root, 'ChatUI', 'index.html'), path.join(dist, 'ChatUI', 'index.html'));
await copyFile(path.join(root, 'ChatUI', 'embedded.html'), path.join(dist, 'ChatUI', 'embedded.html'));
for (const directory of ['css', 'html', 'js']) await cp(path.join(root, 'ChatUI', directory), path.join(dist, 'ChatUI', directory), { recursive: true });

await copyFile(path.join(root, 'TodoList-ui', 'index.html'), path.join(dist, 'TodoList-ui', 'index.html'));
for (const directory of ['css', 'js']) await cp(path.join(root, 'TodoList-ui', directory), path.join(dist, 'TodoList-ui', directory), { recursive: true });

await copyFile(path.join(root, 'diary', 'index.html'), path.join(dist, 'diary', 'index.html'));
for (const directory of ['css', 'src']) await cp(path.join(root, 'diary', directory), path.join(dist, 'diary', directory), { recursive: true });

console.log('Built combined runtime in dist/ using an explicit allow-list.');
