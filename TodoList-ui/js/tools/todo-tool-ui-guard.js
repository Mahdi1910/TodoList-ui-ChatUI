import { TodoToolValidationError } from './todo-tool-normalizers.js';

function active(element) {
  return Boolean(element?.classList?.contains('active'));
}

function conflict(entityType, id, reason) {
  throw new TodoToolValidationError(
    `Cannot change ${entityType} ${id || ''} while it is referenced by an open Todo editor.`,
    { entityType, id: id || null, reason },
    'EDITOR_CONFLICT'
  );
}

function taskDraft() {
  const tasks = window.TasksComponent;
  return {
    active: active(tasks?.addTaskModal),
    editingTaskId: tasks?.editingTaskId || null,
    projectId: tasks?.selectedProject || null,
    tagIds: Array.isArray(tasks?.selectedTags) ? [...tasks.selectedTags] : []
  };
}

function subtaskDraft() {
  const editor = window.SubtaskEditorComponent;
  return {
    active: active(editor?.modal),
    editingSubtaskId: editor?.editingSubtaskId || null,
    parentTaskId: editor?.parentTaskId || null,
    tagIds: Array.isArray(editor?.selectedTags) ? [...editor.selectedTags] : []
  };
}

function taxonomyDraft(type) {
  const sidebar = window.SidebarComponent;
  const stem = type === 'tag' ? 'Tag' : 'Project';
  const lower = type === 'tag' ? 'tag' : 'project';
  const modal = sidebar?.[`${lower}Modal`];
  const parentSelect = sidebar?.[`${lower}ParentSelect`];
  return {
    active: active(modal),
    editingId: sidebar?.[`editing${stem}Id`] || null,
    parentId: parentSelect?.value || null
  };
}

export const TodoToolUiGuard = {
  assertTaskMutation({ taskId, operation = 'update', completed = undefined, parentTaskId = undefined } = {}) {
    const root = taskDraft();
    if (root.active && root.editingTaskId === taskId) conflict('task', taskId, 'task_edit_open');

    const child = subtaskDraft();
    if (!child.active) return;
    if (child.editingSubtaskId === taskId) conflict('task', taskId, 'subtask_edit_open');
    if (child.parentTaskId !== taskId) return;

    if (operation === 'delete') conflict('task', taskId, 'new_or_edited_subtask_depends_on_parent');
    if (completed === true) conflict('task', taskId, 'subtask_draft_parent_cannot_be_completed');
    if (parentTaskId !== undefined && parentTaskId !== null) {
      conflict('task', taskId, 'subtask_draft_parent_cannot_become_subtask');
    }
  },

  assertProjectMutation({ projectId, operation = 'update', parentRelationshipChanges = false } = {}) {
    const root = taskDraft();
    if (operation === 'delete' && root.active && root.projectId === projectId) {
      conflict('project', projectId, 'task_draft_selected_project');
    }

    const draft = taxonomyDraft('project');
    if (!draft.active) return;
    if (draft.editingId === projectId) conflict('project', projectId, 'project_editor_open');
    if (draft.parentId === projectId && (operation === 'delete' || parentRelationshipChanges)) {
      conflict('project', projectId, 'project_draft_parent_dependency');
    }
  },

  assertTagMutation({ tagId, operation = 'update', parentRelationshipChanges = false } = {}) {
    const root = taskDraft();
    const child = subtaskDraft();
    if (operation === 'delete') {
      if (root.active && root.tagIds.includes(tagId)) conflict('tag', tagId, 'task_draft_selected_tag');
      if (child.active && child.tagIds.includes(tagId)) conflict('tag', tagId, 'subtask_draft_selected_tag');
    }

    const draft = taxonomyDraft('tag');
    if (!draft.active) return;
    if (draft.editingId === tagId) conflict('tag', tagId, 'tag_editor_open');
    if (draft.parentId === tagId && (operation === 'delete' || parentRelationshipChanges)) {
      conflict('tag', tagId, 'tag_draft_parent_dependency');
    }
  },

  assertTaxonomyRelationshipSafe(type, entityId, targetParentId) {
    const draft = taxonomyDraft(type);
    if (!draft.active || !draft.editingId || !draft.parentId) return;
    if (entityId === draft.parentId || targetParentId === draft.editingId) {
      conflict(type, entityId, `${type}_draft_hierarchy_dependency`);
    }
  }
};
