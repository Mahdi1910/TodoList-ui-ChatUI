# Implementation Plan ID 3 — ChatUI Todo AI Tool Integration

## Status

**Plan only. Do not implement until reviewed/approved.**

Revision note: this version incorporates the source-validated findings from `implementation plan/Review Implementation Plan ID 3.md`, checked against current `main` after the review was added.

---

# 1. Goal

Add a new **To-Do AI tool** to ChatUI with the same general tool-card/toggle experience as Google Search, URL Context, Code Execution, and Workspace.

When enabled, Gemini can read and control the existing TodoList application through a small set of local function tools. It can find, create, update, delete, organize, schedule, complete/activate, search, and navigate Todo data without duplicating Todo business logic inside ChatUI.

The feature must work while Todo is visible **or hidden**, including normal Chat and Live Voice.

Target flow:

```text
User in ChatUI / Live Voice
        ↓
Gemini chooses a todo_* function
        ↓
ChatUI custom-function executor
        ↓
Shell exact-origin RPC bridge
        ↓
Todo iframe tool executor
        ↓
existing AppDataService / hierarchy / taxonomy / repeat logic
        ↓
IndexedDB
        ↓
AppStateSync
        ↓
Todo UI reconciliation
        ↓
structured function result returns to Gemini
```

When the user later switches to Todo, the new state must already be visible without a page refresh.

This is an **MCP-inspired local function surface**, not a new network MCP server. ChatUI already has a working Gemini client-side custom-function loop and both applications already run in persistent same-origin iframes. Adding another network server would add unnecessary latency, authentication, persistence, and failure boundaries.

### Important reminder limitation

Current Todo supports **reminder configuration/storage**, but it does not yet have a completed browser/system notification-delivery engine.

Therefore this implementation may configure reminder metadata such as “30 minutes before”, but tool descriptions/results and Gemini-facing guidance must **not promise that a real notification will fire**. A separate Todo problem remains responsible for real reminder delivery.

---

# 2. Review findings incorporated

The review was checked against the actual application source. All of its 32 main findings are valid, and its additional semantic items A–F are also valid.

The revised plan therefore adds or changes these rules:

1. reminder configuration must not be described as guaranteed notification delivery;
2. Todo RPC is never queued while the Todo iframe is not READY;
3. mutation timeouts have idempotency/unknown-outcome rules to prevent duplicate retries;
4. one item can partially mutate, so `PARTIAL_MUTATION` is distinct from batch `PARTIAL_FAILURE`;
5. task updates use a final-state hierarchy planner, not one fixed update order;
6. open Todo editors get optimistic-concurrency/lost-update protection;
7. creating a subtask under a completed parent is rejected;
8. AI dates/times are strictly validated before Todo services see them;
9. repeat input is strictly validated before tolerant RepeatEngine normalization;
10. AI-facing yearly repeat months use 1–12, not JavaScript 0–11;
11. reminder conversion uses deterministic IDs through the normal task aggregate path;
12. completion-state transitions cannot be combined with explicit position in one v1 item;
13. current-view reads use the same family-aware display semantics as Todo rendering;
14. read tools wait for pending Todo writes with `AppDataService.whenIdle()`;
15. UI reconciliation runs after any durable mutation, including partial failures;
16. Todo capability follows every frame lifecycle transition;
17. generation tool permission uses the generation’s `activeTools` snapshot, not a live checkbox lookup;
18. responses are size-bounded as well as requests;
19. the 32 KiB/128 KiB protocol cap is selected before generic validation rejects a message;
20. stable tool error codes come from prevalidation/known branches, not parsing English service errors;
21. mutation results report real side-effect IDs, especially repeat/family changes;
22. custom-sort activation uses the same full snapshot semantics as the current UI;
23. project/tag parent+position changes use a deterministic taxonomy planner;
24. task filter/count descendant and completed-state semantics are explicit;
25. duplicate IDs in update batches are rejected before mutation;
26. Gemini declarations use the schema style the existing ChatUI endpoint actually accepts;
27. destructive deletes require Chat-side user approval before dispatch;
28. the To-Do UI explains that selected Todo data used by AI tools is sent to the configured Gemini endpoint;
29. ordinary Todo business failures stay structured inside the existing Gemini function loop;
30. custom provider classification is centralized for Workspace/Todo;
31. UI distinguishes saved Todo preference from live capability availability;
32. CI/static/pure-JS/manual tests are expanded for the new bridge and modules.

Additional clarified rules:

- AI task creation defaults to **no reminder** unless one is explicitly supplied;
- a task whose final state is a subtask cannot also specify `projectId` because project is inherited;
- position results distinguish persistent custom order from current sorted visual order;
- project/tag deletion returns final parent IDs of promoted/reparented children;
- update results carry original input index;
- iframe reload during an in-flight mutation is treated as an uncertain outcome, never an automatic safe retry.

---

# 3. External tool/MCP design lessons retained

Research used for the original plan remains useful:

- MCP-style tools should have clear names, descriptions, bounded structured inputs, and explicit read/write/destructive metadata.
- GitHub MCP demonstrates the value of keeping enabled tool surfaces small because excessive tools increase context and can reduce tool-selection quality.
- Linear favors entity-centered find/create/update operations instead of one tool per UI action.
- Notion demonstrates one plural create operation handling one or many objects.
- Todoist/TickTick/task-board integrations show useful rich task properties, while also showing that mirroring every upstream action as a separate AI tool creates unnecessary fragmentation.
- Taskboard-style designs show the value of AI and UI sharing one authoritative data path so AI-created items appear in the board immediately.

Plan decision: expose a **small, entity-centered Todo surface** and let the Todo adapter translate it into the application’s existing specialized services.

---

# 4. Primary architectural rules

## 4.1 Keep exactly 14 public Todo tools in v1

Do not add separate public tools for move, complete, activate, set/clear date, set/clear time, reminders, repeat, priority, subtask creation, subproject creation, subtag creation, or individual reorder operations.

Those capabilities belong inside create/update contracts.

## 4.2 One plural tool handles one or many objects

Use:

```text
todo_create_tasks
todo_update_tasks
todo_delete_tasks
```

rather than separate single/batch variants.

The same applies to projects and tags.

Structured arrays must be used. Do not parse commas/semicolons as fake item separators.

## 4.3 Existing objects are mutated by canonical ID

Names are for conversation/readability. Existing objects must be resolved to canonical IDs before writes.

If “Study” is ambiguous, Gemini reads first, then mutates the intended ID.

Do not invent IDs.

## 4.4 No direct ChatUI write into Todo state/storage

Hard rule:

```text
ChatUI must not import Todo AppDataService,
write TodoListDB,
mutate Todo AppState,
or reach into Todo DOM/globals.
```

Todo owns Todo business logic.

## 4.5 Reuse the existing Gemini custom-function loop

Do not create another function-calling engine.

Current ChatUI already handles declarations, streamed function calls, client execution, `functionResponse`, multiple rounds, AbortSignal, activity display, and structured `{ok:false}` results.

Todo plugs into that path beside Workspace.

## 4.6 Normal Chat and Live Voice use the same Todo tools

No voice-specific Todo tool engine.

Live Voice sends its turn through normal `sendMessage()` / generation flow, so the same declarations/executor must be reused.

## 4.7 No Todo RPC may use the shell’s deferred frame queue

