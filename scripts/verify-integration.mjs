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

const [rootHtml, frameManager, chatEmbedded, chatRouter, chatLayoutLoader, wrangler, worker] = await Promise.all([
  read('index.html'),
  read('shell/js/frame-manager.js'),
  read('ChatUI/embedded.html'),
  read('ChatUI/js/router/chat-router.js'),
  read('ChatUI/js/layout-loader.js'),
  read('wrangler.jsonc'),
  read('worker.js')
]);

assert(rootHtml.includes('id="todo-frame"') && rootHtml.includes('id="chat-frame"'), 'Root shell must own both persistent iframes.');
assert(rootHtml.includes('allow="microphone; autoplay;'), 'Chat iframe must explicitly allow microphone/audio capabilities.');
assert(frameManager.includes('/TodoList-ui/index.html?embedded=1'), 'Todo embedded frame URL is missing.');
assert(frameManager.includes('/ChatUI/embedded.html?embedded=1'), 'Chat embedded frame URL is missing.');
assert(chatEmbedded.includes('/ChatUI/js/layout-loader.js'), 'Embedded Chat entry must use combined-host ChatUI assets.');
assert(chatLayoutLoader.includes('import.meta.url'), 'Chat fragments must resolve from the module URL.');
assert(chatRouter.includes('embedded=1') || chatRouter.includes("get('embedded')"), 'Chat router must detect embedded mode.');
assert(wrangler.includes('"not_found_handling": "none"'), 'Combined deployment must not SPA-fallback missing child assets.');
assert(worker.includes('chat-ui/chat'), 'Worker must explicitly route public Chat deep links to the shell.');

const allTodoJs = (await walk(path.join(root, 'TodoList-ui', 'js'))).filter(file => file.endsWith('.js'));
const allChatJs = (await walk(path.join(root, 'ChatUI', 'js'))).filter(file => file.endsWith('.js'));
const todoText = (await Promise.all(allTodoJs.map(file => readFile(file, 'utf8')))).join('\n');
const chatText = (await Promise.all(allChatJs.map(file => readFile(file, 'utf8')))).join('\n');
assert(todoText.includes('TodoListDB'), 'TodoListDB name must remain unchanged.');
assert(chatText.includes('ChatUI_DB'), 'ChatUI_DB name must remain unchanged.');
assert(!rootHtml.includes('todo:command'), 'Future Todo AI command bridge must not be implemented in this integration.');

console.log('Static iframe integration verification passed.');
