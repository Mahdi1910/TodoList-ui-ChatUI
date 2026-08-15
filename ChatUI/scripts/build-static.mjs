import { cp, copyFile, mkdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const dist = path.join(root, 'dist');
const requiredEntries = ['index.html', 'css', 'html', 'js'];

async function ensureExists(relativePath) {
  try {
    await stat(path.join(root, relativePath));
  } catch {
    throw new Error(`Required application asset is missing: ${relativePath}`);
  }
}

await Promise.all(requiredEntries.map(ensureExists));
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });

await copyFile(path.join(root, 'index.html'), path.join(dist, 'index.html'));
for (const directory of ['css', 'html', 'js']) {
  await cp(path.join(root, directory), path.join(dist, directory), { recursive: true });
}

console.log('Built safe Cloudflare asset bundle in dist/: index.html, css/, html/, js/');
