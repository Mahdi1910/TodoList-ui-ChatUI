# Implementation Plan ID 3 — ChatUI Todo AI Tool Integration

## Status

**Plan only. Do not implement until explicitly approved.**

This revision replaces the previous review-driven version with the final product decisions from the user. The relevant ChatUI, Shell, Todo state/service/hierarchy/taxonomy/editor/filter/workspace/embedded-bridge files were re-read before this revision.

---

# 1. Goal

Add one new **To-Do** tool to ChatUI, using the same general toggle/card UI as Workspace and the other Chat tools.

When the To-Do tool is enabled, Gemini can read and manage the existing Todo application through a small set of function tools.

The AI should be able to:

- find tasks;
- create one or many tasks/subtasks;
- update one or many tasks/subtasks;
- delete one or many tasks/subtasks;
- create/update/delete Projects and subprojects;
- create/update/delete Tags and subtags;
- set/clear task project, tags, priority, date, time, reminders and repeat;
- make a task completed or active using the normal Todo completion logic;
- move/reparent/order tasks, Projects and Tags;
- read and change the current Todo view/navigation/sort/group settings.

The result must appear in Todo immediately, even when Todo is hidden while the user is in Chat or Live Voice.

Target flow:

```text
User in ChatUI / Live Voice
        ↓
Gemini calls todo_* function
        ↓
ChatUI Todo tool executor
        ↓
Shell bridge ensures Todo iframe is awake/ready
        ↓
Shell sends request once
        ↓
Todo tool executor
        ↓
Existing AppDataService / hierarchy / taxonomy / Repeat logic
        ↓
TodoListDB + AppState
        ↓
One Todo UI reconciliation
        ↓
Structured result → ChatUI → Gemini
```

When the user switches to Todo, the change is already visible. No refresh is required.

This is **MCP-inspired**, but it is not a separate network MCP server. ChatUI already has a Gemini custom-function loop and the combined application already has persistent same-origin Chat/Todo iframes.

---

# 2. Product decisions for this implementation

These decisions are intentional and override recommendations from the review where they conflict.

## 2.1 Reminder support is included now

The AI tool **can create/update/clear Todo reminder configuration now**.

Real browser/system notification delivery is a separate Todo feature that can be implemented later. It does **not** block this tool integration.

This plan only needs to correctly store reminder configuration using Todo's existing reminder system.

## 2.2 Do not redesign the Todo application

The purpose of this work is the ChatUI → Todo AI tool.

Prefer changes in:

```text
ChatUI Todo tool modules
Shell RPC bridge
Todo tool adapter/executor modules
```

Do **not** start a general Todo cleanup/refactor.

Existing Todo services/components should remain unchanged unless a very small integration hook is absolutely required. In v1, staged adapter orchestration is preferred over rewriting AppDataService into new compound transactions.

## 2.3 Todo automatically wakes when a tool needs it

A Todo function must not fail merely because the Todo iframe is currently not ready.

Instead:

```text
function call arrives
→ ensure Todo frame exists/is loading
→ if NOT_CREATED: start it
→ if LOADING: wait
→ if FAILED: automatically retry it once
→ wait for app:ready + todo-tools-v1
→ dispatch the actual Todo RPC once
```

The mutation/read request itself must **not** be inserted into the existing `frameManager.send()` deferred message queue.

The bridge holds the function request while readiness is being established, then sends it once when Todo is ready.

This prevents an old timed-out mutation from unexpectedly executing later while still giving the requested auto-load behavior.

## 2.4 Tool execution is serialized

Todo AI tool calls run **one at a time**.

Use one Todo-tool execution queue:

```text
Tool call 1 finishes
→ Tool call 2 starts
→ Tool call 3 starts after 2
```

Within a batch, items also execute in input order.

At tool-call start, wait for the existing AppDataService write queue to become idle before taking correctness-sensitive state snapshots.

This gives simple predictable state without changing normal Todo service architecture.

## 2.5 Mutation batches are limited to 10

Mutation tools accept:

```text
1..10 items per call
```

This is enough for useful batch creation/update/delete while keeping requests, execution time and results small.

## 2.6 No Chat confirmation for delete in v1

`todo_delete_tasks`, `todo_delete_projects` and `todo_delete_tags` execute when Gemini calls them.

Do not add a Chat approval modal and do not use a hidden Todo `window.confirm()`.

Tool definitions must clearly describe deletion side effects so Gemini receives accurate information, but there is no extra confirmation layer in this implementation.

## 2.7 Open-editor conflict uses rejection, not editor redesign

Do not add optimistic-concurrency/version/dirty-field logic to existing Todo editors for this project.

If an AI mutation would update/delete an entity that is currently open for editing, reject that tool item with:

```text
EDITOR_CONFLICT
```

and tell Gemini which entity is open.

Also reject destructive changes that would invalidate an active editor draft, for example deleting the Project currently selected by an open Task editor or deleting the parent of the currently open Subtask editor.

This preserves the user's unsaved manual draft without modifying the normal Todo editor save system.

## 2.8 Completion + position is allowed

Do not reject a task simply because one update contains both:

```text
completed change
position
```

The adapter supports both and reports exactly what happened.

Position applies to the requested task/occurrence's persistent sibling order. Completion then uses the existing repeat-aware status behavior.

If completion creates a new repeat occurrence, the new occurrence has its own returned ID and keeps the existing Repeat behavior. Position is not silently transferred to a different generated task unless the existing Todo behavior already does so.

If the relative target ends in a different active/completed visual lane, the stored order is still valid even though the two cards may not be visually adjacent. This is not treated as an error.

