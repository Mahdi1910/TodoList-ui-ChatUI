/**
 * todo-tool-definitions.js - Gemini declarations for the combined-app Todo tools.
 */

const ID = { type: 'STRING', description: 'Canonical Todo object ID returned by a Todo read/create tool. Do not guess IDs.' };
const NULLABLE_ID = { ...ID, nullable: true };
const POSITION = {
  type: 'OBJECT',
  description: 'Optional persistent manual position. Task positioning switches task sorting to Custom when needed. Project/Tag positioning uses their manual hierarchy order.',
  properties: {
    placement: { type: 'STRING', enum: ['top', 'bottom', 'before', 'after'] },
    relativeToId: { ...ID, description: 'Required only for before/after; must be a legal sibling.' }
  },
  required: ['placement']
};
const REMINDER = {
  type: 'OBJECT',
  properties: {
    minutesBefore: { type: 'INTEGER', description: 'Whole minutes before due time, 0..86400. 0 means on time.' }
  },
  required: ['minutesBefore']
};
const AFTER = {
  type: 'OBJECT',
  description: 'Pending After dependency. Do not invent the predecessor ID: use a canonical task ID returned by Todo. The task stays without a concrete date/time until Todo resolves it from the predecessor actual completion time plus this delay. hours is 0..24 and minutes is 0..59; they cannot both be 0. resolvedAt is Todo-owned read-only history and is never supplied here.',
  properties: {
    taskId: { ...ID, description: 'Canonical predecessor task ID returned by Todo.' },
    hours: { type: 'INTEGER', minimum: 0, maximum: 24, description: 'Whole delay hours, 0..24.' },
    minutes: { type: 'INTEGER', minimum: 0, maximum: 59, description: 'Whole delay minutes, 0..59.' }
  },
  required: ['taskId', 'hours', 'minutes']
};
const REPEAT = {
  type: 'OBJECT',
  description: 'Repeat rule. Dates use YYYY-MM-DD. Human months are 1..12.',
  properties: {
    mode: { type: 'STRING', enum: ['daily', 'weekly', 'monthly', 'yearly', 'custom'] },
    custom: {
      type: 'OBJECT',
      properties: {
        interval: { type: 'INTEGER', description: '1..99.' },
        unit: { type: 'STRING', enum: ['day', 'week', 'month', 'year'] },
        weekdays: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'Weekdays 0..6 where 0=Sunday.' },
        monthDays: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'Days 1..31.' },
        yearDates: {
          type: 'ARRAY',
          items: {
            type: 'OBJECT',
            properties: {
              month: { type: 'INTEGER', description: 'Human month 1..12.' },
              days: { type: 'ARRAY', items: { type: 'INTEGER' }, description: 'Valid days for this month.' }
            },
            required: ['month', 'days']
          }
        }
      }
    },
    end: {
      type: 'OBJECT',
      properties: {
        type: { type: 'STRING', enum: ['never', 'date', 'count'] },
        date: { type: 'STRING', description: 'YYYY-MM-DD; cannot be before the task due date.' },
        count: { type: 'INTEGER', description: '1..200.' }
      },
      required: ['type']
    }
  },
  required: ['mode']
};

