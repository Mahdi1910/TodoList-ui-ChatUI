# Implementation Plan ID 3 — ChatUI Todo AI Tool Integration

## Status

**Plan only. Do not implement until explicitly approved.**

This revision keeps the previously approved product decisions and adds the latest clarifications about repeating-task IDs, compact AI result trees, large task reads, and automatic Custom sorting during task reordering.

---

# 1. Goal

Add one new **To-Do** tool to ChatUI, using the same general toggle/card experience as Workspace and the other Chat tools.

When enabled, Gemini can read and manage the existing Todo application through a small, clear set of function tools.

The AI should be able to:

- find tasks;
- create/update/delete one or many tasks and subtasks;
- create/update/delete Projects and subprojects;
- create/update/delete Tags and subtags;
- set/clear project, tags, priority, date, time, reminders and repeat;
- complete or activate tasks using Todo's normal completion logic;
- move/reparent/order tasks, Projects and Tags;
- read/change Todo navigation, List/Kanban, sort and group settings.

Changes must appear in Todo immediately even while Todo is hidden and the user is using Chat or Live Voice.

Target path:

```text
Gemini functionCall
→ ChatUI Todo executor
→ Shell ensures Todo iframe is awake/ready
→ Shell sends RPC once
→ Todo tool executor
→ existing AppDataService / hierarchy / taxonomy / Repeat logic
→ TodoListDB + AppState
→ one Todo UI reconciliation
→ structured result → ChatUI → Gemini
```

No page refresh is required.

This is MCP-inspired, but it is **not** a separate network MCP server.

---

# 2. Product decisions that must be preserved

## 2.1 Reminder configuration works now

The tool can create/update/clear Todo reminder configuration now.

Real browser/system notification delivery is a separate Todo feature for later and does not block this integration.

Use Todo's existing reminder storage path.

## 2.2 Do not redesign Todo

This project is the **ChatUI → Todo AI tool**, not a general Todo refactor.

Prefer changes in:

```text
ChatUI Todo modules
Shell RPC bridge
Todo tool adapter/executor modules
```

Existing Todo services/components remain unchanged unless a very small integration hook is proven necessary.

Do not rewrite AppDataService, RepeatEngine, hierarchy, taxonomy, editors or IndexedDB architecture just for this tool.

## 2.3 Todo auto-wakes for a function call

If Todo is not ready, the function must not simply fail.

Behavior:

```text
function call arrives
→ Todo READY? send
→ NOT_CREATED? start Todo
→ LOADING? wait
→ FAILED? retry once
→ wait for app:ready + todo-tools-v1
→ send actual RPC once
```

The actual Todo mutation/read request must **not** be inserted into the existing deferred frame queue.

The RPC layer waits for readiness, then sends exactly once.

## 2.4 Todo AI calls run one at a time

All Todo AI tool calls are serialized:

```text
call 1 finishes
→ call 2 starts
→ call 3 starts
```

Batch items also execute in input order.

At the start of each Todo tool call:

```text
await AppDataService.whenIdle()
```

This ensures a later AI read sees the earlier AI mutation's final state.

## 2.5 Mutation batch maximum = 10

Create/update/delete tools accept:

```text
1..10 items per call
```

## 2.6 No extra delete confirmation in v1

Delete tools execute when Gemini calls them.

Do not add a Chat approval modal and do not call hidden Todo `window.confirm()`.

## 2.7 Open editor conflict = reject AI mutation

Do not redesign Todo editor save behavior.

If an AI update/delete conflicts with an entity currently open for editing, return:

```text
EDITOR_CONFLICT
```

Also reject an operation that would invalidate an active unsaved draft, such as deleting its selected Project/Tag or deleting the parent of the open Subtask editor.

## 2.8 Completion + position is allowed

A task update may contain both:

```text
completed
position
```

The adapter performs the requested stages and reports exactly what succeeded.

## 2.9 Project/Tag task searches include descendants by default

Normal meaning:

```text
Project → Project + subprojects
Tag     → Tag + subtags
```

Exact-only search remains available by explicitly disabling descendants.

## 2.10 Browser behavior is manually tested by the user

Implementation can run syntax/static/build checks.

Do not require headless browser automation.

---

# 3. Existing architecture verified

## ChatUI already has

