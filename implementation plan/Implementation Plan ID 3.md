# Implementation Plan ID 3 — ChatUI Todo AI Tool Integration

## Status

**Plan only. Do not implement until reviewed/approved.**

---

# 1. Goal

Add a new **To-Do AI tool** to ChatUI, presented with the same tool-card/toggle experience as the current Google Search, URL Context, Code Execution, and Workspace tools.

When the To-Do tool is enabled, Gemini should be able to read and control the existing TodoList application through a small, clear set of local function tools. The AI must be able to create, update, delete, organize, schedule, complete, search, and navigate Todo data without duplicating Todo business logic inside ChatUI.

The feature must work while Todo is visible **or hidden**. This is important for normal chat and Live Voice. Example target flow:

```text
User is in ChatUI / Live Voice
        ↓
"Create a task called Study AI for tomorrow at 7 PM,
 high priority, remind me 30 minutes before"
        ↓
Gemini calls todo_create_tasks
        ↓
ChatUI sends a local tool request through the combined-app shell
        ↓
Todo iframe executes against its real AppDataService
        ↓
IndexedDB is updated
        ↓
AppState is updated
        ↓
Todo UI re-renders immediately, even while hidden
        ↓
Structured function result returns to Gemini
        ↓
Gemini confirms the action
        ↓
User switches to Todo
        ↓
The new task is already visible; no refresh is required
```

This plan intentionally designs an **MCP-inspired local tool surface**, but it does **not** add an external MCP server. ChatUI already has a working Gemini client-side custom-function loop, and both apps already run as persistent same-origin iframes inside one shell. A network MCP server would add latency, authentication, another persistence boundary, and unnecessary duplication.

---

# 2. Primary design decisions

## 2.1 Keep the AI tool set small

Do not expose every small Todo action as a separate function.

For example, do **not** create separate tools such as:

```text
move_task
complete_task
reopen_task
set_task_date
clear_task_date
set_task_time
clear_task_time
set_task_priority
clear_task_priority
set_task_repeat
clear_task_repeat
set_task_reminder
clear_task_reminders
create_subtask
create_subproject
create_subtag
reorder_task
reorder_subtask
reorder_project
reorder_tag
```

These operations can be represented as fields of the main create/update functions and then translated internally into the correct existing Todo services.

## 2.2 One tool handles one or many objects

Do not create both:

```text
create_task
create_batch_tasks
```

Use one plural tool:

```text
todo_create_tasks
```

with an array. An array with one element creates one task. An array with many elements creates many tasks.

Apply the same principle to update/delete and to projects/tags.

Do **not** parse commas or semicolons as artificial task separators. Structured arrays are unambiguous and allow titles/descriptions to contain normal punctuation.

## 2.3 No public reorder tool in v1

Do not expose `todo_reorder_items` as an additional AI tool.

Instead, task/project/tag create and update records receive an optional semantic `position` object. The Todo-side adapter translates that semantic request into the existing hierarchy/drag/order service methods.

The AI should never calculate or manipulate raw `sortOrder` numbers.

Example:

```json
{
  "position": {
    "placement": "after",
    "relativeToId": "task-123"
  }
}
```

Supported placements:

```text
top
bottom
before
after
```

`relativeToId` is required only for `before`/`after`.

## 2.4 Mutations require canonical IDs

The AI can talk to the user in names, but write tools should use canonical IDs for existing objects.

Example:

```text
User: Move "Study AI" to University.

AI:
1. todo_find_tasks(query="Study AI")
2. todo_list_projects(query="University")
3. todo_update_tasks(task id + project id)
```

This prevents the wrong object from being changed when duplicate names exist.

Create operations naturally do not require an existing object ID.

## 2.5 Reuse the real Todo service layer

The new AI executor must **not** write directly to IndexedDB, mutate `AppState` manually, or reproduce repeat/reminder/hierarchy rules.

The execution path must remain:

```text
Todo AI adapter
   ↓
AppDataService
   ↓
IndexedDB transaction(s)
   ↓
AppStateSync
   ↓
Todo UI refresh
```

## 2.6 Use the existing ChatUI Gemini function loop

Do not create a second function-calling engine.

Current ChatUI already:

- builds Gemini custom function declarations;
- receives streamed `functionCall` parts;
- executes local custom functions;
- sends matching `functionResponse` parts back to Gemini;
- preserves model content/thought signatures;
- renders tool activity in the assistant timeline.

The To-Do integration should register itself through the existing custom-function registry just like Workspace.

## 2.7 Live Voice uses exactly the same tools

Do not build a separate voice-specific Todo integration.

Live Voice ultimately uses the normal chat generation path, so once `state.tools.todo` is enabled and the normal custom function registry knows the Todo tools, voice requests should automatically receive the same capability.

---

# 3. External MCP/task-manager research

The tool design below was based on current MCP specification guidance plus multiple real Todo/Kanban/ticket integrations.

## 3.1 Model Context Protocol specification

Sources:

- https://modelcontextprotocol.io/specification/2025-11-25/schema
- https://modelcontextprotocol.io/specification/2025-06-18/schema

Relevant patterns:

- a tool has a clear `name`, human-readable description/title, JSON Schema `inputSchema`, and optionally `outputSchema`;
- the current schema defaults to JSON Schema 2020-12 when `$schema` is omitted;
- tool annotations include `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint`;
- annotations are hints, not enforcement.

Plan decision:

Keep an internal metadata descriptor for every Todo function so its read/write/destructive characteristics are explicit even though the current Gemini function declaration format does not directly use all MCP annotations.

All Todo tools are local/closed-world, so conceptually:

```text
openWorldHint = false
```

## 3.2 GitHub official MCP server

Source:

- https://github.com/github/github-mcp-server

GitHub explicitly supports toolsets and individual tool selection to reduce context size and improve the model's tool choice. It also has dynamic tool discovery because enabling too many tools can confuse models.

Plan decision:

- expose Todo declarations **only while the To-Do toggle is enabled**;
- keep the public Todo surface small;
- do not create dozens of micro-tools.

## 3.3 Linear MCP

Source:

- https://linear.app/docs/mcp

Linear describes its MCP around finding, creating, and updating major entities such as issues/projects/comments rather than making every UI action a separate function.

Plan decision:

Use entity-centered operations: find/create/update/delete tasks, projects, and tags.

## 3.4 Notion MCP

Source:

- https://developers.notion.com/guides/mcp/mcp-supported-tools

Important pattern:

`notion-create-pages` creates **one or more pages** with one tool. Notion also has broad update operations that can change many properties.

Plan decision:

Use plural array-capable tools instead of separate single/batch variants.

## 3.5 Todoist API / Todo MCP implementations

Sources:

- https://developer.todoist.com/api/v1/
- https://github.com/Hint-Services/mcp-todoist