const TASK_MUTABLE = {
  title: {
    type: 'STRING',
    description: 'Raw task title, max 500 characters. It may contain strict internal task-link tokens such as [[task:task-abc123]]. To create a completion link, first obtain the target canonical task ID from Todo, preserve the rest of the raw title, and insert exactly [[task:<ID>]]. One side containing the token is enough for bidirectional completion synchronization. Linked tasks keep all other settings independently. Remove an exact token from the raw title to unlink; never guess IDs.'
  },
  description: { type: 'STRING', description: 'Task description, max 4000 characters. Empty string clears it.' },
  projectId: { ...NULLABLE_ID, description: 'Root Project ID. null means Inbox/unassigned. A subtask inherits its parent Project; changing a current subtask project without parentTaskId makes it a root task.' },
  parentTaskId: { ...NULLABLE_ID, description: 'Root task ID to make this a subtask. null makes it a root task. Nested subtasks are not allowed.' },
  priority: { type: 'STRING', enum: ['none', 'low', 'medium', 'high'] },
  tagIds: { type: 'ARRAY', items: ID, description: 'Complete desired Tag ID list. [] clears Tags.' },
  dueDate: { type: 'STRING', nullable: true, description: 'YYYY-MM-DD or null. If time or Repeat remains, Todo resolves missing date to today. Explicit Date/Time/Repeat scheduling without an after field replaces an existing After dependency.' },
  dueTime: { type: 'STRING', nullable: true, description: 'hh:mm AM/PM such as 05:30 PM, or null to clear. Explicit Date/Time/Repeat scheduling without an after field replaces an existing After dependency.' },
  reminders: { type: 'ARRAY', items: REMINDER, description: 'Complete reminder list. [] clears reminders. Pending After may keep reminders so they become relative to its eventual resolved due time.' },
  repeat: { ...REPEAT, nullable: true, description: 'Repeat rule or null to clear Repeat. Pending unresolved After and active Repeat do not coexist; Todo owns that normalization.' },
  after: { ...AFTER, nullable: true, description: 'After dependency or null to clear it. Supplying a pending After lets Todo clear the concrete date/time/Repeat until the predecessor completes. Never compute the future due time yourself and never send resolvedAt.' },
  completed: { type: 'BOOLEAN', description: 'Desired final completion state. Completing one task can also complete task-link peers, create future Repeat occurrences, resolve downstream After schedules, or rewire skipped pending After links. Todo owns all of those side effects.' },
  position: POSITION
};

const DUPLICATE_TOKEN = {
  type: 'STRING',
  description: 'Use only when a previous exact mutation returned DUPLICATE_CONFIRMATION_REQUIRED and the user explicitly confirmed creating the duplicate in a new user turn. Copy the returned one-time token exactly.'
};

const mutationEnvelope = (arrayName, itemSchema) => ({
  type: 'OBJECT',
  properties: {
    [arrayName]: { type: 'ARRAY', items: itemSchema, description: `1 to 10 ${arrayName} in execution order.` },
    duplicateConfirmationToken: DUPLICATE_TOKEN
  },
  required: [arrayName]
});

const taxonomyCreate = label => ({
  type: 'OBJECT',
  properties: {
    name: { type: 'STRING', description: `${label} name, max 500 characters.` },
    icon: { type: 'STRING', description: 'Optional short icon/emoji.' },
    parentId: NULLABLE_ID,
    viewType: { type: 'STRING', enum: ['list', 'kanban'] },
    position: POSITION
  },
  required: ['name']
});
const taxonomyUpdate = label => ({
  type: 'OBJECT',
  properties: {
    id: ID,
    name: { type: 'STRING', description: `${label} name.` },
    icon: { type: 'STRING' },
    parentId: NULLABLE_ID,
    viewType: { type: 'STRING', enum: ['list', 'kanban'] },
    position: POSITION
  },
  required: ['id']
});

