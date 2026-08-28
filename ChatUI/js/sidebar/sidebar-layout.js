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
  const sidebarBackdrop = document.getElementById('sidebar-backdrop');
  const toggleSidebarBtn = document.getElementById('toggle-sidebar-btn');
  const openSidebarBtn = document.getElementById('open-sidebar-btn');
  const newChatBtn = document.getElementById('new-chat-btn');
  const createChatTrigger = document.getElementById('create-chat-trigger');
  const brandNewChat = document.getElementById('brand-new-chat');
  const createProjectTrigger = document.getElementById('create-project-trigger');
  const createProjectModal = document.getElementById('create-project-modal');
  const mobileQuery = window.matchMedia('(max-width: 767px)');

  const syncSidebarBackdrop = () => {
    if (!sidebarBackdrop || !sidebar) return;
    const visible = mobileQuery.matches && !sidebar.classList.contains('collapsed');
    sidebarBackdrop.classList.toggle('hidden', !visible);
    sidebarBackdrop.setAttribute('aria-hidden', visible ? 'false' : 'true');
  };

  const closeSidebar = () => {
    if (!sidebar) return;
    sidebar.classList.add('collapsed');
    syncSidebarBackdrop();
  };

  const openSidebar = () => {
    if (!sidebar) return;
    sidebar.classList.remove('collapsed');
    syncSidebarBackdrop();
  };

  toggleSidebarBtn?.addEventListener('click', closeSidebar);
  openSidebarBtn?.addEventListener('click', openSidebar);

  sidebarBackdrop?.addEventListener('click', event => {
    event.preventDefault();
    event.stopPropagation();
    closeSidebar();
  });

  if (sidebar && mobileQuery.matches) closeSidebar();
  else syncSidebarBackdrop();

  const handleViewportModeChange = () => syncSidebarBackdrop();
  if (typeof mobileQuery.addEventListener === 'function') mobileQuery.addEventListener('change', handleViewportModeChange);
  else mobileQuery.addListener?.(handleViewportModeChange);

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