Todoist internally has specialized movement/reorder commands, and third-party Todoist MCP implementations often expose separate move/complete tools. The Hint Services MCP also demonstrates one create tool accepting a `tasks` array for batch creation.

Plan decision:

Use the useful batch pattern, but hide Todo's internal movement/reorder mechanics behind `todo_update_tasks` + optional semantic `position`.

## 3.6 TickTick connector inspected during planning

The connected TickTick tool set exposes approximately 50 functions, including:

```text
create_task
update_task
delete_task
complete_task
move_task
batch_add_tasks
batch_update_tasks
list_projects
create_project
update_project
list_tags
filter_tasks
...
```

Its task object contains useful examples of full-property task arguments such as project, title, description/content, dates, priority, reminders, repeat, tags, parent, status, and sort order.

Plan decision:

Use that comprehensive task-property idea, but **do not copy its duplicate single/batch/move/complete tool fragmentation**.

## 3.7 Taskboard MCP

Source:

- https://github.com/tcarac/taskboard

Taskboard exposes 22 MCP tools for projects, tickets, teams, board state, and subtasks. Its Web UI and MCP operate over the same SQLite source of truth, so MCP-created tickets appear in the board without maintaining a second data model.

Plan decision:

Our equivalent should operate through Todo's existing authoritative service/state/IndexedDB path and then refresh the mounted UI immediately.

## 3.8 Microsoft To Do MCP examples

Sources:

- https://github.com/jordanburke/microsoft-todo-mcp-server
- https://github.com/MAG-Cie/mcp-microsoft-todo

These servers use conventional read/create/update/delete task operations and provide full task properties on create/update. Some expose separate completion/move/batch tools due to their upstream API shapes.

Plan decision:

Our public schema does not need to mirror an upstream API. We can expose a simpler AI-facing contract and let the Todo adapter orchestrate the app's internal services.

## 3.9 Kanban/board MCP examples

Sources:

- https://github.com/ChristianJStarr/kanboard-mcp
- https://github.com/tcarac/taskboard

These show a recurring useful pattern: read current board/state, create/update/delete primary entities, and move/order internally.

Plan decision:

Add one workspace-state reader and one workspace-state updater so the AI can understand/navigate/change the actual Todo UI without needing multiple view-specific tools.

---

# 4. Current ChatUI architecture verified before planning

## 4.1 Existing custom-function registry

File:

```text
ChatUI/js/tools/function-tool-registry.js
```

Current registry only loads Workspace declarations when `activeTools.workspace` is enabled and routes Workspace calls to its executor.

This is the correct extension point for Todo.

Target shape:

```text
activeTools.workspace → WORKSPACE_FUNCTION_DECLARATIONS
activeTools.todo      → TODO_FUNCTION_DECLARATIONS
```

and:

```text
workspace_* → executeWorkspaceToolCall(...)
todo_*      → executeTodoToolCall(...)
```

## 4.2 Gemini already has the required execution loop

File:

```text
ChatUI/js/api/gemini.js
```

Current behavior already performs iterative custom function execution and feeds `functionResponse` results back to Gemini.

Do not alter the fundamental loop.

Todo-specific work here should be limited to generic provider labeling/error wording if necessary. Current messages that say `Workspace tool loop` should become provider-neutral `custom tool loop` wording because Workspace will no longer be the only client function provider.

## 4.3 Existing tool toggle UI

Files:

```text
ChatUI/html/main-chat.html
ChatUI/html/right-sidebar.html
ChatUI/js/composer/composer.js
ChatUI/js/state/store.js
ChatUI/js/storage/load.js
```

Current tool choices are duplicated in:

- compact composer Tools popup;
- right-side AI Tools panel;
- active-tool indicator pills.

Add a To-Do card with the same visual structure.

Recommended UI label:

```text
To-Do
```

Recommended icon:

```text
list-todo
```

Recommended description:

```text
Manage tasks, projects & tags
```

Add state:

```js
tools: {
  googleSearch: false,
  urlContext: false,
  codeExecution: false,
  workspace: false,
  todo: false
}
```

No IndexedDB schema migration is required because tools are already stored inside the existing app settings object.

### Small maintainability improvement

While adding To-Do, replace the repeated hard-coded JS toggle/pill wiring with one small tool UI descriptor list, for example:

```text
key
label
icon
popupToggleId
sidebarToggleId
isAvailable()
```

This avoids adding another set of repeated `if (toggle...)` blocks every time a future tool is introduced.

Do not refactor unrelated composer behavior.

## 4.4 Tool activity timeline already supports custom tools

File:

```text
ChatUI/js/chat/activity-timeline.js
```

Current provider detection explicitly recognizes `workspace_` functions and otherwise labels unknown custom functions as generic tools.

Add:

```text
todo_* → provider "todo"
```

Add concise summaries such as:

```text
Created 3 tasks
Updated 1 task
Deleted 2 tasks
Listed projects
Updated To-Do view
```

The tool activity preview is already bounded/truncated, which is useful for batch Todo results.

---

# 5. Current Todo architecture verified before planning

## 5.1 Todo's authoritative mutation layer already exists

Files:

```text
TodoList-ui/js/storage/data-service.js
TodoList-ui/js/storage/data-service-taxonomy.js
TodoList-ui/js/storage/data-service-hierarchy.js
TodoList-ui/js/storage/data-service-drag.js
TodoList-ui/js/storage/data-service-taxonomy-drag.js
TodoList-ui/js/storage/data-service-reminders.js
```

Important existing capabilities include:

- serialized write queue through `AppDataService.enqueue()`;
- task create/update/delete;
- completion/repeat lifecycle;
- project/tag create/update/delete;
- task hierarchy link/unlink/reparent/order;
- project/tag hierarchy/order;
- persisted sort/group settings;
- reminder normalization/storage.

The tool integration should orchestrate these functions rather than creating a parallel data layer.

## 5.2 Task model

File:

```text
TodoList-ui/js/task-model.js
```

Current task properties include:

```text
id
title
description
project
parentTaskId
priority
tags
reminders
repeat
dueDate
dueTime
completed
sortOrder
createdAt
updatedAt
```

AI-facing names should use clearer forms such as:

```text
projectId
tagIds
parentTaskId
```

The adapter maps them to the app's internal task shape.

## 5.3 Completion must use existing repeat-aware behavior

`AppDataService.updateTask()` currently preserves the existing completion state. Completion changes are handled by `toggleTaskStatus()`.

Therefore `todo_update_tasks` can expose a simple desired value:

```json
{ "completed": true }
```

but the Todo adapter must implement it by comparing desired/current state and calling `toggleTaskStatus()` only when a state change is required.

This preserves existing repeating-task behavior, including creation of the next occurrence.

No separate `complete_task` or `reopen_task` AI tool is needed.

## 5.4 Parent/subtask movement requires hierarchy services