The existing frame manager queues normal messages while a frame is not READY. That behavior must **never** be used for Todo read or mutation RPC.

Todo RPC must use an immediate-only path such as:

```text
frameManager.sendIfReady(app, message)
```

Behavior:

```text
Todo READY + todo-tools-v1 capability → send immediately
otherwise → fail immediately with TODO_UNAVAILABLE
```

No stale request may execute after a later iframe retry/recovery.

---

# 5. Final public AI tool inventory

Use exactly these 14 tools:

| # | Tool | Purpose |
|---|---|---|
| 1 | `todo_find_tasks` | Read/search/filter tasks and subtasks |
| 2 | `todo_create_tasks` | Create one or many tasks/subtasks |
| 3 | `todo_update_tasks` | Update one or many tasks/subtasks |
| 4 | `todo_delete_tasks` | Delete one or many tasks/subtasks after destructive approval |
| 5 | `todo_list_projects` | Read projects/subprojects and hierarchy |
| 6 | `todo_create_projects` | Create one or many projects/subprojects |
| 7 | `todo_update_projects` | Update/reparent/reorder projects/subprojects |
| 8 | `todo_delete_projects` | Delete projects/subprojects after destructive approval |
| 9 | `todo_list_tags` | Read tags/subtags and hierarchy |
| 10 | `todo_create_tags` | Create one or many tags/subtags |
| 11 | `todo_update_tags` | Update/reparent/reorder tags/subtags |
| 12 | `todo_delete_tags` | Delete tags/subtags after destructive approval |
| 13 | `todo_get_workspace` | Read current Todo navigation/view/sort/group state |
| 14 | `todo_update_workspace` | Navigate Todo and change supported view/sort/group state |

No Timeline value/tool is exposed because current Todo runtime supports List and Kanban only.

---

# 6. Tool metadata and provider model

Keep internal metadata beside every declaration:

| Tool group | readOnly | destructive | idempotent | openWorld |
|---|---:|---:|---:|---:|
| find/list/get workspace | true | false | true | false |
| create | false | false | false | false |
| update | false | true/conservative | false/conservative | false |
| delete | false | true | false | false |
| exact workspace state update | false | false | true where target is exact | false |

These are documentation/safety hints, not enforcement by themselves.

Introduce one Chat-side custom provider resolver, for example:

```text
workspace_* → workspace
todo_*      → todo
otherwise   → unknown
```

Use it in Gemini activity emission and activity-timeline rendering rather than duplicating prefix checks in several files.

---

# 7. Shared AI-facing schema rules

## 7.1 Gemini declaration format

The TypeScript-like notation in this plan is conceptual documentation only.

Actual `todo-tool-definitions.js` declarations must use the same Gemini-compatible style already used by Workspace:

```text
OBJECT
ARRAY
STRING
INTEGER
BOOLEAN
enum
required
```

Do not assume arbitrary JSON-Schema unions/conditionals are accepted by the current endpoint. Conditional relationships are enforced again in Todo normalizers/executor.

## 7.2 Batch limits

Mutation arrays:

```text
1..50 items per call
```

Update arrays must reject duplicate target IDs before any mutation.

Delete arrays may deduplicate IDs and report coverage semantics.

Results must include original `inputIndex` where useful for correlation.

## 7.3 Omitted vs explicit clear

Update semantics:

```text
field omitted → leave unchanged
null / empty collection → explicitly clear when clearable
```

Examples:

```text
projectId: null     → unassign a final root task / Inbox
parentTaskId: null  → make subtask a root where legal
tagIds: []          → clear tags
dueDate: null       → clear date
dueTime: null       → clear time
reminders: []       → clear reminder configuration
repeat: null        → clear repeat
priority: "none"    → clear priority
description: ""     → clear description
```

Names/titles may never be empty.

## 7.4 Strict dates

AI contract:

```text
YYYY-MM-DD
```

Tool normalizer must strictly verify the exact calendar date. Reject impossible/invalid strings such as:

```text
2026-02-31
2026-13-10
random text
```

Use an exact local-date check equivalent to RepeatEngine’s strict year/month/day parser.

Do not rely on `TaskModel.normalizeTask()` for validation because it accepts arbitrary non-empty strings.

## 7.5 Strict times

Canonical AI contract:

```text
hh:mm AM
hh:mm PM
```

with hour `01..12` and minute `00..59`.

Reject examples such as:

```text
00:30 AM
13:00 PM
25:80 PM
random text
```

Canonicalize accepted values to two-digit hour/minute + uppercase period.

## 7.6 Priority

AI values:

```text
none
low
medium
high
```

`none` maps to Todo’s internal empty priority.

## 7.7 Semantic position

Never expose raw `sortOrder`.

Use:

```text
position?: {
  placement: "top" | "bottom" | "before" | "after",
  relativeToId?: string
}
```

Rules:

- `relativeToId` required for before/after;
- reference must exist in the requested **final sibling scope**;
- position is prevalidated before durable mutation;
- if explicit position is requested while task sort is non-custom, activate valid custom ordering using existing service semantics so the requested order is actually visible;
- omit position to preserve the app’s normal placement behavior.

A returned order summary must distinguish:

```text
persistent custom sibling order
vs current rendered index under dueDate/name/priority/etc sorting
```

## 7.8 Completion transition + position

For v1, reject a task create/update item that combines:

```text
explicit position
AND a completion-state transition
```

Use two tool rounds if both are required.

This avoids ambiguous ordering between active/completed lanes and avoids ambiguity when repeat completion creates a new occurrence ID.

---

# 8. Reminder configuration contract

Todo currently stores reminders but does not deliver real notifications.

AI-facing reminder input:

```text
reminders?: [
  { minutesBefore: integer }
]
```

### AI-facing range

Use a conservative maximum compatible with current UI expectations:

```text
0..86400 minutes (0..60 days)
```

### Conversion

For every value:

1. reuse matching built-in IDs first (`on_time`, `5_min`, `10_min`, `15_min`, `30_min`, `1_hour`, `2_hour`, `3_hour`, `1_day`);
2. otherwise convert total minutes canonically into day/hour/minute parts;
3. create deterministic ID:

```text
custom-<day>d-<hr>h-<min>m
```

4. pass that ID directly in the task create/update aggregate;
5. let existing `resolveReminders()` / task aggregate persistence create/reuse the custom definition.

Do **not** pre-save a custom reminder through `saveReminderDefinition()` unless a concrete separate need is proven. Pre-saving could leave an orphan if the task mutation later fails.

Semantics:

```text
create: reminders omitted → no reminder configuration
update: reminders omitted → unchanged
update: reminders []      → clear reminders
```

Tool results may say:

```text
30-minute reminder configuration saved
```

They must not claim:

```text
you will receive a notification in 30 minutes
```

until real delivery exists.

---

# 9. Repeat contract

AI-facing repeat input:

```text
mode: "daily" | "weekly" | "monthly" | "yearly" | "custom"

custom?: {
  interval: integer 1..99
  unit: "day" | "week" | "month" | "year"
  weekdays?: integer[]       // 0=Sunday ... 6=Saturday
  monthDays?: integer[]      // 1..31
  yearDates?: [
    { month: integer 1..12, days: integer[] 1..31 }
  ]
}

end?: {
  type: "never" | "date" | "count"
  date?: "YYYY-MM-DD"
  count?: integer 1..200
}
```

