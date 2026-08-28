/**
 * sidebar-render.js - Render pinned chats, projects, and independent chats.
 */

import { state, runtime, setRuntime } from '../state/store.js';
import { persistSettings } from '../storage/storage.js';
import { loadChat } from '../chat/chat.js';
import { buildChatHref, isUnmodifiedPrimaryNavigation } from '../router/app-links.js';
import { openChatOptionsMenu, openProjectOptionsMenu } from './sidebar-actions.js';
import { bindSidebarActionPress } from './press-actions.js';
import { escapeHtml } from '../utils/dom.js';

function sortChatsNewestFirst(chats) {
  return [...chats].sort((a, b) => {
    const createdA = Number(a?.createdAt) || 0;
    const createdB = Number(b?.createdAt) || 0;
    if (createdA !== createdB) return createdB - createdA;
    return String(b?.id || '').localeCompare(String(a?.id || ''));
  });
}

export function renderSidebar() {
  const pinnedChatList = document.getElementById('pinned-chat-list');
  const projectList = document.getElementById('project-list');
  const recentChatList = document.getElementById('recent-chat-list');

  if (pinnedChatList) {
    pinnedChatList.innerHTML = '';
    const pinnedChats = sortChatsNewestFirst(state.chats.filter(c => c.pinned));
    if (pinnedChats.length === 0) pinnedChatList.innerHTML = '<li class="empty-section-text" id="empty-pinned-msg">No pinned chats</li>';
    else pinnedChats.forEach(chat => pinnedChatList.appendChild(createChatItemNode(chat)));
  }

  if (projectList) {
    projectList.innerHTML = '';
    if (state.projects.length === 0) {
      projectList.innerHTML = '<li class="empty-section-text" id="empty-project-msg">No projects yet</li>';
    } else {
      state.projects.forEach(project => {
        const li = document.createElement('li');
        const isCollapsed = runtime.collapsedProjectIds.has(project.id);
        li.className = `project-item ${state.activeProjectId === project.id ? 'active' : ''} ${isCollapsed ? 'collapsed' : ''}`;
        li.dataset.projectId = project.id;

        const projHeader = document.createElement('div');
        projHeader.className = 'project-header-item';
        projHeader.setAttribute('role', 'button');
        projHeader.setAttribute('tabindex', '0');
        projHeader.setAttribute('aria-expanded', String(!isCollapsed));
        projHeader.setAttribute('aria-label', `${project.name}. Press and hold or open the context menu for project actions.`);
        projHeader.innerHTML = `
          <i data-lucide="chevron-down" class="project-collapse-icon"></i>
          <i data-lucide="folder"></i>
          <span class="chat-item-title">${escapeHtml(project.name)}</span>`;

        const toggleProject = async () => {
          const previousCollapsedProjectIds = new Set(runtime.collapsedProjectIds);
          const collapsedProjectIds = new Set(runtime.collapsedProjectIds);
          if (collapsedProjectIds.has(project.id)) collapsedProjectIds.delete(project.id);
          else collapsedProjectIds.add(project.id);
          setRuntime({ collapsedProjectIds });
          renderSidebar();

          try {
            await persistSettings();
          } catch (err) {
            setRuntime({ collapsedProjectIds: previousCollapsedProjectIds });
            renderSidebar();
            console.error('Failed to save project collapse state:', err);
          }
        };

        bindSidebarActionPress(projHeader, () => openProjectOptionsMenu(projHeader, project, renderSidebar));

        projHeader.addEventListener('click', toggleProject);
        projHeader.addEventListener('keydown', event => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleProject();
          }
        });

        li.appendChild(projHeader);
        const projectChats = sortChatsNewestFirst(state.chats.filter(c => c.projectId === project.id));
        if (projectChats.length > 0) {
          const nestedUl = document.createElement('ul');
          nestedUl.className = 'chat-list nested-project-chats';
          projectChats.forEach(pChat => nestedUl.appendChild(createChatItemNode(pChat)));
          li.appendChild(nestedUl);
        }
        projectList.appendChild(li);
      });
    }
  }

  if (recentChatList) {
    recentChatList.innerHTML = '';
    const recentChats = sortChatsNewestFirst(state.chats.filter(c => !c.projectId && !c.pinned));
    if (recentChats.length === 0) recentChatList.innerHTML = '<li class="empty-section-text" id="empty-chats-msg">Your chat history will appear here</li>';
    else recentChats.forEach(chat => recentChatList.appendChild(createChatItemNode(chat)));
  }

  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function createChatItemNode(chat) {
  const li = document.createElement('li');
  const active = state.activeChatId === chat.id;
  li.className = `chat-item ${active ? 'active' : ''}`;
  li.dataset.chatId = chat.id;

  const link = document.createElement('a');
  link.className = 'chat-item-link';
  link.href = buildChatHref(chat.id);
  link.setAttribute('aria-label', `${chat.title}. Press and hold or open the context menu for chat actions.`);
  if (active) link.setAttribute('aria-current', 'page');

  const icon = document.createElement('i');
  icon.setAttribute('data-lucide', 'message-square');
  const title = document.createElement('span');
  title.className = 'chat-item-title';
  title.textContent = chat.title;
  link.append(icon, title);

  const isBackgroundGenerating = chat.isGenerating && !active;
  if (isBackgroundGenerating) {
    const indicator = document.createElement('span');
    indicator.className = 'sidebar-chat-generating';
    indicator.title = 'Generating response in background...';
    indicator.innerHTML = '<span class="sidebar-generating-dot"></span><span class="sidebar-generating-dot"></span><span class="sidebar-generating-dot"></span>';
    link.appendChild(indicator);
  }

  bindSidebarActionPress(link, () => openChatOptionsMenu(link, chat, renderSidebar));

  link.addEventListener('click', event => {
    if (!isUnmodifiedPrimaryNavigation(event)) return;
    event.preventDefault();
    void loadChat(chat.id, renderSidebar, { historyMode: 'push' });
  });

  li.append(link);
  return li;
}
