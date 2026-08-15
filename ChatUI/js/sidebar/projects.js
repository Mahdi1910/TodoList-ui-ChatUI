/**
 * projects.js — Project CRUD Operations, Context Menus & Hierarchy Helpers
 */

import { state, runtime, setState, setRuntime, updateChat, createEntityId } from '../state/store.js';
import {
  persistSettings,
  persistChatMetadata,
  persistProjectMetadata,
  persistMetadataChanges,
  deleteProjectRecord
} from '../storage/storage.js';
import { startNewChat } from '../chat/chat.js';
import { escapeHtml } from '../utils/dom.js';

export function createNewChatInProject(projectId, updateSidebarCallback = null) {
  startNewChat(updateSidebarCallback, projectId);
}

export async function deleteProject(projectId, updateSidebarCallback = null) {
  const updatedAt = Date.now();
  try {
    await deleteProjectRecord(projectId, updatedAt);
  } catch (err) {
    console.error('Failed to delete project from IndexedDB:', err);
    alert('Failed to delete project from database: ' + err.message);
    return;
  }

  const collapsedProjectIds = new Set(runtime.collapsedProjectIds);
  collapsedProjectIds.delete(projectId);

  setState({
    projects: state.projects.filter(project => project.id !== projectId),
    chats: state.chats.map(chat => chat.projectId === projectId
      ? { ...chat, projectId: null, updatedAt }
      : chat),
    activeProjectId: state.activeProjectId === projectId ? null : state.activeProjectId
  });
  setRuntime({
    collapsedProjectIds,
    activeProjectForChatManagement: runtime.activeProjectForChatManagement?.id === projectId
      ? null
      : runtime.activeProjectForChatManagement,
    activeProjectForRename: runtime.activeProjectForRename?.id === projectId
      ? null
      : runtime.activeProjectForRename
  });

  try {
    // deleteProjectRecord already deleted the project and unassigned persisted
    // chats. Only runtime-derived navigation/collapse settings remain to save.
    await persistSettings();
  } catch (err) {
    console.error('Failed to persist project deletion state:', err);
    alert('Project was deleted, but the remaining state could not be saved: ' + err.message);
    return;
  }
  updateSidebarCallback?.();
}