Validation is two-layered:

1. **strict AI validation** with no silent clamping/filtering/default substitution for invalid supplied values;
2. map 1-based yearly months to RepeatEngine’s internal 0-based structure and then call existing `RepeatEngine.validateRepeatRule()` / normalization.

Reject out-of-range values rather than silently changing Gemini’s intent.

Examples that must fail rather than clamp/filter:

```text
interval = 0 or 100
end count = 0 or 201
weekday = 8
month day = 32
month = 0 or 13
invalid end date
```

---

# 10. Task read tool — `todo_find_tasks`

Arguments conceptually:

```text
ids?: string[]
query?: string
projectIds?: string[]
includeProjectDescendants?: boolean       default false
tagIds?: string[]
includeTagDescendants?: boolean           default false
tagMatch?: "any" | "all"                 default "any"
dueFrom?: YYYY-MM-DD
dueTo?: YYYY-MM-DD
completed?: boolean
priorities?: (none|low|medium|high)[]
parentTaskId?: string | null
includeSubtasks?: boolean                  default true
scope?: "all" | "current_view"            default "all"
detail?: "summary" | "full"               default "summary"
limit?: integer 1..100                     default 50
```

Before taking a read snapshot:

```text
await AppDataService.whenIdle()
```

so a pending manual Todo write cannot race the read.

### Exact vs descendant behavior

Explicit `projectIds` and `tagIds` are exact by default.

Descendants are included only when their corresponding `include...Descendants` flag is true.

`scope=current_view` follows the real current Todo filter behavior, including Project/Tag descendant behavior from `AppState.matchesFilter()`.

### Family-aware current view

Do not implement current-view scope with a new simple filter.

Base it on the same family-aware source used by current rendering:

```text
TaskFilter.getDisplayTasks()
```

Then expand returned root families the same way the renderer represents them.

Use one shared selector for:

```text
todo_find_tasks(scope=current_view)
todo_get_workspace.displayScopeTaskIds
todo_get_workspace.displayScopeTaskCount
```

Define:

```text
displayScopeTaskIds
```

as tasks represented by the current filtered root/family model, regardless of whether a child list is visually collapsed.

If an actual DOM-expanded subset is useful, return it separately as an optional UI-only field; do not call the family scope “visible” if collapse state changes that meaning.

### Output budget

Summary results should contain compact fields:

```text
id
title
projectId/projectName
parentTaskId
priority
tagIds/tagNames
completed
dueDate
dueTime
short description preview if needed
repeat/reminder summary
```

`detail=full` may return bounded fuller data, but still obeys response budgets below.

---

# 11. Task creation — `todo_create_tasks`

Arguments:

```text
tasks: TaskCreateInput[] // 1..50
```

`TaskCreateInput` conceptually:

```text
title: string                         required
description?: string
projectId?: string | null
parentTaskId?: string | null
priority?: none|low|medium|high
tagIds?: string[]
dueDate?: YYYY-MM-DD | null
dueTime?: hh:mm AM/PM | null
reminders?: ReminderInput[]
repeat?: RepeatInput | null
completed?: boolean                   default false
position?: PositionInput
```

### Parent validation

If `parentTaskId` is supplied, prevalidate **before create**:

```text
parent exists
parent is root
parent is not completed
```

Prefer extracting/reusing a generic Todo-domain parent validation helper so create/link/tool paths do not drift.

### Project rule for subtasks

If final state is a subtask, any explicit `projectId` is rejected as conflicting.

The subtask inherits its parent’s project. Do not silently ignore a requested project and report success.

No subtask-of-subtask is supported.

### Parent + child in one natural-language request

Create the parent first, use its returned real ID, then create children in a later tool round.

Do not invent temporary client IDs in v1.

### Completed create

If `completed:true` is requested, create the item first and then use existing repeat-aware completion semantics.

If a later completion stage unexpectedly fails after creation, return `PARTIAL_MUTATION` with the final authoritative created task state.

A completed create cannot include explicit position in the same v1 item.

### Position

Prevalidate the target sibling scope before creation. Use existing hierarchy/order methods after creation, or add a narrow generic Todo compound helper if needed to avoid unsafe partial operation.

---

# 12. Task update — `todo_update_tasks`

Arguments:

```text
tasks: TaskUpdateInput[] // 1..50
```

Each item:

```text
id: string                            required
title?: string
description?: string
projectId?: string | null
parentTaskId?: string | null
priority?: none|low|medium|high
tagIds?: string[]
dueDate?: YYYY-MM-DD | null
dueTime?: hh:mm AM/PM | null
reminders?: ReminderInput[]
repeat?: RepeatInput | null
completed?: boolean
position?: PositionInput
```

Reject duplicate `id` values in the same update array before any mutation.

This tool absorbs task movement, project/tag changes, scheduling, reminder configuration, repeat, priority, hierarchy, completion/activation state, and semantic order.

## 12.1 Final-state mutation planner

Do **not** use one fixed sequence such as “ordinary update first, hierarchy second”.

For each item:

1. wait for prior writes and load the latest task;
2. determine requested **final hierarchy state**;
3. prevalidate all referenced project/tag/parent/position IDs and strict field values before the first durable write;
4. reject explicit `projectId` whenever the final state is a subtask;
5. apply hierarchy/position transition using the correct existing hierarchy method;
6. only after the final hierarchy is established, apply ordinary editable fields through `AppDataService.updateTask()` so project inheritance/root project changes are interpreted in the correct final state;
7. apply desired completion state last through `toggleTaskStatus()` only if current state differs;
8. return final authoritative state + side effects.

### Required hierarchy cases

**Root → subtask**

- reject explicit `projectId`;
- without explicit position, use normal link semantics;
- with explicit position, use hierarchy drag/placement semantics;
- final project comes from the parent.

**Subtask → different parent**

- reject explicit `projectId`;
- use hierarchy reparent/placement semantics;
- final project comes from the new parent.

**Subtask → root with `projectId`**

- make it root first;
- then apply the root project update;
- this prevents the current service from ignoring the project while it is still a subtask.

**Subtask → root without `projectId`**

- preserve current unlink project semantics;
- without explicit position, preserve current unlink placement behavior;
- with explicit position, use hierarchy placement into the root scope.

**Root project change**

- use existing service behavior that propagates project to subtasks;
- include affected child task IDs in result metadata.

## 12.2 Completion state

`completed:true/false` is an AI-facing desired state.

Never directly persist the completed field.

Use existing `toggleTaskStatus()` when a change is actually needed so repeat generation and family completion behavior stay correct.

Do not expose a separate public “reopen” tool; `completed:false` means return the task to active state through the existing toggle semantics.

## 12.3 Completion + position

Reject an item that asks for both an explicit position and a completion-state transition in one call.

## 12.4 Compound-operation safety

Prevalidation must catch all predictable hierarchy/position/reference failures before the first durable mutation.

However, existing services use separate queue entries/transactions for some compound changes. Therefore the implementation must not falsely claim every item is atomic.

Preferred when practical: add **narrow generic Todo-domain compound helpers** for operations that cannot be safely represented by existing public calls. Such helpers must remain ordinary Todo service logic, not Gemini-specific logic.