export const TODO_FUNCTION_DECLARATIONS = [
  {
    name: 'todo_find_tasks',
    description: 'Find/read Todo tasks and subtasks. Use this first when an existing task ID is unknown, especially before creating After dependencies or [[task:<ID>]] completion links. Returned task rows keep raw title tokens and also expose displayTitle, read-only completedAt, and After state when present. Project and Tag filters include descendants by default. Broad results are compact summaries (max 20); full details are max 10 IDs per call. Results are deterministic and paginated.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ids: { type: 'ARRAY', items: ID, description: 'Exact task IDs. Up to 10 exact IDs can return full details.' },
        query: { type: 'STRING', description: 'Case-insensitive title/description text search.' },
        projectIds: { type: 'ARRAY', items: ID },
        includeProjectDescendants: { type: 'BOOLEAN', description: 'Default true.' },
        tagIds: { type: 'ARRAY', items: ID },
        includeTagDescendants: { type: 'BOOLEAN', description: 'Default true.' },
        tagMatch: { type: 'STRING', enum: ['any', 'all'], description: 'all means at least one assigned Tag in every requested Tag tree.' },
        dueFrom: { type: 'STRING', description: 'YYYY-MM-DD inclusive.' },
        dueTo: { type: 'STRING', description: 'YYYY-MM-DD inclusive.' },
        completed: { type: 'BOOLEAN' },
        priorities: { type: 'ARRAY', items: { type: 'STRING', enum: ['none', 'low', 'medium', 'high'] } },
        parentTaskId: NULLABLE_ID,
        includeSubtasks: { type: 'BOOLEAN', description: 'Default true.' },
        scope: { type: 'STRING', enum: ['all', 'current_view'], description: 'current_view follows Todo filter/family/order state, independent of collapsed cards.' },
        detail: { type: 'STRING', enum: ['auto', 'summary', 'full'] },
        offset: { type: 'INTEGER' },
        limit: { type: 'INTEGER', description: 'Summary max 20; full max 10.' }
      }
    }
  },
  {
    name: 'todo_create_tasks',
    description: 'Create 1-10 tasks/subtasks. One call handles full task fields, absolute scheduling, After dependencies, reminders, Repeat, completion, strict [[task:<canonical task ID>]] title links, and optional manual position. A pending After task is intentionally unscheduled until Todo resolves it; do not invent a due time. To create a new parent and new child, create the parent first, then use its returned real ID. Completing during creation may also complete linked tasks, create Repeat occurrences, resolve After dependents, or rewire skipped pending After links; trust the authoritative Todo result.',
    parameters: mutationEnvelope('tasks', {
      type: 'OBJECT',
      properties: { title: TASK_MUTABLE.title, ...TASK_MUTABLE },
      required: ['title']
    })
  },
  {
    name: 'todo_update_tasks',
    description: 'Update 1-10 existing tasks/subtasks by canonical ID. Omitted fields stay unchanged; null/[] clears supported values. Can reparent/move, reorder, complete/activate, change Project/Tags, absolute schedule, After, reminders, Repeat, or raw title task links. Supplying After expresses a dependency; Todo calculates/resolves/rewires it. Supplying Date/Time/Repeat without After replaces an existing dependency. When editing [[task:<ID>]] links, preserve the rest of the raw title and use only canonical IDs returned by Todo. Completion may have linked-task, Repeat, and After side effects owned by Todo. Results report authoritative state and partial commits explicitly.',
    parameters: mutationEnvelope('tasks', {
      type: 'OBJECT',
      properties: { id: ID, ...TASK_MUTABLE },
      required: ['id']
    })
  },
  {
    name: 'todo_delete_tasks',
    description: 'Delete 1-10 tasks by canonical ID. Deleting a root task deletes its subtasks; deleting a subtask deletes only that subtask. This executes without a separate confirmation popup and reports all deleted IDs.',
    parameters: {
      type: 'OBJECT',
      properties: { taskIds: { type: 'ARRAY', items: ID }, duplicateConfirmationToken: DUPLICATE_TOKEN },
      required: ['taskIds']
    }
  },
  {
    name: 'todo_list_projects',
    description: 'List/search the Project/subproject hierarchy in stable manual order. Supports pagination and optional active direct/tree task counts. Use returned IDs for mutations.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ids: { type: 'ARRAY', items: ID },
        query: { type: 'STRING' },
        offset: { type: 'INTEGER' },
        limit: { type: 'INTEGER', description: '1..50, default 25.' },
        includeCounts: { type: 'BOOLEAN' }
      }
    }
  },
  {
    name: 'todo_create_projects',
    description: 'Create 1-10 Projects/subprojects. A new parent has no ID until committed; create a brand-new parent first, then create its child in a later tool round using the returned ID.',
    parameters: mutationEnvelope('projects', taxonomyCreate('Project'))
  },
  {
    name: 'todo_update_projects',
    description: 'Update/reparent/reorder 1-10 Projects by canonical ID. Project order is the manual sidebar hierarchy order. Results report partial stages honestly.',
    parameters: mutationEnvelope('projects', taxonomyUpdate('Project'))
  },
  {
    name: 'todo_delete_projects',
    description: 'Delete 1-10 Projects. Tasks are not deleted: directly assigned tasks become Inbox/unassigned. Child Projects follow current Todo promotion/reparent behavior. Returns all side effects.',
    parameters: {
      type: 'OBJECT',
      properties: { projectIds: { type: 'ARRAY', items: ID }, duplicateConfirmationToken: DUPLICATE_TOKEN },
      required: ['projectIds']
    }
  },
  {
    name: 'todo_list_tags',
    description: 'List/search the Tag/subtag hierarchy in stable manual order. Supports pagination and optional active direct/tree task counts. Use returned IDs for mutations.',
    parameters: {
      type: 'OBJECT',
      properties: {
        ids: { type: 'ARRAY', items: ID },
        query: { type: 'STRING' },
        offset: { type: 'INTEGER' },
        limit: { type: 'INTEGER', description: '1..50, default 25.' },
        includeCounts: { type: 'BOOLEAN' }
      }
    }
  },
  {
    name: 'todo_create_tags',
    description: 'Create 1-10 Tags/subtags. Create a brand-new parent first, then use its returned real ID for a new child in a later tool round.',
    parameters: mutationEnvelope('tags', taxonomyCreate('Tag'))
  },
  {
    name: 'todo_update_tags',
    description: 'Update/reparent/reorder 1-10 Tags by canonical ID. Tag order is the manual hierarchy order. Results report partial stages honestly.',
    parameters: mutationEnvelope('tags', taxonomyUpdate('Tag'))
  },
  {
    name: 'todo_delete_tags',
    description: 'Delete 1-10 Tags. Tasks are not deleted; the Tag relation is removed. Child Tags follow current Todo promotion/reparent behavior. Returns affected task IDs and hierarchy side effects.',
    parameters: {
      type: 'OBJECT',
      properties: { tagIds: { type: 'ARRAY', items: ID }, duplicateConfirmationToken: DUPLICATE_TOKEN },
      required: ['tagIds']
    }
  },
  {
    name: 'todo_get_workspace',
    description: 'Read current Todo navigation target, List/Kanban view, sort, direction, group, and logical current-view task IDs/count.',
    parameters: { type: 'OBJECT', properties: {} }
  },
  {
    name: 'todo_update_workspace',
    description: 'Navigate Todo and/or change List/Kanban, sort, direction and grouping. Applies stages in order: navigation, view, sort, direction, group. Switching to Custom preserves the current visible task order. Partial workspace changes are reported honestly.',
    parameters: {
      type: 'OBJECT',
      properties: {
        navigation: {
          type: 'OBJECT',
          properties: {
            type: { type: 'STRING', enum: ['inbox', 'today', 'completed', 'project', 'tag'] },
            id: ID
          },
          required: ['type']
        },
        viewType: { type: 'STRING', enum: ['list', 'kanban'] },
        sortKey: { type: 'STRING', enum: ['custom', 'dueDate', 'priority', 'name', 'createdAt'] },
        sortDirection: { type: 'STRING', enum: ['asc', 'desc'] },
        groupKey: { type: 'STRING', enum: ['none', 'priority', 'date', 'project', 'tag'] },
        duplicateConfirmationToken: DUPLICATE_TOKEN
      }
    }
  }
];

export const TODO_FUNCTION_NAMES = new Set(TODO_FUNCTION_DECLARATIONS.map(item => item.name));