import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SIDEBAR_LONG_PRESS_MS,
  SIDEBAR_LONG_PRESS_MOVE_PX
} from '../ChatUI/js/sidebar/press-actions.js';

const rootHtml = fs.readFileSync('index.html', 'utf8');
const shellCss = fs.readFileSync('shell/css/shell.css', 'utf8');
const shellApp = fs.readFileSync('shell/js/app-shell.js', 'utf8');
const shellFrameBridge = fs.readFileSync('shell/js/frame-bridge.js', 'utf8');
const chatShellBridge = fs.readFileSync('ChatUI/js/embedded/shell-bridge.js', 'utf8');
const responsiveCss = fs.readFileSync('ChatUI/css/responsive.css', 'utf8');
const toolsCss = fs.readFileSync('ChatUI/css/chat/tools.css', 'utf8');
const composerJs = fs.readFileSync('ChatUI/js/composer/composer.js', 'utf8');
const chatControlsJs = fs.readFileSync('ChatUI/js/ui/chat-controls.js', 'utf8');
const sidebarHtml = fs.readFileSync('ChatUI/html/left-sidebar.html', 'utf8');
const sidebarCss = fs.readFileSync('ChatUI/css/sidebar/items.css', 'utf8');
const sidebarLayoutJs = fs.readFileSync('ChatUI/js/sidebar/sidebar-layout.js', 'utf8');
const sidebarRenderJs = fs.readFileSync('ChatUI/js/sidebar/sidebar-render.js', 'utf8');
const pressActionsJs = fs.readFileSync('ChatUI/js/sidebar/press-actions.js', 'utf8');
const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');

