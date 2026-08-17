/**
 * workspace-navigation-bridge.js - Restore the chat surface for chat navigation actions.
 */

import { closeWorkspaceView } from './workspace-ui.js';
import './workspace-mobile.js';

const CHAT_NAVIGATION_SELECTORS = [
  '#new-chat-btn',
  '#create-chat-trigger',
  '#brand-new-chat',
  '.chat-item-link',
  '.add-chat-to-proj-btn'
].join(',');

document.addEventListener('click', event => {
  if (event.target.closest(CHAT_NAVIGATION_SELECTORS)) closeWorkspaceView();
}, true);