If a compound item still spans multiple durable stages and a later unexpected stage fails:

```text
error.code = PARTIAL_MUTATION
```

Return:

```text
inputIndex
committedStages
failedStage
finalAuthoritativeState
sideEffects
```

and force UI reconciliation.

Do not parse service exception strings to guess which stage failed.

---

# 13. Task deletion — `todo_delete_tasks`

Arguments:

```text
taskIds: string[] // 1..50
```

Rules:

- deduplicate before execution;
- if root + one of its children are both supplied, delete the root family once and report that the child request was covered;
- root deletion uses existing family deletion;
- subtask deletion removes only that subtask;
- missing IDs are resolved into stable tool-layer NOT_FOUND/NO_OP semantics before/around the existing boolean-return service behavior.

Return actual deleted family IDs.

## Destructive approval

Do **not** dispatch task/project/tag deletion to Todo immediately from a model call.

V1 must use a Chat-visible approval step:

1. model requests `todo_delete_*`;
2. Chat resolves/displays exact targets and the consequences;
3. execution waits for explicit user Approve/Cancel in ChatUI;
4. only Approve allows the RPC to be sent to Todo;
5. Cancel/approval timeout returns a structured denial result;
6. there is no hidden Todo `window.confirm()`.

Batch deletes display the target count and important cascading semantics.

For Live Voice, the same visible approval is used; voice mode may tell the user that approval is required, but v1 must not silently interpret untrusted/model text as sufficient destructive authorization.

---

# 14. Project tools

## `todo_list_projects`

Conceptual args:

```text
ids?: string[]
query?: string
includeCounts?: boolean   default true
limit?: 1..100            default 100
```

Return hierarchy-aware items:

```text
id
name
icon
parentId
viewType
childrenIds
persistent order summary
activeDirectTaskCount
activeTreeTaskCount
totalDirectTaskCount
totalTreeTaskCount
```

Only include count fields requested/available within response budget.

## `todo_create_projects`

```text
projects: [
  {
    name,
    icon?,
    parentId?,
    viewType?: list|kanban,
    position?
  }
]
```

For parent + child created in one natural request, use sequential tool rounds and real returned IDs.

## `todo_update_projects`

Reject duplicate IDs before mutation.

Each item may change:

```text
name
icon
parentId
viewType
position
```

### Taxonomy mutation planner

Prevalidate final parent/cycle and position target before mutation.

When parent + semantic position are requested together, use `commitTaxonomyDrag()` semantics for the hierarchy/order concerns instead of “reparent, then separately reorder”.

Scalar name/icon/view updates use the narrowest existing service path.

If the operation still spans separate durable stages and one fails after another committed, return `PARTIAL_MUTATION` with final state rather than pretending the item was atomic.

## `todo_delete_projects`

Destructive approval required.

Current app semantics must be stated clearly:

```text
Deleting a project does not delete its tasks.
Tasks directly assigned to it become unassigned/Inbox tasks.
Child projects are promoted/reparented according to current taxonomy delete behavior.
```

For nested deletion, do not assume children simply move to the deleted project’s old parent. Return their actual final parent IDs.

Return affected task IDs and promoted/reparented project IDs.

---

# 15. Tag tools

## `todo_list_tags`

Conceptual args:

```text
ids?: string[]
query?: string
includeCounts?: boolean   default true
limit?: 1..100            default 100
```

Return hierarchy/order + explicit active/total direct/tree counts when requested.

## `todo_create_tags`

One or many tags/subtags with:

```text
name
icon?
parentId?
viewType?: list|kanban
position?
```

## `todo_update_tags`

Reject duplicate IDs before mutation.

Use the same deterministic taxonomy planner as Projects for scalar fields, final parent, cycle prevention, and semantic position.

## `todo_delete_tags`

Destructive approval required.

Current semantics:

```text
Deleting a tag removes that tag assignment from affected tasks.
It does not delete tasks.
Child tags are promoted/reparented according to existing taxonomy delete behavior.
```

Return actual affected task IDs and final parent IDs of changed child tags.

---

# 16. Workspace tools

## `todo_get_workspace`

Before reading:

```text
await AppDataService.whenIdle()
```

Return:

```text
currentFilter: {
  type: smart|project|tag,
  id,
  title
}

viewType: list|kanban
sortKey: custom|dueDate|priority|name|createdAt
sortDirection: asc|desc
groupKey: none|priority|date|project|tag

displayScopeTaskIds: bounded string[]
displayScopeTaskCount: integer
```

Use the family-aware current-view selector defined earlier.

## `todo_update_workspace`

Conceptual input:

```text
navigate?: {
  type: smart|project|tag,
  value?: inbox|today|completed,
  id?: string
}

viewType?: list|kanban
viewTarget?: {
  type: current|project|tag,
  id?: string
}

sortKey?: custom|dueDate|priority|name|createdAt
sortDirection?: asc|desc
groupKey?: none|priority|date|project|tag
```

Actual Gemini declaration uses one compatible OBJECT schema; executor validates which fields are legal for each `type`.

### Custom sort

When changing to `sortKey=custom`, use the same current UI path:

```text
WorkspaceControls.buildCustomOrderSnapshot()
→ AppDataService.activateCustomSort(snapshot)
```

Never persist `sortKey=custom` alone.

The snapshot must cover every sibling scope expected by the existing service.

If a hierarchy mutation and custom-sort activation are part of one logical operation, take the snapshot at the state where it is valid for the final hierarchy.

### Sort direction in custom mode

Current UI disables direction while custom sort is active.

V1 rule: reject a request that tries to change `sortDirection` while the **final** sort key is custom. Preserve the stored direction silently when simply entering custom mode.

### View persistence

Project/Tag view changes persist on that entity through existing `setEntityViewType()` behavior.

Smart views (Inbox/Today/Completed) have no entity-level persisted view record. A view change there is session/UI state only. Tool result must report whether the view change was persisted or session-only.

After workspace changes, synchronize Sidebar selection/title, WorkspaceControls state/UI, task rendering, and counts.

---

# 17. Stable structured result/error contract