## 2.9 Project/Tag tree queries include descendants by default

When the AI asks for tasks in a Project or Tag, the normal meaning is the whole tree:

```text
Project + its subprojects
Tag + its subtags
```

So descendant inclusion defaults to true. Exact-only filtering remains available when explicitly requested.

## 2.10 Browser behavior is manually tested by the user

Implementation may run normal syntax/static/build checks.

Do **not** require headless Chrome/browser automation.

The user will perform the functional browser and Live Voice testing using the provided checklist.

---

# 3. Existing architecture verified

## ChatUI

Current ChatUI already has:

- saved tool toggles in `state.tools`;
- tool state persisted inside the existing settings record;
- a generic Gemini custom-function execution loop;
- Workspace custom function declarations/execution;
- per-generation `activeTools` snapshots;
- tool activity rendering in assistant responses;
- Live Voice that uses the normal `sendMessage()` generation path.

Therefore Todo must extend the current custom-function system, not create a second Gemini engine.

## Shell

Current Shell already:

- owns persistent Todo and Chat iframes;
- validates exact same origin/source windows;
- tracks iframe lifecycle (`NOT_CREATED`, `LOADING`, `READY`, `FAILED`);
- starts both frames in the current application;
- has a normal `send()` that queues messages while a frame is not READY.

Todo RPC must use a new **ensure-ready + immediate-send** path rather than that ordinary queue.

## Todo

Current Todo already has authoritative logic for:

- task create/update/delete;
- repeat-aware completion;
- task/subtask hierarchy and ordering;
- Project/Tag hierarchy and ordering;
- reminder persistence;
- list/Kanban views;
- sort/group/custom-order settings;
- family-aware current-view filtering;
- IndexedDB persistence → AppState synchronization.

The new Todo tool adapter must reuse these existing capabilities.

---

# 4. Final public tool inventory — 14 tools

| # | Tool | Purpose |
|---|---|---|
| 1 | `todo_find_tasks` | Search/read tasks and subtasks |
| 2 | `todo_create_tasks` | Create 1–10 tasks/subtasks |
| 3 | `todo_update_tasks` | Update 1–10 tasks/subtasks |
| 4 | `todo_delete_tasks` | Delete 1–10 tasks/subtasks |
| 5 | `todo_list_projects` | Read Project/subproject tree |
| 6 | `todo_create_projects` | Create 1–10 Projects/subprojects |
| 7 | `todo_update_projects` | Update/reparent/order 1–10 Projects |
| 8 | `todo_delete_projects` | Delete 1–10 Projects |
| 9 | `todo_list_tags` | Read Tag/subtag tree |
| 10 | `todo_create_tags` | Create 1–10 Tags/subtags |
| 11 | `todo_update_tags` | Update/reparent/order 1–10 Tags |
| 12 | `todo_delete_tags` | Delete 1–10 Tags |
| 13 | `todo_get_workspace` | Read current Todo page/view/sort/group |
| 14 | `todo_update_workspace` | Navigate/change Todo view/sort/group |

Do not add separate public tools for:

```text
move task
complete task
set/clear date
set/clear time
set/clear reminder
set/clear repeat
set/clear priority
create subtask
create subproject
create subtag
reorder task/project/tag
navigate inbox/today/project/tag
```

Those operations are represented through the 14 tools above.

---

# 5. Gemini declaration format

The conceptual schemas in this plan must be converted to the same declaration style already used by Workspace:

```text
OBJECT
ARRAY
STRING
INTEGER
BOOLEAN
enum
required
```

Do not copy TypeScript union notation directly into Gemini declarations.

Conditional rules are enforced by the Todo normalizer/executor even when Gemini's declaration format cannot express every condition.

---

# 6. Shared argument rules

## Canonical IDs

All updates/deletes of existing entities use unique IDs.

Names are used to help Gemini find an item, but the actual mutation uses:

```text
task id
project id
tag id
```

If a name is ambiguous, Gemini must read first and choose the correct ID.

## Omitted versus clear

For updates:

```text
field omitted → leave unchanged
field = null / [] → clear the value when the field supports clearing
```

Examples:

```text
projectId: null → Inbox/unassigned root task
parentTaskId: null → root task
tagIds: [] → clear tags
dueDate: null → clear date
dueTime: null → clear time
reminders: [] → clear reminders
repeat: null → clear repeat
priority: "none" → no priority
description: "" → clear description
```

## Strict date

Use:

```text
YYYY-MM-DD
```

Reject impossible/invalid calendar dates before AppDataService sees them.

## Strict time

Use:

```text
01:05 PM
```

Valid hours `01..12`, minutes `00..59`, `AM|PM`.

## Priority

```text
none
low
medium
high
```

`none` maps to Todo's internal empty priority.

## Position

Use semantic placement, never raw `sortOrder`:

```text
position: {
  placement: "top" | "bottom" | "before" | "after",
  relativeToId?: "..."
}
```

`relativeToId` is required for `before`/`after` and must belong to the legal sibling scope.

---

# 7. Reminder argument

AI-facing format:

```text
reminders: [
  { minutesBefore: 30 },
  { minutesBefore: 1440 }
]
```

Rules:

- `0` means on time;
- maximum: 86,400 minutes / 60 days, matching the current Todo custom-reminder range;
- reuse built-in reminders first;
- otherwise convert minutes into canonical day/hour/minute parts and deterministic ID:

```text
custom-<day>d-<hr>h-<min>m
```

