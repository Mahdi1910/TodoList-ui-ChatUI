# Implementation Plan ID 3 — ChatUI Todo AI Tool Integration

## Status

**Plan only. Do not implement until explicitly approved.**

This revision incorporates:

- the user's final product decisions from the discussion;
- `Review Implementation Plan ID 3.md`;
- `Review Implementation Plan ID 3 - Review 2.md`;
- a fresh source check of the related ChatUI, Shell, Todo storage/state/hierarchy/taxonomy/schedule/editor/rendering and integration files.

No runtime implementation is authorized by this document alone.

---

# 1. Goal

Add one new **To-Do** AI tool to ChatUI, using the same general toggle/card experience as Workspace and the other Chat tools.

When enabled, Gemini can read and manage the real Todo application through a small set of structured functions.

The AI must be able to:

- find tasks/subtasks;
- create/update/delete one or many tasks/subtasks;
- create/update/delete Projects/subprojects;
- create/update/delete Tags/subtags;
- set or clear Project, Tags, priority, date, time, reminder configuration and Repeat;
- complete or activate tasks through Todo's existing repeat-aware completion behavior;
- move/reparent/order tasks, Projects and Tags;
- inspect/change Todo navigation, List/Kanban view, sorting and grouping.

Changes must appear immediately in Todo, including while Todo is hidden and Chat/Live Voice is active.

Target architecture:

```text
User / Live Voice
        ↓
Gemini todo_* functionCall
        ↓
ChatUI Todo executor
        ↓
Shell ensure-Todo-ready RPC
        ↓
Todo tool adapter/executor
        ↓
existing AppDataService / hierarchy / taxonomy / Repeat / reminder logic
        ↓
TodoListDB + AppStateSync
        ↓
one Todo UI reconciliation
        ↓
structured result
        ↓
ChatUI → Gemini functionResponse
```

This is **MCP-inspired local function tooling**, not a new network MCP server.

---

# 2. Product decisions that must be preserved

These are intentional and must not be reopened during implementation unless a concrete blocker is discovered.

## 2.1 Reminder configuration works now

The tool can create/update/clear Todo reminder configuration now.

Real browser/system notification delivery is a separate Todo feature and does not block this integration.

## 2.2 Do not redesign Todo core

Prefer new integration code in:

```text
ChatUI Todo modules
Shell RPC bridge
Todo tool adapter/executor modules
```

Reuse existing Todo services.

Do not start a general AppDataService/Repeat/editor/storage refactor.

## 2.3 Todo auto-wakes

A Todo function does not fail just because Todo is sleeping/loading/not yet READY.

```text
function arrives
→ ensure Todo exists/loads
→ NOT_CREATED: start
→ LOADING: wait
→ FAILED: retry once
→ wait for READY + todo-tools-v1
→ dispatch request once
```

The actual mutation/read request must **never** be inserted into the existing frame manager deferred queue.

## 2.4 Todo AI calls execute one at a time

Use one recoverable Todo-tool queue.

```text
call 1 finishes
→ call 2 starts
→ call 3 starts
```

Batch items also execute sequentially.

## 2.5 Mutation batch maximum = 10

Create/update/delete mutation arrays accept `1..10` items.

## 2.6 No extra delete confirmation UI in v1

Do not add a Chat approval modal.
Do not trigger Todo's hidden `window.confirm()`.

Delete tools execute when Gemini validly calls them and must report all side effects accurately.

## 2.7 Editor protection uses rejection

Do not redesign Todo editors with optimistic concurrency.

If an AI mutation would conflict with an active unsaved Todo draft, return:

```text
EDITOR_CONFLICT
```

## 2.8 Completion + position is allowed

A task update may request both completion state and position.

The adapter performs/report stages truthfully rather than rejecting the combination.

## 2.9 Project/Tag task queries include descendants by default

Project query normally means:

```text
Project + subprojects
```

Tag query normally means:

```text
Tag + subtags
```

Exact-only remains available explicitly.

## 2.10 User performs browser/Live Voice testing

Implementation may run syntax/static/build/pure-JS verification.

Do not introduce a headless Chrome requirement.

---

# 3. Review 2 findings — verified disposition

All 25 second-review findings are valid.

The implementation plan therefore includes these corrections:

1. explicit duplicate confirmation receipt/token + originating `userTurnId`; Regenerate is never confirmation;
2. replay receipts survive Chat iframe reload in bounded `sessionStorage`;
3. known partial commits block blind exact whole-request retry;
4. Stop/Abort can cancel a dispatched request that has not started mutation yet;
5. current subtask + `projectId:null` automatically becomes Inbox/root when no final parent is requested;
6. final scheduling invariant matches Todo UI: time/repeat without date resolves date to today;
7. Repeat end date must not precede final due date; impossible yearly month/day pairs are rejected;
8. every explicit task position uses the same visible-order snapshot semantics as manual drag;
9. batch validation is static-before-batch + dynamic-before-each-item;
10. workspace updates receive staged `PARTIAL_MUTATION` reporting;
11. Project/Tag read tools get query/pagination contracts;
12. `tagMatch=all` means one match in each requested Tag tree, not every descendant;
13. task pagination uses deterministic ordering;
14. one request ID is permanently bound to one exact function+args request;
15. Todo tool queue and shared readiness Promise recover after failure;
16. editor guard covers new drafts and related referenced entities, not only edit IDs;
17. UI sync refreshes safe Subtask metadata/menus and closes stale transient menus;
18. Todo declarations require both generation permission and compatible Shell RPC support;
19. new Project/Tag parent+child creation uses sequential rounds with real returned IDs;
20. To-Do UI gets a concise data-boundary disclosure, without adding an approval flow;
21. Chat replay fingerprint is structural only; Todo business normalization remains Todo-owned;
22. position/index terminology distinguishes persistent Custom order from current rendered order;
23. use `currentViewTaskIds`, independent of collapsed subtask UI state;
24. replay/request registries have explicit TTL/max-entry rules;
25. verification matrix includes all new cases.

Finding #8 was partly present in the previous revision, but is refined here to match the real Todo drag path exactly: the snapshot is passed into the hierarchy/position commit rather than separately activating Custom first.

---

