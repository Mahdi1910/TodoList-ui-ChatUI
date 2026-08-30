import fs from 'node:fs';
import path from 'node:path';

const ROOTS = ['ChatUI', 'TodoList-ui', 'shell', 'diary'];
const JS_EXTENSIONS = new Set(['.js', '.mjs']);
const repoRoot = process.cwd();

function collectFiles(dir, output = []) {
  if (!fs.existsSync(dir)) return output;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collectFiles(full, output);
    else if (entry.isFile() && JS_EXTENSIONS.has(path.extname(entry.name))) output.push(full);
  }
  return output;
}

function localSpecifiers(source) {
  const specs = [];
  const patterns = [
    /\bimport\s+(?:[^'";]*?\s+from\s+)?['"]([^'"]+)['"]/g,
    /\bexport\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"]/g,
    /\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(source))) specs.push(match[1]);
  }
  return specs.filter(spec => spec.startsWith('.') || spec.startsWith('/'));
}

function resolveLocalImport(fromFile, rawSpecifier) {
  const specifier = rawSpecifier.split(/[?#]/, 1)[0];
  const base = specifier.startsWith('/')
    ? path.resolve(repoRoot, `.${specifier}`)
    : path.resolve(path.dirname(fromFile), specifier);

  const relative = path.relative(repoRoot, base);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return { ok: false, reason: 'escapes the repository root', resolved: base };
  }

  const candidates = [base];
  if (!path.extname(base)) candidates.push(`${base}.js`, `${base}.mjs`, path.join(base, 'index.js'), path.join(base, 'index.mjs'));
  const found = candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
  return found ? { ok: true, resolved: found } : { ok: false, reason: 'target does not exist', resolved: base };
}

const files = ROOTS.flatMap(root => collectFiles(root)).sort();
const failures = [];
let checkedImports = 0;

for (const file of files) {
  const source = fs.readFileSync(file, 'utf8');
  for (const specifier of localSpecifiers(source)) {
    checkedImports += 1;
    const result = resolveLocalImport(file, specifier);
    if (!result.ok) failures.push(`${file}: ${specifier} -> ${result.reason}`);
  }
}

if (failures.length) {
  console.error('Local ES-module graph verification failed:\n' + failures.join('\n'));
  process.exit(1);
}

console.log(`Local ES-module graph verification passed for ${checkedImports} imports across ${files.length} runtime files.`);