- `state.tools` toggle state;
- persisted tool settings;
- Gemini client-side custom-function execution loop;
- Workspace custom functions;
- per-generation `activeTools` snapshots;
- tool activity display;
- Live Voice through normal `sendMessage()` generation.

Todo must extend this existing system rather than create a second function engine.

## Shell already has

- persistent Chat and Todo iframes;
- exact same-origin/source checks;
- `NOT_CREATED / LOADING / READY / FAILED` frame lifecycle;
- normal `send()` that queues messages while not READY.

Todo RPC needs a separate **ensure-ready + immediate-send** path.

## Todo already has

- task CRUD;
- repeat-aware completion;
- task/subtask hierarchy + ordering;
- Project/Tag hierarchy + ordering;
- reminder persistence;
- List/Kanban;
- sort/group/custom task order;
- family-aware filtering;
- IndexedDB → AppState synchronization.

The new adapter reuses these capabilities.

---

# 4. Public AI tool inventory — exactly 14

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

Do not add separate public tools for move, complete, schedule fields, reminder, repeat, reorder, subtask/subproject/subtag creation or individual navigation actions.

Those are arguments/behaviors of the 14 tools above.

---

# 5. Gemini declaration rules

Actual declarations use the same Gemini-compatible format already used by Workspace:

```text
OBJECT
ARRAY
STRING
INTEGER
BOOLEAN
enum
required
```

Do not put TypeScript union syntax directly into the declarations.

Tool descriptions must explain important behavior to Gemini, including:

- mutations use canonical IDs;
- read first when ID is unknown/ambiguous;
- mutation batch maximum 10;
- omitted versus clear semantics;
- Project/Tag descendant defaults;
- reminder/repeat rules;
- reordering semantics;
- delete side effects;
- partial/per-stage results;
- repeat completion can produce a new occurrence ID;
- broad reads return summaries and full details are requested in groups of at most 10.

---

# 6. Shared argument rules

## Canonical IDs

Existing entities are mutated by their real IDs, never by title/name alone.

## Omitted versus clear

```text
field omitted      → unchanged
projectId: null    → unassigned/Inbox root task
parentTaskId: null → root task
tagIds: []         → clear tags
dueDate: null      → clear date
dueTime: null      → clear time
reminders: []      → clear reminders
repeat: null       → clear repeat
priority: "none"   → no priority
description: ""    → clear description
```

## Strict date

```text
YYYY-MM-DD
```

Reject impossible dates before Todo services see them.

## Strict time

```text
01:05 PM
```

Hours `01..12`, minutes `00..59`, period `AM|PM`.

## Priority

```text
none | low | medium | high
```

`none` maps to Todo's internal empty priority.

## Semantic position

Never expose raw `sortOrder`.

```text
position: {
  placement: "top" | "bottom" | "before" | "after",
  relativeToId?: "..."
}
```

`relativeToId` is required for before/after and must belong to the legal final sibling scope.

---

# 7. Reminder contract

AI input:

```text
reminders: [
  { minutesBefore: 30 },
  { minutesBefore: 1440 }
]
```

Rules:

- `0` = on time;
- maximum = 86,400 minutes / 60 days;
- reuse existing built-in reminder IDs where possible;
- otherwise convert to day/hour/minute and deterministic ID:

```text
custom-<day>d-<hr>h-<min>m
```

Pass through normal `createTask()` / `updateTask()` aggregate persistence so the existing reminder service creates/reuses definitions.

Do not separately pre-save a custom reminder definition.

Create:

```text
omitted → no reminder
```

Update:

```text
omitted → unchanged
[]      → clear
```

---

# 8. Repeat contract and existing repeat-ID behavior

AI repeat input supports:

```text
mode: daily | weekly | monthly | yearly | custom

custom: {
  interval: 1..99,
  unit: day | week | month | year,
  weekdays?: 0..6,
  monthDays?: 1..31,
  yearDates?: [{ month: 1..12, days: [1..31] }]
}

end: {
  type: never | date | count,
  date?: YYYY-MM-DD,
  count?: 1..200
}
```

Strictly validate AI input before RepeatEngine normalization.

AI months are human months `1..12`; map to RepeatEngine's internal representation.

## Existing application behavior — preserve it

Current Todo repeat completion creates a **new task ID for the next occurrence**.

Example:

```text
old repeating task: task-A
complete task-A
→ task-A remains as the completed old occurrence
→ next occurrence is created as task-B with the next date
```

The same pattern exists for repeating subtasks.

Do **not** change this behavior as part of the AI integration. Changing occurrence identity would require changing Todo repeat semantics, which is outside this project's scope.

The tool must make the transition easy for Gemini to understand by returning compact repeat information such as:

```text
repeatTransition: {
  completedOccurrenceId: "task-A",
  nextOccurrenceId: "task-B",
  nextDueDate: "2026-08-17"
}
```

For repeating root families, also return any generated next-occurrence child IDs when relevant.

---

# 9. AI result format — essential overview first

Every Todo tool response should help Gemini understand the result quickly before reading detailed objects.

Use this shape conceptually:

```text
{
  ok,
  overview: {
    message,
    tree,
    affectedCount
  },
  data,
  meta
}
```

## Compact visual tree

When hierarchy is relevant, `overview.tree` should provide a short human-readable structure, for example:

```text
Work [project-1]
├─ Finish report [task-12]
│  ├─ Draft intro [task-13]
│  └─ Check numbers [task-14]
└─ Email client [task-15]
```

This is an AI convenience summary, not the authoritative data structure.

The authoritative IDs/fields remain in `data`.

Do not generate a huge tree. Bound it to only the objects relevant to that result/request.

For a simple one-task update, the tree may contain only that task and its immediate parent/children context.

For Project/Tag list results, the compact tree is especially useful.

## Per-stage mutation information

For multi-stage updates, `data` still includes exact operation status and final authoritative entity so the overview never hides a failure.

---

# 10. RPC/message size and task-read strategy

Use:

```text
ordinary shell message hard cap: 32 KiB
Todo RPC request hard cap:       64 KiB
Todo RPC response hard cap:      64 KiB
Todo result target budget:       about 48 KiB
```

The message type is recognized before applying its correct limit.

Suggested input guardrails:

```text
title/name: 500 characters
description: 4,000 characters
query: 1,000 characters
ID: 512 characters
mutation batch: maximum 10
```

## Read-detail rule

`todo_find_tasks` supports:

```text
detail: auto | summary | full
offset
limit
```

Rules:

```text
full details: maximum 10 tasks per call
summary:      maximum 20 tasks per call
```

`detail=auto`:

- exact ID lookup of up to 10 tasks → full;
- broad search/filter/list → summary.

### Important >10-task behavior

If a request matches or asks for **more than 10 tasks**, return summary information rather than full task objects.

At the end of the result include an explicit AI hint such as:

```text
fullDetailsHint:
"Full details are available for at most 10 tasks per call. Request the task IDs you want in groups of up to 10."
```

So if Gemini asks for 20 tasks, it receives 20 compact summaries plus the hint, not 20 large descriptions/repeat objects.

Summary fields:

```text
id
title
project id/name
parentTaskId
priority
tag ids/names
completed
dueDate/dueTime
small reminder summary
small repeat summary
```

Full mode can include bounded description/reminder/repeat details.

Every paginated read returns:

```text
totalMatched
offset
returnedCount
hasMore
fullDetailsHint when relevant
```

---

# 11. `todo_find_tasks`

Conceptual filters:

```text
ids?
query?
projectIds?
includeProjectDescendants?   default true
tagIds?
includeTagDescendants?       default true
tagMatch?                    any|all
dueFrom?
dueTo?
completed?
priorities?
parentTaskId?
includeSubtasks?             default true
scope?                       all|current_view
detail?                      auto|summary|full
offset?
limit?
```

For `current_view`, reuse Todo's existing family-aware display/filter logic. Do not invent a second interpretation.

Because the Todo AI queue is serialized, a read starts after previous tool work and `AppDataService.whenIdle()` has completed.

---

# 12. `todo_create_tasks`

```text
tasks: TaskCreateInput[] // 1..10
```

Fields:

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

- parent exists;
- parent is a root/normal task;
- parent is not completed;
- no subtask-of-subtask;
- subtask inherits parent Project;
- conflicting explicit `parentTaskId` + Project returns `INVALID_ARGUMENT`.

New parent + new child in one natural request uses two tool rounds so the child gets the real returned parent ID.

## Position and Custom sort

If task creation includes explicit `position`, the requested manual task ordering must be made persistent and visible.

