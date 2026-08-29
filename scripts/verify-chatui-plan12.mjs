import assert from 'node:assert/strict';
import fs from 'node:fs';

const composerCss = fs.readFileSync('ChatUI/css/chat/composer.css', 'utf8');
const settingsCss = fs.readFileSync('ChatUI/css/components/settings.css', 'utf8');
const readSettingsJs = fs.readFileSync('ChatUI/js/voice/read-settings.js', 'utf8');
const messageControlsJs = fs.readFileSync('ChatUI/js/chat/message-controls.js', 'utf8');
const messageActionsCss = fs.readFileSync('ChatUI/css/chat/message-actions.css', 'utf8');
const sidebarCss = fs.readFileSync('ChatUI/css/sidebar/items.css', 'utf8');
const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');

assert.match(composerCss, /\.composer-bar:has\(\.ProseMirror:focus-visible\)[\s\S]*border-color:\s*var\(--accent-blue\)/, 'composer focus must be shown on the outer rounded surface');
assert.match(composerCss, /\.composer-bar \.composer-editor-host \.ProseMirror:focus-visible[\s\S]*outline:\s*none/, 'inner rectangular composer focus ring must be suppressed');

assert.match(readSettingsJs, /legacySelect\.replaceWith\(root\)/, 'native Audio Read voice select must be replaced by the custom picker at runtime');
assert.match(readSettingsJs, /id="audio-read-voice-trigger"[\s\S]*id="audio-read-voice-menu"[\s\S]*id="audio-read-voice-preview-btn"/, 'custom voice picker must include trigger, listbox, and preview control');
assert.match(readSettingsJs, /startGeminiLiveAudio\(/, 'voice preview must use the existing Gemini Live audio transport');
assert.match(readSettingsJs, /new ReadAudioEngine\(/, 'voice preview must play through the existing PCM audio engine');
assert.match(settingsCss, /\.audio-voice-menu\s*\{[\s\S]*background:\s*#1f1f1f;[\s\S]*max-height:/, 'voice choices must use a bounded dark application menu');
assert.match(settingsCss, /\.audio-voice-preview-btn\s*\{[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/, 'voice preview must have a clear standalone play control');

assert.match(settingsCss, /scrollbar-color:\s*rgba\(148, 163, 184, 0\.42\) transparent;/, 'Settings scrollbar must use a subtle dark-theme rail instead of browser white');
assert.match(settingsCss, /\.settings-card \.settings-close-btn\s*\{[\s\S]*right:\s*max\(18px,[\s\S]*width:\s*40px;[\s\S]*height:\s*40px;/, 'Settings close control must be separated from the scroll rail');

assert.match(messageControlsJs, /class="toolbar-btn message-more-btn"/, 'message toolbar must expose a More actions button');
assert.match(messageControlsJs, /isAssistant[\s\S]*read-msg-btn[\s\S]*regenerate-msg-btn/, 'assistant primary toolbar must keep read/regenerate actions compactly available');
assert.match(messageControlsJs, /edit-msg-menu-item[\s\S]*delete-msg-menu-item/, 'assistant overflow must retain edit and delete actions');
assert.match(messageControlsJs, /regenerate-msg-menu-item[\s\S]*delete-msg-menu-item/, 'user overflow must retain regenerate and delete actions');
assert.doesNotMatch(messageControlsJs, /share-msg|send-msg|data-lucide="share|data-lucide="send/, 'message toolbar must not invent share or send actions');
assert.match(messageActionsCss, /\.message-more-menu\s*\{[\s\S]*position:\s*absolute;[\s\S]*background:\s*#242424;/, 'extra message actions must render as a compact dark popup');

assert.match(sidebarCss, /\.project-header-item\s*\{[\s\S]*grid-template-columns:\s*18px minmax\(0, 1fr\) 16px;/, 'project title must share the first-level icon/text alignment with normal chats');
assert.match(sidebarCss, /\.project-header-item > \.project-collapse-icon\s*\{[\s\S]*grid-column:\s*3;/, 'project collapse chevron must move to the trailing edge instead of pushing the title inward');
assert.match(sidebarCss, /\.nested-project-chats::before\s*\{[\s\S]*background:\s*var\(--border-color\)/, 'nested project chats must have a subtle hierarchy guide');
assert.match(sidebarCss, /\.chat-item\.active\s*\{[\s\S]*font-weight:\s*500;/, 'selected chat background/state must remain intact');

assert.match(apiConfig, /CHATUI_VERSION = '2\.0'/, 'ChatUI Settings version must be 2.0');

console.log('ChatUI Plan 12 UI refinement verification passed.');
