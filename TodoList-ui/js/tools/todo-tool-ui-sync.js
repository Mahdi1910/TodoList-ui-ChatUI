import { AppState } from '../state.js';

function refreshSubtaskProjectLock() {
  const editor = window.SubtaskEditorComponent;
  if (!editor?.modal?.classList.contains('active') || !editor.parentTaskId || !editor.projectLock) return;
  const parent = AppState.getTask(editor.parentTaskId);
  if (!parent) return;
  const project = parent.project ? AppState.getProject(parent.project) : null;
  editor.projectLock.textContent = project ? `${project.icon} ${project.name} 🔑` : 'Inbox 🔑';
  if (editor.parentLabel) editor.parentLabel.textContent = `Parent: ${parent.title}`;
}

export const TodoToolUiSync = {
  reconcile(domain = 'task', { hierarchyChanged = false, deleted = false } = {}) {
    const tasks = window.TasksComponent;
    const sidebar = window.SidebarComponent;
    const workspace = window.WorkspaceControls;
    const subtask = window.SubtaskEditorComponent;

    if ((hierarchyChanged || deleted) && tasks) {
      tasks.closeTaskActionMenu?.(false);
      tasks.closeTaskParentPicker?.(false);
      tasks.closeAllContextMenus?.();
      subtask?.closeMenus?.();
    }

    if (domain === 'project') {
      sidebar?.renderProjects?.();
      tasks?.renderProjectMenu?.();
      sidebar?.syncCurrentView?.();
      refreshSubtaskProjectLock();
      tasks?.render?.();
      sidebar?.updateCounts?.();
      return;
    }

    if (domain === 'tag') {
      sidebar?.renderTags?.();
      tasks?.renderTagMenu?.();
      subtask?.renderTagMenu?.();
      if (subtask?.modal?.classList.contains('active')) subtask.syncTagUI?.();
      sidebar?.syncCurrentView?.();
      tasks?.render?.();
      sidebar?.updateCounts?.();
      return;
    }

    if (domain === 'workspace') {
      sidebar?.syncCurrentView?.();
      workspace?.syncUI?.();
      tasks?.render?.();
      sidebar?.updateCounts?.();
      return;
    }

    tasks?.refreshAfterTaskMutation?.();
    sidebar?.updateCounts?.();
    refreshSubtaskProjectLock();
  }
};
