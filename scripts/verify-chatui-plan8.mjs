import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  COMPOSER_PASTE_ENTER_GUARD_MS,
  normalizePastedComposerText
} from '../ChatUI/js/composer/paste-normalization.js';

const composerJs = fs.readFileSync('ChatUI/js/composer/composer.js', 'utf8');
const markdownEditorJs = fs.readFileSync('ChatUI/js/composer/markdown-editor.js', 'utf8');
const composerCss = fs.readFileSync('ChatUI/css/chat/composer.css', 'utf8');
const composerEditorCss = fs.readFileSync('ChatUI/css/chat/composer-editor.css', 'utf8');
const responsiveCss = fs.readFileSync('ChatUI/css/responsive.css', 'utf8');
const mainChatHtml = fs.readFileSync('ChatUI/html/main-chat.html', 'utf8');
const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');

assert.equal(
  normalizePastedComposerText('first line\nsecond line\n\n'),
  'first line\nsecond line',
  'paste normalization must preserve internal lines while removing trailing pasted returns'
);
assert.equal(
  normalizePastedComposerText('first\r\nsecond\rthird\u2028fourth\u2029'),
  'first\nsecond\nthird\nfourth',
  'mobile and Unicode clipboard line separators must normalize without adding a trailing paragraph'
);
assert.equal(
  normalizePastedComposerText('keep internal\n\nparagraph gap'),
  'keep internal\n\nparagraph gap',
  'intentional internal blank lines must remain intact'
);
assert.equal(COMPOSER_PASTE_ENTER_GUARD_MS, 400, 'mobile paste Enter guard must remain short and bounded');

assert.match(composerCss, /\.composer-bar\s*\{[\s\S]*display:\s*grid;/, 'composer bar must use CSS grid');
assert.match(
  composerCss,
  /min-height:\s*96px;[\s\S]*grid-template-rows:\s*minmax\(40px,\s*auto\) 40px;/,
  'desktop empty composer must use compact equal-height text/control rows'
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
  /\.composer-bar\s*\{[^}]*align-items:\s*flex-end;/,
  'composer must not return to the old bottom-aligned single flex row'
);
assert.match(composerCss, /\.composer-btn\s*\{[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/, 'desktop composer controls must have consistent hit targets');

assert.match(composerEditorCss, /min-height:\s*40px;/, 'desktop empty editor row must match the 40px controls row');
assert.match(composerEditorCss, /max-height:\s*min\(280px,\s*38dvh\)/, 'desktop editor must retain bounded multiline growth');
assert.match(composerEditorCss, /overflow-y:\s*auto;/, 'long prompts must scroll inside the editor after the height cap');
assert.match(composerEditorCss, /position:\s*relative;/, 'placeholder positioning must be anchored to the ProseMirror surface');

assert.match(
  responsiveCss,
  /\.composer-bar\s*\{[\s\S]*min-height:\s*104px;[\s\S]*grid-template-columns:\s*44px 44px minmax\(0, 1fr\) 44px 44px;[\s\S]*grid-template-rows:\s*minmax\(44px,\s*auto\) 44px;/,
  'mobile empty composer must use equal 44px text/control rows and a compact total height'
);
assert.match(
  composerEditorCss,
  /@media \(max-width: 767px\)[\s\S]*min-height:\s*44px;[\s\S]*max-height:\s*min\(340px,\s*42dvh\);[\s\S]*font-size:\s*16px;/,
  'mobile editor must start compact, retain bounded growth, and preserve the anti-zoom font'
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
  /transformPastedText\([\s\S]*normalizePastedComposerText/,
  'clipboard text must pass through trailing-return normalization'
);
assert.match(
  markdownEditorJs,
  /addEventListener\('paste',\s*markComposerPaste,\s*true\)/,
  'composer must mark paste events at the editor DOM boundary'
);
assert.match(
  markdownEditorJs,
  /Date\.now\(\) < suppressPasteEnterUntil\) return true;/,
  'Enter emitted during paste completion must be consumed instead of submitting'
);
assert.match(
  markdownEditorJs,
  /function handleComposerKeyDown\([\s\S]*event\.key !== 'Enter'[\s\S]*requestSubmit\(\)/,
  'normal keyboard submit behavior must remain intact outside the paste guard'
);
assert.match(apiConfig, /CHATUI_VERSION = '1\.6'/, 'ChatUI Settings version must be 1.6');

console.log('ChatUI Plan 8 compact composer and paste-safety verification passed.');