# 4. Public AI tool inventory — exactly 14

| # | Tool | Purpose |
|---|---|---|
| 1 | `todo_find_tasks` | Search/read tasks and subtasks |
| 2 | `todo_create_tasks` | Create 1–10 tasks/subtasks |
| 3 | `todo_update_tasks` | Update 1–10 tasks/subtasks |
| 4 | `todo_delete_tasks` | Delete 1–10 tasks/subtasks |
| 5 | `todo_list_projects` | Read Project/subproject hierarchy |
| 6 | `todo_create_projects` | Create 1–10 Projects/subprojects |
| 7 | `todo_update_projects` | Update/reparent/order 1–10 Projects |
| 8 | `todo_delete_projects` | Delete 1–10 Projects |
| 9 | `todo_list_tags` | Read Tag/subtag hierarchy |
| 10 | `todo_create_tags` | Create 1–10 Tags/subtags |
| 11 | `todo_update_tags` | Update/reparent/order 1–10 Tags |
| 12 | `todo_delete_tags` | Delete 1–10 Tags |
| 13 | `todo_get_workspace` | Read current Todo workspace state |
| 14 | `todo_update_workspace` | Navigate/change view/sort/group |

Do not add public micro-tools for move, completion, date/time/reminder/repeat, reorder, subtask/subproject/subtag creation or individual navigation actions.

---

# 5. Gemini declaration contract

Actual declarations must use the same Gemini-compatible structure already used by Workspace:

```text
OBJECT
ARRAY
STRING
INTEGER
BOOLEAN
enum
required
```

The declaration descriptions must tell Gemini:

- mutate existing objects by canonical IDs;
- read first when ID is unknown/ambiguous;
- mutation arrays max 10;
- omitted vs explicit-clear behavior;
- descendant defaults;
- strict schedule/repeat/reminder rules;
- semantic position behavior and Custom-sort side effect;
- delete side effects;
- partial/per-stage result semantics;
- Repeat completion may create a new occurrence ID;
- broad task reads are summary-first;
- full task details are requested in groups of at most 10;
- duplicate confirmation token may be reused only after the user explicitly confirms duplication in a new user turn.

---

# 6. Shared mutation arguments

## Canonical IDs

Updates/deletes use real IDs, never title/name alone.

## Omitted vs clear

```text
field omitted      → unchanged
projectId: null    → final root task becomes Inbox/unassigned
parentTaskId: null → final task is root
tagIds: []         → clear tags
dueDate: null      → request no explicit date; final schedule invariant may resolve today
dueTime: null      → clear time
reminders: []      → clear reminder configuration
repeat: null       → clear Repeat
priority: "none"   → no priority
description: ""    → clear description
```

## Strict date

```text
YYYY-MM-DD
```

Reject impossible calendar dates.

## Strict time

```text
01:05 PM
```

Hour `01..12`, minute `00..59`, `AM|PM`.

## Priority

```text
none | low | medium | high
```

## Semantic position

Never expose raw `sortOrder`.

```text
position: {
  placement: "top" | "bottom" | "before" | "after",
  relativeToId?: string
}
```

Meaning:

```text
top/bottom
→ top/bottom of the full legal sibling scope in persistent Custom/manual order

before/after
→ relative to the supplied legal sibling ID
```

Use explicit returned names when an index is useful:

```text
customSiblingIndex
currentViewIndex
```

Never call persistent Custom index the visual position while a non-Custom sort is active.

Mutation tools may also accept an optional internal/public envelope field:

```text
duplicateConfirmationToken?: string
```

It is only valid under the replay rules in section 24.

---

# 7. Final scheduling invariant

The adapter must resolve **final** date/time/repeat state before persistence.

Rules matching current Todo UI/business behavior:

```text
final Repeat active + final dueDate null
→ dueDate = today

final dueTime non-null + final dueDate null
→ dueDate = today
```

Therefore:

```text
clear date while keeping time
→ final date becomes today

clear date while keeping Repeat
→ final date becomes today

clear date + clear time + clear Repeat
→ task becomes truly unscheduled
```

The tool result must return the final resolved task so Gemini never claims a date was cleared when Todo resolved it to today.

When an automatic date is applied, include compact metadata such as:

```text
scheduleResolution: {
  dueDateAssigned: "2026-08-16",
  reason: "time_requires_date" | "repeat_requires_date"
}
```

---

# 8. Reminder contract

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
- reuse built-in reminder IDs first;
- otherwise convert to deterministic:

```text
custom-<day>d-<hr>h-<min>m
```

Pass reminder IDs through normal task aggregate persistence so existing `resolveReminders()` creates/reuses definitions.

Do not separately pre-save custom definitions.

Create:

```text
omitted → no reminder
```

Update:

```text
omitted → unchanged
[]      → clear
```

Real notification delivery remains outside this plan.

---

# 9. Repeat contract

AI input supports:

```text
mode: daily | weekly | monthly | yearly | custom

custom: {
  interval: 1..99,
  unit: day | week | month | year,
  weekdays?: integer[] 0..6,
  monthDays?: integer[] 1..31,
  yearDates?: [{ month: 1..12, days: integer[] }]
}

end: {
  type: never | date | count,
  date?: YYYY-MM-DD,
  count?: 1..200
}
```

Validate strictly before tolerant RepeatEngine normalization.

## Year-date validation

Reject impossible month/day combinations:

```text
February 30/31
April 31
June 31
September 31
November 31
```

February 29 is allowed.

AI months are human `1..12`; adapter maps to Todo's internal month indexes.

## Repeat end-date invariant

After final due date is resolved:

```text
repeat.end.type === date
→ end.date must be >= final dueDate
```

Otherwise return `INVALID_ARGUMENT`.

## Existing occurrence identity — preserve it

Current Todo completion creates a **new ID** for the next repeating occurrence.

```text
task-A completed
→ task-A stays as completed occurrence
→ task-B is created for next occurrence
```

Do not change this Todo behavior.

Return a compact transition:

```text
repeatTransition: {
  completedOccurrenceId,
  nextOccurrenceId,
  nextDueDate,
  nextOccurrenceChildIds?
}
```

---

# 10. AI result shape — essential overview first

Every result uses a compact overview before detailed authoritative data.