If task sorting is not already `custom`, first preserve the current visible order as the Custom snapshot using the same existing workspace logic, then apply the requested task position.

Do not expose or calculate raw sort numbers in Gemini.

## Completion

Position and completion may both be requested.

Create → position → completion, with each stage reported.

---

# 13. `todo_update_tasks`

```text
tasks: TaskUpdateInput[] // 1..10
```

Every item requires `id` and can change:

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

Reject duplicate IDs before mutation.

## Final-state adapter behavior

### Root → subtask

Use existing hierarchy link/drag behavior; final Project inherits parent.

### Subtask → another parent

Use existing hierarchy reparent behavior; final Project inherits new parent.

### Subtask → root explicitly

If `parentTaskId:null`, unlink first, then apply root Project if requested.

### Subtask + new Project without parentTaskId

Interpret as:

```text
make task root
→ assign requested Project
```

This is adapter behavior only; do not change Todo's normal subtask Project rule.

### Root Project change

Use existing `updateTask()` propagation to child tasks and report affected child IDs.

## Position always activates task Custom order when needed

Any AI task reorder/position operation must behave like manual custom reordering:

```text
if sortKey != custom
→ WorkspaceControls.buildCustomOrderSnapshot()
→ AppDataService.activateCustomSort(snapshot)
→ perform task position mutation
```

After an explicit task reorder, task sorting is therefore `custom`.

This is important: do not let the AI reorder persistent task order while the UI remains sorted by due date/name/priority and hides the requested change.

## Completion

`completed` is a desired state. Use existing `toggleTaskStatus()` only when state differs.

Repeat completion keeps current Todo semantics and may return a new occurrence ID.

## Stage result

A task update may require several existing Todo service calls. Do not pretend it is one giant atomic transaction.

Return:

```text
inputIndex
id
operations:
  hierarchy: success|failed|skipped
  fields: success|failed|skipped
  position: success|failed|skipped
  completion: success|failed|skipped
finalTask
sideEffects
```

If an unexpected later stage fails after an earlier stage committed:

```text
PARTIAL_MUTATION
```

Return exact stage statuses and final authoritative state.

---

# 14. Task deletion

`todo_delete_tasks` accepts 1–10 IDs.

- deduplicate IDs;
- root deletion uses existing family deletion;
- deleting one subtask deletes only it;
- root + child in same input executes family deletion once;
- return all actual deleted IDs;
- no extra Chat confirmation.

---

# 15. Project tools

`todo_list_projects` returns a bounded Project/subproject tree with IDs, names, icons, parent IDs, view type, order and useful counts.

Create/update accept 1–10 items and support:

```text
name
icon
parentId
viewType
position
```

Use existing taxonomy hierarchy/order behavior and reject cycles/invalid relative positions.

## Project reordering

Projects do **not** have a workspace `sortKey` mode like tasks.

Their sidebar hierarchy is already stored as explicit/manual taxonomy `sortOrder`.

Therefore a Project reorder simply commits the existing taxonomy manual order through the taxonomy drag/order service. Do not invent a fake Project `custom` setting.

Project deletion:

- does not delete tasks;
- direct tasks become unassigned/Inbox;
- child Projects follow existing promotion/reparent behavior;
- return affected task IDs and changed child final parent IDs.

---

# 16. Tag tools

Same pattern as Projects.

Create/update accept 1–10 and support:

```text
name
icon
parentId
viewType
position
```

## Tag reordering

Tags, like Projects, already use explicit taxonomy manual order and have no separate workspace `custom` mode.

Commit reordering through the existing taxonomy order/drag service.

Tag deletion:

- does not delete tasks;
- removes the Tag relation from affected tasks;
- child Tags follow existing promotion/reparent behavior;
- return affected task IDs and final parent IDs.

---

# 17. Workspace tools

`todo_get_workspace` returns:

```text
current filter type/id/title
viewType: list|kanban
sortKey: custom|dueDate|priority|name|createdAt
sortDirection: asc|desc
groupKey: none|priority|date|project|tag
bounded current-view task IDs/count
```

`todo_update_workspace` supports navigation to Inbox/Today/Completed/Project/Tag plus List/Kanban, sorting, direction and grouping.

## Custom task sort

Never set only:

```text
sortKey = custom
```

Use the existing path:

