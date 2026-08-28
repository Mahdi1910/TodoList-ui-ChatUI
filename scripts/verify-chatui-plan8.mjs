import assert from 'node:assert/strict';
import fs from 'node:fs';

const composerJs = fs.readFileSync('ChatUI/js/composer/composer.js', 'utf8');
const markdownEditorJs = fs.readFileSync('ChatUI/js/composer/markdown-editor.js', 'utf8');
const composerCss = fs.readFileSync('ChatUI/css/chat/composer.css', 'utf8');
const composerEditorCss = fs.readFileSync('ChatUI/css/chat/composer-editor.css', 'utf8');
const responsiveCss = fs.readFileSync('ChatUI/css/responsive.css', 'utf8');
const mainChatHtml = fs.readFileSync('ChatUI/html/main-chat.html', 'utf8');
const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');

assert.match(composerCss, /\.composer-bar\s*\{[\s\S]*display:\s*grid;/, 'composer bar must use CSS grid');
assert.match(
  composerCss,
  /grid-template-rows:\s*minmax\(56px,\s*auto\) 40px;/,
  'desktop composer must always reserve a text row above the controls row'
);
assert.match(
  composerCss,
  /grid-template-areas:[\s\S]*"editor editor editor editor editor"[\s\S]*"attach tools indicators record primary"/,
  'editor must always occupy the top row and controls must always occupy the bottom row'
);
assert.doesNotMatch(
  composerCss,
  /grid-template-areas:\s*"attach tools indicators editor record primary"/,
  'empty composer must never place placeholder/editor between bottom controls'
);
assert.doesNotMatch(
  composerCss,
  /\.composer-bar\.composer-has-text\s*\{[\s\S]*grid-template-(?:areas|rows|columns):/,
  'two-row geometry must not depend on whether text is present'
);
assert.doesNotMatch(
  composerCss,
  /\.composer-bar\s*\{[^}]*align-items:\s*flex-end;/,
  'composer must not return to the old bottom-aligned single flex row'
);
assert.match(composerCss, /\.composer-btn\s*\{[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/, 'desktop composer controls must have consistent hit targets');

assert.match(composerEditorCss, /min-height:\s*56px;/, 'desktop editor must keep a dedicated top-row height when empty');
assert.match(composerEditorCss, /max-height:\s*min\(280px,\s*38dvh\)/, 'desktop editor must have a bounded multiline height');
assert.match(composerEditorCss, /overflow-y:\s*auto;/, 'long prompts must scroll inside the editor after the height cap');
assert.doesNotMatch(
  composerEditorCss,
  /\.composer-bar:not\(\.composer-has-text\) \.composer-editor-host/,
  'empty editor must not collapse into the controls row'
);
assert.match(composerEditorCss, /position:\s*relative;/, 'placeholder positioning must be anchored to the ProseMirror surface');

assert.match(
  responsiveCss,
  /\.composer-bar\s*\{[\s\S]*grid-template-columns:\s*44px 44px minmax\(0, 1fr\) 44px 44px;[\s\S]*grid-template-rows:\s*minmax\(64px,\s*auto\) 44px;/,
  'mobile composer must always keep a dedicated top editor row and fixed bottom controls row'
);
assert.match(
  responsiveCss,
  /grid-template-areas:[\s\S]*"editor editor editor editor editor"[\s\S]*"attach tools indicators record primary"/,
  'mobile editor and controls must remain in separate rows'
);
assert.match(
  composerEditorCss,
  /@media \(max-width: 767px\)[\s\S]*min-height:\s*64px;[\s\S]*max-height:\s*min\(340px,\s*42dvh\);[\s\S]*font-size:\s*16px;/,
  'mobile editor must keep a dedicated empty height, bounded growth, and anti-zoom 16px font'
);

for (const id of [
  'attach-file-btn',
  'tools-menu-btn',
  'composer-editor-host',
  'record-audio-btn',
  'open-voice-mode-btn',
  'send-btn',
  'stop-generating-btn'
]) {
  assert.match(mainChatHtml, new RegExp(`id="${id}"`), `existing composer control ${id} must remain present`);
}

assert.match(
  composerJs,
  /const hasText = !isComposerEmpty\(\);/,
  'existing text-aware Send/Voice behavior must remain intact'
);
assert.match(
  markdownEditorJs,
  /function handleComposerKeyDown\([\s\S]*event\.key !== 'Enter'[\s\S]*requestSubmit\(\)/,
  'existing keyboard submit behavior must remain intact'
);
assert.match(apiConfig, /CHATUI_VERSION = '1\.5'/, 'ChatUI Settings version must be 1.5');

console.log('ChatUI Plan 8 two-part composer verification passed.');