- pass those IDs through normal `createTask()` / `updateTask()` aggregate persistence so `resolveReminders()` creates/reuses definitions;
- do not pre-save a custom definition separately.

Create default:

```text
reminders omitted → no reminder
```

Update:

```text
omitted → unchanged
[] → clear reminders
```

This tool stores reminder configuration now. Real notification delivery can be added to Todo later without changing this AI-facing contract.

---

# 8. Repeat argument

AI-facing input:

```text
mode: daily | weekly | monthly | yearly | custom

custom: {
  interval: 1..99,
  unit: day | week | month | year,
  weekdays?: 0..6,
  monthDays?: 1..31,
  yearDates?: [
    { month: 1..12, days: [1..31] }
  ]
}

end: {
  type: never | date | count,
  date?: YYYY-MM-DD,
  count?: 1..200
}
```

Validation must be strict before RepeatEngine normalization so invalid AI intent is not silently clamped/filtered.

AI months are normal human months `1..12`; adapter maps them to RepeatEngine's internal month indexes.

---

# 9. RPC/message size and result strategy

The old 128 KiB Todo envelope is larger than needed for the chosen v1 design.

Use:

```text
ordinary shell message hard cap: 32 KiB
Todo RPC request hard cap:       64 KiB
Todo RPC response hard cap:      64 KiB
Todo result target budget:       about 48 KiB
```

The message type must be recognized before applying the correct cap in Shell, Chat embedded bridge and Todo embedded bridge.

Suggested AI input guardrails:

```text
title/name: 500 characters
description: 4,000 characters
query: 1,000 characters
ID: 512 characters
mutation batch: maximum 10
```

## Task read pagination/detail

`todo_find_tasks` supports:

```text
detail: "auto" | "summary" | "full"   default auto
offset: integer >= 0                    default 0
limit: integer
```

Policy:

```text
summary: maximum 20 tasks per call
full:    maximum 10 tasks per call
```

`detail=auto`:

- exact ID lookup of up to 10 tasks → full;
- broad search/filter/list → summary.

Summary returns only essential information:

```text
id
title
project id/name
parentTaskId
priority
tag ids/names
completed
due date/time
small reminder/repeat summary
```

Do not return full descriptions/repeat internals for 100 tasks.

Full mode includes bounded description/reminder/repeat details.

Every paginated result returns:

```text
totalMatched
offset
returnedCount
hasMore
```

If Gemini needs more, it makes another read call with the next offset or asks for full information for specific IDs.

This keeps model context and bridge payloads small instead of dumping all Todo data at once.

---

# 10. `todo_find_tasks`

Conceptual arguments:

```text
ids?: string[]
query?: string
projectIds?: string[]
includeProjectDescendants?: boolean   default true
tagIds?: string[]
includeTagDescendants?: boolean       default true
tagMatch?: any | all                  default any
dueFrom?: YYYY-MM-DD
dueTo?: YYYY-MM-DD
completed?: boolean
priorities?: none|low|medium|high[]
parentTaskId?: string | null
includeSubtasks?: boolean             default true
scope?: all | current_view            default all
detail?: auto | summary | full        default auto
offset?: integer                      default 0
limit?: integer
```

All supplied filter categories combine predictably.

For current view, reuse Todo's existing family-aware rendering source (`TaskFilter.getDisplayTasks()` plus the same family representation used by renderer). Do not create a different filtering interpretation just for AI.

Before snapshotting, the Todo tool queue waits for existing AppDataService writes to settle.

---

# 11. `todo_create_tasks`

```text
tasks: TaskCreateInput[] // 1..10
```

Each task may contain:

```text
title required
description
projectId
parentTaskId
priority
tagIds
dueDate
dueTime
reminders
repeat
completed
position
```

## Subtask rules

If `parentTaskId` is supplied:

- parent must exist;
- parent must be a root/normal task;
- parent must not be completed;
- nested subtask-of-subtask is rejected;
- final subtask project comes from the parent.

If an explicit `parentTaskId` and a conflicting explicit `projectId` are supplied together, return `INVALID_ARGUMENT` instead of silently ignoring the project.

## Parent + children creation

If the user asks to create a new parent and new children in one natural request:

1. first `todo_create_tasks` creates the parent;
2. returned real parent ID is used in the next function round to create the children.

No temporary fake IDs.

## Position/completion

Position is allowed with completed creation.

Adapter creates the requested task, performs requested persistent position, then applies desired completion using normal `toggleTaskStatus()` when needed.

Every stage is reported in the result.

---

# 12. `todo_update_tasks`

```text
tasks: TaskUpdateInput[] // 1..10
```

Each item requires:

```text
id
```

and may change:

```text
title
description
projectId
parentTaskId
priority
tagIds
dueDate
dueTime
reminders
repeat
completed
position
```

Reject duplicate task IDs in the same update array before any mutation.

## 12.1 Adapter decides the correct operation from the requested final state

Do not blindly call `updateTask()` first for every field.

### Root → subtask

If `parentTaskId` changes from null to a valid parent:

- validate parent;
- use existing hierarchy link/drag behavior;
- final project inherits parent project.

If the call explicitly requests both a final subtask parent and a conflicting Project, reject it.

### Subtask → another parent

Use existing hierarchy reparent/drag behavior. Final project inherits the new parent.

### Subtask → root explicitly

If `parentTaskId: null`:

- unlink/move to root first;
- then apply a requested root `projectId`.

### Subtask + new Project without explicit `parentTaskId`

This is an ergonomic v1 rule based on the user decision:

If the current item is a subtask and the update asks for a different non-null `projectId` while no new parent is requested, interpret the intent as:

```text
make this task a root task
then move it to the requested Project
```

The adapter automatically unlinks first, then applies the Project.

This avoids modifying Todo's existing rule that subtasks inherit their parent Project.

### Root Project update

Use existing `updateTask()` behavior, including its propagation of the root Project to child tasks.

Return affected child IDs.

## 12.2 Completion

`completed` is a desired final state.

Use existing `toggleTaskStatus()` only when current state differs.

This preserves normal family/repeat behavior.

No separate completion/activation tool is added.

## 12.3 Position + completion

Both are supported in the same update.

Recommended stage order:

```text
validate all predictable fields/IDs
→ hierarchy transition if needed
→ ordinary fields
→ persistent position
→ desired completion state
```

Position refers to the requested task ID/occurrence.

For repeat completion, return both the completed occurrence/family and any generated next occurrence IDs. A generated next task is not silently treated as the original task.

## 12.4 Per-stage result instead of pretending the whole item is atomic

Unique task ID removes name ambiguity, but one update can still use multiple existing Todo service calls.

Do not redesign Todo just to force one giant transaction.

Return a clear stage result:

```text
{
  inputIndex,
  id,
  operations: [
    { name: "hierarchy", status: "success|failed|skipped" },
    { name: "fields", status: "success|failed|skipped" },
    { name: "position", status: "success|failed|skipped" },
    { name: "completion", status: "success|failed|skipped" }
  ],
  finalTask,
  sideEffects
}
```

Prevalidate everything predictable before the first write.

If an unexpected later stage fails after an earlier stage committed:

```text
error.code = PARTIAL_MUTATION
```

and return the stage statuses plus the final authoritative task state.

This gives Gemini enough information to understand exactly what succeeded and what did not.

---

# 13. `todo_delete_tasks`

```text
taskIds: string[] // 1..10
```

Rules:

- deduplicate IDs;
- root task deletion uses existing family deletion and removes its subtasks;
- deleting one subtask removes only that subtask;
- root + child in the same delete input executes the family deletion once;
- return all actual deleted IDs.

No extra Chat confirmation in v1.

---

# 14. Project tools

## `todo_list_projects`

Returns the Project hierarchy with bounded useful fields:

```text
id
name
icon
parentId
viewType
childrenIds
order summary
active task counts when requested
```

## `todo_create_projects`

Create 1–10 Projects/subprojects.

Fields:

```text
name
icon
parentId
viewType: list|kanban
position
```

## `todo_update_projects`

Update 1–10 IDs; reject duplicate target IDs first.

Can change:

```text
name
icon
parentId
viewType
position
```

Prevalidate parent/cycle/position before writes.

When parent + position are both supplied, use existing taxonomy drag semantics for the hierarchy/order part rather than exposing raw `sortOrder`.

Scalar field changes use existing taxonomy update service.

As with tasks, if stages unexpectedly split and a later one fails, return stage statuses + final Project state rather than pretending nothing happened.

## `todo_delete_projects`

Delete 1–10 IDs immediately when called.

Accurately describe/return existing Todo semantics:

- deleting a Project does **not** delete its tasks;
- tasks directly assigned to it become unassigned/Inbox;
- child Projects are promoted/reparented according to current taxonomy behavior;
- return affected task IDs and final parent IDs of changed child Projects.

---

# 15. Tag tools

Same pattern as Projects:

```text
todo_list_tags
todo_create_tags
todo_update_tags
todo_delete_tags
```

Tags support:

```text
name
icon
parentId
viewType
position
```

Delete semantics:

- deleting a Tag does not delete tasks;
- that Tag relation is removed from affected tasks;
- child Tags are promoted/reparented according to existing taxonomy behavior;
- return affected task IDs and child final parent IDs.

No extra confirmation in v1.

---

# 16. Project/Tag descendant semantics

When task filtering uses a Project or Tag ID:

```text
include descendants = true by default
```

This matches the normal Todo page behavior where selecting a Project/Tag represents its tree.

Allow an explicit false option for exact-entity-only queries.

Counts/result fields must use clear names rather than an ambiguous generic count. Example:

```text
activeTreeTaskCount
activeDirectTaskCount
```

Only return counts that are actually useful/requested.

---

# 17. Workspace tools

## `todo_get_workspace`

Return current:

```text
filter type/id/title
viewType: list|kanban
sortKey: custom|dueDate|priority|name|createdAt
sortDirection: asc|desc
groupKey: none|priority|date|project|tag
bounded current-view task IDs/count
```

Current-view task information must come from the same family-aware selector used by Todo rendering.

## `todo_update_workspace`

Supports:

```text
navigate to Inbox / Today / Completed / Project / Tag
view list / kanban
sort custom / dueDate / priority / name / createdAt
sort direction asc / desc
group none / priority / date / project / tag
```

### Custom-sort rule

The current Todo UI does more than set `sortKey='custom'`.

It performs:

```text
WorkspaceControls.buildCustomOrderSnapshot()
→ AppDataService.activateCustomSort(snapshot)
```

The AI adapter must use the same behavior so switching to Custom preserves a valid visible ordering snapshot.

Do not simply write the setting string.

Current UI ignores/disables sort direction while Custom is active; the tool should preserve the stored direction and not treat it as a meaningful Custom-sort operation.

Project/Tag view changes use the existing entity view persistence. Smart-view List/Kanban is current-session UI state because there is no Project/Tag entity record for Inbox/Today/Completed.

No Timeline value is exposed because the current runtime supports List and Kanban.