assert.doesNotMatch(rootHtml, /interactive-widget=resizes-content/, 'outer shell must not resize its layout viewport around the software keyboard');
assert.match(shellCss, /\.shell\s*\{[\s\S]*position:\s*relative;/, 'shell must provide a stable layout box for mobile navigation');
assert.match(shellCss, /@media \(max-width: 768px\)[\s\S]*\.shell-nav\s*\{[\s\S]*position:\s*absolute;[\s\S]*bottom:\s*0;/, 'mobile app navigation must stay anchored to the shell layout bottom');
assert.match(shellApp, /window\.visualViewport/, 'shell must observe the visual viewport for keyboard occlusion');
assert.match(shellApp, /stageBottom - visibleBottom/, 'keyboard occlusion must be calculated relative to the ChatUI stage, not by moving the shell rail');
assert.match(shellApp, /bridge\.setViewportInsets\('chat'/, 'shell must send keyboard occlusion only to ChatUI');
assert.match(shellFrameBridge, /function setViewportInsets\([\s\S]*shell:viewport-insets/, 'frame bridge must expose viewport inset messages');
assert.match(chatShellBridge, /case 'shell:viewport-insets':[\s\S]*applyShellViewportInsets/, 'embedded ChatUI must consume shell viewport insets');
assert.match(chatShellBridge, /--shell-keyboard-occlusion-bottom/, 'embedded ChatUI must publish keyboard occlusion as a CSS variable');
assert.match(responsiveCss, /margin-bottom:\s*var\(--shell-keyboard-occlusion-bottom,\s*0px\)/, 'mobile composer must rise by the shell-provided keyboard occlusion');

assert.match(responsiveCss, /#toggle-right-sidebar-btn\s*\{\s*display:\s*none\s*!important;/, 'mobile header must remove the dedicated Controls icon');
assert.match(responsiveCss, /\.model-selector-btn\s*\{[\s\S]*font-size:\s*15px;/, 'mobile model selector must use compact typography');
assert.match(responsiveCss, /\.thinking-selector-btn\s*\{[\s\S]*min-width:\s*0;[\s\S]*font-size:\s*13px;/, 'mobile thinking selector must shrink instead of forcing the header wide');
assert.match(chatControlsJs, /label:\s*'Controls'[\s\S]*icon:\s*'panel-right'[\s\S]*onSelect:\s*openRightSidebar/, 'mobile overflow menu must retain access to the Controls panel');

assert.match(toolsCss, /\.tool-option\s*\{[\s\S]*min-height:\s*48px;[\s\S]*cursor:\s*pointer;/, 'tool rows must be full-row touch targets');
assert.match(toolsCss, /\.tool-option \.toggle-switch\s*\{[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/, 'tool switches must have 44px finger targets');
assert.match(toolsCss, /\.tool-option \.toggle-slider\s*\{[\s\S]*width:\s*34px;[\s\S]*height:\s*18px;/, 'larger hit target must preserve the compact visible switch');
assert.match(toolsCss, /\.tools-menu-header \.close-btn\s*\{[\s\S]*width:\s*44px;[\s\S]*height:\s*44px;/, 'Tools close control must have a full touch target');
assert.match(composerJs, /row\?\.addEventListener\('click'[\s\S]*composerToggle\.dispatchEvent\(new Event\('change'/, 'tapping a tool row must toggle its checkbox exactly through the existing change path');
assert.match(toolsCss, /\.tool-indicator-pill\s*\{[\s\S]*width:\s*34px;[\s\S]*height:\s*34px;/, 'active tool indicators must be larger than the previous 28px buttons');
assert.match(toolsCss, /@media \(max-width: 767px\)[\s\S]*\.tool-indicator-pill\s*\{[\s\S]*width:\s*36px;[\s\S]*height:\s*36px;/, 'active tool indicators must grow slightly further on phones');

assert.equal(SIDEBAR_LONG_PRESS_MS, 500, 'sidebar long press must use a deliberate half-second hold');
assert.equal(SIDEBAR_LONG_PRESS_MOVE_PX, 10, 'sidebar long press must cancel when a finger starts scrolling');
assert.match(pressActionsJs, /addEventListener\('contextmenu'/, 'desktop right-click must open the same sidebar action menu');
assert.match(pressActionsJs, /ContextMenu[\s\S]*shiftKey[\s\S]*F10/, 'keyboard context-menu access must remain available');
assert.match(pressActionsJs, /suppressNextClick[\s\S]*stopImmediatePropagation/, 'a completed long press must not also navigate/collapse the row');
assert.match(pressActionsJs, /SUPPRESS_FOLLOWUP_CLICK_MS\s*=\s*900/, 'long-press click suppression must expire instead of eating a later normal tap');
assert.doesNotMatch(sidebarRenderJs, /add-chat-to-proj-btn|proj-options-btn|pin-chat-btn|chat-options-btn/, 'chat/project rows must not restore redundant action buttons');
assert.match(sidebarRenderJs, /bindSidebarActionPress\(projHeader/, 'project rows must use long-press/right-click actions');
assert.match(sidebarRenderJs, /bindSidebarActionPress\(link/, 'chat rows must use long-press/right-click actions');
assert.match(sidebarCss, /touch-action:\s*pan-y;/, 'sidebar rows must keep vertical scrolling compatible with long press');

assert.match(sidebarHtml, /id="sidebar-backdrop"/, 'mobile sidebar must have a real backdrop element');
assert.match(responsiveCss, /\.sidebar-backdrop:not\(\.hidden\)[\s\S]*z-index:\s*90;[\s\S]*background:\s*rgba\(0, 0, 0, 0\.45\)/, 'sidebar backdrop must visibly and physically cover underlying content');
assert.doesNotMatch(responsiveCss, /sidebar:not\(\.collapsed\)::after[\s\S]*pointer-events:\s*none/, 'non-interactive pseudo backdrops must not return');
assert.match(sidebarLayoutJs, /sidebarBackdrop\?\.addEventListener\('click'[\s\S]*event\.stopPropagation\(\);[\s\S]*closeSidebar\(\)/, 'backdrop taps must close the drawer without passing through');

assert.match(apiConfig, /CHATUI_VERSION = '2\.4'/, 'ChatUI Settings version must be 2.4');

console.log('ChatUI Plan 10 mobile interaction verification passed.');