A subtask is a normal task with `parentTaskId`.

The public AI tool may expose:

```json
{ "parentTaskId": "task-123" }
```

or:

```json
{ "parentTaskId": null }
```

but internally this must route through the hierarchy service rather than attempting to force `parentTaskId` through ordinary `updateTask()`.

Existing hierarchy restrictions must remain authoritative, including:

- a task cannot parent itself;
- parent must be a valid normal/root task;
- completed tasks cannot be used as parents;
- hierarchy cycles/unsupported nested structures must remain rejected;
- when a task becomes a subtask, project inheritance follows the parent.

## 5.5 Ordering already has correct internal service methods

Task hierarchy/order services support before/after relationships and sibling-scope renumbering. Taxonomy drag services do the same for projects/tags and protect against cycles.

This is why public AI schemas should use semantic positions and not expose raw sort numbers.

## 5.6 Project/tag delete semantics must be documented accurately

Current project deletion does **not** mean "delete every task in the project".

Existing behavior:

- remove the selected project;
- tasks directly assigned to it become unassigned/Inbox tasks;
- direct child projects are promoted/reparented according to current taxonomy delete behavior.

Current tag deletion:

- removes the tag itself;
- removes that tag assignment from affected tasks;
- child tags are reparented according to existing taxonomy behavior.

The AI tool descriptions/results must state these effects clearly.

## 5.7 Reminder model

Built-in reminder definitions currently include:

```text
On time
5 minutes before
10 minutes before
15 minutes before
30 minutes before
1 hour before
2 hours before
3 hours before
1 day before
```

Custom reminders are already supported by Todo's reminder service.

Do not expose internal reminder IDs to Gemini. Use an AI-friendly schema:

```json
{
  "reminders": [
    { "minutesBefore": 30 },
    { "minutesBefore": 1440 }
  ]
}
```

The Todo adapter converts minutes into an existing built-in ID or existing custom reminder representation.

An empty array clears reminders.

## 5.8 Repeat model

File:

```text
TodoList-ui/js/repeat/repeat-engine.js
```

Supported repeat modes:

```text
none
daily
weekly
monthly
yearly
custom
```

Custom units:

```text
day
week
month
year
```

Custom fields already support interval, weekdays, month days, yearly dates, and end rules (`never`, `date`, `count`).

Do not add separate repeat functions. This object belongs inside task create/update.

## 5.9 Actual supported workspace views

File:

```text
TodoList-ui/js/components/workspace-controls.js
```

The current application supports:

```text
viewType:
  list
  kanban

sortKey:
  custom
  dueDate
  priority
  name
  createdAt

sortDirection:
  asc
  desc

groupKey:
  none
  priority
  date
  project
  tag
```

Do **not** expose Timeline because Timeline is not currently implemented in this Todo runtime.

## 5.10 UI does not automatically render after every state mutation

`AppDataService` correctly persists and updates `AppState`, but Todo UI components normally call `render()` after a user action.

Therefore AI calls need a centralized post-mutation UI synchronization step.

This is mandatory for the requirement that changes appear instantly without refresh.

---

# 6. Final public AI tool inventory

Use exactly these **14** tools for v1:

| # | Tool | Purpose |
|---|---|---|
| 1 | `todo_find_tasks` | Get/search/filter task or subtask data |
| 2 | `todo_create_tasks` | Create one or many tasks/subtasks |
| 3 | `todo_update_tasks` | Update one or many tasks/subtasks, including completion, movement, scheduling and order |
| 4 | `todo_delete_tasks` | Delete one or many tasks/subtasks |
| 5 | `todo_list_projects` | Read projects/subprojects and hierarchy |
| 6 | `todo_create_projects` | Create one or many projects/subprojects |
| 7 | `todo_update_projects` | Update/reparent/reorder one or many projects/subprojects |
| 8 | `todo_delete_projects` | Delete one or many projects/subprojects |
| 9 | `todo_list_tags` | Read tags/subtags and hierarchy |
| 10 | `todo_create_tags` | Create one or many tags/subtags |
| 11 | `todo_update_tags` | Update/reparent/reorder one or many tags/subtags |
| 12 | `todo_delete_tags` | Delete one or many tags/subtags |
| 13 | `todo_get_workspace` | Read current Todo navigation/view/sort/group state |
| 14 | `todo_update_workspace` | Navigate Todo and change view/sort/group settings |

This inventory intentionally removes separate tools for:

```text
get_task
search_tasks
filter_tasks
batch_create_tasks
batch_update_tasks
batch_delete_tasks
move_task
complete_task
reopen_task
create_subtask
set/clear date
set/clear time
set/clear reminder
set/clear repeat
set/clear priority
create_subproject
create_subtag
move_project
move_tag
reorder_* tools
navigate_to_* tools
set_view_mode
set_group_by
set_sort_by
```

Their capabilities remain available through the 14 tools above.

---

# 7. MCP-inspired tool metadata

Keep metadata next to each declaration for documentation/tests/future interoperability.

| Tool group | readOnly | destructive | idempotent | openWorld |
|---|---:|---:|---:|---:|
| find/list/get workspace | true | false | true | false |
| create | false | false | false | false |
| update task/project/tag | false | true | false (conservative) | false |
| delete | false | true | false (conservative) | false |
| update workspace UI | false | false | true for exact target state | false |

These are **hints**, not security enforcement.

---

# 8. Shared AI-facing schema conventions

## 8.1 Batch limits

Each plural mutation tool accepts:

```text
1–50 objects per call
```

Additionally reject an encoded tool request larger than the dedicated Todo RPC payload limit described later.

## 8.2 Null versus omitted

Use standard PATCH semantics:

```text
field omitted → leave current value unchanged
field = null / empty collection → explicitly clear when that field is clearable
```

Examples:

```text
projectId: null     → unassign root task from project / Inbox
parentTaskId: null  → unlink a subtask to root, where allowed
tagIds: []          → remove all tags
dueDate: null       → clear date
dueTime: null       → clear time
reminders: []       → clear reminders
repeat: null        → clear repeat
priority: "none"    → clear priority
description: ""     → clear description
```

`title`/project name/tag name may never become empty.

## 8.3 Dates

Canonical AI function format:

```text
YYYY-MM-DD
```

Do not send natural-language dates into Todo persistence.

Gemini may interpret "tomorrow" from conversation context, but the actual function argument should be the resolved date.

## 8.4 Time

Use the existing Todo format:

```text
hh:mm AM
hh:mm PM
```

Examples:

```text
07:30 AM
09:05 PM
```

The Todo adapter validates it before mutation.

## 8.5 Priority

AI enum:

```text
none
low
medium
high
```

Adapter maps `none` to Todo's internal empty priority.

## 8.6 Position

Shared position schema:

```json
{
  "placement": "top | bottom | before | after",
  "relativeToId": "optional-id"
}
```

