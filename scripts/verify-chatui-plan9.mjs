import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainChatHtml = fs.readFileSync('ChatUI/html/main-chat.html', 'utf8');
const toolsCss = fs.readFileSync('ChatUI/css/chat/tools.css', 'utf8');
const sidebarItemsCss = fs.readFileSync('ChatUI/css/sidebar/items.css', 'utf8');
const sidebarRenderJs = fs.readFileSync('ChatUI/js/sidebar/sidebar-render.js', 'utf8');
const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');

assert.doesNotMatch(mainChatHtml, /class="tool-desc"/, 'composer Tools popover must not include descriptive subtitle text');
for (const label of ['Google Search', 'URL Context', 'Code Execution', 'Workspace Access', 'To-Do']) {
  assert.match(mainChatHtml, new RegExp(`class="tool-name">${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}<`), `tool name ${label} must remain visible`);
}
for (const id of [
  'toggle-google-search',
  'toggle-url-context',
  'toggle-code-execution',
  'toggle-workspace',
  'toggle-todo'
]) {
  assert.match(mainChatHtml, new RegExp(`id="${id}"`), `tool toggle ${id} must remain present`);
}
assert.doesNotMatch(toolsCss, /\.tool-desc\s*\{/, 'removed tool descriptions must not retain dedicated layout CSS');
assert.match(toolsCss, /\.tool-option\s*\{[\s\S]*min-height:\s*48px;/, 'tool rows must remain compact while providing a larger touch target');

assert.match(
  sidebarItemsCss,
  /\.project-item\s*\{[\s\S]*align-items:\s*stretch;[\s\S]*padding:\s*0;/,
  'project rows must remain first-level full-width items without extra outer indentation'
);
assert.match(
  sidebarItemsCss,
  /\.project-header-item\s*\{[\s\S]*padding:\s*6px 8px;/,
  'project header row padding must align with top-level chat row padding'
);
assert.match(
  sidebarItemsCss,
  /\.nested-project-chats\s*\{[\s\S]*width:\s*100%;[\s\S]*padding-left:\s*24px;[\s\S]*border-left:\s*0;/,
  'project chats must remain the single indented second level and use the available row width'
);
assert.match(
  sidebarItemsCss,
  /\.chat-item\.active\s*\{[\s\S]*font-weight:\s*500;/,
  'existing selected-chat styling must remain present'
);

assert.doesNotMatch(sidebarRenderJs, /add-chat-to-proj-btn|proj-options-btn|pin-chat-btn|chat-options-btn/, 'per-row action buttons must stay removed');
assert.match(sidebarRenderJs, /bindSidebarActionPress\(projHeader/, 'project rows must expose actions through the press-action primitive');
assert.match(sidebarRenderJs, /bindSidebarActionPress\(link/, 'chat rows must expose actions through the press-action primitive');
assert.match(apiConfig, /CHATUI_VERSION = '2\.5'/, 'ChatUI Settings version must be 2.5');

console.log('ChatUI Plan 9 sidebar and tools verification passed.');
