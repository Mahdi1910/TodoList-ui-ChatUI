/**
 * workspace-navigation-bridge.js - Keep Workspace app mode separate from chat navigation.
 */

import { closeWorkspaceView } from './workspace-ui.js';
import './workspace-mobile.js';

const CHAT_NAVIGATION_SELECTORS = [
  '#new-chat-btn',
  '#create-chat-trigger',
  '#brand-new-chat',
  '.chat-item',
  '.add-chat-to-proj-btn'
].join(',');

function restoreChatSurface() {
  closeWorkspaceView();
  document.title = 'ChatUI';
}

document.addEventListener('click', event => {
  if (event.target.closest(CHAT_NAVIGATION_SELECTORS)) restoreChatSurface();
}, true);

document.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  if (event.target.closest('#brand-new-chat, .chat-item')) restoreChatSurface();
}, true);

// Chat routes are not Workspace routes in the first version. Back/forward navigation
// therefore always restores the normal chat surface before the router loads its content.
window.addEventListener('popstate', restoreChatSurface);
