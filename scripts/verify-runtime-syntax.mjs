import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const ROOTS = ['ChatUI', 'TodoList-ui', 'shell', 'diary'];
const EXTENSIONS = new Set(['.js', '.mjs']);

function collectFiles(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectFiles(full, output);
      continue;
    }
    if (entry.isFile() && EXTENSIONS.has(path.extname(entry.name))) output.push(full);
  }
  return output;
}

const files = ROOTS.flatMap(root => collectFiles(root)).sort();
if (!files.length) throw new Error('No runtime JavaScript files were found.');

const failures = [];
for (const file of files) {
  const result = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (result.status !== 0) {
    failures.push(`${file}\n${result.stderr || result.stdout || 'Unknown syntax error'}`);
  }
}

if (failures.length) {
  console.error(failures.join('\n\n'));
  process.exit(1);
}

console.log(`Runtime JavaScript syntax verification passed for ${files.length} files.`);
