import assert from 'node:assert/strict';
import fs from 'node:fs';
import { state, setState } from '../ChatUI/js/state/store.js';
import {
  ensureTextApiProfilesState,
  selectTextApiProfile
} from '../ChatUI/js/api/text-api-profiles.js';

const mainCss = fs.readFileSync('ChatUI/css/main.css', 'utf8');
const refinementsCss = fs.readFileSync('ChatUI/css/refinements.css', 'utf8');
const rightSidebarCss = fs.readFileSync('ChatUI/css/components/right-sidebar.css', 'utf8');
const settingsCss = fs.readFileSync('ChatUI/css/components/settings.css', 'utf8');
const settingsHtml = fs.readFileSync('ChatUI/html/settings-modal.html', 'utf8');
const mainChatHtml = fs.readFileSync('ChatUI/html/main-chat.html', 'utf8');
const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');
const utilityApi = fs.readFileSync('ChatUI/js/api/gemini-utility.js', 'utf8');
const autoTitle = fs.readFileSync('ChatUI/js/chat/auto-title.js', 'utf8');
const generationRunner = fs.readFileSync('ChatUI/js/chat/generation-runner.js', 'utf8');
const conversation = fs.readFileSync('ChatUI/js/chat/conversation.js', 'utf8');
const records = fs.readFileSync('ChatUI/js/storage/records.js', 'utf8');
const load = fs.readFileSync('ChatUI/js/storage/load.js', 'utf8');
const messageControls = fs.readFileSync('ChatUI/js/chat/message-controls.js', 'utf8');
const actionMenu = fs.readFileSync('ChatUI/js/ui/action-menu.js', 'utf8');

// Text API profiles: old one-profile installs migrate into Mode 1, while Mode 2
// starts empty and each mode keeps its own key health/base-URL state.
setState({
  api: {
    textApiKey: 'legacy-key',
    textApiKeys: [{ key: 'legacy-key', cooldownUntil: 123, validationStatus: 'valid' }],
    textApiKeyIndex: 0,
    textBaseUrl: 'https://mode-one.example',
    voiceApiKey: 'voice-key',
    voiceBaseUrl: ''
  }
});
let api = ensureTextApiProfilesState();
assert.equal(api.activeTextProfileId, 'mode-1', 'legacy text API settings must migrate into Mode 1');
assert.equal(api.textProfiles.length, 2, 'exactly two persistent Text API modes must exist');
assert.equal(api.textProfiles[0].textApiKeys[0].cooldownUntil, 123, 'Mode 1 must preserve key health metadata');
assert.equal(api.textProfiles[1].textApiKeys.length, 0, 'Mode 2 must start empty for a legacy install');

selectTextApiProfile('mode-2');
setState({
  api: {
    ...state.api,
    textApiKey: 'mode-two-key',
    textApiKeys: [{ key: 'mode-two-key', cooldownUntil: 456, validationStatus: 'rate-limited' }],
    textApiKeyIndex: 0,
    textBaseUrl: 'https://mode-two.example'
  }
});
selectTextApiProfile('mode-1');
assert.equal(state.api.textApiKey, 'legacy-key', 'returning to Mode 1 must restore its own active key');
assert.equal(state.api.textApiKeys[0].cooldownUntil, 123, 'Mode 1 cooldown state must survive a mode switch');
assert.equal(state.api.textBaseUrl, 'https://mode-one.example', 'Mode 1 Base URL must survive a mode switch');
selectTextApiProfile('mode-2');
assert.equal(state.api.textApiKey, 'mode-two-key', 'Mode 2 must restore its independent key');
assert.equal(state.api.textApiKeys[0].cooldownUntil, 456, 'Mode 2 cooldown state must survive a mode switch');
assert.equal(state.api.textBaseUrl, 'https://mode-two.example', 'Mode 2 Base URL must survive a mode switch');