Conceptually:

```text
{
  ok,
  overview: {
    message,
    tree?,
    affectedCount
  },
  data,
  meta
}
```

When hierarchy is useful, `overview.tree` may look like:

```text
Work [project-1]
├─ Finish report [task-12]
│  ├─ Draft intro [task-13]
│  └─ Check numbers [task-14]
└─ Email client [task-15]
```

The tree is bounded and informational only. IDs/fields in `data` are authoritative.

---

# 11. RPC and result budgets

Use:

```text
ordinary Shell message hard cap: 32 KiB
Todo RPC request hard cap:       64 KiB
Todo RPC response hard cap:      64 KiB
Todo result target budget:       ~48 KiB
```

Select the cap by allowlisted message type **before** rejecting for size.

AI input guardrails:

```text
title/name: 500 chars
description: 4,000 chars
query: 1,000 chars
ID: 512 chars
mutation batch: 10
```

Every AI serializer bounds individual strings as well as total payload size.

---

# 12. `todo_find_tasks`

Conceptual arguments:

```text
ids?: string[]
query?: string
projectIds?: string[]
includeProjectDescendants?: boolean   default true
tagIds?: string[]
includeTagDescendants?: boolean       default true
tagMatch?: "any" | "all"             default "any"
dueFrom?: YYYY-MM-DD
dueTo?: YYYY-MM-DD
completed?: boolean
priorities?: (none|low|medium|high)[]
parentTaskId?: string | null
includeSubtasks?: boolean             default true
scope?: "all" | "current_view"        default "all"
detail?: "auto" | "summary" | "full" default "auto"
offset?: integer >= 0                 default 0
limit?: integer
```

## Tag tree matching

For every requested Tag:

```text
Tree(tag) = tag + descendants when includeTagDescendants=true
```

Then:

```text
tagMatch:any
→ task has at least one assigned Tag in at least one requested tree

tagMatch:all
→ for every requested Tag tree, task has at least one assigned Tag inside that tree
```

Do not require every descendant Tag to be assigned.

## Deterministic ordering before pagination

Apply filters to a deterministic base order and only then apply `offset/limit`.

### `scope=current_view`

Return the same logical task ordering represented by current Todo rendering:

- same family-aware filtering;
- same active/completed lane separation;
- same current sort/group ordering;
- same List/Kanban logical ordering rules.

Do not derive this from DOM positions. Reuse existing pure ordering/sort helpers where possible.

### `scope=all`

Use stable family/sibling order:

```text
sortOrder
→ createdAt
→ id tie-breaker
```

Roots precede their ordered child records.

## `includeSubtasks:false`

Return only root task records.

Do not promote child records into synthetic roots.

## Collapse-independent current view

Use the name:

```text
currentViewTaskIds
```

It means tasks represented by the current filter/family model, independent of whether the user has visually collapsed a subtask family.

Do not call this `visibleTaskIds`.

## Summary/full policy

```text
full:    maximum 10 tasks
summary: maximum 20 tasks
```

`detail=auto`:

```text
exact ID lookup <=10 → full
broad query/filter    → summary
```

If more than 10 tasks are requested/matched for broad output, return summary rather than full objects.