Business validation failures must remain normal structured function results. Do not throw them through the Gemini custom-function loop.

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
RESULT_TOO_LARGE
STORAGE_ERROR
BRIDGE_TIMEOUT
MUTATION_OUTCOME_UNKNOWN
REQUEST_ABORTED
DESTRUCTIVE_APPROVAL_REQUIRED
DESTRUCTIVE_APPROVAL_DENIED
PARTIAL_FAILURE
PARTIAL_MUTATION
INTERNAL_TODO_ERROR
```

Use a tool-layer error type such as:

```text
TodoToolError(code, message, details)
```

Codes must come from explicit prevalidation/known branches, not English substring matching of AppDataService errors.

Unexpected service/IndexedDB failures may map to `STORAGE_ERROR` / `INTERNAL_TODO_ERROR` without exposing stack traces or raw internals.

`AbortError` and true transport/runtime failures may reject where the existing function loop expects them; ordinary Todo business errors should not.

---

# 18. Mutation side-effect reporting

Results must report actual Todo side effects rather than one root ID when the underlying service changed more records.

When relevant, task results include:

```text
requestedTaskId
updatedTaskIds
completedTaskIds
activatedTaskIds
createdTaskIds
nextOccurrenceId
nextOccurrenceChildIds
deletedTaskIds
affectedChildTaskIds
```

Examples that require expanded reporting:

- completing a non-repeating root also completes children;
- completing a repeating root may finish old root/children and create a new root + child occurrences;
- changing a root project propagates project to its subtasks;
- deleting a root removes the whole family;
- deleting a Project unassigns tasks;
- deleting a Tag removes relations from tasks.

Use scoped before/after authoritative snapshots or narrow service helpers where necessary to identify real side effects. Do not make Gemini infer them.

---

# 19. Batch and partial-mutation semantics

Before mutation:

1. validate request envelope and object schemas;
2. reject duplicate target IDs for update arrays;
3. pre-resolve referenced IDs and predictable hierarchy/position conflicts;
4. run items sequentially in input order through the existing serialized Todo service path.

If item N fails after earlier array items fully committed:

```text
PARTIAL_FAILURE
```

Return:

```text
succeeded[]
failed { inputIndex, ... }
unattempted[]
```

If one logical item itself committed some stages before a later stage failed:

```text
PARTIAL_MUTATION
```

Return the committed stages and final authoritative state.

Stop further batch items after the first failed/partially failed item unless a future product rule explicitly changes this.

Do not claim cross-item atomicity.

---

# 20. RPC delivery, idempotency, timeout, and uncertain outcome

## 20.1 Request identity

Every Todo RPC has:

```text
requestId
functionName
args
```

Todo keeps a bounded in-memory request registry keyed by:

```text
requestId + functionName
```

Duplicate delivery of the same request ID:

- while in flight → reuse the same in-flight Promise/result;
- after completion while cached → return the cached result;
- never execute twice.

Use a bounded TTL/LRU policy so this registry does not grow forever.

This protects duplicate delivery inside one iframe lifetime only.

## 20.2 No automatic retry of uncertain mutations

A timed-out non-idempotent create/update/delete is **never automatically retried with a new request ID**.

If Chat stops waiting after dispatch and cannot prove the final outcome:

```text
MUTATION_OUTCOME_UNKNOWN
```

Gemini should read/reconcile current Todo state before proposing or attempting another mutation.

A full Todo iframe reload loses the in-memory dedupe registry. Therefore an in-flight reload is also an uncertain outcome requiring read-back reconciliation.

## 20.3 Timeouts

Use operation-aware timeouts rather than one aggressive 15-second value:

```text
read RPC:              15 seconds
ordinary workspace UI: 20 seconds
Todo mutations:        60 seconds
user destructive approval: separate UI approval timeout, before Todo dispatch
```

These are defensive limits, not guarantees that a timed-out mutation did not commit.

## 20.4 Abort

Before RPC dispatch: abort can safely cancel.

After mutation dispatch: Chat may stop waiting, but must not imply rollback. Todo committed state remains authoritative.

Late responses after a cancelled/expired pending Chat request are ignored by Chat, while Todo’s dedupe registry may retain the completed result for same-ID duplicate delivery.

---

# 21. ChatUI ↔ Shell ↔ Todo RPC architecture

## 21.1 Message path

```text
Gemini functionCall
   ↓
ChatUI todo-tool-executor
   ↓
Chat TodoBridgeClient
   ↓
chatui:todo-tool-request
   ↓
Shell frame bridge
   ↓ immediate-only sendIfReady
shell:todo-tool-request
   ↓
Todo embedded bridge
   ↓
TodoToolExecutor
   ↓
Todo AppDataService/domain services
   ↓
Todo UI sync
   ↓
todo:tool-response
   ↑
Shell
   ↑
shell:todo-tool-response
   ↑
Chat pending request
   ↑
