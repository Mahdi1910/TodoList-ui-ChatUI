import assert from 'node:assert/strict';
import fs from 'node:fs';
import { READABLE_SELECTION_SELECTOR } from '../ChatUI/js/voice/read-selection.js';

const messagesCss = fs.readFileSync('ChatUI/css/chat/messages.css', 'utf8');
const markdownCss = fs.readFileSync('ChatUI/css/chat/markdown.css', 'utf8');
const renderer = fs.readFileSync('ChatUI/js/chat/message-renderer.js', 'utf8');
const readSelection = fs.readFileSync('ChatUI/js/voice/read-selection.js', 'utf8');
const chatControls = fs.readFileSync('ChatUI/js/ui/chat-controls.js', 'utf8');
const readAloud = fs.readFileSync('ChatUI/js/voice/read-aloud.js', 'utf8');
const liveAudio = fs.readFileSync('ChatUI/js/api/gemini-live-audio.js', 'utf8');
const activityRenderer = fs.readFileSync('ChatUI/js/chat/activity-renderer.js', 'utf8');
const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');

function channelToLinear(value) {
  const channel = value / 255;
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
}

function luminance(hex) {
  const raw = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map(index => channelToLinear(Number.parseInt(raw.slice(index, index + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(first, second) {
  const a = luminance(first);
  const b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

// Sent-message disclosure is measurement-only. Short prompts start with no
// control at all and cannot be promoted by a character/newline heuristic.
assert.match(renderer, /USER_MESSAGE_COLLAPSE_LINES\s*=\s*6/, 'sent-message visual limit must remain six lines');
assert.match(renderer, /toggle\.hidden\s*=\s*true;/, 'Show more must start hidden for every user message');
assert.doesNotMatch(renderer, /USER_MESSAGE_COLLAPSE_CHAR_HINT|likelyNeedsUserCollapse/, 'short/long classification must not use text-length heuristics');
assert.match(renderer, /const naturalHeight = text\.scrollHeight;/, 'overflow must measure the natural rendered text height');
assert.match(renderer, /const collapsedHeight = effectiveLineHeight \* USER_MESSAGE_COLLAPSE_LINES;/, 'overflow must compare against the six-line rendered height');
assert.match(renderer, /const hasOverflow = naturalHeight > collapsedHeight \+ 2;/, 'Show more must appear only after real rendered overflow');
assert.match(renderer, /toggle\.hidden = !hasOverflow;/, 'short messages must keep the disclosure hidden after measurement');
assert.match(renderer, /new ResizeObserver[\s\S]*observer\.observe\(text\)/, 'overflow must remeasure when the rendered text size changes');

// The new blue should be noticeably lighter than the previous #173E76 while
// still meeting normal-text contrast with white.
const bubbleColor = messagesCss.match(/--user-bubble-bg:\s*(#[0-9A-Fa-f]{6})/)?.[1];
assert.equal(bubbleColor?.toUpperCase(), '#2F6FBA', 'sent-message bubble must use the approved lighter medium/sky blue');
assert.ok(contrastRatio(bubbleColor, '#FFFFFF') >= 4.5, 'lighter sent-message blue must retain at least 4.5:1 contrast with white text');
assert.match(markdownCss, /\.user-bubble a\s*\{[\s\S]*color:\s*#FFFFFF;/, 'links inside the lighter blue bubble must remain clearly readable');

// Read Selected Text must understand all answer-rendering generations. Newer
// persisted assistant answers use activity-item-text instead of content-slot.
assert.match(activityRenderer, /className = 'activity-item activity-item-text'/, 'activity-timeline assistant answers must keep their readable text root');
assert.equal(
  READABLE_SELECTION_SELECTOR,
  '.message-text, .content-slot, .activity-item-text',
  'Read Selected Text must recognize user, legacy assistant, and activity-timeline answer roots'
);
assert.match(readSelection, /READABLE_SELECTION_SELECTOR = '\.message-text, \.content-slot, \.activity-item-text'/, 'selection root contract must stay explicit');
assert.match(readSelection, /if \(!text\) \{[\s\S]*clearSelectedReadText\(\);[\s\S]*return '';/, 'a new invalid selection must clear stale captured words instead of reusing them');
assert.match(readSelection, /selectedChatId !== state\.activeChatId[\s\S]*clearSelectedReadText\(\)/, 'captured selection must expire when the active chat changes');
assert.match(readSelection, /\.streaming-cursor/, 'selection extraction must omit transient streaming UI');

// Capture occurs before pointer focus can collapse the browser selection, then
// the exact snapshot is closed over by the action-menu item and passed into the
// existing read-aloud function.
assert.match(chatControls, /optionsBtn\?\.addEventListener\('pointerdown', \(\) => captureSelectedReadText\(\)\)/, 'chat options must capture selection before pointer focus changes it');
assert.match(chatControls, /const selectedText = getSelectedReadText\(\);/, 'chat options must snapshot the preserved selected text when opening');
assert.match(chatControls, /label:\s*'Read Selected Text'[\s\S]*disabled:\s*!selectedText[\s\S]*onSelect:\s*\(\) => readSelectedText\(selectedText\)/, 'Read Selected Text must enable from and speak the exact captured snapshot');
assert.match(readAloud, /export async function readSelectedText\(text\)[\s\S]*const sourceText = normalizeText\(text\);[\s\S]*sourceType: 'selection'/, 'Read Aloud must keep selection jobs isolated and use the supplied text');
assert.match(liveAudio, /buildReadAloudInput\(this\.text\)/, 'Gemini Live Audio must receive the selected-text job source without substituting conversation text');

assert.match(apiConfig, /CHATUI_VERSION = '2\.3'/, 'ChatUI Settings version must be 2.3');

console.log('ChatUI Plan 15 sent-message disclosure and Read Selected Text verification passed.');