Summary includes only essential fields:

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
small Repeat summary
```

Every response returns:

```text
totalMatched
offset
returnedCount
hasMore
```

When full details are not returned because the set is too large, add:

```text
fullDetailsHint:
"Full details are available for at most 10 tasks per call. Request the IDs you want in groups of up to 10."
```

---

# 13. `todo_create_tasks`

```text
tasks: TaskCreateInput[] // 1..10
```

Fields:

```text
title required
description?
projectId?
parentTaskId?
priority?
tagIds?
dueDate?
dueTime?
reminders?
repeat?
completed?
position?
```

## Subtask rules

- parent exists;
- parent is a root task;
- parent is not completed;
- no subtask-of-subtask;
- subtask inherits parent Project;
- explicit final subtask parent + conflicting explicit Project is `INVALID_ARGUMENT`.

New parent + new child uses two function rounds:

```text
create parent
→ receive real parent ID
→ create child using real ID
```

No temporary fake IDs.

## Scheduling

Resolve section 7 invariants before persistence.

## Explicit position and non-Custom sort

Creation occurs first so the task has a real ID.

Immediately before the position commit:

1. inspect current task sort;
2. if non-Custom, build the same full visible Custom snapshot used by manual Todo drag;
3. pass that snapshot into the same hierarchy/position commit used for reordering;
4. that commit applies snapshot + requested move and switches sort to Custom;
5. synchronize `WorkspaceControls.sortKey='custom'` after commit;
6. return `sortChangedToCustom:true` when applicable.

Do **not** call `activateCustomSort()` separately and then perform the move; the existing drag path commits the snapshot with the move.

## Completion

Position + completion are both allowed.

Report create/position/completion stages independently.

---

# 14. `todo_update_tasks`

```text
tasks: TaskUpdateInput[] // 1..10
```

Every item requires canonical `id`.

May change:

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

Reject duplicate target IDs before starting the batch.

## Final-state hierarchy/project rules

### Root → subtask

Use existing hierarchy link/drag behavior. Final Project is inherited from parent.

### Subtask → different parent

Use existing reparent behavior. Final Project is inherited from new parent.

### Subtask → root explicitly

```text
parentTaskId:null
→ unlink/root first
→ apply requested root projectId if supplied
```

### Current subtask + non-null `projectId`, `parentTaskId` omitted

Interpret as:

```text
make root
→ assign requested Project
```

### Current subtask + `projectId:null`, `parentTaskId` omitted

Interpret as:

```text
make root
→ Inbox/unassigned
```

This closes the current-service inheritance gap without changing Todo core behavior.

### Final subtask + any explicit conflicting Project intent

If a final parent is supplied and the result remains a subtask, Project is inherited.

Do not silently ignore `projectId:null` or another conflicting Project value; reject the conflict as `INVALID_ARGUMENT`.

### Root Project change

Use existing `updateTask()` propagation to children and return affected child IDs.

## Scheduling

Build final dueDate/dueTime/Repeat values first, then apply section 7 and section 9 invariants.

## Explicit task position

For every explicit task position, use the same semantics as manual drag.

If current sort is non-Custom:

```text
build current full Custom-order snapshot immediately before hierarchy/position commit
→ pass customOrderSnapshot into commitHierarchyDrag/equivalent
→ snapshot + move commit together
→ sort becomes custom
```

The snapshot must represent the authoritative state at that exact stage of the planner, after any earlier safe field stages that intentionally affect current visible sorting, and before the hierarchy/position commit.

For a hierarchy+position change, the same commit handles both.

Return:

```text
sortChangedToCustom
customSiblingIndex when useful
```

## Completion

`completed` is desired final state.

Use existing `toggleTaskStatus()` only if a transition is needed.

Repeat completion preserves Todo's new-occurrence-ID behavior.

## Per-stage result

A single item may involve:

```text
hierarchy
fields
position
completion
```

Return each as:

```text
success | failed | skipped
```

and return final authoritative task.

If a later stage fails after an earlier durable stage committed:

```text
PARTIAL_MUTATION
```

Do not claim rollback.

---

# 15. `todo_delete_tasks`

Accept `1..10` IDs.

- deduplicate IDs;
- root deletion uses existing family deletion;
- child-only deletion removes only the child;
- root+child input deletes family once;
- return actual deleted IDs;
- no extra approval UI.

Editor/draft guards still apply.

---

# 16. Project read/create/update/delete

## `todo_list_projects`

Arguments:

```text
ids?: string[]
query?: string
offset?: integer >= 0          default 0
limit?: integer 1..50          default 25
includeCounts?: boolean        default true
```

Deterministic base order is Todo taxonomy tree order.

Return bounded fields:

```text
id
name
icon
parentId
viewType
depth
childrenIds
custom/manual sibling order summary
activeDirectTaskCount? 
activeTreeTaskCount?
```

Return pagination metadata:

```text
totalMatched
offset
returnedCount
hasMore
```

`overview.tree` covers only returned/relevant hierarchy and marks truncation when needed.

## `todo_create_projects`

Create `1..10`.

Fields:

```text
name
icon?
parentId?
viewType?: list|kanban
position?
```

A new Project has no canonical ID until committed.

If user asks for a brand-new parent and brand-new child:

```text
round 1: create parent
round 2: use returned parent ID to create child
```

Do not invent temporary parent IDs inside one batch.

## `todo_update_projects`

Update `1..10`, unique target IDs.

May change:

```text
name
icon
parentId
viewType
position
```

Project sidebar order is already explicit taxonomy/manual order; there is no Project `custom` sort setting.

Use existing taxonomy drag/order service for parent+position and reject cycles/invalid sibling targets dynamically immediately before the item executes.

Return stage statuses + final Project if a multi-stage update partially commits.

## `todo_delete_projects`

Delete `1..10`.

Existing semantics:

- tasks are not deleted;
- tasks directly assigned to deleted Project become Inbox/unassigned;
- child Projects follow existing promotion/reparent rules;
- return unassigned task IDs and child final parent IDs.

---

# 17. Tag read/create/update/delete

## `todo_list_tags`

Arguments:

```text
ids?: string[]
query?: string
offset?: integer >= 0          default 0
limit?: integer 1..50          default 25
includeCounts?: boolean        default true
```

Use deterministic Todo taxonomy tree order.

Return:

```text
id
name
icon
parentId
viewType
depth
childrenIds
manual sibling order summary
activeDirectTaskCount?
activeTreeTaskCount?
```

plus:

```text
totalMatched
offset
returnedCount
hasMore
```

## `todo_create_tags`

Create `1..10`.

A newly created parent Tag must be committed first; create a requested new child in a later function round using the returned real parent ID.

No temporary fake IDs.

## `todo_update_tags`

Same staged taxonomy rules as Projects.

Tag order is explicit taxonomy/manual order; no separate Custom sort mode.

## `todo_delete_tags`

Existing semantics:

- tasks are not deleted;
- Tag relation is removed from affected tasks;
- child Tags follow existing promotion/reparent behavior;
- return affected task IDs and child final parent IDs.

---

# 18. `todo_get_workspace`

Return:

```text
currentFilter: type/id/title
viewType: list|kanban
sortKey: custom|dueDate|priority|name|createdAt
sortDirection: asc|desc
groupKey: none|priority|date|project|tag
currentViewTaskIds: bounded string[]
currentViewTaskCount
```

`currentViewTaskIds` follows the family/filter model and is not changed by collapsed/expanded subtask UI state.

---

# 19. `todo_update_workspace`

Supports:

```text
navigate to Inbox/Today/Completed/Project/Tag
viewType list|kanban
sortKey custom|dueDate|priority|name|createdAt
sortDirection asc|desc
groupKey none|priority|date|project|tag
```

## Stage order

When multiple properties are requested:

```text
1. navigation
2. view on the new current target
3. sort
4. sortDirection
5. group
```

If final sort is Custom, `sortDirection` is preserved/skipped because it is not meaningful in Custom mode.

## Custom sort

An explicit workspace switch to Custom uses:

```text
WorkspaceControls.buildCustomOrderSnapshot()
→ AppDataService.activateCustomSort(snapshot)
```

This workspace-only operation is different from explicit task drag/position, where the snapshot is passed into the hierarchy-drag commit itself.

## Honest staged result

Return stage receipts:

```text
navigation
view
sort
sortDirection
group
```

If later stage fails after earlier workspace state changed:

```text
PARTIAL_MUTATION
```

Return final authoritative workspace state and run one UI reconciliation.

---

# 20. Two-level batch validation

Do not globally validate dynamic hierarchy/references against only the initial batch snapshot.

## Before any item mutates

Validate only static facts that earlier items cannot change:

```text
schema/JSON shape
batch size
field types/ranges
strict date/time/repeat shapes
duplicate target IDs
malformed IDs
```

## Immediately before each item

Re-read current authoritative AppState and validate dynamic facts:

```text
target still exists
parent currently legal
completed-parent rule
cycle currently legal
position target in current legal sibling scope
Project/Tag reference still exists
editor/draft guard clear
```

This allows valid sequences such as:

```text
item 1: make Task A root
item 2: make Task B child of Task A
```

---

# 21. Todo AI execution queue

Use a Todo-specific recoverable queue without changing AppDataService's queue.

Pattern:

```text
run = tail.then(work, work)
tail = run.catch(() => {})
return run
```

Every Todo AI read/mutation joins the queue.

At the start of each tool call:

```text
await AppDataService.whenIdle()
```

Dynamic validation is still repeated immediately before each item.

One unexpected failed call must not poison future queue work.

---

# 22. Editor/draft guard matrix

The guard checks active modal state and referenced draft entities, not only editing IDs.

## Existing Task edit/create draft

Reject AI mutations that:

- update/delete the exact edited Task;
- delete a Project selected by the draft;
- delete a Tag selected by the draft;
- otherwise invalidate required referenced draft state.

## Existing/New Subtask draft

While Subtask modal is active, use:

```text
editingSubtaskId
parentTaskId
selected Tags/schedule draft
```

Reject actions that make the parent illegal before save, including:

```text
delete parent
complete parent
make parent become a subtask
```

A valid parent Project rename/move may remain allowed; safe metadata is refreshed instead.

## Project/Tag edit or new-child draft

Even when:

```text
editingProjectId = null
editingTagId = null
```

an active creation modal can reference a selected parent.

Conservatively reject hierarchy/destructive changes touching an entity/parent relationship referenced by the active same-domain taxonomy draft when that change could invalidate its pending save.

For an edit draft, prevent AI reparenting that would make the draft's pending parent relation cyclic/invalid.

## Recheck timing

Re-run editor guard immediately before every mutation item, not only once per tool call.

Return:

```text
EDITOR_CONFLICT
```

with entity type/ID and compact reason.

Do not modify normal editor save logic.

---

# 23. Immediate UI synchronization

After every mutation tool call, if durable state changed, run **one** final reconciliation, including partial outcomes.

## Task domain

- refresh Tasks;
- update Sidebar counts;
- close stale Task action/parent/context menus after hierarchy/deletion changes.

## Project domain

- render Project tree;
- sync current filter/title;
- refresh Task Project menus;
- render Tasks/counts;
- if an unrelated active Subtask editor remains valid, refresh its Project lock label from current parent/Project metadata without changing typed draft fields.

## Tag domain

- render Tag tree;
- sync current filter/title;
- refresh Task Tag menu;
- call `SubtaskEditorComponent.renderTagMenu()` when safe;
- if Subtask editor is active, resync Tag selected-state presentation without replacing typed title/description/schedule draft;
- render Tasks/counts.

## Workspace domain

Sync Sidebar active item/title, WorkspaceControls UI, Tasks and counts.

Rule:

```text
10 data mutations
→ 1 final reconciliation
```

Never overwrite unsaved title/description/schedule fields merely to refresh metadata.

---

# 24. Request identity, replay and duplicate confirmation

There are two distinct protections.

## 24.1 Todo request-ID dedupe

Todo registry is keyed primarily by:

```text
requestId
```

Each entry stores:

```text
functionName
structural request fingerprint
phase/status
result
```

Rules:

```text
same requestId + same function + same args
→ reuse same in-flight/completed result

