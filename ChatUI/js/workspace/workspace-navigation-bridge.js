/**
 * workspace-navigation-bridge.js - Keep Workspace app mode separate from chat navigation.
 */

import { closeWorkspaceView } from './workspace-ui.js';
import { initWorkspaceMobile, destroyWorkspaceMobile } from './workspace-mobile.js';

const CHAT_NAVIGATION_SELECTORS = [
  '#new-chat-btn',
  '#create-chat-trigger',
  '#brand-new-chat',
  '.chat-item',
  '.add-chat-to-proj-btn'
].join(',');

let cleanupCurrent = null;

export function initWorkspaceNavigationBridge() {
  cleanupCurrent?.();

  const restoreChatSurface = () => {
    closeWorkspaceView();
  };
  const onClick = event => {
    if (event.target.closest(CHAT_NAVIGATION_SELECTORS)) restoreChatSurface();
  };
  const onKeydown = event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    if (event.target.closest('#brand-new-chat, .chat-item')) restoreChatSurface();
  };

  document.addEventListener('click', onClick, true);
  document.addEventListener('keydown', onKeydown, true);
  const mobileCleanup = initWorkspaceMobile();

  cleanupCurrent = () => {
    document.removeEventListener('click', onClick, true);
    document.removeEventListener('keydown', onKeydown, true);
    mobileCleanup?.();
    destroyWorkspaceMobile();
    cleanupCurrent = null;
  };
  return cleanupCurrent;
}

export function destroyWorkspaceNavigationBridge() {
  cleanupCurrent?.();
}