---

# 18. Todo tool execution queue

Add a Todo-side queue specifically for AI tool calls.

```text
TodoToolExecutor._queue = Promise.resolve()
```

Every Todo AI call is appended to this queue, including reads.

At the beginning of each call:

```text
await AppDataService.whenIdle()
```

Then the tool reads/mutates.

This ensures consecutive AI calls observe the previous AI operation's final state and also waits for any already-running normal AppDataService write.

Do not change AppDataService's own existing serialized write queue.

---

# 19. Duplicate/timeout protection

There are two different protections.

## 19.1 Same requestId dedupe

Todo keeps a bounded in-memory registry:

```text
requestId + functionName → in-flight/completed result
```

If the exact same RPC request is delivered twice in one Todo iframe lifetime, it executes once and reuses the result.

## 19.2 Exact repeated mutation fingerprint guard

Chat side keeps a short-lived history for mutation calls using a stable fingerprint of:

```text
functionName + canonical normalized args
```

Object keys are canonicalized; array order is preserved.

Recommended guard window:

```text
5 minutes
```

Behavior:

### First call

Execute normally and remember final status/result.

### Second new call with exactly the same successful mutation fingerprint

Do **not** execute immediately.

Return structured result:

```text
DUPLICATE_CONFIRMATION_REQUIRED
previousResult
```

Gemini should tell the user that the exact operation was already successfully performed and ask whether a duplicate is wanted.

### Same exact call in a later user turn after that guard response

Treat that as the user's confirmation and allow it to execute.

Do not allow the Gemini function loop to bypass this by repeating the call again inside the **same** generation without a new user turn.

After the confirmed duplicate executes, future exact repeats are guarded again against the newest successful execution.

### Previous call definitely failed without mutation

Allow a normal retry.

### Previous result is uncertain

Return:

```text
MUTATION_OUTCOME_UNKNOWN
```

and make Gemini read/reconcile before attempting another mutation.

## 19.3 Timeout behavior

Use:

```text
Todo readiness/wake wait: about 30 seconds
read RPC after ready:     20 seconds
mutation RPC after ready: 60 seconds
```

A timeout after mutation dispatch does not mean rollback.

Late Todo responses may still update the Chat-side recent mutation history so a later exact retry can be recognized as already successful.

No automatic blind mutation retry.

---

# 20. Auto-wake Shell RPC architecture

## Request path

```text
Gemini functionCall
→ Chat TodoBridgeClient
→ Shell todo request
→ Shell ensureTodoReady()
→ Todo already READY? continue
→ NOT_CREATED? start
→ LOADING? wait
→ FAILED? retry once and wait
→ wait for READY + todo-tools-v1
→ immediate postMessage once
→ Todo executor
```

## Important: waiting is not mutation queuing

The pending request lives in the correlated RPC layer while Todo starts.

Do **not** put `shell:todo-tool-request` into `frameManager.queue`.

Once readiness succeeds, send exactly once.

If readiness fails/times out, return `TODO_UNAVAILABLE` and discard the pending dispatch.

## Shared readiness promise

If several requests arrive while Todo is starting, share one `ensureTodoReady()` Promise rather than restarting the iframe for each request.

After ready, the Todo-side tool queue runs the requests sequentially.

## Capability

Todo advertises:

```text
todo-tools-v1
```

only after hydration/repair/UI/tool executor initialization.

If Todo reloads later, the next Todo call can wake/wait again rather than permanently disabling the saved tool preference.

---

# 21. Generation toggle behavior

Current Chat generation already saves an `activeTools` snapshot on the assistant message.

Use that exact model:

```text
User starts AI answer while To-Do = ON
→ that generation may use Todo
→ user turns toggle OFF while answer is running
→ current generation keeps its original Todo permission
→ next generation does not receive Todo declarations
```

If the user force-stops the current generation, that generation ends normally and the next generation uses the current toggle state.

Do not check the live checkbox to revoke a tool halfway through an already-started generation.

---

# 22. Open-editor guards

Create a small Todo integration guard, for example:

```text
TodoList-ui/js/tools/todo-tool-ui-guard.js
```

Before mutation/delete, inspect existing UI state such as:

```text
TasksComponent.editingTaskId
SubtaskEditorComponent.editingSubtaskId
SidebarComponent.editingProjectId
SidebarComponent.editingTagId
```

Reject an update/delete when its exact target is currently being edited.

Also reject an operation that would invalidate a currently open draft, including:

- deleting a Project selected by an open Task draft;
- deleting a Tag selected by an open Task/Subtask draft;
- deleting the parent task while its Subtask editor is open;
- deleting an entity with an open nested Schedule/Repeat editor belonging to that draft.

Return:

```text
EDITOR_CONFLICT
```

with the relevant entity ID/type.

Do not change existing Task/Subtask/Project/Tag editor save behavior for this feature.

---

# 23. Stable result/error contract

Ordinary Todo business errors return structured results to Gemini and do not crash the whole custom-function loop.

Success:

```json
{
  "ok": true,
  "data": {},
  "meta": {
    "affectedCount": 1
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

Recommended codes:

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
EDITOR_CONFLICT
RESULT_TOO_LARGE
STORAGE_ERROR
BRIDGE_TIMEOUT
MUTATION_OUTCOME_UNKNOWN
DUPLICATE_CONFIRMATION_REQUIRED
REQUEST_ABORTED
PARTIAL_FAILURE
PARTIAL_MUTATION
INTERNAL_TODO_ERROR
```

Generate stable codes from explicit validation/known branches.

