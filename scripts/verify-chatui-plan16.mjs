import assert from 'node:assert/strict';
import fs from 'node:fs';
import { READABLE_SELECTION_SELECTOR } from '../ChatUI/js/voice/read-selection.js';

const readSelection = fs.readFileSync('ChatUI/js/voice/read-selection.js', 'utf8');
const messagesCss = fs.readFileSync('ChatUI/css/chat/messages.css', 'utf8');
const chatControls = fs.readFileSync('ChatUI/js/ui/chat-controls.js', 'utf8');
const readAloud = fs.readFileSync('ChatUI/js/voice/read-aloud.js', 'utf8');

assert.equal(
  READABLE_SELECTION_SELECTOR,
  '.message-text, .content-slot, .activity-item-text',
  'all user, legacy assistant, and activity-timeline text roots must remain readable'
);

// Triple-click/paragraph selection may put one browser Range endpoint in the
// parent container just outside the visible line. Selection extraction must
// intersect and clip to readable roots instead of rejecting those endpoints.
assert.match(readSelection, /function rangeIntersectionWithRoot\(range, root\)/, 'selection extraction must clip browser ranges to readable message roots');
assert.match(readSelection, /range\.intersectsNode\(root\)/, 'selection extraction must discover readable roots from actual range intersection');
assert.match(readSelection, /compareBoundaryPoints\(Range\.START_TO_START, rootRange\) < 0/, 'selection start outside a readable root must clip to the root start');
assert.match(readSelection, /compareBoundaryPoints\(Range\.END_TO_END, rootRange\) > 0/, 'selection end outside a readable root must clip to the root end');
assert.doesNotMatch(readSelection, /const startRoot = allowedRootFor|const endRoot = allowedRootFor/, 'selection must not require both browser endpoints to live inside readable roots');
assert.match(readSelection, /if \(!roots\.length\) return '';/, 'selection entirely outside conversation text must still be rejected');
assert.match(readSelection, /if \(!text\) \{[\s\S]*clearSelectedReadText\(\)/, 'invalid visible selections must not revive stale captured text');

// Opening the chat menu must still snapshot before pointer focus can collapse
// the browser selection, and Read Aloud must consume that exact snapshot.
assert.match(chatControls, /optionsBtn\?\.addEventListener\('pointerdown', \(\) => captureSelectedReadText\(\)\)/, 'chat menu must capture the selection before focus changes it');
assert.match(chatControls, /onSelect:\s*\(\) => readSelectedText\(selectedText\)/, 'Read Selected Text must use the captured selection snapshot');
assert.match(readAloud, /export async function readSelectedText\(text\)/, 'existing selected-text Read Aloud coordinator must remain in use');

// The whole sent-message bubble must never become a left/right scroller for
// ordinary prose. Text wraps at word boundaries, with long unbreakable tokens
// allowed to break only when needed. Dedicated code/table surfaces retain local
// overflow handling rather than making the whole message scroll.
assert.match(messagesCss, /\.user-bubble\s*\{[\s\S]*overflow-x:\s*hidden;/, 'user bubble must not expose a horizontal scrollbar');
assert.doesNotMatch(messagesCss, /\.user-bubble\s*\{[^}]*overflow-x:\s*auto;/, 'whole user bubble must never return to horizontal auto-scroll');
assert.match(
  messagesCss,
  /\.user-bubble \.markdown-content,[\s\S]*\.user-bubble blockquote\s*\{[\s\S]*white-space:\s*normal;[\s\S]*overflow-wrap:\s*break-word;[\s\S]*word-break:\s*normal;/,
  'normal user prose must wrap naturally inside the bubble'
);
assert.match(messagesCss, /\.user-bubble pre,[\s\S]*\.user-bubble table \{ max-width:\s*100%; overflow-x:\s*auto; \}/, 'specialized code/table surfaces may keep local horizontal overflow');

console.log('ChatUI Plan 16 triple-click selection and sent-message wrapping verification passed.');