Gemini functionResponse
```

## 21.2 Exact origin/source validation

Keep exact-origin checks and known-window direction checks:

- Shell accepts Chat Todo requests only from the registered Chat iframe;
- Shell forwards only to the registered Todo iframe;
- Shell accepts Todo result only from the registered Todo iframe;
- Todo accepts only explicit shell Todo request types + allowlisted `todo_*` names;
- Chat resolves only matching `requestId + expected functionName`;
- no `postMessage('*')`.

## 21.3 Capability lifecycle

Todo advertises:

```text
todo-tools-v1
```

only after Todo storage hydration/repair and tool/UI dependencies are ready.

Availability rules:

```text
Todo frame READY + ready payload contains todo-tools-v1 → available
Todo LOADING/FAILED/navigation-away/frame replacement → unavailable immediately
new READY with capability → available again
```

Shell rebroadcasts capability state to Chat on every relevant transition.

Saved `tools.todo` preference is not erased when capability disappears.

If capability disappears after a generation already received Todo declarations, executor returns `TODO_UNAVAILABLE`; it never queues the call.

## 21.4 Generation-snapshot permission

Current generation already captures `assistantMessage.activeTools`.

Rule:

```text
Enabled for this generation = context.activeTools.todo from generation snapshot
Available right now          = live Todo bridge capability
```

A user toggling the checkbox during an already-started generation does not silently change that generation’s declared permission.

## 21.5 Message-size policy

Current ordinary shell messages remain capped near:

```text
32 KiB
```

Todo RPC request/response envelopes use:

```text
128 KiB hard envelope cap
```

The message type must be identified from an allowlist **before** applying the size cap. Do not let the current generic 32 KiB validator reject an 80 KiB valid Todo RPC before the Todo-specific rule is considered.

Implement the same message-type-aware contract in Shell, Chat embedded bridge, and Todo embedded bridge, with static tests that keep the three validators in agreement.

Do not remove ordinary-message limits.

Suggested input field guardrails:

```text
title/name: 500 characters
AI-supplied description: 4,000 characters
query: 1,000 characters
IDs: 512 characters
mutation arrays: max 50
```

These limits apply to AI requests; existing stored Todo data may already contain larger strings.

---

# 22. Response/context budget

Every Todo response must be serialized through a bounded AI-facing serializer.

Rules:

- enforce the 128 KiB RPC envelope cap on responses;
- target a smaller result budget (for example ~96 KiB) so envelope metadata has room;
- bound every returned string independently;
- default task search/list output to compact summaries;
- description in summary mode is only a bounded preview;
- full mode still truncates oversized stored text and reports truncation metadata;
- cap results by actual serialized size as well as item count;
- mutation results return affected objects/IDs only, not the whole database.

If requested output cannot fit safely:

```text
RESULT_TOO_LARGE
```

with guidance to narrow the query or lower the limit.

Do not silently drop the whole response or exceed Gemini context unnecessarily.

---

# 23. Todo-side executor modules

Recommended new modules:

```text
TodoList-ui/js/tools/todo-tool-registry.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-normalizers.js
TodoList-ui/js/tools/todo-tool-ui-sync.js
```

## Registry

- exact allowlist of the 14 names;
- handler mapping;
- metadata readOnly/destructive/idempotent/openWorld.

## Normalizers

- strict date/time validation;
- strict AI repeat validation + 1-based month mapping;
- reminder total-minute conversion;
- AI `projectId/tagIds` mapping to internal fields;
- priority `none` mapping;
- semantic position validation;
- bounded AI serializers;
- stable `TodoToolError` helpers.

## Executor

- validate function + generation/tool capability context;
- call `whenIdle()` before reads and correctness-sensitive snapshots;
- batch orchestration;
- final-state task mutation planner;
- taxonomy mutation planner;
- request dedupe registry;
- side-effect capture;
- `PARTIAL_FAILURE` / `PARTIAL_MUTATION` / unknown-outcome behavior;
- call existing Todo services rather than IndexedDB directly.

## UI sync

Track:

```text
mutationOccurred
mutationDomains = task/project/tag/workspace
```

Run one final UI reconciliation in `finally` whenever any durable mutation occurred, even if overall result is `ok:false` because of `PARTIAL_FAILURE` or `PARTIAL_MUTATION`.

---

# 24. Existing Todo service changes

Prefer reusing current AppDataService/hierarchy/taxonomy methods, but the old rule “prefer no existing service changes” is too strict.

If implementation proves that one logical Todo operation cannot be composed safely from current public methods, add a **narrow generic Todo-domain compound helper**.

Requirements for such helpers:

- generic Todo behavior, not Gemini-specific naming/logic;
- one clear queue ownership boundary where practical;
- one consistent operation plan/transaction where practical;
- reuse existing mappers/repositories/repeat rules;
- no duplicate storage architecture.

Do not call public methods that each enqueue from inside another queued operation in a way that could deadlock. If a compound helper needs one queue entry, extract/reuse lower-level non-queued primitives instead.

If full atomic composition is too invasive for a specific edge case, retain truthful staged semantics and return `PARTIAL_MUTATION`.

---

# 25. Immediate Todo UI synchronization

Immediate synchronization is a core acceptance requirement.

After any durable AI mutation, including partial mutation/failure, reconcile the mounted Todo UI once.

## Task domain

Equivalent refresh responsibilities:

```text
TasksComponent.refreshAfterTaskMutation()
SidebarComponent.updateCounts()
```

plus menus when taxonomy metadata changed.

## Project domain

Refresh/reconcile:

```text
SidebarComponent.renderProjects()
SidebarComponent.syncCurrentView()
TasksComponent.renderProjectMenu()
TasksComponent.render()
SidebarComponent.updateCounts()
```

## Tag domain

Refresh/reconcile:

```text
SidebarComponent.renderTags()
SidebarComponent.syncCurrentView()
TasksComponent.renderTagMenu()
TasksComponent.render()
SidebarComponent.updateCounts()
```

## Workspace domain

Synchronize active filter/title, WorkspaceControls, tasks, and counts.

Performance rule:

```text
30 data operations
1 final UI reconciliation
```

not 30 full renders.

Because the iframe remains mounted while hidden, its DOM still updates. Switching back to Todo must show the new state without reload/rehydration.

---

# 26. Open-editor optimistic concurrency

The original “do not repopulate an open editor” rule is insufficient because current Task/Subtask editors submit full payloads and can later overwrite AI changes with stale values.

V1 must add lost-update protection.

## 26.1 Base snapshot

When a Task/Subtask editor opens, capture:

```text
entity id
base updatedAt
base normalized editable values
```

## 26.2 Detect stale editor

If an AI mutation changes the same entity while its editor is open:

- do not overwrite the user’s visible draft;
- mark the editor stale/conflicted;
- preserve typed text and selections.

## 26.3 Safe save

On Save after the base entity changed:

1. compare current draft to base snapshot to find user-dirty fields;
2. compare latest AppState entity to base snapshot to find externally changed fields;
3. if the user and AI changed different fields, submit/merge only user-dirty fields onto latest state;
4. if both changed the same field, block silent save and show a conflict message/banner while preserving the draft;
5. user can review/reload/resolve explicitly.

Do not allow the old full payload to silently overwrite newer AI state.

## 26.4 Related invalidation

AI UI sync must also handle:

- edited entity deleted → close editor + nested Schedule/Repeat safely;
- selected Project deleted in open Task editor → remove invalid selected ID and notify/mark draft changed as appropriate;
- selected Tags deleted → remove invalid tag IDs from Task/Subtask draft;
- parent task deleted while Subtask editor open → close invalid subtask editor stack;
- taxonomy editor open for an entity AI deletes/changes → invalidate/close or mark stale consistently;
- rebuild menus **and** reconcile internal selected IDs, not only DOM options.

Use existing `ModalFocusManager` for safe focus restoration.

---

# 27. Chat-side modules

Recommended additions:

```text
ChatUI/js/todo/todo-tool-definitions.js
ChatUI/js/todo/todo-tool-executor.js
ChatUI/js/todo/todo-bridge-client.js
ChatUI/js/tools/custom-tool-provider.js   // or equivalent centralized provider resolver
```

## Definitions

- the 14 Gemini-compatible declarations;
- concise but precise descriptions;
- tell model to read first when ID is unknown/ambiguous;
- explain plural one-or-many arrays;
- explain omitted/null semantics;
- explain project/tag delete side effects;
- explain reminder configuration is not guaranteed delivery;
- explain position semantics;
- never invent IDs.

## Bridge client

- live capability state;
- pending request map;
- immediate-only RPC through Shell;
- operation-aware timeout behavior;
- AbortSignal handling;
- uncertain-outcome status;
- ignore mismatched/late responses;
- never contain Todo business rules.

## Todo tool executor

- check `context.activeTools.todo` generation snapshot;
- check live Todo capability;
- route destructive calls through Chat approval before dispatch;
- call bridge client;
- normalize transport failures into stable structured Todo results.

## Generic custom-function registry

Make current registry provider-neutral and register both Workspace and Todo.

Preserve the existing behavior where `{ok:false}` business results are sent back to Gemini as `functionResponse` instead of crashing the whole assistant turn.

Rename Workspace-specific custom-loop error wording to provider-neutral wording where needed.

---

# 28. ChatUI To-Do tool UI and privacy

Add To-Do in:

- composer Tools popup;
- right-side AI Tools panel;
- active tool pill system.

Recommended label/icon:

```text
To-Do
list-todo
```

Recommended short description:

```text
Read & manage tasks, projects and tags
```

Add clear user-facing disclosure near/when enabling the tool:

```text
Allows ChatUI to read and change your To-Do data.
Todo information used by AI tools may be sent to your configured Gemini endpoint.
```

Do not imply that Todo data remains entirely local after a read result is sent to Gemini.

## Preference vs availability

UI descriptor must represent both:

```text
saved preference
live capability availability
```

Example states:

```text
preference=false + available=true  → unchecked enabled
preference=true  + available=true  → checked active
preference=true  + available=false → preference retained, visibly unavailable, declarations disabled
preference=false + available=false → unchecked disabled
```

Active pill represents **effective active availability**, not merely saved preference.

Do not clear saved `tools.todo` when Todo temporarily reloads/fails or standalone ChatUI is opened.

Add `tools.todo` to Chat state/load/persistence without an IndexedDB schema-version change.

While touching tool UI wiring, replace repeated hard-coded toggle/pill conditionals with a small descriptor table rather than adding another full duplicated block. Do not refactor unrelated composer behavior.

---

# 29. Live Voice behavior

No special voice-only declarations.

Normal read/create/update flow:

```text
Enable To-Do
→ start Live Voice
→ speak request
→ normal sendMessage/generation
→ Gemini todo_* call
→ Todo hidden iframe persists + reconciles UI
→ result returns
→ Gemini can speak confirmation
→ switch to Todo
→ state already visible
```

Reminder wording must say the reminder configuration was saved, not promise a real notification.

Destructive delete requests use the same Chat-visible approval step before Todo dispatch. No hidden iframe confirmation.

Cross-app switching must not reload either frame or stop Chat generation/recording/Live Voice/Read Aloud.

---

# 30. File-by-file implementation plan

## ChatUI — modify

```text
ChatUI/js/state/store.js
```

- add `tools.todo: false`.

```text
ChatUI/js/storage/load.js
ChatUI/js/storage/records.js (only fallback/default shape if needed)
```

- load/save todo preference without DB schema migration.

```text
ChatUI/html/main-chat.html
ChatUI/html/right-sidebar.html
```

- add To-Do card/toggle + privacy/unavailable disclosure consistent with current UI.

```text
ChatUI/js/composer/composer.js
```

- use tool descriptor model for toggle/pill synchronization;
- distinguish saved preference vs effective availability.

```text
ChatUI/js/tools/function-tool-registry.js
```

- provider-neutral Workspace + Todo registration.

```text
ChatUI/js/api/gemini.js
```

- keep current custom loop;
- provider-neutral loop wording;
- use centralized custom provider resolver;
- preserve structured business failure behavior.

```text
ChatUI/js/chat/activity-timeline.js
```

- Todo provider label/summaries through centralized provider resolver.

```text
ChatUI/js/embedded/shell-bridge.js
```

- Todo capability/result message integration with type-aware size validation, avoiding duplicate competing listeners.

Potential approval UI module/markup:

```text
ChatUI/js/todo/todo-destructive-approval.js
```

or equivalent small module integrated with existing modal/focus conventions.

## ChatUI — add

```text
ChatUI/js/todo/todo-tool-definitions.js
ChatUI/js/todo/todo-tool-executor.js
ChatUI/js/todo/todo-bridge-client.js
ChatUI/js/tools/custom-tool-provider.js   // if not placed elsewhere
```

## Shell — modify

```text
shell/js/frame-manager.js
```

- add immediate-only `sendIfReady()` (or equivalent) that never queues Todo RPC.

```text
shell/js/frame-bridge.js
shell/js/protocol.js
shell/js/app-shell.js
```

- route correlated Todo requests/results;
- type-aware 32/128 KiB validation;
- capability lifecycle broadcasts;
- exact source/window checks;
- no stale RPC queue.

## Todo — modify

```text
TodoList-ui/js/embedded/shell-bridge.js
```

- advertise `todo-tools-v1` only when ready;
- type-aware payload validation;
- execute allowlisted Todo RPC asynchronously;
- correlated response.

```text
TodoList-ui/js/app-main.js
```

- initialize tool executor/bridge dependencies only after persistence/state/UI are ready;
- keep startup order otherwise stable.

```text
TodoList-ui/js/components/tasks.js
TodoList-ui/js/components/subtask-editor.js
```

- optimistic-concurrency base snapshots/dirty-field merge/conflict handling;
- reconcile invalid project/tag selections.

Other modal/taxonomy modules only as needed for safe stale/deleted-entity handling.

## Todo — add

```text
TodoList-ui/js/tools/todo-tool-registry.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-normalizers.js
TodoList-ui/js/tools/todo-tool-ui-sync.js
```

## Todo existing services — narrow changes allowed where proven necessary

Potentially add generic compound/validation helpers in the appropriate existing storage/domain modules. Do not add AI-specific storage repositories or a second mutation architecture.

## Build scripts

No runtime copy-list change expected because current root build recursively copies `ChatUI/js` and `TodoList-ui/js`.

---

# 31. Safety rules

## Function allowlist

Only exact registered `todo_*` names execute.

No dynamic model-provided method lookup beyond exact registry mapping.

## No dynamic code execution

No `eval`, model-provided imports, or arbitrary JavaScript.

## Referential validation

Before mutation:

- target IDs exist;
- project/tag IDs exist;
- parent is legal;
- completed parent cannot receive a new subtask;
- taxonomy parent cannot create cycle;
- before/after target is in final sibling scope;
- final subtask cannot specify project;
- dates/times/repeat/reminders pass strict AI validators.

## Destructive protection

Delete calls require Chat-visible user approval before dispatch.

No hidden Todo confirmation.

No automatic retry of deletion after timeout/uncertain outcome.

## Closed-world Todo results

Todo functions read only local Todo data. They do not fetch network data themselves.

Selected returned data is still transmitted to the configured Gemini endpoint as part of function responses; UI must disclose this.

---

# 32. Testing and CI plan

Respect the existing project testing preference: **do not add headless Chrome as a requirement**. Keep browser/voice behavior in the manual matrix and add pure-JS/static tests where possible.

## 32.1 UI/declaration

Verify:

- To-Do appears in both tool UI locations;
- toggles synchronized;
- saved preference persists;
- live unavailable state does not erase preference;
- active pill reflects effective availability;
- declarations absent when toggle snapshot off;
- declarations absent when capability unavailable;
- standalone ChatUI starts safely with Todo unavailable.

## 32.2 RPC lifecycle

Verify:

1. Todo LOADING + create call → immediate `TODO_UNAVAILABLE`; never delivered later.
2. Todo FAILED/retry → no stale queued mutation after READY.
3. capability drop during active generation → tool returns unavailable; never queues.
4. same requestId delivered twice → executes once.
5. mutation timeout → no automatic new-ID retry.
6. frame reload mid-mutation → outcome treated uncertain; read reconciliation required.
7. request >32 KiB and <128 KiB Todo RPC accepted.
8. ordinary shell message >32 KiB still rejected.
9. Todo request/response >128 KiB rejected/bounded.
10. wrong origin/source/mismatched function/request response ignored.

## 32.3 Strict normalizers

Pure-JS tests for:

- valid/invalid date;
- valid/invalid time;
- priority;
- repeat ranges;
- yearDates January/December 1-based mapping;
- reminder built-in mapping/custom deterministic IDs/max range;
- position scope/required relative target;
- duplicate update IDs;
- final-subtask project conflict.

## 32.4 Read consistency

Verify:

- read waits for pending manual service write;
- current_view matches real family-aware TaskFilter/render semantics;
- exact vs descendant project/tag filters;
- active vs total count labels;
- large search results stay within result budget or return `RESULT_TOO_LARGE`.

## 32.5 Task create/update/delete

Test:

- one/many create;
- title/description/project/tags/priority/date/time;
- reminder configuration (without claiming actual delivery);
- all repeat modes/end conditions;
- create subtask under valid active root;
- completed parent rejected;
- root→subtask conflict project rejected;
- subtask→different parent;
- subtask→root + new project yields requested final project;
- root project change reports affected children;
- completion uses repeat-aware semantics;
- repeat root completion reports old family + new occurrence IDs;
- completion transition + position rejected;
- task family delete semantics;
- update duplicate IDs rejected before mutation;
- mid-batch failure returns `PARTIAL_FAILURE`;
- single multi-stage failure returns `PARTIAL_MUTATION` + final state;
- partial mutation still refreshes Todo UI once.

## 32.6 Project/tag

For each:

- one/many create;
- child create;
- rename/icon/view;
- reparent;
- top-level;
- top/bottom/before/after;
- parent+position planner;
- cycle rejection;
- duplicate update IDs rejected;
- delete requires approval;
- delete returns actual promoted child parent IDs;
- Project deletion unassigns tasks;
- Tag deletion removes relations only.

## 32.7 Workspace

- navigate Inbox/Today/Completed/project/tag;
- List/Kanban;
- project/tag view persistence;
- smart view session-only result;
- all group/sort values;
- custom sort uses full snapshot + activateCustomSort;
- sortDirection change rejected when final sort is custom;
- no Timeline accepted.

## 32.8 Editor concurrency

Verify:

- AI updates task while Task editor open → later Save does not silently erase AI fields;
- same field changed both places → conflict shown, draft preserved;
- different fields → safe dirty-field merge;
- AI deletes edited task → editor/nested schedule closes safely;
- selected project/tag deleted → internal draft IDs reconciled, not only menu DOM;
- parent task deleted while Subtask editor open → invalid editor closes safely;
- taxonomy editor stale/deleted behavior is safe.

## 32.9 Destructive approval/privacy

- delete tool never reaches Todo before explicit Chat approval;
- Cancel leaves data unchanged;
- batch delete shows count/effects;
- Live Voice surfaces approval rather than silently deleting;
- ambiguous/untrusted tool content cannot bypass approval;
- To-Do UI clearly states AI data-sharing boundary.

## 32.10 Immediate rendering and Live Voice

Todo visible and hidden:

- create/update/delete/project/tag/workspace changes appear without refresh;
- partial committed state also appears immediately;
- sidebar counts/current title/menus correct;
- Live Voice read/create/update goes through normal generation path;
- switching apps does not reload frames or stop generation/recording/Live Voice/Read Aloud.

## 32.11 CI/static integration

Update:

```text
.github/workflows/iframe-integration-check.yml
scripts/verify-integration.mjs
```

Add syntax checks for all new Chat/Todo/shell tool modules.

Replace the old invariant that says future Todo command bridge must not exist with new assertions for:

- `todo-tools-v1` capability;
- exact-origin Todo RPC routing;
- immediate-only/no-queue Todo RPC;
- type-aware 32/128 KiB limits;
- `todo_` function declarations;
- no direct sibling iframe storage/DOM coupling;
- static build contains new modules.

Run existing:

```text
node scripts/verify-integration.mjs
node scripts/build-static.mjs
```

and standalone ChatUI/Todo build checks if present.

Regression-check Workspace, Google Search, URL Context, Code Execution, manual Todo CRUD, persistence, repeat/reminder storage, combined routing, and standalone startup.

---

# 33. Recommended implementation order

## Phase 1 — Pure Todo contract/normalizer tests

Implement/test strict dates, times, repeat, reminders, position, serializers, error type, batch duplicate rules.

No Gemini connection yet.

## Phase 2 — Todo executor + mutation planners

Implement read selectors, final-state Task planner, taxonomy planner, side-effect reporting, partial semantics, UI sync, and narrow generic service helpers only where proven necessary.

Test directly against existing Todo services.

## Phase 3 — Editor concurrency protection

Add base snapshots, dirty-field merge/conflict handling, and deleted/invalid related-entity reconciliation before background AI mutations can be enabled.

## Phase 4 — Shell RPC + capability lifecycle

Implement immediate-only `sendIfReady`, exact-origin correlated messages, capability transitions, type-aware payload limits, dedupe, timeout/unknown outcome behavior.

Test with synthetic requests before Gemini registration.

## Phase 5 — Chat definitions/executor/activity

Add 14 declarations, bridge client, provider-neutral registry/activity classification, generation-snapshot permission checks, bounded function responses.

## Phase 6 — Tool UI + privacy + destructive approval

Add To-Do cards/toggles/pill, saved-vs-available states, privacy disclosure, and Chat-visible delete approval.

## Phase 7 — Live Voice and cross-view verification

Verify hidden Todo updates during normal Chat/Live Voice and no refresh/reload.

## Phase 8 — Full regression/build/PR

When runtime implementation is explicitly authorized:

- re-fetch exact latest `main`;
- create a feature branch from that exact SHA;
- implement phases above;
- run static/pure-JS/build verification;
- user manually verifies browser/voice behavior;
- open PR;
- do not merge until reviewed/approved.

---

# 34. Non-goals

This plan does **not**:

- create a network MCP server;
- create another Todo database;
- merge ChatUI_DB and TodoListDB;
- let ChatUI directly write Todo storage/state;
- add Timeline view;
- add additional task hierarchy levels;
- add separate public move/completion/activation/date/time/reminder/repeat/reorder tools;
- promise actual notification delivery from stored reminder metadata;
- expose raw sortOrder;
- add a generic dangerous `todo_execute_action` tool;
- automatically retry an uncertain mutation;
- depend on page refresh for UI synchronization;
- require headless Chrome testing;
- rewrite repeat/storage architecture unless a concrete generic helper is required for correctness.

---

# 35. Definition of done

The feature is complete only when all are true:

1. ChatUI has a To-Do toggle matching existing tool UI patterns.
2. Only the 14 planned Todo functions are exposed.
3. Function declarations use the current Gemini-compatible declaration style.
4. Declarations are enabled by the generation tool snapshot and only while Todo capability is live.
5. Todo capability becomes unavailable immediately on LOADING/FAILED/navigation/replacement and returns on READY.
6. Todo RPC is never queued for later frame recovery.
7. Normal Chat and Live Voice use the same tool path.
8. Read tools wait for pending writes and use family-aware current-view semantics.
9. AI can create/update/delete one or many tasks, Projects and Tags with the planned contracts.
10. Task final-state hierarchy/project behavior is correct, including subtask→root + project change.
11. Completed parents cannot receive new AI-created subtasks.
12. Strict date/time/repeat/reminder validation rejects invalid intent instead of silently coercing it.
13. Reminder configuration is supported without falsely promising real notification delivery.
14. Mutation results report actual repeat/family/taxonomy side effects.
15. Batch partial failure and single-item partial mutation are reported truthfully.
16. Duplicate same-request delivery executes at most once in one iframe lifetime.
17. Mutation timeout/reload uncertain outcomes are never automatically retried; reconciliation is required.
18. Requests and responses are bounded, with ordinary 32 KiB and Todo RPC 128 KiB protocol behavior preserved correctly.
19. Stable error codes come from tool prevalidation/known branches, not English exception parsing.
20. Project/Tag parent+position changes use deterministic existing hierarchy/order semantics.
21. `sortKey=custom` uses the same full snapshot + activateCustomSort path as current UI.
22. Smart-view vs Project/Tag view persistence is reported accurately.
23. Todo UI reconciles immediately after all committed changes, including partial-error cases, while visible or hidden.
24. Open editors cannot silently overwrite newer AI changes; user drafts are preserved/conflicts surfaced.
25. Delete calls require explicit Chat-visible user approval and never use hidden Todo confirmation.
26. User-facing To-Do UI explains that Todo content used by AI may be sent to the configured Gemini endpoint.
27. Business validation errors remain structured function results inside the existing Gemini loop.
28. Workspace and other Chat tools remain functional.
29. Standalone ChatUI/Todo remain functional.
30. CI/static/pure-JS/manual test matrix covers the revised review cases.
31. Existing combined build/integration checks pass after their Todo-bridge invariants are updated.
32. No runtime implementation is merged until this revised plan is reviewed and explicit implementation approval is given.
