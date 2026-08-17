/**
 * sidebar-layout.js - Sidebar open/close, mobile drawer, and initialization wiring.
 */

import { startNewChat, initRenameChatModal } from '../chat/chat.js';
import { buildNewChatHref, isUnmodifiedPrimaryNavigation } from '../router/app-links.js';
import { initProjectModalListeners } from './projects.js';
import { initSearchUI } from './search.js';
import { renderSidebar } from './sidebar-render.js';

export function initSidebarUI() {
  const sidebar = document.getElementById('sidebar');
  const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
  const openSidebarBtn = document.getElementById('open-sidebar-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const createChatTrigger = document.getElementById('create-chat-trigger');
  const brandNewChat = document.getElementById('brand-new-chat');
  const createProjectTrigger = document.getElementById('create-project-trigger');
  const createProjectModal = document.getElementById('create-project-modal');

  if (toggleSidebarBtn && sidebar) {
    toggleSidebarBtn.addEventListener('click', () => sidebar.classList.add('collapsed'));
  }

  if (openSidebarBtn && sidebar) {
    openSidebarBtn.addEventListener('click', () => sidebar.classList.remove('collapsed'));
  }

  document.addEventListener('click', event => {
    if (!window.matchMedia('(max-width: 767px)').matches) return;
    if (sidebar.classList.contains('collapsed')) return;
    if (sidebar.contains(event.target) || openSidebarBtn?.contains(event.target)) return;
    sidebar.classList.add('collapsed');
  });

  if (sidebar && window.matchMedia('(max-width: 767px)').matches) {
    sidebar.classList.add('collapsed');
  }

  const goToNewChat = () => startNewChat(renderSidebar);
  const newChatHref = buildNewChatHref();
  [newChatBtn, brandNewChat].forEach(anchor => {
    if (!anchor) return;
    anchor.href = newChatHref;
    anchor.addEventListener('click', event => {
      if (!isUnmodifiedPrimaryNavigation(event)) return;
      event.preventDefault();
      goToNewChat();
    });
  });

  createChatTrigger?.addEventListener('click', goToNewChat);

  if (createProjectTrigger && createProjectModal) {
    createProjectTrigger.addEventListener('click', () => {
      createProjectModal.classList.remove('hidden');
      const input = createProjectModal.querySelector('#project-name-input');
      if (input) {
        input.value = '';
        input.focus();
      }
    });
  }

  initProjectModalListeners(renderSidebar);
  initRenameChatModal(renderSidebar);
  initSearchUI(renderSidebar);
  renderSidebar();
}
