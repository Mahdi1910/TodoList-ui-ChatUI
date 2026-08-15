/**
 * sidebar-actions.js — Chat/project actions using the shared popup menu.
 */

import { updateChat } from '../state/store.js';
import { persistChatMetadata } from '../storage/storage.js';
import { deleteChat } from '../chat/chat.js';
import { openActionMenu, closeActionMenu } from '../ui/action-menu.js';
import {
  createNewChatInProject,
  openAddToProjectModal,
  openManageProjectChatsModal,
  openRenameProjectModal,
  deleteProject
} from './projects.js';

export { closeActionMenu };

export function openChatOptionsMenu(event, chat, updateSidebarCallback = null) {
  event?.stopPropagation?.();
  if (!chat || !event?.currentTarget) return;
  openActionMenu(event.currentTarget, [
    {
      label: 'Move to Project', icon: 'folder-plus',
      onSelect: () => openAddToProjectModal(chat, updateSidebarCallback)
    },
    {
      label: chat.pinned ? 'Unpin Chat' : 'Pin Chat', icon: 'pin',
      onSelect: async () => {
        const previousPinned = chat.pinned;
        const updatedChat = updateChat(chat.id, current => ({ ...current, pinned: !current.pinned, updatedAt: Date.now() }));
        try {
          await persistChatMetadata(updatedChat);
        } catch (error) {
          updateChat(chat.id, current => ({ ...current, pinned: previousPinned }));
          console.error('Failed to save pin state:', error);
          alert('Failed to save pin state: ' + error.message);
        }
        updateSidebarCallback?.();
      }
    },
    {
      label: 'Delete Chat', icon: 'trash-2', danger: true,
      onSelect: () => deleteChat(chat.id, updateSidebarCallback)
    }
  ]);
}

export function openProjectOptionsMenu(event, project, updateSidebarCallback = null) {
  event?.stopPropagation?.();
  if (!project || !event?.currentTarget) return;
  openActionMenu(event.currentTarget, [
    {
      label: 'Create Chat Inside', icon: 'plus',
      onSelect: () => createNewChatInProject(project.id, updateSidebarCallback)
    },
    {
      label: 'Manage Chats', icon: 'list-checks',
      onSelect: () => openManageProjectChatsModal(project, updateSidebarCallback)
    },
    {
      label: 'Rename', icon: 'edit-3',
      onSelect: () => openRenameProjectModal(project)
    },
    {
      label: 'Delete Project', icon: 'trash-2', danger: true,
      onSelect: () => deleteProject(project.id, updateSidebarCallback)
    }
  ]);
}