// Message overflow placement and focus behavior.
assert.match(messageControls, /openActionMenu\(moreBtn,[\s\S]*placement:\s*'top-start'/, 'message More menu must request ChatGPT-style top-start placement');
assert.match(actionMenu, /placement === 'top-start'[\s\S]*left = rect\.left;[\s\S]*top = rect\.top - height - gap;/, 'shared action menu must anchor above the left edge of its button');
assert.match(mainCss, /input:focus,[\s\S]*textarea:focus,[\s\S]*select:focus,[\s\S]*outline:\s*none;/, 'normal input fields must not receive the blue focus outline');
assert.match(refinementsCss, /\.composer-bar:focus-within,[\s\S]*border-color:\s*var\(--border-color\)\s*!important;[\s\S]*box-shadow:\s*none/, 'composer focus must keep its normal border without a blue line');

// Light appearance must use explicit light hover/selected/menu tokens rather than
// inheriting dark-theme surfaces.
assert.match(mainCss, /--bg-selected:/, 'theme state must expose a selected-row token');
assert.match(mainCss, /--menu-bg:/, 'theme state must expose a popup-surface token');
assert.match(refinementsCss, /\.chat-item\.active\s*\{[^}]*var\(--bg-selected\)/, 'selected chats must use the appearance-aware selected token');
assert.match(refinementsCss, /\.action-popup-menu[\s\S]*var\(--menu-bg\)/, 'shared action menus must use the appearance-aware menu surface');
assert.match(refinementsCss, /\.action-menu-item:focus-visible\s*\{[\s\S]*var\(--focus-ring\)/, 'menu keyboard focus must not retain a hard-coded dark-theme outline');
assert.match(settingsCss, /\.settings-section-btn:hover\s*\{\s*background:\s*var\(--bg-hover\)/, 'Settings hover rows must remain token-driven');

// Desktop Controls panel is a real flex sibling that consumes width; mobile keeps
// the existing overlay-drawer behavior.
assert.match(rightSidebarCss, /@media \(min-width: 768px\)[\s\S]*\.right-sidebar\s*\{[\s\S]*position:\s*relative;[\s\S]*flex:\s*0 0 var\(--right-sidebar-width/, 'desktop right sidebar must participate in layout and push/shrink chat content');
assert.match(rightSidebarCss, /@media \(max-width: 767px\)[\s\S]*\.right-sidebar\s*\{[\s\S]*position:\s*absolute;/, 'mobile right sidebar must remain an overlay drawer');

// Settings must expose the two persistent modes without runtime-only layout shift,
// and the key editor must start compact.
assert.match(settingsHtml, /id="text-api-profile-switcher"[\s\S]*data-text-api-profile="mode-1"[\s\S]*Mode 1[\s\S]*data-text-api-profile="mode-2"[\s\S]*Mode 2/, 'Gemini Settings must render Mode 1 and Mode 2 explicitly');
assert.match(settingsHtml, /<textarea[^>]+id="text-api-key-input"[^>]+rows="3"/, 'Gemini text-key textarea must keep its multiline markup fallback');
assert.match(apiConfig, /selectTextApiProfile\(button\.dataset\.textApiProfile\)/, 'mode selection must use the persistent Text API profile state');

// Background title generation must use the repository's streaming-only text
// transport and the selected Text API profile/failover path.
assert.match(utilityApi, /:streamGenerateContent\?alt=sse/, 'background Gemini utility work must use SSE streaming');
assert.doesNotMatch(utilityApi, /:generateContent(?:[`?"'])/, 'background title work must not introduce a non-stream text-generation endpoint');
assert.match(utilityApi, /runWithTextApiKeyFailover/, 'background title work must reuse Text API key rotation/failover');
assert.match(autoTitle, /AUTO_TITLE_MODEL_ID = 'gemini-3\.5-flash-lite'/, 'automatic titles must use the fixed Gemini 3.5 Flash Lite backend model');
assert.match(autoTitle, /pairs\.length < 2/, 'automatic title generation must wait for two completed user-assistant pairs');
assert.match(autoTitle, /message\.status !== 'completed'/, 'only completed assistant answers may count toward the two-turn threshold');
assert.match(autoTitle, /const current = state\.chats\.find[\s\S]*if \(!eligibleChat\(current\)\) return false;/, 'automatic title must re-check ownership after its network request');
assert.match(conversation, /titleSource:\s*'manual'/, 'manual chat rename must permanently take title ownership');
assert.match(records, /titleSource:[\s\S]*autoTitleGeneratedAt:/, 'chat persistence must store title ownership and generation state');
assert.match(load, /titleSource:[\s\S]*autoTitleGeneratedAt:/, 'chat loading must restore title ownership and generation state');
assert.ok(
  generationRunner.indexOf('maybeGenerateAutomaticChatTitle(chat.id') > generationRunner.indexOf('await persistChatMessage'),
  'automatic title generation must only be scheduled after the completed assistant has been persisted'
);

// New-chat landing stays visually clean while non-default loading/error copy can
// still be shown by conversation.js.
assert.match(mainChatHtml, /landing-title default-landing-title/, 'default empty-state title must be explicitly classed for suppression');
assert.match(refinementsCss, /#empty-state \.landing-title\.default-landing-title\s*\{[\s\S]*display:\s*none;/, 'default new-chat heading must be hidden');
assert.match(conversation, /title\.classList\.toggle\('default-landing-title', message === 'What can I help with\?'\)/, 'loading/error messages must remove the default-only hidden marker');

assert.match(apiConfig, /CHATUI_VERSION = '2\.3'/, 'ChatUI Settings version must be 2.3');

console.log('ChatUI Plan 13 theme, profiles, layout, menu, and automatic-title verification passed.');