export function openAddToProjectModal(chat, updateSidebarCallback = null) {
  setRuntime({ activeChatForProjectAdd: chat });
  const addToProjectModal = document.getElementById('add-to-project-modal');
  const projectSelectionList = document.getElementById('project-selection-list');
  if (!addToProjectModal || !projectSelectionList) return;

  projectSelectionList.innerHTML = '';

  const noneItem = document.createElement('div');
  noneItem.className = 'project-selection-item';
  noneItem.innerHTML = '<i data-lucide="folder-minus"></i> None';
  noneItem.onclick = async () => {
    const previousProjectId = chat.projectId || null;
    if (!previousProjectId) {
      addToProjectModal.classList.add('hidden');
      return;
    }
    const updatedChat = updateChat(chat.id, current => ({ ...current, projectId: null, updatedAt: Date.now() }));
    if (!updatedChat) return;
    try {
      await persistChatMetadata(updatedChat);
    } catch (err) {
      updateChat(chat.id, current => ({ ...current, projectId: previousProjectId }));
      console.error('Failed to remove chat from project:', err);
      alert('Failed to remove chat from project: ' + err.message);
      return;
    }
    chat = updatedChat;
    addToProjectModal.classList.add('hidden');
    updateSidebarCallback?.();
  };
  projectSelectionList.appendChild(noneItem);

  if (state.projects.length === 0) {
    const emptyMessage = document.createElement('div');
    emptyMessage.className = 'project-selection-empty';
    emptyMessage.textContent = 'No projects created yet';
    projectSelectionList.appendChild(emptyMessage);
  } else {
    state.projects.forEach(proj => {
      const item = document.createElement('div');
      item.className = 'project-selection-item';
      item.innerHTML = `<i data-lucide="folder"></i> ${escapeHtml(proj.name)}`;

      item.onclick = async () => {
        const previousProjectId = chat.projectId || null;
        const updatedChat = updateChat(chat.id, current => ({ ...current, projectId: proj.id, updatedAt: Date.now() }));
        if (!updatedChat) return;
        try {
          await persistChatMetadata(updatedChat);
        } catch (err) {
          updateChat(chat.id, current => ({ ...current, projectId: previousProjectId }));
          console.error('Failed to save chat project assignment:', err);
          alert('Failed to add chat to project: ' + err.message);
          return;
        }
        chat = updatedChat;
        addToProjectModal.classList.add('hidden');
        updateSidebarCallback?.();
      };
      projectSelectionList.appendChild(item);
    });
  }

  addToProjectModal.classList.remove('hidden');
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

export function openManageProjectChatsModal(project, updateSidebarCallback = null) {
  setRuntime({ activeProjectForChatManagement: project });
  const modal = document.getElementById('manage-project-chats-modal');
  const list = document.getElementById('manage-project-chats-list');
  const title = document.getElementById('manage-project-chats-title');
  if (!modal || !list) return;

  if (title) title.textContent = `Manage chats — ${project.name}`;
  list.innerHTML = '';

  const chats = [...state.chats].sort((a, b) => {
    const createdA = Number(a?.createdAt) || 0;
    const createdB = Number(b?.createdAt) || 0;
    if (createdA !== createdB) return createdB - createdA;
    return String(b?.id || '').localeCompare(String(a?.id || ''));
  });

  if (chats.length === 0) {
    list.innerHTML = '<div class="project-chat-manager-empty">No chats available.</div>';
  } else {
    const groups = [
      { id: project.id, name: project.name, icon: 'folder', chats: chats.filter(chat => chat.projectId === project.id), target: true },
      ...state.projects.filter(other => other.id !== project.id).map(other => ({
        id: other.id,
        name: other.name,
        icon: 'folder',
        chats: chats.filter(chat => chat.projectId === other.id),
        target: false
      })),
      { id: null, name: 'Outside projects', icon: 'inbox', chats: chats.filter(chat => !chat.projectId), target: false }
    ];

    groups.forEach(group => {
      const section = document.createElement('section');
      section.className = 'project-chat-manager-group';
      section.innerHTML = `
        <div class="project-chat-manager-group-title">
          <i data-lucide="${group.icon}"></i>
          <span>${escapeHtml(group.name)}</span>
          <span class="project-chat-manager-count">${group.chats.length}</span>
        </div>`;

      const groupList = document.createElement('div');
      groupList.className = 'project-chat-manager-group-list';

      if (group.chats.length === 0) {
        groupList.innerHTML = '<div class="project-chat-manager-empty-group">No chats</div>';
      } else {
        group.chats.forEach(chat => {
          const row = document.createElement('label');
          row.className = 'project-chat-manager-row';
          const checked = chat.projectId === project.id;
          row.innerHTML = `
            <input type="checkbox" ${checked ? 'checked' : ''} aria-label="${escapeHtml(chat.title)}">
            <span class="project-chat-manager-checkmark"><i data-lucide="check"></i></span>
            <i data-lucide="message-square"></i>
            <span class="project-chat-manager-chat-title">${escapeHtml(chat.title)}</span>`;

          const checkbox = row.querySelector('input');
          checkbox.addEventListener('change', async () => {
            const previousProjectId = chat.projectId || null;
            const nextProjectId = checkbox.checked ? project.id : null;
            const updatedChat = updateChat(chat.id, current => ({
              ...current,
              projectId: nextProjectId,
              updatedAt: Date.now()
            }));
            if (!updatedChat) return;

            try {
              await persistChatMetadata(updatedChat);
            } catch (err) {
              updateChat(chat.id, current => ({ ...current, projectId: previousProjectId }));
              checkbox.checked = previousProjectId === project.id;
              console.error('Failed to update project chat assignment:', err);
              alert('Failed to update chat assignment: ' + err.message);
              return;
            }

            openManageProjectChatsModal(state.projects.find(item => item.id === project.id) || project, updateSidebarCallback);
            updateSidebarCallback?.();
          });

          groupList.appendChild(row);
        });
      }

      section.appendChild(groupList);
      list.appendChild(section);
    });
  }

  modal.classList.remove('hidden');
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

export function openRenameProjectModal(project) {
  setRuntime({ activeProjectForRename: project });
  const renameProjectModal = document.getElementById('rename-project-modal');
  const renameProjectInput = document.getElementById('rename-project-input');
  if (!renameProjectModal || !renameProjectInput) return;

  renameProjectInput.value = project.name;
  renameProjectModal.classList.remove('hidden');
  renameProjectInput.focus();
}

export function initProjectModalListeners(updateSidebarCallback = null) {
  const createProjectModal = document.getElementById('create-project-modal');
  const confirmCreateProjectBtn = document.getElementById('confirm-create-project-btn');
  const projectNameInput = document.getElementById('project-name-input');
  const closeProjectModalBtn = document.getElementById('close-project-modal-btn');

  const closeAddToProjectBtn = document.getElementById('close-add-to-project-btn');
  const addToProjectModal = document.getElementById('add-to-project-modal');
  const closeManageProjectChatsBtn = document.getElementById('close-manage-project-chats-btn');
  const manageProjectChatsModal = document.getElementById('manage-project-chats-modal');

  const renameProjectModal = document.getElementById('rename-project-modal');
  const closeRenameProjectBtn = document.getElementById('close-rename-project-btn');
  const confirmRenameProjectBtn = document.getElementById('confirm-rename-project-btn');
  const renameProjectInput = document.getElementById('rename-project-input');

  if (confirmCreateProjectBtn && projectNameInput) {
    confirmCreateProjectBtn.addEventListener('click', () => {
      const name = projectNameInput.value.trim();
      if (!name) return;

      const newProject = {
        id: createEntityId('proj'),
        name,
        createdAt: Date.now(),
        updatedAt: Date.now()
      };

      const previousProjects = state.projects;
      const previousCollapsedProjectIds = new Set(runtime.collapsedProjectIds);
      setState({ projects: [...state.projects, newProject] });
      setRuntime({ collapsedProjectIds: new Set([...runtime.collapsedProjectIds, newProject.id]) });
      persistMetadataChanges({ projects: [newProject], settings: true }).catch(err => {
        setState({ projects: previousProjects });
        setRuntime({ collapsedProjectIds: previousCollapsedProjectIds });
        console.error('Failed to save new project:', err);
        alert('Failed to save project: ' + err.message);
      });
      projectNameInput.value = '';
      createProjectModal?.classList.add('hidden');
      updateSidebarCallback?.();
    });
  }

  if (closeProjectModalBtn && createProjectModal) closeProjectModalBtn.onclick = () => createProjectModal.classList.add('hidden');
  if (closeAddToProjectBtn && addToProjectModal) closeAddToProjectBtn.onclick = () => addToProjectModal.classList.add('hidden');
  if (closeManageProjectChatsBtn && manageProjectChatsModal) closeManageProjectChatsBtn.onclick = () => manageProjectChatsModal.classList.add('hidden');
  if (closeRenameProjectBtn && renameProjectModal) closeRenameProjectBtn.onclick = () => renameProjectModal.classList.add('hidden');

  if (confirmRenameProjectBtn && renameProjectInput) {
    confirmRenameProjectBtn.onclick = async () => {
      const newName = renameProjectInput.value.trim();
      if (newName && runtime.activeProjectForRename) {
        const projectId = runtime.activeProjectForRename.id;
        const previousProjects = state.projects;
        const renamedProject = { ...runtime.activeProjectForRename, name: newName, updatedAt: Date.now() };
        setState({ projects: state.projects.map(p => p.id === projectId ? renamedProject : p) });
        try {
          await persistProjectMetadata(renamedProject);
        } catch (err) {
          setState({ projects: previousProjects });
          console.error('Failed to save renamed project:', err);
          alert('Failed to rename project: ' + err.message);
          return;
        }
        setRuntime({ activeProjectForRename: null });
        renameProjectModal?.classList.add('hidden');
        updateSidebarCallback?.();
      }
    };
  }
}
