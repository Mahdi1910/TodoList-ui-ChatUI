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

function actionAnchor(source) {
  source?.stopPropagation?.();
  return source?.currentTarget || source || null;
}

export function openChatOptionsMenu(source, chat, updateSidebarCallback = null) {
  const anchor = actionAnchor(source);
  if (!chat || !anchor) return;
  openActionMenu(anchor, [
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
    { type: 'separator' },
    {
      label: 'Move to Project', icon: 'folder-plus',
      onSelect: () => openAddToProjectModal(chat, updateSidebarCallback)
    },
    { type: 'separator' },
    {
      label: 'Delete Chat', icon: 'trash-2', danger: true,
      onSelect: () => deleteChat(chat.id, updateSidebarCallback)
    }
  ]);
}

export function openProjectOptionsMenu(source, project, updateSidebarCallback = null) {
  const anchor = actionAnchor(source);
  if (!project || !anchor) return;
  openActionMenu(anchor, [
    {
      label: 'Create Chat Inside', icon: 'plus',
      onSelect: () => createNewChatInProject(project.id, updateSidebarCallback)
    },
    {
      label: 'Manage Chats', icon: 'list-checks',
      onSelect: () => openManageProjectChatsModal(project, updateSidebarCallback)
    },
    { type: 'separator' },
    {
      label: 'Rename', icon: 'edit-3',
      onSelect: () => openRenameProjectModal(project)
    },
    { type: 'separator' },
    {
      label: 'Delete Project', icon: 'trash-2', danger: true,
      onSelect: () => deleteProject(project.id, updateSidebarCallback)
    }
  ]);
}