```text
WorkspaceControls.buildCustomOrderSnapshot()
→ AppDataService.activateCustomSort(snapshot)
```

This same rule is used automatically by task create/update when an explicit task `position` is requested.

Sort direction is not meaningful while Custom is active; preserve the stored direction.

No Timeline option because current Todo supports List and Kanban only.

---

# 18. Todo tool execution queue

Add a Todo-specific AI queue without changing AppDataService's own queue.

Conceptually:

```text
TodoToolExecutor._queue = Promise.resolve()
```

Every read/mutation joins the queue.

At call start:

```text
await AppDataService.whenIdle()
```

---

# 19. Duplicate and timeout protection

## Same requestId dedupe

Todo keeps bounded in-memory:

```text
requestId + functionName → in-flight/completed result
```

Same delivery executes once.

## Exact repeated mutation fingerprint guard

Chat keeps short-lived history based on:

```text
functionName + canonical normalized args
```

Recommended window: 5 minutes.

Behavior:

1. first call → execute;
2. exact same successful mutation in a new call → return `DUPLICATE_CONFIRMATION_REQUIRED` + previous result;
3. Gemini tells user it was already done and asks whether duplicate is wanted;
4. exact call from a later confirmed user turn → allow execution;
5. same-generation repeated call cannot bypass the guard;
6. definite no-mutation failure can retry;
7. uncertain previous outcome returns `MUTATION_OUTCOME_UNKNOWN` and requires read/reconciliation first.

Timeouts:

```text
Todo wake/readiness: ~30 s
read after ready:    20 s
mutation after ready: 60 s
```

No blind mutation retry after dispatch.

Late success can update replay history.

---

# 20. Shell auto-wake RPC

Conceptual path:

```text
Gemini
→ Chat TodoBridgeClient
→ Shell
→ ensureTodoReady()
→ start/wait/retry Todo if needed
→ verify todo-tools-v1
→ immediate send once
→ Todo executor
→ correlated response back to Chat
```

The pending function waits in the RPC layer, not in `frameManager.queue`.

If multiple requests arrive during startup, share one readiness Promise; after readiness the Todo AI queue serializes execution.

---

# 21. Generation toggle behavior

Use the current generation's `activeTools` snapshot.

```text
answer starts with To-Do ON
→ current answer keeps Todo permission
→ user turns toggle OFF
→ current answer continues
→ next answer has Todo OFF
```

Stopping the generation ends it; the next generation uses the latest toggle state.

---

# 22. Open-editor guard

Add a small Todo integration guard that inspects existing component state.

Reject mutation/delete if exact target is currently being edited or if the action would invalidate an unsaved active draft.

Return:

```text
EDITOR_CONFLICT
```

Do not change existing editor save logic.

---

# 23. Structured result/error contract

Success:

```text
{
  ok: true,
  overview: { message, tree, affectedCount },
  data: {...},
  meta: {...}
}
```

Failure:

```text
{
  ok: false,
  overview: { message, tree? },
  error: {
    code,
    message,
    details
  },
  data?: final/partial state
}
```

Stable codes include:

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

Generate codes from explicit validation/known branches; do not parse English exception text.

---

# 24. Side-effect reporting

Task results may include:

```text
requestedTaskId
finalTask
updatedTaskIds
completedTaskIds
activatedTaskIds
createdTaskIds
repeatTransition
nextOccurrenceId
nextOccurrenceChildIds
deletedTaskIds
affectedChildTaskIds
stage statuses
```

Project deletion returns deleted Project IDs, unassigned task IDs and child Project final parent IDs.

Tag deletion returns deleted Tag IDs, affected task IDs and child Tag final parent IDs.

The compact `overview` summarizes this first; authoritative details remain in `data`.

---

# 25. Batch behavior

Items execute sequentially.

Reject duplicate update IDs before mutation.

If earlier items succeed and later item fails:

```text
PARTIAL_FAILURE
```

Return:

```text
succeeded[]
failed { inputIndex, result }
unattempted[]
```

If one item partially commits across its internal stages:

```text
PARTIAL_MUTATION
```

Return stage statuses and final authoritative entity.

After partial success/failure, still reconcile durable Todo UI changes once.

---

# 26. Immediate Todo UI synchronization

After each mutation tool call, if anything changed, perform **one** final UI reconciliation.

Task domain:

