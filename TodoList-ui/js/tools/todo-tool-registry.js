export const TODO_TOOL_NAMES = Object.freeze([
  'todo_find_tasks',
  'todo_create_tasks',
  'todo_update_tasks',
  'todo_delete_tasks',
  'todo_list_projects',
  'todo_create_projects',
  'todo_update_projects',
  'todo_delete_projects',
  'todo_list_tags',
  'todo_create_tags',
  'todo_update_tags',
  'todo_delete_tags',
  'todo_get_workspace',
  'todo_update_workspace'
]);

export const TODO_TOOL_NAME_SET = new Set(TODO_TOOL_NAMES);

export const TODO_MUTATION_TOOL_NAMES = new Set([
  'todo_create_tasks',
  'todo_update_tasks',
  'todo_delete_tasks',
  'todo_create_projects',
  'todo_update_projects',
  'todo_delete_projects',
  'todo_create_tags',
  'todo_update_tags',
  'todo_delete_tags',
  'todo_update_workspace'
]);

export function isTodoToolName(name) {
  return TODO_TOOL_NAME_SET.has(String(name || ''));
}

export function isTodoMutationToolName(name) {
  return TODO_MUTATION_TOOL_NAMES.has(String(name || ''));
}