Rules:

- `relativeToId` required for `before`/`after`;
- reference must exist in the target sibling scope;
- omit `position` to preserve normal app default/current placement;
- if explicit task positioning is requested while task sort is non-custom, activate custom sorting through existing service logic so the requested order is actually visible;
- never expose raw `sortOrder`.

## 8.7 Result size

Return only the affected/matched objects and useful metadata. Never dump the entire Todo IndexedDB store as a write-tool result.

---

# 9. Tool arguments — tasks

## 9.1 `todo_find_tasks`

Purpose:

One read tool replaces get/search/filter task tools.

Arguments:

```text
ids?: string[]
query?: string
projectIds?: string[]
tagIds?: string[]
tagMatch?: "any" | "all"             default: "any"
dueFrom?: "YYYY-MM-DD"
dueTo?: "YYYY-MM-DD"
completed?: boolean
priorities?: ("none"|"low"|"medium"|"high")[]
parentTaskId?: string | null
includeSubtasks?: boolean              default: true
scope?: "all" | "current_view"        default: "all"
limit?: integer 1..100                 default: 50
```

Filter semantics:

- supplied filter categories combine with AND;
- `tagMatch` controls only the relation between supplied tags;
- `query` searches title and description case-insensitively;
- `ids` is exact matching;
- `parentTaskId` string selects children of that task;
- `parentTaskId: null` explicitly selects root tasks when the field is present;
- `scope: current_view` uses the same effective filter currently visible in Todo.

Result item should contain:

```text
id
title
description
projectId
parentTaskId
priority
tagIds
completed
dueDate
dueTime
reminders (semantic minutesBefore form)
repeat
position/order summary
createdAt
updatedAt
```

Also include resolved project/tag names for model readability, but IDs remain canonical.

## 9.2 `todo_create_tasks`

Arguments:

```text
tasks: TaskCreateInput[]   // 1..50
```

`TaskCreateInput`:

```text
title: string                         required
description?: string
projectId?: string | null
parentTaskId?: string | null
priority?: "none"|"low"|"medium"|"high"
tagIds?: string[]
dueDate?: "YYYY-MM-DD" | null
dueTime?: "hh:mm AM/PM" | null
reminders?: ReminderInput[]
repeat?: RepeatInput | null
completed?: boolean                   default false
position?: PositionInput
```

Rules:

- a `parentTaskId` creates a subtask of an existing valid root task;
- a subtask inherits its parent's project using existing Todo rules; reject conflicting explicit project assignment rather than silently accepting impossible state;
- no nested subtask-of-subtask support because the current Todo hierarchy is one parent task level;
- creating a parent and its children in one logical user request can use two normal tool rounds: create parent first, then use returned parent ID in the next `todo_create_tasks` call. This avoids introducing fragile temporary-reference syntax;
- if `completed:true`, create first and then use existing completion semantics;
- if repeat requires a date and none is supplied, preserve the current RepeatEngine behavior.

## 9.3 `todo_update_tasks`

Arguments:

```text
tasks: TaskUpdateInput[]   // 1..50
```

`TaskUpdateInput`:

```text
id: string                            required
title?: string
description?: string
projectId?: string | null
parentTaskId?: string | null
priority?: "none"|"low"|"medium"|"high"
tagIds?: string[]
dueDate?: "YYYY-MM-DD" | null
dueTime?: "hh:mm AM/PM" | null
reminders?: ReminderInput[]
repeat?: RepeatInput | null
completed?: boolean
position?: PositionInput
```

This one tool absorbs:

```text
move task
complete/uncomplete task
link/unlink subtask
change project
affect tags
set/clear date
set/clear time
set/clear reminder
set/clear repeat
set/clear priority
reorder task/subtask
```

### Internal operation ordering

For each update, execute in a stable order:

1. resolve and validate task ID;
2. validate all requested referenced project/tag/parent/position IDs;
3. apply ordinary editable fields through `AppDataService.updateTask()`;
4. if parent relationship changes, use hierarchy service to link/unlink/reparent;
5. apply explicit semantic position through hierarchy/order service;
6. apply desired completion state **last**, using `toggleTaskStatus()` only when current state differs;
7. return the final affected state and any repeat-generated next occurrence metadata.

Completion last is important because completing a repeating task may finalize one occurrence and create another.

When a repeating completion creates a next occurrence, result metadata should make this explicit:

```text
requestedTaskId
completedTaskId
nextOccurrenceId
```

when applicable.

## 9.4 `todo_delete_tasks`

Arguments:

```text
taskIds: string[]   // 1..50
```

Rules:

- deduplicate IDs before execution;
- if both a root task and one of its subtasks are supplied, execute the root family deletion once and report the redundant child request as covered by the parent deletion;
- deleting a root task uses existing `deleteTaskFamily()` behavior and therefore deletes its subtasks;
- deleting a subtask removes only that subtask;
- return deleted IDs/family IDs so Gemini knows exactly what disappeared.

---

# 10. Shared reminder/repeat arguments

## 10.1 ReminderInput

```text
minutesBefore: integer >= 0
```

Examples:

```json
[{ "minutesBefore": 0 }]
[{ "minutesBefore": 30 }]
[{ "minutesBefore": 30 }, { "minutesBefore": 1440 }]
```

The adapter:

1. reuses a built-in definition when one matches;
2. otherwise converts minutes into the current custom reminder representation and lets the existing reminder service persist/resolve it;
3. deduplicates equal reminders.

## 10.2 RepeatInput

```text
mode: "daily" | "weekly" | "monthly" | "yearly" | "custom"

custom?: {
  interval: integer 1..99
  unit: "day" | "week" | "month" | "year"
  weekdays?: integer[]       // 0=Sunday ... 6=Saturday
  monthDays?: integer[]      // 1..31
  yearDates?: object         // existing RepeatEngine month-index → days representation
}

end?: {
  type: "never" | "date" | "count"
  date?: "YYYY-MM-DD"
  count?: integer 1..200
}
```

Always validate through the existing RepeatEngine before persistence.

---

# 11. Tool arguments — projects

## 11.1 `todo_list_projects`

Arguments:

```text
ids?: string[]
query?: string
includeCounts?: boolean   default true
limit?: integer 1..100    default 100
```

Return hierarchy-aware items:

```text
id
name
icon
parentId
viewType
position/order summary
directTaskCount / treeTaskCount when requested
children IDs
```

## 11.2 `todo_create_projects`

Arguments:

```text
projects: ProjectCreateInput[]   // 1..50
```

`ProjectCreateInput`:

```text
name: string                    required
icon?: string
parentId?: string | null
viewType?: "list" | "kanban"
position?: PositionInput
```

For a newly-created parent and child in the same user request, prefer sequential function rounds so the child receives the real parent ID. Do not invent client-only IDs in v1.