same requestId + different function or args
→ protocol/INVALID_ARGUMENT
→ never execute a second mutation under that requestId
```

Chat pending RPC map also rejects a local request-ID collision.

## 24.2 Chat replay fingerprint ownership

Chat uses only a **structural exact fingerprint**:

```text
functionName + JSON args
```

Canonicalization:

- recursively sort object keys;
- preserve all array order;
- do not convert priority/reminders/repeat/Tags/position using Todo business rules.

This intentionally catches exact/restructurally identical retries without duplicating Todo normalization inside Chat.

Todo remains the only owner of semantic business normalization.

## 24.3 `userTurnId` and Regenerate identity

Propagate the real originating user message ID through:

```text
send-message.js userMsgObj.id
or regenerate.js targetUser.id
→ generation-runner/regenerate
→ streaming
→ gemini custom tool context
→ Todo tool executor/replay guard
```

Also propagate a generation mode/attempt identity so:

```text
normal new turn
regenerate same user turn
same generation tool round
```

are distinguishable.

Regenerate of the same user message never counts as duplicate confirmation.

## 24.4 Temporary replay receipt persistence

Store bounded transient replay receipts in Chat `sessionStorage` so Chat iframe reload does not erase protection.

Receipt contains only compact information:

```text
fingerprint
status: pending | success | partial_committed | unknown | failed_no_mutation
requestId
userTurnId
generationMode
timestamp
affected IDs / compact result receipt
confirmation token metadata if issued
```

Do not store large Todo result objects.

Before/at mutation dispatch write `pending`.

If Chat reloads with an unresolved old `pending`, treat it as `unknown` until reconciled.

Late result may upgrade receipt to `success` or `partial_committed`.

## 24.5 Exact successful duplicate confirmation

First exact mutation:

```text
execute normally
```

Second new exact call matching a known successful receipt:

```text
return DUPLICATE_CONFIRMATION_REQUIRED
+ compact previous receipt
+ one-time duplicateConfirmationToken
```

Gemini asks the user whether the duplicate is really wanted.

The repeated mutation is allowed only when:

- a later **new** user turn explicitly confirms duplication;
- Gemini includes the exact `duplicateConfirmationToken` in the repeated mutation call;
- token matches the same structural fingerprint/previous receipt;
- `userTurnId` differs from the turn that triggered the duplicate warning;
- generation mode is not Regenerate;
- token is unexpired/not consumed.

The tool declaration must tell Gemini never to attach this token for an unrelated user turn.

A repeated call in the same generation or Regenerate cannot consume the token.

After successful confirmed duplicate, consume token and create a new success receipt; future exact repeats are guarded again.

## 24.6 Known partial commit replay

If previous exact request returned:

```text
PARTIAL_FAILURE
PARTIAL_MUTATION
```

and `mutationOccurred=true`, store:

```text
partial_committed
```

An exact whole-request retry is **not executed**.

Return:

```text
PARTIAL_REPLAY_BLOCKED
previous compact receipt
```

Tell Gemini to read current Todo state and retry only failed/unattempted remainder as a new narrowed mutation.

## 24.7 Unknown result

For pending/timeout/reload outcome that cannot be proved:

```text
MUTATION_OUTCOME_UNKNOWN
```

Require read/reconciliation before another mutation.

A definitely failed request with no mutation may retry normally.

## 24.8 Registry bounds

Chat replay receipts:

```text
max settled receipts: 100
base TTL: 10 minutes
duplicate-confirmation token validity: 5 minutes
never discard an actively pending receipt merely because max settled count is reached
```

Todo request registry:

```text
max settled entries: 200
TTL after settlement: 10 minutes
never evict an in-flight/queued entry
```

Evict expired settled entries oldest-first.

---

# 25. Stop/Abort cancellation phases

Stopping generation must prevent Todo work that has not started mutation yet.

## Before Shell dispatch

```text
Abort
→ discard request
→ REQUEST_ABORTED
→ no side effect
```

## Dispatched to Todo but still queued/not started

Add correlated cancel route:

```text
chatui:todo-tool-cancel
→ Shell
→ shell:todo-tool-cancel
→ Todo request registry
```

Todo marks the request cancelled.

Immediately before a tool call/item begins its first durable mutation stage, executor checks cancellation.

If no mutation began:

```text
REQUEST_ABORTED
```

and no side effect.

## Some earlier batch items/stages already committed

Stop further unstarted items/stages where safe.

Return/record truthful partial state:

```text
PARTIAL_FAILURE or PARTIAL_MUTATION
reason: REQUEST_ABORTED
```

Late receipt still protects replay even if Chat has already stopped displaying the generation.

## Durable stage already in progress

Do not claim rollback.

Outcome remains committed/in-flight/possibly uncertain until final/late result.

`REQUEST_ABORTED` is used only when the system can prove no mutation began.

---

# 26. RPC timeout/readiness behavior

Recommended limits:

```text
Todo wake/readiness wait: ~30 seconds
read after ready:         20 seconds
mutation after ready:     60 seconds
```

A post-dispatch mutation timeout does not mean failure/rollback.

No blind new-request-ID retry.

Late result updates replay receipt if available.

---

# 27. Shell auto-wake architecture

Request flow:

```text
Chat request
→ Shell ensureTodoReady()
→ READY? continue
→ NOT_CREATED? start
→ LOADING? wait
→ FAILED? retry once
→ wait READY + todo-tools-v1
→ sendNow() exactly once
```

The pending RPC waits outside `record.queue`.

If several calls arrive while loading, share one readiness Promise.

## Failure-resilient shared readiness

```text
if no readiness Promise: create one
await it
finally: clear shared Promise regardless of resolve/reject
```

A failed readiness attempt must not poison future Todo calls.

`sendNow()` never queues.

---

# 28. Effective declaration gate / standalone ChatUI

Separate:

```text
generation permission = activeTools.todo
compatible bridge support = Chat is embedded in Shell that advertises Todo RPC support
```

Todo declarations require **both**.

Bridge support does not require Todo already READY because auto-wake handles that.

Use an explicit Shell→Chat compatibility/capability handshake rather than assuming any iframe parent is the correct Shell.

Standalone behavior:

```text
saved tools.todo may remain true
bridge support false
→ no Todo declarations
→ executor returns TODO_UNAVAILABLE if somehow invoked
→ saved preference is not erased
```

Adjust the function registry API to accept effective provider capability context, not only `activeTools`.

---

# 29. Generation toggle behavior

Keep current per-generation `activeTools` snapshot.

```text
answer starts with To-Do ON
→ current answer retains permission
→ user turns toggle OFF
→ current answer can continue
→ next answer has Todo OFF
```

If user presses Stop, section 25 cancellation rules apply.

---

# 30. Structured result/error codes

Success:

```text
{
  ok: true,
  overview,
  data,
  meta
}
```

Failure:

```text
{
  ok: false,
  overview,
  error: { code, message, details },
  data?: final/partial authoritative state
}
```

Codes include:

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
PARTIAL_REPLAY_BLOCKED
REQUEST_ABORTED
PARTIAL_FAILURE
PARTIAL_MUTATION
INTERNAL_TODO_ERROR
```

