import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = relative => readFile(path.join(root, relative), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function importSource(relative) {
  const source = await read(relative);
  const encoded = Buffer.from(source, 'utf8').toString('base64');
  return import(`data:text/javascript;base64,${encoded}`);
}

const limits = await importSource('ChatUI/js/tools/custom-tool-limits.js');
assert(limits.normalizeCustomToolRoundLimit(undefined) === 24, 'Missing custom-tool limit must default to 24.');
assert(limits.normalizeCustomToolRoundLimit(24) === 24, '24-round limit must be accepted.');
assert(limits.normalizeCustomToolRoundLimit(100) === 100, '100-round limit must be accepted.');
assert(limits.normalizeCustomToolRoundLimit(1000) === 1000, '1000-round limit must be accepted.');
assert(limits.normalizeCustomToolRoundLimit(-1) === -1, '-1 must mean unlimited.');
assert(limits.normalizeCustomToolRoundLimit(0) === 24, '0 must normalize safely.');
assert(limits.normalizeCustomToolRoundLimit(1.5) === 24, 'Decimal limits must normalize safely.');
assert(limits.MAX_CUSTOM_CALLS_PER_ROUND === 16, 'Per-round custom-call safety limit must remain 16.');

const zip = await importSource('ChatUI/js/workspace/workspace-zip.js');
const utf8 = new TextEncoder();
const archive = zip.createStoredZip([
  { name: 'workspace-manifest.json', data: '{"format":"chatui-workspace-backup"}' },
  { name: 'جامعة/', directory: true },
  { name: 'جامعة/notes.md', data: '# مرحبا\n235' }
]);
const parsedZip = zip.readStoredZip(archive, { maxEntries: 10, maxTotalBytes: 1024 * 1024 });
assert(parsedZip.entries.length === 3, 'Workspace ZIP round-trip must preserve all entries.');
const notes = parsedZip.entries.find(entry => entry.name === 'جامعة/notes.md');
assert(notes && new TextDecoder().decode(notes.data).includes('235'), 'Workspace ZIP must preserve UTF-8 Markdown content.');
const corrupted = archive.slice();
const noteBytes = utf8.encode('# مرحبا\n235');
let noteOffset = -1;
for (let i = 0; i <= corrupted.length - noteBytes.length; i += 1) {
  let match = true;
  for (let j = 0; j < noteBytes.length; j += 1) if (corrupted[i + j] !== noteBytes[j]) { match = false; break; }
  if (match) { noteOffset = i; break; }
}
assert(noteOffset >= 0, 'Test ZIP payload should be locatable.');
corrupted[noteOffset] ^= 1;
let crcRejected = false;
try { zip.readStoredZip(corrupted, { maxEntries: 10, maxTotalBytes: 1024 * 1024 }); }
catch (error) { crcRejected = /CRC/.test(error.message); }
assert(crcRejected, 'Workspace ZIP restore must reject CRC-corrupted entries.');

const shellRouter = await importSource('shell/js/router.js');
let route = shellRouter.parseShellRoute('/workspace', '');
assert(route.app === 'chat' && route.surface === 'workspace' && route.workspacePath === '/', '/workspace must route to Chat Workspace root.');
route = shellRouter.parseShellRoute('/workspace/Mahdi%20Notes/AI%20%231/file%20name.md', '');
assert(route.workspacePath === '/Mahdi Notes/AI #1/file name.md', 'Workspace segments must decode independently.');
route = shellRouter.parseShellRoute('/chat-ui/chat/chat-1', '#message=msg-2');
assert(route.surface === 'chat' && route.chatId === 'chat-1' && route.messageId === 'msg-2', 'Chat message fragments must survive shell parsing.');
route = shellRouter.parseShellRoute('/workspace/%E0%A4%A', '');
assert(route.surface === 'workspace' && route.invalidWorkspacePath === true, 'Malformed Workspace encoding must stay a Workspace not-found route.');

const [
  worker,
  server,
  shellBridge,
  appLinks,
  chatRouter,
  embeddedBridge,
  app,
  sidebarHtml,
  sidebarRender,
  workspaceUi,
  workspaceBackup,
  workspaceStorage,
  settingsHtml,
  gemini,
  streaming,
  fileRecovery,
  rightSidebarHtml,
  rightSidebarCss,
  markdown,
  messageRenderer,
  composer,
  messagesCss,
  searchStorage,
  searchUi,
  actionMenu
] = await Promise.all([
  read('worker.js'),
  read('server.py'),
  read('shell/js/frame-bridge.js'),
  read('ChatUI/js/router/app-links.js'),
  read('ChatUI/js/router/chat-router.js'),
  read('ChatUI/js/embedded/shell-bridge.js'),
  read('ChatUI/js/app.js'),
  read('ChatUI/html/left-sidebar.html'),
  read('ChatUI/js/sidebar/sidebar-render.js'),
  read('ChatUI/js/workspace/workspace-ui.js'),
  read('ChatUI/js/workspace/workspace-backup.js'),
  read('ChatUI/js/workspace/workspace-storage.js'),
  read('ChatUI/html/settings-modal.html'),
  read('ChatUI/js/api/gemini.js'),
  read('ChatUI/js/chat/streaming.js'),
  read('ChatUI/js/chat/file-reference-recovery.js'),
  read('ChatUI/html/right-sidebar.html'),
  read('ChatUI/css/components/right-sidebar.css'),
  read('ChatUI/js/chat/markdown.js'),
  read('ChatUI/js/chat/message-renderer.js'),
  read('ChatUI/js/composer/composer.js'),
  read('ChatUI/css/chat/messages.css'),
  read('ChatUI/js/storage/search.js'),
  read('ChatUI/js/sidebar/search.js'),
  read('ChatUI/js/ui/action-menu.js')
]);

assert(worker.includes('workspace(?:\\/.*)?') || worker.includes('workspace(?:/.*)?'), 'Worker must shell-route Workspace deep links.');
assert(server.includes('workspace(?:/.*)?'), 'Local server must shell-route Workspace deep links.');
assert(shellBridge.includes('workspacePath') && shellBridge.includes('messageId'), 'Shell bridge must carry Workspace and message routes.');
assert(appLinks.includes('buildWorkspaceHref') && appLinks.includes('buildMessageHref'), 'Shared app href builders are missing.');
assert(chatRouter.includes('pushWorkspaceRoute') && chatRouter.includes('pushChatMessageRoute'), 'Chat router must support Workspace and message routes.');
assert(embeddedBridge.includes('isInternalAppUrl') && embeddedBridge.includes('navigateWorkspace') && embeddedBridge.includes('messageId'), 'Embedded bridge must preserve internal links and routed targets.');
assert(app.includes('openWorkspacePath') && app.includes('focusMessageTarget') && app.includes('initWorkspaceBackupUI'), 'App bootstrap must restore Workspace/message routes and initialize Workspace backup UI.');
assert(sidebarHtml.includes('<a class="new-chat-btn"') && sidebarHtml.includes('<a class="workspace-nav-btn"'), 'New Chat and Workspace sidebar navigation must use anchors.');
assert(sidebarRender.includes("className = 'chat-item-link'") && sidebarRender.includes('buildChatHref'), 'Chat rows must expose real anchors.');
assert(workspaceUi.includes("className = 'workspace-tree-link'") && workspaceUi.includes('workspace-breadcrumb-link'), 'Workspace tree and breadcrumb navigation must expose links.');

assert(workspaceBackup.includes('WORKSPACE_BACKUP_FORMAT') && workspaceBackup.includes('validateRelativeArchivePath'), 'Workspace backup manifest/path validation is missing.');
assert(workspaceBackup.includes('WORKSPACE_BACKUP_MAX_ENTRIES') && workspaceBackup.includes('WORKSPACE_BACKUP_MAX_BYTES'), 'Workspace backup resource bounds are missing.');
assert(workspaceBackup.includes('WORKSPACE_MAX_FILE_BYTES'), 'Workspace restore must enforce existing file-size limits.');
assert(workspaceStorage.includes('replaceWorkspaceSnapshot') && workspaceStorage.includes('.clear()'), 'Workspace restore must use one atomic replacement primitive.');
assert(settingsHtml.includes('create-workspace-backup-btn') && settingsHtml.includes('restore-workspace-backup-btn'), 'Workspace backup Settings controls are missing.');

assert(!gemini.includes('MAX_CUSTOM_TOOL_ROUNDS = 12'), 'Old 12-round hard cap must be removed.');
assert(!gemini.includes('MAX_CUSTOM_FUNCTION_CALLS = 32'), 'Old 32-total-call hard cap must be removed.');
assert(gemini.includes('normalizeCustomToolRoundLimit') && gemini.includes('CUSTOM_TOOL_ROUND_LIMIT_REACHED'), 'Configurable graceful custom-tool limit handling is missing.');
assert(gemini.includes('MAX_CUSTOM_CALLS_PER_ROUND'), 'Per-round custom-call safety limit is missing.');
assert(gemini.includes('streamLimitNarration') && gemini.includes('nativeTools'), 'Finite custom-tool limit must end with a native-only narration turn.');
assert(streaming.includes('gemini-file-recovery-wrapper.js'), 'Streaming must continue through the Gemini File recovery wrapper.');
assert(fileRecovery.includes('FILE_RECOVERY_CONCURRENCY = 7'), 'Gemini File recovery concurrency must remain 7.');

assert(!rightSidebarHtml.includes('tool-desc'), 'Right sidebar tool descriptions must be removed.');
assert(rightSidebarCss.includes('position: absolute') && rightSidebarCss.includes('transform: translateX(100%)'), 'Right sidebar must be transform-based overlay geometry.');
assert(markdown.includes("'p, h1, h2, h3, h4, h5, h6, ul, ol, li"), 'Markdown renderer must assign direction to list containers.');
assert(messageRenderer.includes('text.innerHTML = renderMarkdown(content)'), 'Sent user messages must continue to render stored Markdown.');
assert(!composer.includes('composer-markdown-preview') && !composer.includes("../chat/markdown.js"), 'Plan 6 must supersede the old mirrored composer preview without changing sent-message Markdown rendering.');
assert(messagesCss.includes('padding-inline-start') && !messagesCss.includes('.markdown-content[dir="rtl"] ul'), 'Markdown list indentation must use logical CSS instead of wrapper RTL special cases.');

assert(searchStorage.includes('openCursor()') && searchStorage.includes('messageId') && searchStorage.includes('matchRanges'), 'Contextual search must use cursor scanning and return message excerpts/ranges.');
assert(searchUi.includes("document.createElement('mark')") && searchUi.includes('buildMessageHref') && searchUi.includes('openChatAtMessage'), 'Search UI must safely highlight and open exact message targets.');
assert(actionMenu.includes("item?.type === 'separator'") && actionMenu.includes("event.key === 'Home'") && actionMenu.includes("event.key === 'End'"), 'Shared action menu separators/Home/End behavior is missing.');

console.log('Implementation Plan ID 4 static and pure-JS verification passed.');
