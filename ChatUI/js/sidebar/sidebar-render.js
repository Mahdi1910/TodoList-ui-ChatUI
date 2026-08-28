/**
 * sidebar-render.js - Render pinned chats, projects, and independent chats.
 */

import { state, runtime, setRuntime, updateChat } from '../state/store.js';
import { persistSettings, persistChatMetadata } from '../storage/storage.js';
import { loadChat } from '../chat/chat.js';
import { buildChatHref, isUnmodifiedPrimaryNavigation } from '../router/app-links.js';
import { createNewChatInProject } from './projects.js';
import { openChatOptionsMenu, openProjectOptionsMenu } from './sidebar-actions.js';
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
        projHeader.innerHTML = `
          <i data-lucide="chevron-down" class="project-collapse-icon"></i>
          <i data-lucide="folder"></i>
          <span class="chat-item-title">${escapeHtml(project.name)}</span>
          <div class="chat-item-actions" aria-label="Project actions">
            <button class="chat-action-btn add-chat-to-proj-btn" title="New chat in project" aria-label="New chat in ${escapeHtml(project.name)}"><i data-lucide="plus"></i></button>
            <button class="chat-action-btn proj-options-btn" title="Project options" aria-label="Project options for ${escapeHtml(project.name)}"><i data-lucide="more-horizontal"></i></button>
          </div>`;

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

        projHeader.addEventListener('click', toggleProject);
        projHeader.addEventListener('keydown', event => {
          if (event.target?.closest?.('.chat-item-actions')) return;
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            toggleProject();
          }
        });

        projHeader.querySelector('.add-chat-to-proj-btn')?.addEventListener('click', e => {
          e.stopPropagation();
          createNewChatInProject(project.id, renderSidebar);
        });

        projHeader.querySelector('.proj-options-btn')?.addEventListener('click', e => {
          e.stopPropagation();
          openProjectOptionsMenu(e, project, renderSidebar);
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

  link.addEventListener('click', event => {
    if (!isUnmodifiedPrimaryNavigation(event)) return;
    event.preventDefault();
    void loadChat(chat.id, renderSidebar, { historyMode: 'push' });
  });

  const actions = document.createElement('div');
  actions.className = 'chat-item-actions';
  actions.setAttribute('aria-label', 'Chat actions');
  actions.innerHTML = `
    <button class="chat-action-btn pin-chat-btn" title="${chat.pinned ? 'Unpin chat' : 'Pin chat'}" aria-label="${chat.pinned ? 'Unpin chat' : 'Pin chat'}"><i data-lucide="pin"></i></button>
    <button class="chat-action-btn chat-options-btn" title="Chat options" aria-label="Chat options"><i data-lucide="more-horizontal"></i></button>`;

  actions.querySelector('.pin-chat-btn')?.addEventListener('click', async event => {
    event.stopPropagation();
    const previousPinned = chat.pinned;
    const updatedChat = updateChat(chat.id, current => ({ ...current, pinned: !current.pinned, updatedAt: Date.now() }));
    try {
      await persistChatMetadata(updatedChat);
    } catch (err) {
      updateChat(chat.id, current => ({ ...current, pinned: previousPinned }));
      console.error('Failed to save pin state:', err);
      alert('Failed to save pin state: ' + err.message);
      return;
    }
    renderSidebar();
  });

  actions.querySelector('.chat-options-btn')?.addEventListener('click', e => {
    openChatOptionsMenu(e, chat, renderSidebar);
  });

  li.append(link, actions);
  return li;
}
