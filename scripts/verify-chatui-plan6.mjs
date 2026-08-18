import { readFile } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const read = relative => readFile(path.join(root, relative), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const [
  mainChat,
  composer,
  editor,
  sendMessage,
  conversation,
  chatUi,
  messageRenderer,
  composerCss,
  editorCss,
  markdownCss,
  responsiveCss,
  chatCss,
  vendorRuntime,
  vendorLicense,
  vendorMetadata,
  streaming,
  fileRecovery,
  todoBridge,
  todoExecutor
] = await Promise.all([
  read('ChatUI/html/main-chat.html'),
  read('ChatUI/js/composer/composer.js'),
  read('ChatUI/js/composer/markdown-editor.js'),
  read('ChatUI/js/chat/send-message.js'),
  read('ChatUI/js/chat/conversation.js'),
  read('ChatUI/js/chat/ui.js'),
  read('ChatUI/js/chat/message-renderer.js'),
  read('ChatUI/css/chat/composer.css'),
  read('ChatUI/css/chat/composer-editor.css'),
  read('ChatUI/css/chat/markdown.css'),
  read('ChatUI/css/responsive.css'),
  read('ChatUI/css/chat.css'),
  read('ChatUI/js/vendor/milkdown-composer.runtime.js'),
  read('ChatUI/js/vendor/milkdown-composer.LICENSE.txt'),
  read('ChatUI/js/vendor/milkdown-composer.version.json'),
  read('ChatUI/js/chat/streaming.js'),
  read('ChatUI/js/chat/file-reference-recovery.js'),
  read('ChatUI/js/todo/todo-bridge-client.js'),
  read('ChatUI/js/todo/todo-tool-executor.js')
]);

const previewSources = [mainChat, composer, composerCss, markdownCss];
assert(previewSources.every(source => !source.includes('composer-markdown-preview')), 'Separate composer Markdown preview must be completely removed from runtime UI/source/CSS.');
assert(!composer.includes('renderMarkdown') && !composer.includes("../chat/markdown.js"), 'Composer must not use the sent-message display renderer for live editing.');
assert(mainChat.includes('id="composer-editor-host"') && !mainChat.includes('id="composer-textarea"') && !mainChat.includes('<textarea'), 'Composer must expose one rich editor host and no raw textarea.');

for (const apiName of [
  'initMarkdownComposer',
  'getComposerMarkdown',
  'setComposerMarkdown',
  'clearComposer',
  'isComposerEmpty',
  'focusComposer',
  'isComposerReady',
  'destroyComposer'
]) {
  const asyncPrefix = apiName === 'initMarkdownComposer' || apiName === 'destroyComposer' ? 'async ' : '';
  assert(editor.includes(`export ${asyncPrefix}function ${apiName}`), `Markdown composer adapter must export ${apiName}.`);
}

assert(editor.includes('.use(commonmark)') && editor.includes('.use(gfm)') && editor.includes('.use(history)') && editor.includes('.use(listener)'), 'Milkdown composer must use CommonMark, GFM, history and listener plugins.');
assert(editor.includes('.use(clipboard)'), 'Milkdown composer must include Markdown-aware clipboard behavior.');
assert(editor.includes('getMarkdown') && editor.includes('replaceAll') && editor.includes('markdownUpdated'), 'Composer adapter must keep Markdown as its get/set/change boundary.');
assert(editor.includes('editorViewOptionsCtx') && editor.includes('nodeViews') && editor.includes('image: safeImageNodeView'), 'Composer must configure the structured editor view and a non-fetching image node view.');
assert(editor.includes('view?.composing') && editor.includes('event.isComposing') && editor.includes('compositionstart'), 'Composer Enter-to-send must explicitly guard IME composition.');
assert(editor.includes('selectionIsTopLevelParagraph') && editor.includes('event.ctrlKey || event.metaKey'), 'Composer must keep normal Enter-to-send while preserving structured Enter and Ctrl/Cmd+Enter submit.');
assert(editor.includes("closest?.('a')") && editor.includes('preventDefault'), 'Composer links must not navigate during normal editing clicks.');
assert(editor.includes("querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, th, td')") && editor.includes("querySelectorAll('pre, code')"), 'Composer must preserve automatic text direction while forcing code LTR.');

assert(sendMessage.includes("from '../composer/markdown-editor.js'") && sendMessage.includes('getComposerMarkdown()') && sendMessage.includes('clearComposer()'), 'Send flow must consume/clear the composer through the Markdown adapter.');
assert(!sendMessage.includes('composerTextarea') && !sendMessage.includes('composer-textarea') && !sendMessage.includes('.value'), 'Send flow must not depend on textarea/editable DOM content.');
assert(sendMessage.indexOf('await persistNewUserTurn') < sendMessage.lastIndexOf('clearComposer();'), 'Rich draft must clear only after durable user-turn persistence succeeds.');
assert(sendMessage.includes('content: hasText ? rawMarkdown'), 'Persisted user content must remain Markdown rather than editor HTML/JSON.');

assert(conversation.includes("from '../composer/markdown-editor.js'") && conversation.includes('clearComposer();'), 'New Chat must clear through the composer adapter.');
assert(!conversation.includes('composerTextarea') && !conversation.includes('composer-textarea'), 'Conversation lifecycle must not manipulate a textarea directly.');
assert(!chatUi.includes('composerTextarea') && !chatUi.includes('composer-textarea'), 'Generic chat DOM helpers must not expose a textarea-specific composer handle.');
assert(messageRenderer.includes('text.innerHTML = renderMarkdown(content)'), 'Sent user messages must continue through the existing sanitized Markdown display renderer.');

assert(chatCss.includes('@import url("chat/composer-editor.css")'), 'Chat CSS must include the structured composer stylesheet.');
assert(editorCss.includes('.composer-editor-host') && editorCss.includes('.ProseMirror'), 'Composer editor CSS must style the single ProseMirror surface.');
assert(editorCss.includes('padding-inline-start') && editorCss.includes('text-align: start'), 'Composer editor CSS must use logical RTL-safe layout.');
assert(editorCss.includes('.composer-image-markdown') && !editorCss.includes('.code-block-wrapper'), 'Composer styling must use safe image text and must not inject display-only code cards.');
assert(!responsiveCss.includes('.composer-textarea') && responsiveCss.includes('.composer-editor-host'), 'Mobile layout must target the rich editor instead of the removed textarea.');

const metadata = JSON.parse(vendorMetadata);
assert(metadata.package === '@milkdown/kit' && metadata.version === '7.22.0', 'Milkdown provenance metadata must pin @milkdown/kit 7.22.0.');
assert(metadata.runtime === 'pinned-esm-cdn' && metadata.bundle === false, 'Milkdown runtime strategy must be explicit and reproducible.');
assert(vendorLicense.includes('The MIT License (MIT)') && vendorLicense.includes('Copyright (c) 2020-present Mirone'), 'Milkdown MIT license notice must be preserved.');
const remoteImports = [...vendorRuntime.matchAll(/https:\/\/esm\.sh\/([^'"\s]+)/g)].map(match => match[0]);
assert(remoteImports.length >= 6, 'Pinned Milkdown vendor runtime imports are missing.');
assert(remoteImports.every(url => url.includes('@milkdown/kit@7.22.0/') && url.includes('bundle=false') && !url.includes('@latest')), 'Every new Milkdown runtime URL must be version-pinned and use shared dependency instances.');
assert(!vendorRuntime.includes('@milkdown/kit@latest') && !vendorRuntime.includes('https://esm.sh/@milkdown/kit/core'), 'No unpinned Milkdown runtime CDN import is allowed.');

assert(streaming.includes('gemini-file-recovery-wrapper.js'), 'Gemini File recovery wrapper must remain wired into streaming.');
assert(fileRecovery.includes('FILE_RECOVERY_CONCURRENCY = 7'), 'Gemini File recovery concurrency must remain 7.');
assert(todoBridge.includes('TODO_BRIDGE') || todoBridge.includes('todo'), 'Todo bridge client must remain present.');
assert(todoExecutor.includes('executeTodo') || todoExecutor.includes('todo'), 'Todo tool executor must remain present.');

console.log('Implementation Plan ID 6 static verification passed.');