Do not parse English AppDataService error strings to guess error type.

Unexpected storage/service exceptions map to generic internal/storage errors without exposing stack traces.

---

# 24. Side-effect reporting

Tool definitions and tool responses must clearly tell Gemini about real Todo effects.

Task mutation results may include:

```text
requestedTaskId
finalTask
updatedTaskIds
completedTaskIds
activatedTaskIds
createdTaskIds
nextOccurrenceId
nextOccurrenceChildIds
deletedTaskIds
affectedChildTaskIds
operations/stage statuses
```

Project delete result includes:

```text
deletedProjectIds
unassignedTaskIds
reparentedProjectIds + final parent IDs
```

Tag delete result includes:

```text
deletedTagIds
affectedTaskIds
reparentedTagIds + final parent IDs
```

This information belongs both in the public tool descriptions and in the structured result so Gemini understands what actually happened.

---

# 25. Batch result behavior

Mutation items run sequentially in input order.

Before starting:

- validate envelope/schema;
- reject duplicate update IDs;
- resolve referenced IDs/obvious conflicts when possible.

If earlier items succeeded and a later item fails:

```text
PARTIAL_FAILURE
```

Return:

```text
succeeded[]
failed { inputIndex, result }
unattempted[]
```

If one item partly succeeds internally:

```text
PARTIAL_MUTATION
```

Return its stage statuses and final authoritative entity.

After either type, Todo UI still reconciles the durable changes once.

---

# 26. Immediate Todo UI synchronization

After every mutation tool call, if anything changed, perform **one final UI reconciliation**.

## Task changes

Reuse existing responsibilities such as:

```text
TasksComponent.refreshAfterTaskMutation()
SidebarComponent.updateCounts()
```

## Project changes

Refresh/reconcile Project tree, current filter, task Project menu, task render and counts.

## Tag changes

Refresh/reconcile Tag tree, current filter, task Tag menu, task render and counts.

## Workspace changes

Synchronize Sidebar current selection/title, WorkspaceControls state/UI, task render and counts.

Batch rule:

```text
10 mutations
→ 1 final render/reconciliation
```

not ten full renders.

Because Todo's iframe remains mounted while hidden, the DOM updates in the background and is already correct when opened.

---

# 27. Chat-side implementation

## Add

```text
ChatUI/js/todo/todo-tool-definitions.js
ChatUI/js/todo/todo-tool-executor.js
ChatUI/js/todo/todo-bridge-client.js
ChatUI/js/todo/todo-mutation-replay-guard.js
ChatUI/js/tools/custom-tool-provider.js
```

### `todo-tool-definitions.js`

Contains the 14 Gemini-compatible declarations and precise descriptions.

Tell Gemini:

- existing objects use IDs;
- read first when an ID is unknown;
- create/update/delete arrays accept maximum 10;
- Project/Tag filters include descendants by default;
- omitted versus clear semantics;
- reminder/repeat/position rules;
- actual delete side effects;
- tool results include stage/side-effect information.

### `todo-bridge-client.js`

Owns:

- correlated pending RPC map;
- Todo readiness/wake handshake through Shell;
- request/response size handling;
- timeouts/AbortSignal;
- late response handling;
- no Todo business logic.

### `todo-mutation-replay-guard.js`

Owns:

- canonical mutation fingerprint;
- recent call status/history;
- second-call duplicate warning;
- same-generation repeat blocking;
- later-user-turn duplicate confirmation behavior;
- late-success update after timeout.

### `todo-tool-executor.js`

Checks:

```text
context.activeTools.todo from generation snapshot
```

then uses bridge/replay guard and returns stable structured results.

## Modify

```text
ChatUI/js/tools/function-tool-registry.js
```

Register Workspace + Todo through a provider-neutral registry.

```text
ChatUI/js/api/gemini.js
```

Keep current custom-function loop; only make custom provider wording/classification generic where needed.

```text
ChatUI/js/chat/activity-timeline.js
```

Recognize Todo provider and display summaries such as:

```text
Created 3 tasks
Updated 1 task
Listed 20 tasks
Deleted 2 tags
Changed To-Do view
```

Centralize provider identification instead of repeating `name.startsWith('todo_')` in many files.

---

# 28. ChatUI To-Do toggle UI

Modify:

```text
ChatUI/js/state/store.js
ChatUI/js/storage/load.js
ChatUI/js/storage/records.js if default/fallback shape needs update
ChatUI/html/main-chat.html
ChatUI/html/right-sidebar.html
ChatUI/js/composer/composer.js
```

Add:

```text
tools.todo = false
```

No IndexedDB version/schema migration is required because tool settings already live inside the existing settings record.

UI:

```text
Name: To-Do
Icon: list-todo
Description: Manage tasks, projects & tags
```

It appears in:

- composer Tools popup;
- right sidebar AI Tools;
- active tool indicator.

While adding it, prefer a small data-driven tool descriptor list instead of another repeated set of toggle/pill conditionals.

## Availability UI

In the combined application, the tool preference can stay ON even if Todo is currently loading because a function call can auto-wake/wait for Todo.

Standalone ChatUI has no Todo sibling/shell; there the To-Do tool is unavailable/disabled and Todo declarations are not sent.

Do not erase the user's saved preference simply because Todo is temporarily reloading.

---

# 29. Shell implementation

Modify:

```text
shell/js/frame-manager.js
shell/js/frame-bridge.js
shell/js/protocol.js
shell/js/app-shell.js
```

## Frame manager additions