Codes come from explicit tool validation/known branches, not English service-message parsing.

---

# 31. Side-effect reporting

Task mutation result may contain:

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
sortChangedToCustom
customSiblingIndex
stage statuses
```

Project deletion:

```text
deletedProjectIds
unassignedTaskIds
reparentedProjectIds + final parent IDs
```

Tag deletion:

```text
deletedTagIds
affectedTaskIds
reparentedTagIds + final parent IDs
```

Workspace mutation returns final authoritative workspace + stage receipts.

---

# 32. Batch failure behavior

Items execute in input order.

If earlier items commit and later item fails:

```text
PARTIAL_FAILURE
```

Return:

```text
succeeded[]
failed { inputIndex, result }
unattempted[]
mutationOccurred: true
```

If one item partially commits across internal stages:

```text
PARTIAL_MUTATION
```

Return exact stages + final authoritative entity.

Both forms trigger UI reconciliation and replay protection as `partial_committed`.

---

# 33. Chat-side implementation

## Add

```text
ChatUI/js/todo/todo-tool-definitions.js
ChatUI/js/todo/todo-tool-executor.js
ChatUI/js/todo/todo-bridge-client.js
ChatUI/js/todo/todo-mutation-replay-guard.js
ChatUI/js/tools/custom-tool-provider.js
```

## Modify generation plumbing

```text
ChatUI/js/chat/send-message.js
ChatUI/js/chat/generation-runner.js
ChatUI/js/chat/regenerate.js
ChatUI/js/chat/streaming.js
ChatUI/js/api/gemini.js
ChatUI/js/tools/function-tool-registry.js
```

Propagate:

```text
userTurnId
generation attempt/mode
activeTools snapshot
AbortSignal
compatible provider capability context
```

Regenerate passes the original `targetUser.id` and marks generation mode as Regenerate.

## Replay guard

- structural exact fingerprint only;
- bounded `sessionStorage` receipts;
- partial/unknown handling;
- explicit confirmation token;
- late-result receipt updates.

## Provider resolver

Central mapping:

```text
workspace_* → workspace
todo_*      → todo
otherwise   → unknown
```

Use it for activity display and generic error wording.

---

# 34. ChatUI To-Do toggle UI

Modify existing tool settings/UI modules to add:

```text
tools.todo = false
```

No IndexedDB version bump.

UI:

```text
Name: To-Do
Icon: list-todo
Short description: Manage tasks, projects & tags
```

Add to composer Tools popup, right AI Tools panel and active tool indicator.

Add a concise transparency description/tooltip/settings text:

```text
Allows AI to read and change your To-Do data. Todo information used by the AI may be sent to your configured model endpoint.
```

This is disclosure only—no approval modal or extra safety workflow.

Saved preference remains even when bridge support is temporarily unavailable.

---

# 35. Shell implementation

Modify:

```text
shell/js/frame-manager.js
shell/js/frame-bridge.js
shell/js/protocol.js
shell/js/app-shell.js
```

Add:

```text
ensureReady(app)
sendNow(app, message)
```

Add Todo request/response/cancel routing:

```text
chatui:todo-tool-request
shell:todo-tool-request
chatui:todo-tool-cancel
shell:todo-tool-cancel
todo:tool-response
shell:todo-tool-response
```

Validate exact origin and exact registered iframe source windows.

Add Shell→Chat bridge-support capability handshake.

Use 64 KiB only for allowlisted Todo RPC request/response/cancel envelopes; ordinary messages remain 32 KiB.

---

# 36. Todo-side implementation

## Add

```text
TodoList-ui/js/tools/todo-tool-registry.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-normalizers.js
TodoList-ui/js/tools/todo-tool-ui-sync.js
TodoList-ui/js/tools/todo-tool-ui-guard.js
TodoList-ui/js/tools/todo-tool-read-selectors.js
```

### Registry

Exact 14-name allowlist + handler metadata.

### Normalizers

Own all Todo business-facing normalization:

- strict dates/times;
- final schedule invariant;
- Repeat strict validation/end-date rule/year-date rule;
- reminder conversion;
- ID/Project/Tag mapping;
- priority mapping;
- position validation;
- bounded serializers.

### Read selectors

- deterministic task ordering;
- current-view family/render ordering;
- Tag tree `any/all` semantics;
- Project/Tag pagination/tree ordering.

### Executor

Owns:

- recoverable one-at-a-time queue;
- requestId registry bound to exact request;
- cancellation phases;
- dynamic per-item validation;
- staged task final-state planner;
- staged Project/Tag planner;
- staged workspace mutation;
- side-effect capture;
- replay-result metadata (`mutationOccurred`);
- final UI sync.

It calls existing Todo services rather than writing IndexedDB directly.

### UI guard

Reads active editors/modals/draft references and returns `EDITOR_CONFLICT` conservatively.

### UI sync

Central safe metadata/render reconciliation.

## Modify

```text
TodoList-ui/js/embedded/shell-bridge.js
```

- accept allowlisted Todo request/cancel messages;
- type-aware 64 KiB validation;
- correlate requestId/functionName;
- async executor/result path.

```text
TodoList-ui/js/app-main.js
```

Initialize tool dependencies before advertising:

```text
todo-tools-v1
```

Keep current storage hydration/repair/UI initialization order otherwise stable.

## Existing Todo core

No planned rewrite of:

```text
AppDataService core
RepeatEngine
Task/Subtask editor save logic
hierarchy/taxonomy storage
reminder storage
IndexedDB schema
```

Only add a narrow generic existing-module hook if implementation proves a required capability cannot safely be composed from existing methods.

---

# 37. Live Voice

No voice-specific Todo engine.

Live Voice uses normal generation/tool flow.

Example:

```text
To-Do ON
→ Live Voice request
→ Gemini todo_create_tasks
→ Shell wakes Todo if needed
→ Todo saves/renders
→ result returns
→ Gemini speaks result
```

Stop during Live Voice generation follows section 25 cancellation semantics.

Switching Chat/Todo must not reload persistent iframes or stop voice/generation/read-aloud.

---

# 38. Static/pure-JS verification

No headless-browser requirement.

Implementation agent runs normal checks such as:

```text
node --check changed/new JS
node scripts/verify-integration.mjs
node scripts/build-static.mjs
existing standalone static checks
```

Update CI/static verifier to remove the old invariant that Todo command bridge must not exist.

Add pure/static cases for:

1. tool queue continues after unexpected rejected call;
2. shared ensureReady Promise clears after rejection and later call can recover;
3. same requestId + different function/args is rejected;
4. success/partial replay receipts survive serialization/reload logic;
5. partial committed exact replay is blocked;
6. subtask `projectId:null` final state becomes root/Inbox;
7. time-only task resolves date today;
8. clear date while time remains resolves today;
9. clear date while Repeat remains resolves today;
10. clear date+time+Repeat truly unschedules;
11. Repeat end date before final due date rejected;
12. February 30/April 31 yearly dates rejected, February 29 accepted;
13. explicit task position from non-Custom sort passes a snapshot into hierarchy-drag commit;
14. `tagMatch=all` uses one match per requested Tag tree;
15. task pagination order is deterministic;
16. Project/Tag pagination stays bounded;
17. dynamic batch validation observes previous item mutations;
18. workspace staged partial result is truthful;
19. declaration gate requires activeTools.todo + compatible Shell bridge support.

---

# 39. User manual browser/Live Voice checklist

The user performs functional browser testing.

## Tool UI

- To-Do appears in both tool locations;
- preference persists;
- standalone ChatUI with saved Todo=true still sends no Todo declarations;
- turning toggle OFF during active answer affects next answer only.

## Wake/RPC

- Todo READY → immediate tool execution;
- Todo LOADING → wait then execute;
- Todo FAILED → one recovery attempt;
- failed readiness does not poison future call;
- no stale deferred mutation executes later.

## Duplicate/replay

- first mutation succeeds;
- exact duplicate returns confirmation token;
- unrelated later user message does not authorize duplicate;
- explicit confirmation + token allows exactly one duplicate;
- Regenerate of original user message does not repeat mutation;
- Chat iframe reload after success retains replay protection;
- unknown/partial outcome cannot be blindly repeated;
- partial batch exact retry does not recreate already-created items.

## Stop

- Stop before dispatch → no mutation;
- Stop after dispatch but before Todo starts → cancel prevents later mutation;
- Stop after partial commit → committed work remains and receipt reflects partial result.

## Tasks

- create/update/delete one and batches up to 10;
- date/time/reminder/repeat/priority/Tags/Project persist;
- time-only gets today's date;
- subtask `projectId:null` becomes root Inbox;
- subtask given new Project becomes root then gets Project;
- completed parent rejects child creation;
- completion + position works;
- repeating completion reports old + new occurrence IDs;
- explicit position while Due Date/Name/Priority sorted preserves the current visible ordering when switching to Custom.

## Reads

- >10 task request returns summary + full-detail hint;
- full details work in groups <=10;
- page 2 does not duplicate/skip unchanged tasks;
- currentViewTaskIds unaffected by collapsed subtask UI;
- Project/Tag filters include descendants;
- `tagMatch=all` behaves per requested Tag tree;
- large Project/Tag lists can paginate/search.

## Editors

- exact edited entity mutation rejected;
- new Subtask draft protects its parent from delete/complete/becoming subtask;
- Project/Tag draft parent dependencies protected;
- unrelated Tag rename/create refreshes Subtask Tag menu without losing typed draft;
- Project metadata refreshes Subtask lock label safely.

## Workspace

- navigation + view applies view to newly navigated target;
- sort/group/direction work;
- Custom sort uses correct snapshot;
- multi-stage workspace failure reports final partial state.

## Hidden Todo / Live Voice

- Chat creates/updates while Todo hidden;
- opening Todo requires no refresh;
- Live Voice uses same tools;
- switching apps does not stop voice/generation.

---

# 40. Recommended implementation order

## Phase 1 — Contracts/normalizers/read selectors

Implement exact 14 tools, strict scheduling/repeat/reminder/position validation, deterministic reads, pagination and structured serializers.

## Phase 2 — Todo executor

Implement recoverable queue, request registry, editor guard, staged task/Project/Tag/workspace planners, cancellation checks, side-effect reporting and final UI sync.

## Phase 3 — Shell wake/cancel RPC

Implement failure-resilient `ensureReady`, immediate send, capability handshake, request/response/cancel routing and 32/64 KiB validators.

## Phase 4 — Chat generation context + replay guard

Propagate userTurnId/generation mode, implement sessionStorage receipts, structural fingerprints, duplicate token protocol, partial/unknown handling and late results.

## Phase 5 — Gemini registry/activity

Register Todo behind generation-permission + bridge-support gate and centralize provider identification.

## Phase 6 — To-Do UI

Add toggle/card/pill, saved preference, unavailable/standalone state and concise data-boundary disclosure.

## Phase 7 — Static/pure-JS/build verification

Run the non-browser checks and update CI verifier.

## Phase 8 — User manual verification

Provide/use section 39 checklist.

## Phase 9 — PR

Only after explicit implementation approval:

- fetch exact latest `main`;
- create feature branch from that SHA;
- implement;
- run checks;
- user manually verifies;
- open PR;
- do not merge until reviewed/approved.

---

# 41. Non-goals

This plan does not:

- create an external MCP server;
- merge ChatUI_DB and TodoListDB;
- let ChatUI directly write Todo storage/state/DOM;
- redesign Todo editors;
- rewrite RepeatEngine/AppDataService architecture;
- implement real notification delivery;
- add Timeline;
- add deeper task hierarchy levels;
- add dozens of micro-tools;
- expose raw `sortOrder`;
- add delete approval popups;
- require headless Chrome;
- use page refresh as synchronization;
- treat Regenerate as permission to repeat mutations.

---

# 42. Definition of done

Implementation is done only when:

1. ChatUI exposes exactly the 14 Todo tools behind one To-Do toggle.
2. Todo declarations require generation permission **and** compatible Shell bridge support.
3. Todo auto-wakes and actual RPC is never left in the normal frame queue.
4. Shared readiness and Todo tool queues recover after failures.
5. Todo AI calls/items execute sequentially with static + dynamic validation.
6. Mutation batches max at 10.
7. Task/Project/Tag writes use canonical IDs.
8. Scheduling final-state rules match normal Todo date/time/Repeat behavior.
9. Repeat end/date/year-date validation prevents UI-impossible rules.
10. Reminder configuration persists through existing Todo reminder logic.
11. Repeating completion preserves current new-occurrence-ID behavior and reports it clearly.
12. Subtask Project/null final-state rules are deterministic and correct.
13. Every explicit task position preserves current visible order when forcing Custom by passing a snapshot into the hierarchy-position commit.
14. Broad task reads max at 20 summaries; full details max at 10 and include narrowing guidance.
15. Task pagination ordering is deterministic.
16. Project/Tag list tools can search/paginate/narrow safely.
17. Tag `all` descendant semantics are explicitly correct.
18. Results begin with compact overview/tree and retain authoritative structured data.
19. Multi-stage Task/Project/Tag/Workspace operations report partial state truthfully.
20. UI reconciles once after all durable outcomes, including partial commits.
21. Editor/draft guards protect both existing edits and new drafts without rewriting editor save logic.
22. Safe Subtask metadata/tag UI is refreshed after related AI changes.
23. Todo requestId is bound to one exact request and cannot be reused for different args.
24. Chat replay receipts survive iframe reload and are bounded/temporary.
25. Known partial commits and unknown outcomes cannot be blindly replayed.
26. Exact successful duplicate requires explicit token use from a later new user turn; Regenerate never confirms it.
27. Stop cancels dispatched-but-not-started Todo work and never falsely claims rollback after mutation begins.
28. Todo RPC/result budgets remain within 64 KiB; ordinary Shell messages remain 32 KiB.
29. Tool/result error codes are stable and not inferred from English service strings.
30. No extra delete approval UI is added.
31. Normal Chat and Live Voice use the same Todo path.
32. Hidden Todo changes are already visible when opened without refresh.
33. Existing Workspace/Google Search/URL Context/Code Execution remain functional.
34. Standalone ChatUI/Todo remain functional.
35. Static/pure-JS/build checks pass and the user completes browser/Live Voice testing.
36. No runtime code is merged until explicit implementation approval is given.