## 11.3 `todo_update_projects`

Arguments:

```text
projects: ProjectUpdateInput[]   // 1..50
```

`ProjectUpdateInput`:

```text
id: string                      required
name?: string
icon?: string
parentId?: string | null
viewType?: "list" | "kanban"
position?: PositionInput
```

This tool handles rename, reparent to subproject/top-level, view change, and reorder.

Internally use taxonomy update/drag services so cycle validation and sibling renumbering remain correct.

## 11.4 `todo_delete_projects`

Arguments:

```text
projectIds: string[]   // 1..50
```

Tool description must state current app semantics:

```text
Deleting a project does not delete its tasks.
Tasks directly assigned to it become unassigned/Inbox tasks.
Its direct child projects are promoted/reparented according to current Todo hierarchy rules.
```

Return:

```text
deletedProjectIds
affectedTaskIds
reparentedProjectIds
```

where available.

---

# 12. Tool arguments — tags

## 12.1 `todo_list_tags`

Arguments:

```text
ids?: string[]
query?: string
includeCounts?: boolean   default true
limit?: integer 1..100    default 100
```

Return:

```text
id
name
icon
parentId
viewType
position/order summary
direct/tree task counts when requested
children IDs
```

## 12.2 `todo_create_tags`

Arguments:

```text
tags: TagCreateInput[]   // 1..50
```

`TagCreateInput`:

```text
name: string                    required
icon?: string
parentId?: string | null
viewType?: "list" | "kanban"
position?: PositionInput
```

## 12.3 `todo_update_tags`

Arguments:

```text
tags: TagUpdateInput[]   // 1..50
```

`TagUpdateInput`:

```text
id: string                      required
name?: string
icon?: string
parentId?: string | null
viewType?: "list" | "kanban"
position?: PositionInput
```

This handles rename, reparent/top-level, view, and order.

## 12.4 `todo_delete_tags`

Arguments:

```text
tagIds: string[]   // 1..50
```

Tool description must state:

```text
Deleting a tag removes that tag assignment from affected tasks.
It does not delete those tasks.
Child tags are reparented according to current Todo hierarchy behavior.
```

Return affected task/tag IDs.

---

# 13. Tool arguments — Todo workspace/UI

## 13.1 `todo_get_workspace`

No required arguments.

Return:

```text
currentFilter: {
  type: "smart" | "project" | "tag"
  id: string
  title: string
}

viewType: "list" | "kanban"
sortKey: "custom" | "dueDate" | "priority" | "name" | "createdAt"
sortDirection: "asc" | "desc"
groupKey: "none" | "priority" | "date" | "project" | "tag"
visibleTaskIds: string[]          bounded
visibleTaskCount: integer
```

This gives Gemini enough UI context to answer requests such as:

```text
"Create this in the project I am currently looking at."
"What is on this page?"
"Change this project to Kanban."
```

## 13.2 `todo_update_workspace`

Arguments:

```text
navigate?:
  { type: "smart", value: "inbox" | "today" | "completed" }
  | { type: "project", id: string }
  | { type: "tag", id: string }

viewType?: "list" | "kanban"

viewTarget?:
  { type: "current" }
  | { type: "project", id: string }
  | { type: "tag", id: string }

sortKey?: "custom" | "dueDate" | "priority" | "name" | "createdAt"
sortDirection?: "asc" | "desc"
groupKey?: "none" | "priority" | "date" | "project" | "tag"
```

Rules:

- `navigate` changes the active Todo page/filter;
- `viewType` without `viewTarget` applies to current effective target;
- project/tag view changes use existing `setEntityViewType()` so the setting persists on that entity;
- global sort/group/direction use `AppDataService.setSetting()` / existing custom-sort activation behavior;
- switching to `custom` must preserve/activate a valid current custom-order snapshot exactly as the existing UI does;
- after any change, synchronize Sidebar active selection/title, WorkspaceControls state, and task rendering.

---

# 14. Structured result/error contract

Every Todo tool returns a JSON object and should avoid throwing ordinary business validation failures past the custom function executor.

Success:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "affectedCount": 1,
    "warnings": []
  }
}
```

Failure:

```json
{
  "ok": false,
  "error": {
    "code": "TASK_NOT_FOUND",
    "message": "Task not found.",
    "details": {}
  }
}
```

Batch partial failure:

```json
{
  "ok": false,
  "error": {
    "code": "PARTIAL_FAILURE",
    "message": "Some requested operations were committed before a later item failed."
  },
  "data": {
    "succeeded": [],
    "failed": {},
    "unattempted": []
  }
}
```

Recommended stable error codes:

```text
TODO_TOOL_DISABLED
TODO_UNAVAILABLE
INVALID_ARGUMENT
TASK_NOT_FOUND
PROJECT_NOT_FOUND
TAG_NOT_FOUND
INVALID_PARENT
HIERARCHY_CONFLICT
POSITION_CONFLICT
STORAGE_ERROR
BRIDGE_TIMEOUT
REQUEST_ABORTED
PARTIAL_FAILURE
INTERNAL_TODO_ERROR
```

Do not expose stack traces, IndexedDB internals, or raw exception objects to Gemini.

---

# 15. Batch execution semantics

The existing Todo service methods contain complex purpose-specific IndexedDB transactions and repeat/hierarchy logic. Do not rewrite all of them merely to force a giant cross-operation transaction.

Use this safe v1 policy:

1. validate the entire request envelope and basic object schemas first;
2. pre-resolve referenced IDs when possible;
3. execute items sequentially in input order through existing AppDataService queue/services;
4. stop on the first item that fails;
5. return `PARTIAL_FAILURE` if earlier items were already durably committed;
6. include succeeded/failed/unattempted items so Gemini can explain or retry intelligently;
7. refresh Todo UI **once at the end of the whole tool call**, not after every item.

This preserves existing business logic and avoids false claims of atomicity.

Future fully atomic batch transactions may be added only if there is a real product need.

---

# 16. ChatUI ↔ Shell ↔ Todo communication architecture

## 16.1 Do not cross-import sibling application modules

The Chat iframe must not import Todo's `AppDataService` or reach directly into Todo DOM/globals.

The iframe boundary should remain an architectural boundary.

## 16.2 Use the existing exact-origin shell protocol

Current files:

```text
shell/js/protocol.js
shell/js/frame-bridge.js
ChatUI/js/embedded/shell-bridge.js
TodoList-ui/js/embedded/shell-bridge.js
```

Add correlated request/response messages.

Recommended message flow:

```text
Gemini functionCall
   ↓
ChatUI todo-tool-executor
   ↓
Chat TodoBridgeClient
   ↓ postMessage
chatui:todo-tool-request
   ↓
Shell frame bridge
   ↓ postMessage
shell:todo-tool-request
   ↓
Todo embedded bridge
   ↓
TodoToolExecutor
   ↓
