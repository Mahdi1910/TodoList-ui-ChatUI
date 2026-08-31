import assert from 'node:assert/strict';
import fs from 'node:fs';

const embeddedHtml = fs.readFileSync('ChatUI/embedded.html', 'utf8');
const refinementsCss = fs.readFileSync('ChatUI/css/refinements.css', 'utf8');
const apiKeyCss = fs.readFileSync('ChatUI/css/components/api-key-pool.css', 'utf8');
const sidebarShellCss = fs.readFileSync('ChatUI/css/sidebar/shell.css', 'utf8');
const messagesCss = fs.readFileSync('ChatUI/css/chat/messages.css', 'utf8');
const markdownCss = fs.readFileSync('ChatUI/css/chat/markdown.css', 'utf8');
const messageRenderer = fs.readFileSync('ChatUI/js/chat/message-renderer.js', 'utf8');
const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');

// The combined shell uses embedded.html. Final refinements must load there after
// responsive.css so Light mode and the latest component refinements actually run.
const responsiveIndex = embeddedHtml.indexOf('/ChatUI/css/responsive.css');
const refinementsIndex = embeddedHtml.indexOf('/ChatUI/css/refinements.css');
assert.ok(responsiveIndex >= 0, 'embedded ChatUI must load responsive.css');
assert.ok(refinementsIndex > responsiveIndex, 'embedded ChatUI must load refinements.css after responsive.css');

assert.match(
  refinementsCss,
  /\.action-popup-menu,[\s\S]*\.message-more-menu,[\s\S]*\.model-dropdown-menu,[\s\S]*\.thinking-dropdown-menu,[\s\S]*\.tools-popup-menu\s*\{[\s\S]*background:\s*var\(--menu-bg\)\s*!important;[\s\S]*box-shadow:\s*var\(--menu-shadow\)\s*!important;/,
  'shared popup surfaces must use appearance-aware menu tokens'
);
assert.match(
  refinementsCss,
  /\.settings-card \.settings-close-btn\s*\{[\s\S]*background:\s*var\(--menu-bg\)\s*!important;[\s\S]*color:\s*var\(--text-primary\)/,
  'Settings close control must follow Light/Dark appearance'
);
assert.match(refinementsCss, /\.chat-item\.active\s*\{[^}]*var\(--bg-selected\)/, 'selected chats must retain an appearance-aware selected state');
assert.match(refinementsCss, /\.model-option\.active,[\s\S]*\.thinking-option\.selected\s*\{[\s\S]*var\(--bg-selected\)/, 'selector choices must not keep dark selected surfaces in Light mode');

assert.match(
  refinementsCss,
  /\.text-api-profile-switcher\s*\{[\s\S]*width:\s*min\(250px, 100%\);[\s\S]*margin:\s*2px auto 16px;[\s\S]*border-radius:\s*999px;/,
  'Mode 1 / Mode 2 must be a centered compact segmented selector'
);
assert.match(refinementsCss, /\.text-api-profile-btn\[aria-pressed="true"\][\s\S]*color:\s*var\(--accent-blue\)/, 'active Text API mode must have a clear selected treatment');
assert.match(apiConfig, /textarea\.rows\s*=\s*2;/, 'runtime Text API key editor must request only two rows');
assert.match(apiKeyCss, /\.api-key-pool-input\s*\{[\s\S]*min-height:\s*44px;[\s\S]*height:\s*44px;[\s\S]*max-height:\s*88px;/, 'Text API key editor must stay compact while remaining resizable');

assert.match(sidebarShellCss, /\.sidebar-nav\s*\{[\s\S]*gap:\s*8px;/, 'New Chat and Workspace must have visible vertical separation');
assert.match(sidebarShellCss, /\.new-chat-btn,\s*\.workspace-nav-btn\s*\{[\s\S]*text-decoration:\s*none;/, 'Workspace must share the same first-level navigation styling as New Chat');

assert.match(messagesCss, /\.user-bubble\s*\{[\s\S]*--user-bubble-bg:\s*#2F6FBA;[\s\S]*--user-bubble-text:\s*#FFFFFF;/, 'sent messages must use the lighter blue bubble with high-contrast text');
assert.match(messagesCss, /\.user-message-collapsible\.is-collapsed\s*\{[\s\S]*max-height:\s*9\.6em;[\s\S]*overflow:\s*hidden;/, 'long sent prompts must initially cap at approximately six lines');
assert.match(messagesCss, /\.user-message-collapsible\.is-collapsed\.has-overflow::after[\s\S]*linear-gradient/, 'collapsed prompts must have a subtle bottom fade instead of a hard text cut');
assert.match(messagesCss, /\.user-message-toggle\s*\{[\s\S]*font-size:\s*12px;[\s\S]*font-weight:\s*600;/, 'Show more / Show less must remain a compact in-bubble control');
assert.match(markdownCss, /\.user-bubble h1,[\s\S]*color:\s*inherit;/, 'user Markdown headings must remain readable on the blue bubble');
assert.match(markdownCss, /\.user-bubble a\s*\{[\s\S]*color:\s*#FFFFFF;/, 'user Markdown links must remain readable on the lighter blue bubble');

assert.match(messageRenderer, /USER_MESSAGE_COLLAPSE_LINES\s*=\s*6/, 'sent-message collapse threshold must stay at six lines');
assert.match(messageRenderer, /function appendUserContent\([\s\S]*user-message-collapsible is-collapsed/, 'only the user-content rendering path must own the disclosure wrapper');
assert.match(messageRenderer, /toggle\.hidden = true;/, 'sent-message disclosure must start hidden until real overflow is measured');
assert.doesNotMatch(messageRenderer, /USER_MESSAGE_COLLAPSE_CHAR_HINT|likelyNeedsUserCollapse/, 'sent-message disclosure must not use character or newline heuristics');
assert.match(messageRenderer, /naturalHeight > collapsedHeight \+ 2/, 'disclosure visibility must come from actual rendered text height beyond six lines');
assert.match(messageRenderer, /toggle\.textContent = expanding \? 'Show less' : 'Show more'/, 'expanded sent prompts must expose Show less');
assert.match(messageRenderer, /observer\.observe\(text\)/, 'sent-message overflow must remeasure when responsive or iframe visibility changes affect text size');
assert.match(messageRenderer, /else if \(content\) \{\s*appendUserContent\(bubble, content\);\s*\}/, 'assistant messages must not be routed through the sent-message collapse path');

console.log('ChatUI Plan 14 embedded light theme and sent-message compactness verification passed.');
