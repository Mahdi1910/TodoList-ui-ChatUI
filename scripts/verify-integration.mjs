import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = relative => readFile(path.join(root, relative), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function walk(directory) {
  const result = [];
  for (const name of await readdir(directory)) {
    const full = path.join(directory, name);
    const info = await stat(full);
    if (info.isDirectory()) result.push(...await walk(full));
    else result.push(full);
  }
  return result;
}

const [
  rootHtml,
  frameManager,
  frameBridge,
  shellRouter,
  shellProtocol,
  chatEmbedded,
  chatRouter,
  chatLayoutLoader,
  todoEmbeddedBridge,
  todoToolRegistry,
  chatTodoBridge,
  diaryBridge,
  diaryMain,
  diaryDatabase,
  diaryStorageNamespace,
  buildStatic,
  wrangler,
  worker,
  server
] = await Promise.all([
  read('index.html'),
  read('shell/js/frame-manager.js'),
  read('shell/js/frame-bridge.js'),
  read('shell/js/router.js'),
  read('shell/js/protocol.js'),
  read('ChatUI/embedded.html'),
  read('ChatUI/js/router/chat-router.js'),
  read('ChatUI/js/layout-loader.js'),
  read('TodoList-ui/js/embedded/shell-bridge.js'),
  read('TodoList-ui/js/tools/todo-tool-registry.js'),
  read('ChatUI/js/todo/todo-bridge-client.js'),
  read('diary/src/embedded/shell-bridge.js'),
  read('diary/src/main.js'),
  read('diary/src/features/database.js'),
  read('diary/src/platform/storage-namespace.mjs'),
  read('scripts/build-static.mjs'),
  read('wrangler.jsonc'),
  read('worker.js'),
  read('server.py')
]);

assert(rootHtml.includes('id="todo-frame"') && rootHtml.includes('id="chat-frame"') && rootHtml.includes('id="diary-frame"'), 'Root shell must own Todo, Chat, and Diary persistent iframes.');
assert(rootHtml.includes('id="shell-nav-diary"') && !rootHtml.includes('Diary — planned'), 'Diary navigation must be enabled.');
assert(rootHtml.includes('allow="microphone; autoplay;'), 'Chat iframe must explicitly allow microphone/audio capabilities.');
assert(rootHtml.includes('allow="microphone; geolocation; autoplay"'), 'Diary iframe must explicitly allow microphone/geolocation/audio capabilities.');
assert(frameManager.includes('/TodoList-ui/index.html?embedded=1'), 'Todo embedded frame URL is missing.');
assert(frameManager.includes('/ChatUI/embedded.html?embedded=1'), 'Chat embedded frame URL is missing.');
assert(frameManager.includes('/diary/index.html?embedded=1'), 'Diary embedded frame URL is missing.');
assert(frameManager.includes("expectedPath: '/diary/index.html'"), 'Diary iframe navigation guard is missing.');
assert(frameManager.includes('ensureReady') && frameManager.includes('sendNow'), 'Shell must provide ensure-ready and immediate-send helpers for Todo RPC.');
assert(shellProtocol.includes("DIARY: 'diary'"), 'Shell protocol must recognize Diary as a first-class app.');
assert(shellRouter.includes("const DIARY_PATH = '/diary'"), 'Shell public Diary route is missing.');
assert(frameBridge.includes('chatui:todo-tool-request') && frameBridge.includes('shell:todo-tool-request'), 'Chat -> Shell -> Todo request route is missing.');
assert(frameBridge.includes('shell:todo-tool-cancel'), 'Todo cancellation route is missing.');
assert(frameBridge.includes('shell:todo-tool-response'), 'Todo response route is missing.');
assert(frameBridge.includes('shell:todo-tool-dispatched'), 'Todo dispatch acknowledgement is missing.');
assert(frameBridge.includes('64 * 1024') && frameBridge.includes('32 * 1024'), 'Shell must keep separate 64 KiB Todo and 32 KiB ordinary message limits.');
assert(frameBridge.includes('workspacePath') && shellRouter.includes('WORKSPACE_ROOT_PATH'), 'Shell Workspace route bridge is missing.');
assert(todoEmbeddedBridge.includes('todo-tools-v1'), 'Todo must advertise the todo-tools-v1 capability.');
assert(todoToolRegistry.includes('todo_find_tasks') && todoToolRegistry.includes('todo_update_workspace'), 'Todo tool allowlist is incomplete.');
assert(chatTodoBridge.includes('chatui:todo-tool-request') && chatTodoBridge.includes('chatui:todo-tool-cancel'), 'Chat Todo RPC client is incomplete.');
assert(!chatTodoBridge.includes('AppDataService') && !chatTodoBridge.includes('TodoListDB'), 'Chat Todo bridge must not access Todo services/storage directly.');
assert(chatEmbedded.includes('/ChatUI/js/layout-loader.js'), 'Embedded Chat entry must use combined-host ChatUI assets.');
assert(chatLayoutLoader.includes('import.meta.url'), 'Chat fragments must resolve from the module URL.');
assert(chatRouter.includes('embedded=1') || chatRouter.includes("get('embedded')"), 'Chat router must detect embedded mode.');
assert(chatRouter.includes('pushWorkspaceRoute'), 'Chat router must support Workspace routes.');

assert(diaryBridge.includes("app:ready") && diaryBridge.includes("app:appearance"), 'Diary must report ready state and appearance through the Shell bridge.');
assert(diaryBridge.includes("shell:active") && diaryBridge.includes("shell:inactive"), 'Diary must receive explicit Shell lifecycle activation.');
assert(diaryBridge.includes("shell:open-settings") && diaryBridge.includes("shell:viewport-insets"), 'Diary must support Shell settings and viewport commands.');
assert(diaryMain.trimStart().startsWith("import './platform/storage-namespace.mjs';"), 'Diary storage namespace must install before other Diary modules run.');
assert(diaryStorageNamespace.includes("aura-diary:"), 'Diary localStorage must use an application namespace.');
assert(diaryDatabase.includes("new Dexie('AuraDiaryDB')"), 'AuraDiaryDB name must remain unchanged.');

assert(buildStatic.includes("'diary/index.html'") && buildStatic.includes("'diary/src'"), 'Safe runtime build must include Diary assets explicitly.');
assert(wrangler.includes('"not_found_handling": "none"'), 'Combined deployment must not SPA-fallback missing child assets.');
assert(worker.includes('diary\\/?$') || worker.includes('diary\\/??$') || worker.includes('diary\\/?'), 'Worker must explicitly route the public Diary path to the shell.');
assert(server.includes('diary/?$'), 'Local server must explicitly route the public Diary path to the shell.');
assert(worker.includes('chat-ui\\/chat') || worker.includes('chat-ui/chat'), 'Worker must explicitly route public Chat deep links to the shell.');
assert(worker.includes('workspace'), 'Worker must explicitly route public Workspace deep links to the shell.');

const allTodoJs = (await walk(path.join(root, 'TodoList-ui', 'js'))).filter(file => file.endsWith('.js'));
const allChatJs = (await walk(path.join(root, 'ChatUI', 'js'))).filter(file => file.endsWith('.js'));
const allDiaryJs = (await walk(path.join(root, 'diary', 'src'))).filter(file => file.endsWith('.js') || file.endsWith('.mjs'));
const todoText = (await Promise.all(allTodoJs.map(file => readFile(file, 'utf8')))).join('\n');
const chatText = (await Promise.all(allChatJs.map(file => readFile(file, 'utf8')))).join('\n');
const diaryText = (await Promise.all(allDiaryJs.map(file => readFile(file, 'utf8')))).join('\n');
assert(todoText.includes('TodoListDB'), 'TodoListDB name must remain unchanged.');
assert(chatText.includes('ChatUI_DB'), 'ChatUI_DB name must remain unchanged.');
assert(diaryText.includes('AuraDiaryDB'), 'AuraDiaryDB name must remain unchanged.');
assert(!chatText.includes("from '../../../TodoList-ui") && !chatText.includes('TodoList-ui/js/storage'), 'ChatUI must not import Todo runtime/storage modules directly.');
assert(!diaryText.includes('TodoList-ui/js/') && !diaryText.includes('ChatUI/js/'), 'Diary must remain independent from Todo and Chat runtime modules.');

console.log('Static Todo + Chat + Diary iframe integration verification passed.');