Add readiness helpers rather than using normal queued `send()` for Todo RPC, conceptually:

```text
ensureReady(app, options)
sendNow(app, message)
```

`ensureReady('todo')`:

- returns immediately if READY;
- starts NOT_CREATED;
- waits on LOADING;
- retries FAILED once;
- resolves only after READY;
- shares one pending readiness Promise;
- times out cleanly.

`sendNow()`:

- only posts when READY;
- never adds to `record.queue`.

Existing ordinary shell message behavior can remain unchanged.

## Frame bridge Todo route

Add:

```text
chatui:todo-tool-request
shell:todo-tool-request
todo:tool-response
shell:todo-tool-response
Todo readiness/capability state
```

Validate exact source windows and origin.

Before dispatch, confirm READY payload advertises `todo-tools-v1`.

Use 64 KiB limit for allowlisted Todo RPC types and retain 32 KiB for ordinary messages.

---

# 30. Todo-side implementation

## Add

```text
TodoList-ui/js/tools/todo-tool-registry.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-normalizers.js
TodoList-ui/js/tools/todo-tool-ui-sync.js
TodoList-ui/js/tools/todo-tool-ui-guard.js
```

### Registry

Exact allowlist of the 14 tool names + handler mapping.

### Normalizers

Handle:

- strict dates/times;
- strict repeat input and month conversion;
- reminder minute conversion;
- IDs/project/tags mapping;
- priority mapping;
- semantic position;
- filter descendants;
- compact/full serializers and response budget;
- stable errors.

### Executor

Owns:

- one-at-a-time Todo tool queue;
- `AppDataService.whenIdle()` boundary;
- requestId dedupe;
- batch orchestration;
- task final-state/staged adapter logic;
- automatic subtask unlink when a new Project implies root conversion;
- Project/Tag staged adapter logic;
- repeat/family side-effect reporting;
- editor guard;
- final UI synchronization.

It calls existing Todo services. It does not directly implement a second IndexedDB mutation layer.

### UI guard

Reads current editor/component state and returns `EDITOR_CONFLICT` instead of changing normal editor behavior.

### UI sync

Centralizes one final render/reconciliation per tool call.

## Modify

```text
TodoList-ui/js/embedded/shell-bridge.js
```

- accept only allowlisted Shell Todo RPC;
- 64 KiB Todo type-aware validation;
- execute asynchronously;
- send correlated result.

```text
TodoList-ui/js/app-main.js
```

- initialize Todo tool executor before advertising `todo-tools-v1`;
- keep existing hydration/repair/component startup order otherwise unchanged.

## Existing Todo services/components

**No planned changes** to:

```text
Task editor save logic
Subtask editor save logic
RepeatEngine
AppDataService core
hierarchy service
taxonomy service
reminder service
IndexedDB schema
```

Use their existing methods from the adapter.

Only add a very small existing-module hook later if implementation proves it is impossible to complete the integration safely without one; do not assume such a change is needed in advance.

---

# 31. Live Voice

No voice-specific Todo implementation.

Current Live Voice already sends its recorded turn through normal Chat generation.

Example:

```text
To-Do toggle ON
→ Live Voice
→ "Create Buy medicine tomorrow at 5 PM with a 30 minute reminder"
→ normal Gemini generation
→ todo_create_tasks
→ Shell wakes/waits for Todo if needed
→ Todo stores + renders task
→ result returned
→ Gemini speaks result
→ switch to Todo
→ task already visible
```

The same path handles reads, updates, Projects, Tags and workspace changes.

App switching must continue to keep Chat generation, Live Voice, recording and Read Aloud alive exactly as the persistent iframe architecture currently intends.

---

# 32. Automated verification vs manual testing

## Implementation agent runs

Only normal non-browser checks needed for code quality/integration:

```text
node --check for changed/new JS modules
node scripts/verify-integration.mjs
node scripts/build-static.mjs
standalone static build checks if already present
```

Update current CI/static verifier so it no longer asserts that the Todo bridge must not exist.

Static assertions should verify:

- `todo-tools-v1` exists;
- Chat/Shell/Todo route uses known frame/origin;
- Todo RPC uses ensure-ready/immediate dispatch, not the normal deferred queue;
- ordinary messages remain 32 KiB;
- Todo RPC is 64 KiB;
- new tool modules are included by the recursive build;
- no direct Chat import/access of Todo AppDataService/IndexedDB/DOM.

## User manually tests in browser

No headless Chrome requirement.

Manual checklist:

### Tool UI

- To-Do appears in both Chat tool locations;
- toggle persists;
- active indicator correct;
- turning it off during an active answer affects the next answer, not the current one.

### Auto wake

- Todo ready → function runs immediately;
- Todo loading → function waits then runs;
- Todo failed → one automatic retry/wake then function runs if recovery succeeds;
- no request executes twice after wake/retry.

### Create/read

- create one task;
- create up to 10 tasks;
- create Project/Tag/subproject/subtag/subtask;
- reminder/repeat/date/time/priority/tags/project all persist;
- task appears without refresh;
- broad 100-task Project query comes back as paginated compact summaries, not huge full objects;
- full details can be requested for selected IDs.

### Update

- rename/update by unique ID;
- root Project move;
- subtask moved to another parent;
- subtask given a new Project automatically becomes root then receives that Project;
- root→subtask inherits parent's Project;
- completion + position in one update works and result explains stages;
- repeat completion reports generated occurrence IDs;
- update multiple tasks and receive per-item/per-stage results.

### Duplicate guard