```text
TasksComponent.refreshAfterTaskMutation()
SidebarComponent.updateCounts()
```

Project domain: refresh Project tree, current filter, task Project menu, tasks and counts.

Tag domain: refresh Tag tree, current filter, task Tag menu, tasks and counts.

Workspace domain: sync Sidebar selection/title, WorkspaceControls, tasks and counts.

Rule:

```text
10 data mutations
→ 1 final UI reconciliation
```

Todo's persistent hidden iframe updates in the background, so switching to Todo shows the new state immediately.

---

# 27. Chat-side implementation

Add:

```text
ChatUI/js/todo/todo-tool-definitions.js
ChatUI/js/todo/todo-tool-executor.js
ChatUI/js/todo/todo-bridge-client.js
ChatUI/js/todo/todo-mutation-replay-guard.js
ChatUI/js/tools/custom-tool-provider.js
```

Modify existing tool registry/Gemini/activity code to register Workspace + Todo through provider-neutral logic.

The provider helper simply maps function names to `workspace`, `todo` or `unknown`; it is unrelated to iframe wake logic.

Tool activity examples:

```text
Created 3 tasks
Updated 1 task
Listed 20 tasks
Deleted 2 tags
Changed To-Do view
```

Add `tools.todo` to current Chat settings persistence with no IndexedDB version bump.

Add To-Do toggle/card/pill to both Chat tool UI locations.

Standalone ChatUI keeps To-Do unavailable because no sibling Todo/Shell exists.

---

# 28. Shell implementation

Modify:

```text
shell/js/frame-manager.js
shell/js/frame-bridge.js
shell/js/protocol.js
shell/js/app-shell.js
```

Add conceptually:

```text
ensureReady(app)
sendNow(app, message)
```

`ensureReady('todo')` starts/waits/retries and shares a readiness Promise.

`sendNow()` never queues.

Add correlated Todo request/response message types and `todo-tools-v1` capability check.

Use 64 KiB for allowlisted Todo RPC messages and 32 KiB for ordinary shell messages.

---

# 29. Todo-side implementation

Add:

```text
TodoList-ui/js/tools/todo-tool-registry.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-normalizers.js
TodoList-ui/js/tools/todo-tool-ui-sync.js
TodoList-ui/js/tools/todo-tool-ui-guard.js
```

Registry: exact allowlist of 14 tools.

Normalizers:

- strict dates/times;
- repeat conversion/validation;
- reminder minutes conversion;
- ID/project/tag mapping;
- semantic position;
- descendant filters;
- compact/full serializers;
- compact tree/overview builder;
- stable errors.

Executor:

- one-at-a-time Todo AI queue;
- `AppDataService.whenIdle()` boundary;
- requestId dedupe;
- batch orchestration;
- task staged adapter;
- automatic subtask unlink for Project move;
- automatic task Custom-sort activation when positioning;
- Project/Tag taxonomy operations;
- repeat occurrence side-effect reporting;
- editor guard;
- final UI sync.

Modify Todo embedded shell bridge to receive allowlisted async RPC and return correlated results.

Initialize tools after Todo hydration/repair/UI initialization and only then advertise `todo-tools-v1`.

No planned changes to Todo editor logic, RepeatEngine, AppDataService core, hierarchy service, taxonomy service, reminder service or IndexedDB schema.

---

# 30. Live Voice

No voice-only Todo implementation.

Live Voice uses the existing normal generation path, so the same 14 tools work in normal Chat and Voice.

Example:

```text
"Create Buy medicine tomorrow at 5 PM with a 30 minute reminder"
→ todo_create_tasks
→ Shell wakes Todo if needed
→ Todo persists + renders
→ compact result returns
→ Gemini speaks confirmation
```

Switching apps must not reload Chat/Todo or stop generation/recording/Live Voice/Read Aloud.

---

# 31. Verification

Implementation agent runs only normal non-browser checks:

```text
node --check changed/new JS
node scripts/verify-integration.mjs
node scripts/build-static.mjs
existing standalone static checks if present
```

Update static integration assertions for:

- `todo-tools-v1`;
- exact-origin Chat/Shell/Todo RPC;
- ensure-ready + immediate send instead of deferred Todo mutation queue;
- 32 KiB ordinary / 64 KiB Todo limits;
- new modules included by build;
- no direct Chat access to Todo AppDataService/IndexedDB/DOM.