TodoToolService / AppDataService
   ↓
Todo UI sync
   ↓
todo:tool-response
   ↑
Shell
   ↑
shell:todo-tool-response
   ↑
Chat pending Promise
   ↑
Gemini functionResponse
```

## 16.3 Request envelope

```json
{
  "requestId": "todo:<uuid>",
  "functionName": "todo_create_tasks",
  "args": {}
}
```

## 16.4 Response envelope

```json
{
  "requestId": "todo:<uuid>",
  "functionName": "todo_create_tasks",
  "result": {
    "ok": true,
    "data": {}
  }
}
```

## 16.5 Source/origin validation

Keep current exact-origin validation and additionally enforce direction:

- shell accepts `chatui:todo-tool-request` only from the registered Chat iframe;
- shell forwards it only to the registered Todo iframe;
- shell accepts `todo:tool-response` only from the registered Todo iframe;
- shell forwards response only to Chat;
- Todo only accepts the explicit shell request type and allowlisted `todo_*` function names;
- Chat only resolves a pending request when both request ID and expected function name match.

Do not use `postMessage('*')`.

## 16.6 Availability/capability negotiation

Todo's `app:ready` should advertise an additive capability:

```text
todo-tools-v1
```

The shell tells Chat whether Todo tools are available.

Chat keeps a runtime capability flag separate from the saved user preference.

Effective declaration rule:

```text
saved tools.todo == true
AND
Todo bridge capability == ready
```

Only then include Todo function declarations in a Gemini request.

This prevents tool calls before Todo startup/hydration is complete.

## 16.7 Timeout and abort

Chat bridge client:

- one pending Promise per requestId;
- default timeout: 15 seconds;
- remove pending entry on result, timeout, or abort;
- respect the generation AbortSignal;
- late responses after abort/timeout are ignored.

## 16.8 Payload limits

Current shell protocol globally limits payload JSON to about 32 KiB. Batch task descriptions can legitimately exceed that.

Do **not** simply remove the limit.

Recommended approach:

- retain the normal 32 KiB cap for ordinary shell messages;
- introduce a dedicated Todo RPC validator with a hard cap of **128 KiB** for Todo tool request/response envelopes;
- still enforce per-field lengths and 50-object batch limits;
- reject over-limit requests before execution with `INVALID_ARGUMENT`.

Suggested field limits:

```text
title/name: 500 characters
description: 4,000 characters
query: 1,000 characters
IDs: 512 characters each
arrays: defined per schema
```

These are guardrails, not database schema changes.

---

# 17. Todo-side executor architecture

Create a small dedicated Todo tool layer instead of putting a large switch statement into `shell-bridge.js`.

Recommended new modules:

```text
TodoList-ui/js/tools/todo-tool-registry.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-normalizers.js
TodoList-ui/js/tools/todo-tool-ui-sync.js
```

Responsibilities:

## `todo-tool-registry.js`

- allowlist supported `todo_*` function names;
- map function name → handler;
- carry metadata such as readOnly/destructive.

## `todo-tool-normalizers.js`

- validate dates/times/enums;
- map `projectId` → internal `project`;
- map `tagIds` → internal `tags`;
- map priority `none` → `''`;
- convert semantic reminders to existing reminder IDs/custom definitions;
- normalize repeat objects through RepeatEngine;
- validate semantic position objects;
- serialize task/project/tag data into bounded AI-facing results.

## `todo-tool-executor.js`

- validate function call + args;
- implement batch orchestration;
- call existing AppDataService/hierarchy/taxonomy/order methods;
- return stable structured results/errors;
- never directly access IndexedDB stores.

## `todo-tool-ui-sync.js`

Centralize exactly one post-call refresh/reconciliation based on mutation domains.

Do not scatter UI rendering throughout each tool handler.

---

# 18. Immediate Todo UI synchronization

This is a core acceptance requirement, not an optional polish item.

After a successful AI mutation, refresh the mounted Todo UI immediately.

Recommended synchronization matrix:

## Task mutations

Call the equivalent of:

```text
TasksComponent.refreshAfterTaskMutation()
SidebarComponent.updateCounts()
```

If project/tag metadata shown in task menus changed during the same logical operation, rebuild those menus as needed.

## Project mutations

Refresh:

```text
SidebarComponent.renderProjects()
SidebarComponent.syncCurrentView()
TasksComponent.renderProjectMenu()
TasksComponent.render()
SidebarComponent.updateCounts()
```

If the current project was deleted, existing state logic falls back to Inbox; the visual navigation must be synchronized to that new state.

## Tag mutations

Refresh:

```text
SidebarComponent.renderTags()
SidebarComponent.syncCurrentView()
TasksComponent.renderTagMenu()
TasksComponent.render()
SidebarComponent.updateCounts()
```

## Workspace mutations

Synchronize:

```text
Sidebar active filter/title
WorkspaceControls internal state + UI
TasksComponent render
counts
```

## Important performance rule

For a batch of 30 tasks:

```text
30 data operations
1 final UI refresh
```

not:

```text
30 data operations
30 full renders
```

Because the Todo iframe remains mounted while hidden, this render still updates its DOM. Switching back to Todo therefore shows the new state instantly without a page reload or rehydration.

---

# 19. Open editor/modal conflict handling

An AI tool may modify data while the user has a Todo editor/modal open.

Do not blindly overwrite the user's currently typed, unsaved form controls.

V1 policy:

- underlying persisted/AppState data changes immediately;
- task list/sidebar/counts update immediately;
- do not repopulate an open editor's text fields solely because an AI call completed;
- if the AI deletes the exact entity currently being edited, close the now-invalid editor safely and restore focus;
- if project/tag deletion invalidates a menu selection, rebuild the menu from state;
- after the user closes/reopens an editor, it reads the committed latest state.

A future optimistic conflict banner can be added later; it is not required for the initial integration.

---

# 20. Chat-side modules and registry

Recommended new modules:

```text
ChatUI/js/todo/todo-tool-definitions.js
ChatUI/js/todo/todo-tool-executor.js
ChatUI/js/todo/todo-bridge-client.js
```

## `todo-tool-definitions.js`

Contains only AI-facing function declarations and metadata.

Descriptions should tell the model:

- use read tools first when an existing ID is unknown/ambiguous;
- create/update tools accept one or many objects;
- updates use omitted-vs-null semantics;
- project/tag/task delete effects;
- position is semantic;
- do not invent IDs.

Keep descriptions precise enough for tool choice but not unnecessarily verbose, to reduce prompt/context cost.

## `todo-bridge-client.js`

- tracks Todo capability readiness;
- sends correlated requests to shell;
- owns pending request map/timeouts/abort;
- never executes Todo business logic.

## `todo-tool-executor.js`

- verifies tool is currently enabled/effectively available;
- sends request through bridge client;
- normalizes bridge-level failures into stable Todo tool results.

## Generic function registry update

`ChatUI/js/tools/function-tool-registry.js` should become provider-neutral and register both Workspace and Todo.

A small descriptor registry is preferable to adding repeated conditional code for each future provider.

---

# 21. ChatUI tool toggle/availability behavior

## Combined app

When Todo capability is ready:

- To-Do toggle is enabled;
- saved state can be turned on/off like Workspace;
- active pill appears when enabled;
- Gemini declarations are sent only when enabled.

## Before Todo is ready

The To-Do option can render disabled with a small unavailable/loading state. Do not let the user enable a tool the current generation cannot execute.

## Standalone ChatUI

Standalone ChatUI has no sibling Todo iframe.

Preserve standalone behavior:

- do not throw during startup;
- show To-Do as unavailable/disabled (or hide it consistently if UI design prefers, but disabled is more self-explanatory);
- do not include Todo function declarations;
- do not erase the stored `tools.todo` preference merely because Todo is temporarily unavailable.

If the same settings database is later used in the combined shell and `tools.todo` was enabled, it can become effective once the capability is ready.

---

# 22. Live Voice behavior

No special voice-only tool declarations.

Acceptance flow:

```text
1. Enable To-Do tool.
2. Open Live Voice.
3. Say: "Create a task called Buy medicine tomorrow at 5 PM and remind me 30 minutes before."
4. Live Voice transcribes/sends the normal user turn.
5. Gemini calls todo_create_tasks.
6. Todo hidden iframe persists task and refreshes its DOM.
7. Function result returns to Gemini.
8. Gemini speaks confirmation.
9. Switch to Todo.
10. Task is already visible without refresh.
```

The same must work for update/delete/project/tag/view operations.

---

# 23. File-by-file implementation plan

## ChatUI — modify

```text
ChatUI/js/state/store.js
```

- add `tools.todo` default false;
- add runtime bridge availability only if a dedicated bridge client does not encapsulate it.

```text
ChatUI/js/storage/load.js
```

- normalize persisted `savedTools.todo`;
- no DB version/schema change.

```text
ChatUI/html/main-chat.html
ChatUI/html/right-sidebar.html
```

- add To-Do tool option/card matching current tool UI.

```text
ChatUI/js/composer/composer.js
```

- wire Todo state/toggle/pill;
- preferably introduce small data-driven descriptor for current tool UI synchronization rather than one more duplicated set of selectors.

```text
ChatUI/js/tools/function-tool-registry.js
```

- register Todo declarations/executor when effectively enabled;
- make unsupported-function error generic rather than Workspace-specific.

```text
ChatUI/js/api/gemini.js
```

- keep current function loop;
- classify `todo_` provider in emitted activity or use centralized provider helper;
- rename Workspace-specific loop-limit error text to generic custom-tool wording where applicable.

```text
ChatUI/js/chat/activity-timeline.js
```

- recognize `todo_` provider;
- add To-Do display label and compact summaries.

```text
ChatUI/js/embedded/shell-bridge.js
```

- integrate Todo availability/results only if the dedicated Todo bridge client hooks into this module; avoid duplicate message listeners/validators where possible.

## ChatUI — add

```text
ChatUI/js/todo/todo-tool-definitions.js
ChatUI/js/todo/todo-tool-executor.js
ChatUI/js/todo/todo-bridge-client.js
```

## Shell — modify

```text
shell/js/frame-bridge.js
shell/js/protocol.js
```

- add allowlisted Todo RPC routing/capability/result messages;
- maintain exact-origin + known-frame validation;
- keep existing message behavior backward compatible.

Only modify frame-manager/main shell code if needed to retain/rebroadcast Todo capability readiness cleanly.

## Todo — modify

```text
TodoList-ui/js/embedded/shell-bridge.js
```

- advertise `todo-tools-v1` only after app initialization;
- receive allowlisted Todo tool requests;
- execute asynchronously;
- send correlated result.

```text
TodoList-ui/js/app-main.js
```

- pass/register any tool executor dependencies required by embedded bridge after state/storage/UI initialization;
- do not change startup order unnecessarily.

## Todo — add

```text
TodoList-ui/js/tools/todo-tool-registry.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-normalizers.js
TodoList-ui/js/tools/todo-tool-ui-sync.js
```

## Existing Todo services

Prefer no changes.

Only add narrowly-scoped internal service helpers if implementation discovers an operation cannot safely be composed from current AppDataService/hierarchy/taxonomy APIs. Do not add AI-specific logic to generic storage repositories.

## Build scripts

No expected changes.

Current combined/standalone static build scripts already copy the `js` trees recursively, so new modules under `ChatUI/js` and `TodoList-ui/js` should be included automatically.

---

# 24. Validation and safety rules

## 24.1 Function allowlist

Todo iframe must execute only names registered in the local Todo tool registry.

Never execute arbitrary property names supplied by the model.

## 24.2 No dynamic code execution

No `eval`, dynamic imports from model arguments, or model-provided method names beyond exact allowlist lookup.

## 24.3 Referential validation

Before mutation:

- task/project/tag/parent/reference IDs must exist;
- before/after target must be in legal sibling scope;
- taxonomy parent must not create a cycle;
- task parent rules must remain enforced;
- project/tag IDs assigned to tasks must exist.

## 24.4 Destructive semantics

Delete tools remain separate so destructive intent is obvious to both model and activity UI.

Do not hide deletion under a generic `action` field inside update.

The tool description should instruct the model to call deletion only when the user's request actually asks for deletion/removal.

Do not display a hidden Todo `window.confirm()` dialog during AI execution; that could block a hidden iframe indefinitely. Authorization is the explicit conversational request plus model tool call. A future Chat-level confirmation policy may be added separately if desired.

## 24.5 Closed-world result data

Todo tools may only return data from the local Todo app. They should not fetch network content.

## 24.6 Abort does not pretend to roll back committed work

If generation is aborted after Todo already committed an operation, do not lie and report that the mutation was undone. Abort should stop waiting/future calls, while committed Todo state remains authoritative.

---

# 25. Testing plan

## 25.1 Declaration/UI tests

Verify:

- To-Do appears in composer Tools popup;
- To-Do appears in right sidebar with same visual pattern;
- both toggles stay synchronized;
- active indicator pill appears/disappears;
- state persists across refresh;
- Todo declarations absent when toggle off;
- declarations present when toggle on + capability ready;
- declarations absent safely in standalone ChatUI.

## 25.2 Read tools

Test:

- exact IDs;
- text search;
- project/tag filters;
- any/all tag matching;
- date ranges;
- completed true/false;
- priority filters;
- root/subtask filters;
- current-view scope;
- limits/bounded output;
- project/tag hierarchy/counts;
- current workspace state.

## 25.3 Task create

Test one and batch:

- title only;
- description;
- Inbox task;
- project;
- multiple tags;
- all priorities including none;
- date only;
- time only if current app allows it;
- date + time;
- built-in reminder;
- custom reminder;
- multiple reminders;
- daily/weekly/monthly/yearly/custom repeat;
- repeat end by date/count;
- existing parent subtask;
- explicit top/bottom/before/after position;
- completed create when explicitly requested;
- invalid project/tag/parent rejected cleanly.

## 25.4 Task update

Test:

- rename/description;
- change/clear project;
- add/replace/clear tags;
- set/clear date;
- set/clear time;
- set/clear reminders;
- set/clear repeat;
- set/clear priority;
- complete active task;
- change completed task back to active using the same `completed` field, with no separate tool;
- repeating completion generates next occurrence exactly according to existing RepeatEngine;
- root → subtask;
- subtask → root;
- legal reparent;
- illegal hierarchy rejected;
- position within root scope;
- position within subtask sibling scope;
- batch mixed updates;
- one mid-batch failure reports partial results.

## 25.5 Task delete

Test:

- one root task without children;
- root with subtasks deletes family;
- one subtask only;
- several tasks;
- parent+child duplicated input does not double-delete;
- missing ID result.

## 25.6 Projects/tags

For both entity types test:

- create one/many;
- child creation under existing parent;
- rename/icon/view;
- reparent;
- make top-level;
- before/after/top/bottom order;
- cycle rejection;
- delete current selection;
- delete parent and verify existing child promotion behavior;
- project deletion unassigns tasks rather than deleting them;
- tag deletion removes tag relation rather than deleting tasks.

## 25.7 Workspace/UI

Test:

- navigate Inbox/Today/Completed;
- navigate project;
- navigate tag;
- set List/Kanban;
- persist project/tag view;
- group all supported values;
- sort all supported values;
- direction asc/desc;
- custom sort activation;
- no Timeline declaration/value accepted.

## 25.8 Immediate rendering

With Todo visible:

- AI create/update/delete appears instantly without refresh.

With Todo hidden:

- perform AI calls from Chat;
- switch to Todo;
- changed state is already rendered.

Verify sidebar counts, task list/Kanban, project/tag trees, current view title, and menus are correct.

## 25.9 Live Voice

Test repeated voice cycles:

- read Todo;
- create task;
- update task;
- create project/tag;
- completion;
- deletion explicitly requested;
- change workspace view;
- switch between Todo/Chat during voice generation;
- no iframe reload and no dropped tool result.

## 25.10 Bridge/security

Test:

- wrong-origin message rejected;
- unknown source window rejected;
- unsupported function rejected;
- mismatched request/function response ignored;
- duplicate/late response ignored;
- timeout returns `BRIDGE_TIMEOUT`;
- aborted generation clears pending request;
- payload > allowed cap rejected;
- malformed array/enum/date/time rejected;
- Todo not ready/unavailable handled without crash.

## 25.11 Build/regression

Run existing:

```text
node scripts/verify-integration.mjs
node scripts/build-static.mjs
```

and standalone ChatUI/Todo build verification if present.

Extend integration verification to confirm:

- Todo capability exists in embedded mode;
- shell protocol contains expected Todo RPC route;
- Chat declarations use `todo_` prefix;
- no direct sibling iframe DOM/service coupling was introduced;
- static build contains new Todo tool modules.

Regression-check:

- Workspace tool still works;
- Google Search/URL Context/Code Execution unaffected;
- normal chat unaffected when Todo disabled;
- Todo manual UI CRUD still works;
- persistence survives reload;
- reminder/repeat behavior remains unchanged outside tool calls;
- combined routing/persistent frames unchanged;
- standalone apps still start.

---

# 26. Recommended implementation order

## Phase 1 — Todo local executor

Build and test Todo-side normalizers, registry, handlers, and UI sync directly against existing services before connecting Gemini.

This proves the 14 contracts map correctly onto current Todo behavior.

## Phase 2 — Shell RPC bridge

Add correlated Chat→Shell→Todo and Todo→Shell→Chat routing, capability negotiation, payload limits, timeout behavior.

Verify with synthetic requests from Chat iframe before Gemini registration.

## Phase 3 — Chat definitions/executor

Add Todo function declarations, bridge client, function registry integration, provider activity display.

Keep Gemini loop unchanged.

## Phase 4 — Tool UI toggle

Add To-Do to popup/sidebar/active pill/persistence and availability states.

## Phase 5 — Live Voice + cross-view verification

Test hidden Todo iframe mutation while speaking in Chat Live Voice.

## Phase 6 — Full regression/build/PR

When implementation is explicitly authorized later:

- create a feature branch from the exact latest `main`;
- implement phases above;
- run automated verification;
- manually test browser/Live Voice behavior;
- open a PR;
- do not merge until reviewed/approved.

---

# 27. Non-goals

This implementation must **not**:

- create a network MCP server;
- expose Todo data to an external service other than data Gemini already receives through requested tool results;
- add a second Todo database;
- write Todo records directly from ChatUI;
- duplicate AppDataService business rules;
- add Timeline view that the current app does not support;
- add new Todo hierarchy levels beyond current task/subtask and project/tag hierarchy rules;
- add a separate completion/reopen/move/reorder/reminder/repeat tool;
- add a generic dangerous `todo_execute_action` tool;
- make UI refresh depend on a full page reload;
- rewrite existing repeat/reminder/storage architecture unless a concrete missing primitive is proven during implementation.

---

# 28. Definition of done

The feature is complete only when all of these are true:

1. ChatUI has a To-Do toggle visually consistent with existing tools.
2. Only the 14 planned Todo function declarations are exposed.
3. Tool declarations are sent to Gemini only when enabled and Todo capability is ready.
4. Normal chat and Live Voice use the same function path.
5. AI can read/search/filter tasks and read project/tag/workspace context.
6. AI can create/update/delete one or many tasks.
7. AI can control task description, project, tags, priority, date, time, reminders, repeat, completion, parent/subtask relationship, and semantic position through create/update rather than extra micro-tools.
8. AI can create/update/delete projects and tags, including hierarchy, views, and position.
9. AI can navigate Todo and change actual supported list/kanban/sort/group settings.
10. All mutations flow through Todo's existing services and IndexedDB/AppState path.
11. Todo UI updates immediately after tool execution, including while its iframe is hidden.
12. Switching from Chat/Live Voice back to Todo shows the result without refresh.
13. Errors are structured, bounded, and understandable to Gemini.
14. Bridge messages are exact-origin/source validated, allowlisted, size-limited, correlated, timeout-safe, and abort-safe.
15. Workspace and other Chat tools continue to work.
16. Standalone ChatUI/Todo remain functional.
17. Existing builds/integration checks pass.
18. No runtime implementation is merged until this plan is reviewed and explicit implementation approval is given.
