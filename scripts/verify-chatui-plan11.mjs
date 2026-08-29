import assert from 'node:assert/strict';
import fs from 'node:fs';

const mainCss = fs.readFileSync('ChatUI/css/main.css', 'utf8');
const modalCss = fs.readFileSync('ChatUI/css/components/modals.css', 'utf8');
const settingsCss = fs.readFileSync('ChatUI/css/components/settings.css', 'utf8');
const refinementsCss = fs.readFileSync('ChatUI/css/refinements.css', 'utf8');
const toolsCss = fs.readFileSync('ChatUI/css/chat/tools.css', 'utf8');
const composerCss = fs.readFileSync('ChatUI/css/chat/composer.css', 'utf8');
const voiceCss = fs.readFileSync('ChatUI/css/components/voice.css', 'utf8');
const shellCss = fs.readFileSync('shell/css/shell.css', 'utf8');
const leftSidebarHtml = fs.readFileSync('ChatUI/html/left-sidebar.html', 'utf8');
const mainChatHtml = fs.readFileSync('ChatUI/html/main-chat.html', 'utf8');
const rightSidebarHtml = fs.readFileSync('ChatUI/html/right-sidebar.html', 'utf8');
const composerJs = fs.readFileSync('ChatUI/js/composer/composer.js', 'utf8');
const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');

assert.match(
  mainCss,
  /button:focus-visible,[\s\S]*a:focus-visible,[\s\S]*\[tabindex\]:focus-visible[\s\S]*outline:\s*1px solid var\(--focus-ring\)/,
  'keyboard focus must remain visible on discrete buttons, links, and custom focusable rows'
);
assert.match(
  mainCss,
  /input:focus,[\s\S]*textarea:focus,[\s\S]*select:focus,[\s\S]*input:focus-visible,[\s\S]*textarea:focus-visible,[\s\S]*select:focus-visible[\s\S]*outline:\s*none/,
  'native text/select fields must not regain the unwanted blue focus outline'
);
assert.match(refinementsCss, /\.input-with-icon:focus-within\s*\{[\s\S]*border-color:\s*var\(--border-color\)[\s\S]*box-shadow:\s*none/, 'icon-wrapped inputs must keep their normal border while focused');
assert.match(settingsCss, /\.switch input:focus-visible \+ \.slider\s*\{[\s\S]*outline:\s*2px solid var\(--accent-blue\)/, 'Settings switches must retain visible keyboard focus');
assert.match(toolsCss, /\.toggle-switch input:focus-visible \+ \.toggle-slider\s*\{[\s\S]*outline:\s*2px solid var\(--accent-blue\)/, 'AI tool switches must retain visible keyboard focus');
assert.match(composerCss, /\.composer-bar:has\(\.ProseMirror:focus-visible\)\s*\{[\s\S]*border-color:\s*var\(--border-color\);[\s\S]*box-shadow:\s*none;/, 'rich composer must keep its normal rounded border while typing');
assert.match(composerCss, /\.composer-bar \.composer-editor-host \.ProseMirror:focus-visible\s*\{[\s\S]*outline:\s*none;/, 'rich composer must not show a rectangular inner focus outline');

assert.match(shellCss, /@media \(max-width: 768px\)[\s\S]*\.shell-nav-label\s*\{[\s\S]*font-size:\s*11px;[\s\S]*font-weight:\s*500;[\s\S]*line-height:\s*1\.1;/, 'mobile app-navigation labels must be readable without making the rail oversized');

assert.match(leftSidebarHtml, /workspace-nav-btn[\s\S]*<span>Workspace<\/span>/, 'Workspace destination must keep the simple Workspace navigation name');
assert.match(mainChatHtml, /data-tool="workspace"[\s\S]*class="tool-name">Workspace Access<\/span>/, 'composer AI tool must be named Workspace Access');
assert.match(rightSidebarHtml, /sidebar-toggle-workspace[\s\S]*Workspace Access|Workspace Access[\s\S]*sidebar-toggle-workspace/, 'right Controls panel must use Workspace Access naming');
assert.match(composerJs, /key:\s*'workspace'[\s\S]*label:\s*'Workspace Access'/, 'Workspace Access must remain the existing workspace tool key rather than changing tool behavior');
assert.match(mainChatHtml, /Allow the AI to work with your Workspace files\./, 'Workspace Access must explain what the permission does');

assert.match(voiceCss, /\.voice-mode-overlay\s*\{[\s\S]*env\(safe-area-inset-top,[\s\S]*env\(safe-area-inset-bottom,/, 'Live Voice must account for top and bottom device safe areas');
assert.match(modalCss, /@media \(max-width: 767px\)[\s\S]*\.modal-overlay\s*\{[\s\S]*env\(safe-area-inset-top,[\s\S]*env\(safe-area-inset-right,[\s\S]*env\(safe-area-inset-bottom,[\s\S]*env\(safe-area-inset-left,/, 'mobile dialogs must keep safe-area-aware margins on every screen edge');
assert.match(modalCss, /#search-modal \.modal-card\s*\{\s*width:\s*100%;/, 'Search dialog must fit the padded mobile modal viewport rather than touching screen edges');

assert.match(apiConfig, /CHATUI_VERSION = '2\.4'/, 'ChatUI Settings version must be 2.4');

console.log('ChatUI Plan 11 UI consistency verification passed.');