- first create succeeds;
- same exact successful mutation again returns “already done / duplicate confirmation required”;
- Gemini asks user;
- same exact call in the following confirmed user turn is allowed;
- same-generation automatic repeat is not allowed through the guard;
- failed mutation can retry normally.

### Editor guard

- open Task editor, AI tries to update/delete same task → `EDITOR_CONFLICT`, draft unchanged;
- open Subtask editor → same protection;
- Project/Tag editor → same protection;
- deletion that would invalidate an open Task/Subtask draft is rejected.

### Delete

- delete task/subtask/family;
- delete Project leaves tasks and unassigns the direct tasks;
- delete Tag leaves tasks and removes relation;
- no Chat approval popup is added.

### Workspace

- Inbox/Today/Completed/Project/Tag navigation;
- List/Kanban;
- sort/group/direction;
- Custom sort preserves correct snapshot/order;
- no Timeline option.

### Hidden Todo / Live Voice

- make changes from Chat while Todo hidden;
- switch to Todo and see them immediately;
- create/update/read through Live Voice;
- switching apps does not reload Chat/Todo or stop voice/generation.

---

# 33. Recommended implementation order

## Phase 1 — Todo tool contracts/normalizers

Implement the 14-name registry, strict input conversion, reminders, repeat, position, filters, compact/full serializers and stable result errors.

## Phase 2 — Todo executor

Implement the one-at-a-time tool queue, editor guards, task staged adapter, Project/Tag staged adapter, side-effect reporting, requestId dedupe and one final UI sync.

Do not connect Gemini yet.

## Phase 3 — Shell auto-wake RPC

Implement `ensureReady` + immediate send, Todo capability, correlated Chat→Shell→Todo→Shell→Chat request/response, and 32/64 KiB validators.

## Phase 4 — Chat bridge/replay guard

Implement pending requests, timeouts, late results, exact mutation fingerprint guard and uncertain-outcome handling.

## Phase 5 — Gemini registration/activity

Register Todo declarations/executor in existing custom-function registry and centralize provider classification.

Keep the existing Gemini function loop.

## Phase 6 — To-Do tool UI

Add toggle/card/pill/state persistence and standalone unavailable behavior.

## Phase 7 — Static/build verification

Run syntax/integration/build checks and update CI/static assertions.

## Phase 8 — User browser verification

Provide the manual checklist above. User performs browser/Live Voice tests.

## Phase 9 — PR

When implementation is explicitly authorized:

- start from exact latest `main`;
- create feature branch;
- implement;
- run static/build verification;
- open PR;
- do not merge until reviewed/approved.

---

# 34. Non-goals

This plan does not:

- create an external/network MCP server;
- merge ChatUI_DB and TodoListDB;
- let ChatUI write directly to Todo IndexedDB/AppState;
- refactor Todo editors for concurrency/version tracking;
- rewrite RepeatEngine;
- rewrite AppDataService into new atomic transactions;
- implement real browser/system reminder delivery;
- add Timeline;
- add more task hierarchy levels;
- add dozens of micro-tools;
- expose raw `sortOrder`;
- add Chat delete approval/confirmation;
- require headless browser tests;
- require page refresh after an AI mutation.

---

# 35. Definition of done

Implementation is complete when:

1. ChatUI has the To-Do toggle/card/pill using the existing tool UI style.
2. Exactly the 14 planned Todo functions are exposed.
3. Actual declarations use the current Gemini-compatible schema style.
4. Each generation uses its saved `activeTools.todo` snapshot.
5. Todo calls automatically start/wait/retry the Todo iframe when needed.
6. Actual Todo RPC is sent once after readiness and never stored in the normal deferred frame queue.
7. Todo tool calls execute one at a time.
8. Mutation batches are limited to 10.
9. Task/Project/Tag mutations use canonical unique IDs.
10. Broad reads are compact/paginated; selected IDs can return bounded full detail.
11. Todo RPC hard cap is 64 KiB while ordinary shell messages remain 32 KiB.
12. Strict date/time/repeat/reminder/position validation prevents bad AI inputs.
13. Reminder configuration works now without requiring notification-delivery implementation.
14. Completed parents cannot receive AI-created subtasks.
15. A subtask moved to a new Project through `projectId` automatically becomes root first when no final parent is requested.
16. Completion + position is supported and accurately reported.
17. Multi-stage task/Project/Tag updates return per-stage status and final authoritative entity when something fails.
18. Repeat/family/taxonomy side effects are explicitly returned.
19. Duplicate same-request delivery executes at most once.
20. Exact repeated successful mutations trigger the duplicate guard on the second new call and allow confirmed repetition from a later user turn.
21. Unknown timeout outcomes are not blindly retried.
22. AI updates/deletes that conflict with an open Todo editor are rejected with `EDITOR_CONFLICT` without changing normal editor code.
23. Project/Tag task queries include descendants by default.
24. Custom sort uses the existing snapshot + `activateCustomSort()` behavior.
25. Delete functions execute without a new Chat approval dialog and return accurate side effects.
26. Todo UI reconciles once after every tool call that durably changed data, including partial-error cases.
27. Hidden Todo updates are already rendered when the user switches back.
28. Normal Chat and Live Voice use the same Todo tool path.
29. Workspace/Google Search/URL Context/Code Execution continue working.
30. Standalone ChatUI remains safe with Todo unavailable.
31. Existing Todo manual behavior/persistence remains unchanged outside the new adapter path.
32. Static/integration/build checks pass.
33. User receives and completes the manual browser/Live Voice checklist.
34. No runtime change is merged until this plan is explicitly approved for implementation.
