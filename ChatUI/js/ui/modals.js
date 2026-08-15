/**
 * modals.js — Generic Modal Open/Close, Backdrop Clicks, Focus Trap & Escape Key
 */

import { closeVoiceMode } from '../voice/voice-ui.js';
import { closeSettingsModal } from '../settings/settings.js';

export function getVisibleActiveDialog() {
  const createProjectModal = document.getElementById('create-project-modal');
  const settingsModal = document.getElementById('settings-modal');
  const voiceModeOverlay = document.getElementById('voice-mode-overlay');
  const searchModal = document.getElementById('search-modal');
  const addToProjectModal = document.getElementById('add-to-project-modal');
  const renameProjectModal = document.getElementById('rename-project-modal');

  if (createProjectModal && !createProjectModal.classList.contains('hidden')) return createProjectModal;
  if (settingsModal && !settingsModal.classList.contains('hidden')) return settingsModal;
  if (voiceModeOverlay && !voiceModeOverlay.classList.contains('hidden')) return voiceModeOverlay;
  if (searchModal && !searchModal.classList.contains('hidden')) return searchModal;
  if (addToProjectModal && !addToProjectModal.classList.contains('hidden')) return addToProjectModal;
  if (renameProjectModal && !renameProjectModal.classList.contains('hidden')) return renameProjectModal;

  return null;
}

export function initModalGlobalListeners() {
  const createProjectModal = document.getElementById('create-project-modal');
  const settingsModal = document.getElementById('settings-modal');
  const voiceModeOverlay = document.getElementById('voice-mode-overlay');
  const searchModal = document.getElementById('search-modal');
  const addToProjectModal = document.getElementById('add-to-project-modal');
  const renameProjectModal = document.getElementById('rename-project-modal');
  const modelMenu = document.getElementById('model-dropdown-menu');
  const modelTrigger = document.getElementById('model-dropdown-trigger');
  const thinkingMenu = document.getElementById('thinking-dropdown-menu');
  const thinkingTrigger = document.getElementById('thinking-dropdown-trigger');

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      let handled = false;

      // 1. Message context menus. The shared action menu owns its own Escape lifecycle.
      const contextMenus = document.querySelectorAll('.message-context-menu.show');
      if (contextMenus.length > 0) {
        contextMenus.forEach(menu => menu.classList.remove('show'));
        handled = true;
      }

      // 2. Selector Menus
      if (modelMenu && !modelMenu.classList.contains('hidden')) {
        modelMenu.classList.add('hidden');
        modelTrigger?.setAttribute('aria-expanded', 'false');
        modelTrigger?.focus();
        handled = true;
      }
      if (thinkingMenu && !thinkingMenu.classList.contains('hidden')) {
        thinkingMenu.classList.add('hidden');
        thinkingTrigger?.setAttribute('aria-expanded', 'false');
        thinkingTrigger?.focus();
        handled = true;
      }

      // 3. Modals & Voice Mode Overlay
      if (!handled) {
        if (createProjectModal && !createProjectModal.classList.contains('hidden')) {
          createProjectModal.classList.add('hidden');
        } else if (settingsModal && !settingsModal.classList.contains('hidden')) {
          closeSettingsModal();
        } else if (voiceModeOverlay && !voiceModeOverlay.classList.contains('hidden')) {
          closeVoiceMode();
        } else if (searchModal && !searchModal.classList.contains('hidden')) {
          searchModal.classList.add('hidden');
        } else if (addToProjectModal && !addToProjectModal.classList.contains('hidden')) {
          addToProjectModal.classList.add('hidden');
        } else if (renameProjectModal && !renameProjectModal.classList.contains('hidden')) {
          renameProjectModal.classList.add('hidden');
        }
      }
    }

    // Tab Key Focus Trap
    if (e.key === 'Tab') {
      const activeDialog = getVisibleActiveDialog();
      if (activeDialog) {
        const focusableElements = activeDialog.querySelectorAll(
          'a[href], button:not([disabled]), textarea:not([disabled]), input[type="text"]:not([disabled]), input[type="radio"]:not([disabled]), input[type="checkbox"]:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        const focusable = Array.from(focusableElements).filter(
          el => el.offsetWidth > 0 || el.offsetHeight > 0 || el.getClientRects().length > 0
        );

        if (focusable.length > 0) {
          const first = focusable[0];
          const last = focusable[focusable.length - 1];

          if (!activeDialog.contains(document.activeElement)) {
            e.preventDefault();
            (e.shiftKey ? last : first).focus();
            return;
          }

          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    }
  });
}
