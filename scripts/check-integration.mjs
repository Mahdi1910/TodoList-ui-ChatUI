import { mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, '..');
const dist = path.join(root, 'dist');
const checkDist = process.argv.includes('--dist');
const failures = [];

function fail(message) { failures.push(message); }
function assert(condition, message) { if (!condition) fail(message); }

async function exists(target) {
  try { await stat(target); return true; }
  catch (_) { return false; }
}

async function read(relative) {
  return readFile(path.join(root, relative), 'utf8');
}

async function walkJs(directory) {
  const result = [];
  if (!(await exists(directory))) return result;
  const entries = await readdir(directory, { withFileTypes: true });
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...await walkJs(target));
    else if (entry.isFile() && entry.name.endsWith('.js')) result.push(target);
  }
  return result;
}

async function checkJavaScriptSyntax() {
  const files = [
    ...await walkJs(path.join(root, 'shell', 'js')),
    ...await walkJs(path.join(root, 'ChatUI', 'js')),
    ...await walkJs(path.join(root, 'TodoList-ui', 'js'))
  ];
  const temp = await mkdtemp(path.join(os.tmpdir(), 'combined-app-syntax-'));
  try {
    for (let index = 0; index < files.length; index += 1) {
      const source = await readFile(files[index], 'utf8');
      const probe = path.join(temp, `${index}.mjs`);
      await writeFile(probe, source);
      const result = spawnSync(process.execPath, ['--check', probe], { encoding: 'utf8' });
      if (result.status !== 0) fail(`JavaScript syntax failed for ${path.relative(root, files[index])}:\n${result.stderr || result.stdout}`);
    }
    console.log(`Syntax-checked ${files.length} runtime JavaScript files.`);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function checkRoutes() {
  const routerUrl = `${pathToFileURL(path.join(root, 'shell/js/router.js')).href}?check=${Date.now()}`;
  const router = await import(routerUrl);
  const rootRoute = router.parseShellRoute('/');
  assert(rootRoute.app === 'todo' && rootRoute.canonicalPath === '/todo-list-ui', '/ must canonicalize to /todo-list-ui.');
  const todo = router.parseShellRoute('/todo-list-ui');
  assert(todo.app === 'todo' && todo.type === 'todo-home', '/todo-list-ui must parse as To-Do.');
  const chatHome = router.parseShellRoute('/chat-ui');
  assert(chatHome.app === 'chat' && chatHome.type === 'chat-home', '/chat-ui must parse as Chat home.');
  const chat = router.parseShellRoute('/chat-ui/chat/chat%20one');
  assert(chat.app === 'chat' && chat.type === 'chat' && chat.chatId === 'chat one', 'Encoded Chat IDs must round-trip.');
  assert(router.buildChatPath('a b') === '/chat-ui/chat/a%20b', 'Chat route builder must encode IDs.');
  assert(router.parseShellRoute('/chat-ui/chat/a/b').app === 'unknown', 'Extra Chat route segments must be rejected.');
  const legacy = router.parseShellRoute('/chat/old-id');
  assert(legacy.app === 'chat' && legacy.legacy === true && legacy.canonicalPath === '/chat-ui/chat/old-id', 'Legacy Chat links must canonicalize safely.');
}

async function checkArchitecture() {
  const [index, router, registry, shell, build, chatModule, todoModule, chatRouter] = await Promise.all([
    read('index.html'), read('shell/js/router.js'), read('shell/js/module-registry.js'),
    read('shell/js/app-shell.js'), read('scripts/build-static.mjs'),
    read('ChatUI/js/module.js'), read('TodoList-ui/js/module.js'), read('ChatUI/js/router/chat-router.js')
  ]);
  assert(index.includes('href="/todo-list-ui"'), 'Root index must expose a real /todo-list-ui link.');
  assert(index.includes('href="/chat-ui"'), 'Root index must expose a real /chat-ui link.');
  assert(index.includes('id="shell-module-host"'), 'Root index must contain the shell module host.');
  assert(router.includes("'/todo-list-ui'"), 'Shell router must define /todo-list-ui.');
  assert(router.includes("'/chat-ui'"), 'Shell router must define /chat-ui.');
  assert(registry.includes("../../TodoList-ui/js/module.js"), 'Shell registry must import only the To-Do module entry.');
  assert(registry.includes("../../ChatUI/js/module.js"), 'Shell registry must import only the ChatUI module entry.');
  assert(!registry.includes('AppDataService') && !registry.includes('state/store') && !registry.includes('voice/'), 'Shell registry must not reach into application internals.');
  assert(shell.includes('prepareDeactivate'), 'Shell lifecycle must call prepareDeactivate before leaving an app.');
  assert(shell.includes('beforeLeave') && shell.includes('unmount'), 'Shell lifecycle must sequence beforeLeave and unmount.');
  assert(shell.includes('window.location.assign'), 'Shell must keep a hard-navigation fallback for cleanup failure.');
  assert(chatModule.includes('stopLiveVoiceMode') && chatModule.includes('stopActiveReadAloud') && chatModule.includes('abortActiveGeneration'), 'Chat module must own generation/voice/read cleanup.');
  assert(todoModule.includes('AppDataService.whenIdle'), 'To-Do module must wait for its own persistence queue before leave.');
  assert(todoModule.includes('prepareDeactivate'), 'To-Do module must protect unsaved/active work before leave.');
  assert(chatRouter.includes("basePath = '/chat-ui'"), 'Chat router must be base-path aware for /chat-ui.');

  const forbiddenBuildTerms = ['chat UI agent', 'to-do list agent', 'implementation plan', '.git'];
  forbiddenBuildTerms.forEach(term => assert(!build.includes(`'${term}'`) && !build.includes(`\"${term}\"`), `Build allow-list must not include ${term}.`));
}

async function checkDistOutput() {
  if (!checkDist) return;
  assert(await exists(path.join(dist, 'index.html')), 'dist/index.html is missing after build.');
  assert(await exists(path.join(dist, 'shell', 'js', 'app-shell.js')), 'dist shell runtime is missing.');
  assert(await exists(path.join(dist, 'ChatUI', 'js', 'module.js')), 'dist ChatUI module is missing.');
  assert(await exists(path.join(dist, 'TodoList-ui', 'js', 'module.js')), 'dist To-Do module is missing.');
  for (const forbidden of ['chat UI agent', 'to-do list agent', 'implementation plan', '.git']) {
    assert(!(await exists(path.join(dist, forbidden))), `Forbidden internal directory was published to dist: ${forbidden}`);
  }
}

await checkJavaScriptSyntax();
await checkRoutes();
await checkArchitecture();
await checkDistOutput();

if (failures.length) {
  console.error('\nIntegration checks failed:');
  failures.forEach((message, index) => console.error(`${index + 1}. ${message}`));
  process.exit(1);
}
console.log('Integration static checks passed.');