User manually tests browser/Live Voice behavior.

Important manual cases:

- To-Do toggle persists;
- toggle OFF during current answer affects next answer only;
- auto-wake from loading/failed Todo;
- create/update/delete 1–10 items;
- reminder/repeat/date/time/project/tag/priority persistence;
- >10 task read returns summary + full-details hint;
- full details requested by IDs in groups up to 10;
- result overview/tree is concise and correct;
- repeating completion reports old completed occurrence + new occurrence ID/date;
- task reorder while non-Custom automatically activates Custom and visibly preserves requested order;
- Project/Tag reorder follows taxonomy manual order;
- subtask moved by new Project automatically becomes root first;
- completion + position works and stages are reported;
- duplicate mutation guard behavior;
- editor conflict behavior;
- hidden Todo updates appear without refresh;
- Live Voice uses same tools.

---

# 32. Recommended implementation order

1. **Todo contracts/normalizers** — declarations, validation, serializers, overview/tree, read summary/full rules.
2. **Todo executor** — queue, editor guard, task/Project/Tag adapters, Custom activation, repeat side effects, UI sync.
3. **Shell auto-wake RPC** — ensure-ready, immediate send, capability, correlated response, payload limits.
4. **Chat bridge/replay guard** — pending requests, timeouts, late results, duplicate fingerprint behavior.
5. **Gemini registration/activity** — register 14 declarations in existing custom-function loop and provider classification.
6. **To-Do tool UI** — toggle/card/pill/state persistence.
7. **Static/build verification**.
8. **User browser/Live Voice verification**.
9. **PR** only after explicit runtime implementation approval; start from exact latest `main` on a feature branch.

---

# 33. Non-goals

This plan does not:

- create an external MCP server;
- merge ChatUI_DB and TodoListDB;
- let ChatUI directly write Todo storage/state;
- refactor Todo editors;
- rewrite RepeatEngine or change repeat occurrence identity;
- rewrite AppDataService into new transactions;
- implement actual notification delivery;
- add Timeline;
- expose raw sortOrder;
- add Chat delete approval;
- require headless browser tests;
- require refresh after AI changes.

---

# 34. Definition of done

Implementation is complete when:

1. ChatUI exposes exactly the planned 14 Todo functions behind a To-Do toggle.
2. Existing entities are mutated by canonical IDs.
3. Todo auto-starts/waits/retries when a function needs it, then the RPC is dispatched exactly once.
4. Todo AI calls execute one at a time.
5. Mutation batches are limited to 10.
6. Reads over 10 tasks use summary mode and tell Gemini to request full details in groups of at most 10.
7. Full task detail is limited to 10 tasks per call; summary is limited to 20.
8. Results provide a compact essential overview/tree first and authoritative structured details after it.
9. Todo RPC remains bounded to 64 KiB and ordinary shell messages to 32 KiB.
10. Reminder configuration works through existing Todo persistence.
11. Repeat input is strictly validated.
12. Existing repeat completion semantics remain unchanged: old occurrence completes and next occurrence receives a new task ID.
13. Tool results clearly return repeat transition IDs/date so Gemini follows the new occurrence correctly.
14. Explicit **task** position/reorder automatically activates valid Custom task sorting when needed.
15. Project/Tag reorder uses their existing taxonomy manual order and does not invent a separate Custom setting.
16. Completed parents cannot receive new AI-created subtasks.
17. A subtask moved to a different Project without a requested final parent becomes root first, then receives that Project.
18. Completion + position is allowed and accurately reported.
19. Multi-stage changes report exact per-stage success/failure and final authoritative state.
20. Duplicate delivery and repeated successful mutation safeguards work as planned.
21. Editor conflicts return `EDITOR_CONFLICT` without rewriting normal editors.
22. Project/Tag task searches include descendants by default.
23. Todo UI performs one final reconciliation after durable AI changes and is already updated while hidden.
24. Normal Chat and Live Voice use the same Todo tool path.
25. Existing Workspace/Google Search/URL Context/Code Execution remain functional.
26. Standalone ChatUI remains safe with Todo unavailable.
27. Static/integration/build checks pass.
28. User receives the manual browser/Live Voice checklist.
29. No runtime code is merged until explicit implementation approval is given.
