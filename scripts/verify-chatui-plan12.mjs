import assert from 'node:assert/strict';
import fs from 'node:fs';

const composerCss = fs.readFileSync('ChatUI/css/chat/composer.css', 'utf8');
const settingsCss = fs.readFileSync('ChatUI/css/components/settings.css', 'utf8');
const refinementsCss = fs.readFileSync('ChatUI/css/refinements.css', 'utf8');
const readSettingsJs = fs.readFileSync('ChatUI/js/voice/read-settings.js', 'utf8');
const messageControlsJs = fs.readFileSync('ChatUI/js/chat/message-controls.js', 'utf8');
const actionMenuJs = fs.readFileSync('ChatUI/js/ui/action-menu.js', 'utf8');
const sidebarCss = fs.readFileSync('ChatUI/css/sidebar/items.css', 'utf8');
const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');

assert.match(composerCss, /\.composer-bar:has\(\.ProseMirror:focus-visible\)[\s\S]*border-color:\s*var\(--border-color\)[\s\S]*box-shadow:\s*none/, 'composer must keep its normal rounded surface while focused');
assert.match(composerCss, /\.composer-bar \.composer-editor-host \.ProseMirror:focus-visible[\s\S]*outline:\s*none/, 'inner rectangular composer focus ring must remain suppressed');

assert.match(readSettingsJs, /legacySelect\.replaceWith\(root\)/, 'native Audio Read voice select must be replaced by the custom picker at runtime');
assert.match(readSettingsJs, /id="audio-read-voice-trigger"[\s\S]*id="audio-read-voice-menu"[\s\S]*id="audio-read-voice-preview-btn"/, 'custom voice picker must include trigger, listbox, and preview control');
assert.match(readSettingsJs, /startGeminiLiveAudio\(/, 'voice preview must use the existing Gemini Live audio transport');
assert.match(readSettingsJs, /new ReadAudioEngine\(/, 'voice preview must play through the existing PCM audio engine');
assert.match(settingsCss, /\.audio-voice-menu\s*\{[\s\S]*max-height:[\s\S]*background:\s*#1f1f1f;/, 'voice choices must remain bounded in the base component');
assert.match(refinementsCss, /\.audio-voice-menu\s*\{[\s\S]*background:\s*var\(--menu-bg\)/, 'voice picker surface must follow the active light/dark theme');
assert.match(settingsCss, /\.audio-voice-preview-btn\s*\{[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/, 'voice preview must have a clear standalone play control');

assert.match(refinementsCss, /scrollbar-color:\s*var\(--scrollbar-thumb\) transparent/, 'Settings scrollbar must use theme-aware muted colors');
assert.match(settingsCss, /\.settings-card \.settings-close-btn\s*\{[\s\S]*right:\s*max\(18px,[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/, 'Settings close control must remain separated from the scroll rail');

assert.match(messageControlsJs, /class="toolbar-btn message-more-btn"/, 'message toolbar must expose a More actions button');
assert.match(messageControlsJs, /isAssistant[\s\S]*read-msg-btn[\s\S]*regenerate-msg-btn/, 'assistant primary toolbar must keep read/regenerate actions compactly available');
assert.match(messageControlsJs, /label:\s*'Edit message'[\s\S]*label:\s*'Delete message'/, 'assistant overflow must retain edit and delete actions');
assert.match(messageControlsJs, /label:\s*'Regenerate response'[\s\S]*label:\s*'Delete message'/, 'user overflow must retain regenerate and delete actions');
assert.match(messageControlsJs, /openActionMenu\(moreBtn,[\s\S]*placement:\s*'top-start'/, 'message overflow must use the shared ChatGPT-style popup above the leading edge of the More button');
assert.match(actionMenuJs, /placement === 'top-start'[\s\S]*left = rect\.left;[\s\S]*top = rect\.top - height - gap;/, 'shared menu primitive must implement top-start anchoring');
assert.doesNotMatch(messageControlsJs, /share-msg|send-msg|data-lucide="share|data-lucide="send/, 'message toolbar must not invent share or send actions');

assert.match(sidebarCss, /\.project-header-item\s*\{[\s\S]*grid-template-columns:\s*18px minmax\(0, 1fr\) 16px;/, 'project title must share the first-level icon/text alignment with normal chats');
assert.match(sidebarCss, /\.project-header-item > \.project-collapse-icon\s*\{[\s\S]*grid-column:\s*3;/, 'project collapse chevron must stay on the trailing edge');
assert.match(sidebarCss, /\.nested-project-chats::before\s*\{[\s\S]*background:\s*var\(--border-color\)/, 'nested project chats must retain the subtle hierarchy guide');
assert.match(sidebarCss, /\.chat-item\.active\s*\{[\s\S]*font-weight:\s*500;/, 'selected chat state must remain intact');

assert.match(apiConfig, /CHATUI_VERSION = '2\.3'/, 'ChatUI Settings version must be 2.3');

console.log('ChatUI Plan 12 UI refinement verification passed.');
