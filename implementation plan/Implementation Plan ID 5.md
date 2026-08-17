# Implementation Plan ID 5 — To-Do Due-Date Sorting Fix + Multi-Select Mode

## Status

**Plan only. Do not implement until explicitly approved.**

Baseline inspected and review-validated against:

```text
main @ 189c18b84b7afaa54001436cd027c185c5634609
```

This revision incorporates the technically valid findings from:

```text
TodoList-ui/review.md
```

This plan is intentionally **To-Do-only**.

Do not modify ChatUI runtime code, Shell routing/RPC code, Gemini declarations, ChatUI databases, or the persistent iframe architecture as part of this implementation.

A small change to the existing **Todo-side** AI executor is now explicitly in scope only to coordinate Todo mutations safely with a manual multi-select batch. That remains a TodoList-ui change; it does not require ChatUI or Shell changes.

---

# 1. Goals

Implement two Todo improvements:

1. Fix **Due Date sorting** so tasks on the same date are ordered by real clock time instead of lexicographic 12-hour text.
2. Add a complete **multi-select mode** for tasks/subtasks in List and Kanban views.

Multi-select must support:

- entering Select mode from the top-right workspace `•••` menu;
- selecting many individual tasks using the **existing circular task checkbox/control**;
- clicking/tapping a task body to select it while Select mode is active;
- one circular select-all control for every logical visible task container/lane;
- replacing the blue `+` FAB with a selection-actions `•••` FAB while Select mode is active;
- batch actions for:
  - Done
  - Date
  - Priority
  - Tags
  - Project
  - Delete
  - Link Parent Task

No Pin action is added.

---

# 2. Product decisions fixed by the request

These are requirements, not implementation-agent choices.

## 2.1 Reuse the existing round task control

Do **not** add a second checkbox beside every task.

Normal mode:

```text
round task control
→ completed/active
```

Select mode:

```text
same round task control
→ selected/unselected
→ no completion mutation
```

The shape stays the same.

To make temporary selection visually distinct from completion without changing that shape:

```text
normal checked/completed → existing success/green treatment
Select-mode checked      → accent/blue treatment
```

The task card itself still keeps its real completed strike-through/state.

## 2.2 Select mode entry

Add to the existing top-right workspace menu:

```text
Select
```

While active, the item becomes:

```text
Cancel Selection
```

Do not enter Select mode while Task, Subtask, Schedule, Settings, or another blocking Todo modal is active.

## 2.3 Batch action layout

The selection action panel must use this layout:

```text
┌────────┬────────┬──────────┐
│  Done  │  Date  │ Priority │
├────────┼────────┼──────────┤
│  Tags  │ Project│  Delete  │
└────────┴────────┴──────────┘

[ Link Parent Task ]
```

Use existing Todo visual/icon language:

- Done → check/done icon;
- Date → existing calendar icon;
- Priority → existing flag icon;
- Tags → existing tag icon;
- Project → existing folder/project icon;
- Delete → trash icon with danger styling;
- Link Parent Task → visible text is required.

No Pin.

## 2.4 Container controls are round selectors, not text buttons

Do not add `Select All` / `Deselect All` text buttons.

Each logical container gets a small circular checkbox/control matching the task-circle language.

State:

```text
none selected → unchecked
some selected → indeterminate
all selected  → checked
```

Click:

```text
all selected
→ unselect all IDs in that container

none/some selected
→ select all IDs in that container
```

## 2.5 Every visible logical lane has an independent selector

Examples:

### List, Group=None

```text
○ Active Tasks
○ Completed
```

### List, Group=Priority

```text
○ None
○ Low
○ Medium
○ High

○ Completed
```

### Kanban, Group=Priority

```text
High
  ○ Active
  ○ Completed

Medium
  ○ Active
  ○ Completed
```

`High → Completed` selects only the completed family/cards rendered in the High completed lane.

## 2.6 Selection is runtime-only

Do not persist:

```text
selectionMode
selectedTaskIds
selection panel state
```

No TodoListDB schema/version change.

---

# 3. Review claims validated against the real application

The implementation agent should treat this section as the result of the review audit.

## Finding 1 — TRUE — FAB event ownership

Current `TasksCore.bindEvents()` permanently binds:

```js
this.openAddTaskBtn?.addEventListener('click', () => this.openModal());
```

Therefore the implementation must **replace that ownership path**, not add a second independent click handler.

Use one method:

```text
handlePrimaryFabClick()
```

Behavior:

```text
Select mode OFF → open Add Task
Select mode ON  → open/close selection action panel
```

The same owner updates icon, disabled state, `aria-label`, `aria-expanded`, and restoration after Select mode.

## Finding 2 — TRUE — Escape event ownership

WorkspaceControls, task actions, drag, Schedule and modal code already listen for Escape independently.

The selection Escape handler must:

```js
if (event.key !== 'Escape') return;
if (event.defaultPrevented) return;
```

and detect higher-priority active Todo layers before exiting Select mode.

One Escape must close **one UI layer**, not two.

## Finding 3 — TRUE — Bulk Date needs exact schedule invariants

The normal Schedule UI assigns Today when a time exists without a date and validates Repeat end-date ordering. Raw `AppDataService.updateTask(id, { dueDate })` does not reproduce every UI-level invariant.

The upgraded exact rules are defined in section 22.

## Finding 4 — TRUE — One checkbox event path

The existing task checkbox owns completion through one `change` listener. Do not add both `click` and `change` selection mutations.

Branch inside the existing `change` flow.

## Finding 5 — TRUE — Manual batch and Todo AI can otherwise interleave

Todo AI has its own high-level executor queue, while manual UI writes and AI writes meet only at individual `AppDataService.enqueue()` calls. A multi-step manual batch can therefore interleave with a multi-step AI mutation.

Add one Todo-local higher-level mutation coordinator as defined in section 19.

## Finding 6 — TRUE — Due Date edge rules were underspecified

Pin all no-date/no-time/invalid-time/descending behavior explicitly in section 6.

## Finding 7 — TRUE — Display-unit counts can differ from concrete selected IDs

A root display unit can render root + subtasks while existing headers count only the root row. In Select mode, selector counts must use concrete expanded task IDs.

## Finding 8 — TRUE — Mixed completion family state is possible

A root family can visibly contain child cards whose own `completed` state differs from the root. Container selection follows the **rendered family/container**, because the user asked to select everything in that visible container.

## Finding 9 — TRUE — Task-body keyboard target needs selection state

In Select mode the existing `.task-details` button-like target must expose `aria-pressed` and truthful Select/Unselect labels.

## Finding 10 — TRUE AS UX IMPROVEMENT — distinguish selection from completion

Keep the same round shape but use accent color for temporary selection.

## Finding 11 — TRUE — predictable batch errors should be preflighted

Validate all predictable target/value errors before the first durable write, then still re-read dynamic state before every item.

## Finding 12 — TRUE — preserve/update collapse hooks deliberately

`ensureCompletedSectionToggle()` currently finds:

```text
:scope > .completed-section-toggle
```

Refactoring the header into a wrapper will break that query unless the method is intentionally updated. Do not rely on old DOM shape accidentally surviving.

## Finding 13 — TRUE — empty container state needs a special case

For zero concrete IDs:

```text
checked = false
indeterminate = false
disabled = true
```

Never use `every()` without first handling an empty list.

## Finding 14 — CONFIRMED — one pure sorter fix is correct

Keep the time parser/comparator in `WorkspaceControls.sortTasks()` so List, Kanban, groups and subtasks reuse the same behavior.

## Finding 15 — ALREADY SATISFIED

The plan already requires a central `selectedTaskIds` Set and logical membership from AppState/render rows rather than arbitrary DOM scraping. Keep this unchanged.

---

# 4. Recommended module structure

Add:

```text
TodoList-ui/js/components/task-selection.js
TodoList-ui/js/components/task-selection-actions.js
TodoList-ui/js/components/task-selection-menus.js
TodoList-ui/js/todo-mutation-coordinator.js
TodoList-ui/css/components/task-selection.css
```

## `task-selection.js`

Owns:

```text
selectionMode
selectedTaskIds: Set
selectionBatchBusy
enter/exit/toggle
selection pruning
container membership/state
card selection state
FAB mode state
workspace Select/Cancel state
Escape ownership
```

## `task-selection-actions.js`

Owns:

```text
batch preflight
batch execution
Done
Date
Priority
Tags
Project
Delete
Link Parent Task
partial-success bookkeeping
final reconciliation
```

All durable changes go through existing `AppDataService` / hierarchy services.

## `task-selection-menus.js`

Owns:

```text
batch action panel
Priority picker
Tags picker
Project picker
Date-only Schedule entry
Link Parent candidate picker
outside-click/focus behavior
```

Do not reuse mutable Task editor draft properties such as:

```text
TasksComponent.selectedPriority
TasksComponent.selectedProject
TasksComponent.selectedTags
```

## `todo-mutation-coordinator.js`

A small Todo-only higher-level exclusive coordinator for multi-step mutations.

Conceptually:

```js
runExclusive(owner, work)
whenIdle()
```

It sits **above** `AppDataService.enqueue()`.

It does not replace IndexedDB transactions and does not write data itself.

Use it for:

```text
manual multi-select commit
Todo AI mutating request
```

Do not modify ChatUI or Shell for this.

## `task-selection.css`

Own only selection-specific styles:

```text
selection card state
accent checked circle in Select mode
container circles + indeterminate state
selection FAB
2x3 panel
bulk pickers
busy state
mobile positioning
```

---

# 5. Compose selection into `TasksComponent`

Modify:

```text
TodoList-ui/js/components/tasks.js
```

Import and compose selection modules in the same style as renderer/drag/group modules.

During `init()`:

1. cache existing FAB and task DOM references;
2. initialize menus/actions/hierarchy/drag;
3. initialize selection;
4. bind normal editor events;
5. render.

### Critical FAB correction

Replace:

```js
this.openAddTaskBtn?.addEventListener('click', () => this.openModal());
```

with one mode-aware binding:

```js
this.openAddTaskBtn?.addEventListener('click', () => this.handlePrimaryFabClick());
```

Do **not** add another click listener that competes with the existing one.

---

# 6. Fix Due Date sorting exactly

Modify:

```text
TodoList-ui/js/components/workspace-controls.js
```

Current bug:

```text
`${dueDate}|${dueTime}`
```

is compared as text.

Add a pure defensive parser:

```text
parseDueTimeMinutes("12:00 AM") → 0
parseDueTimeMinutes("01:00 AM") → 60
parseDueTimeMinutes("11:59 AM") → 719
parseDueTimeMinutes("12:00 PM") → 720
parseDueTimeMinutes("12:18 PM") → 738
parseDueTimeMinutes("03:57 PM") → 957
parseDueTimeMinutes("11:59 PM") → 1439
missing                     → null
malformed legacy value      → null
```

Parser must never throw during rendering.

### Exact product ordering

#### Scheduled vs No Date

Preserve current behavior:

```text
No Date is always after dated tasks
```

This remains true in **both Ascending and Descending**.

The scheduled-vs-unscheduled comparison stays outside the direction reversal.

#### Different dates

Compare ISO `YYYY-MM-DD`.

Direction applies to dated tasks:

```text
Ascending  → earlier date first
Descending → later date first
```

#### Same date, timed vs date-only/invalid time

Preserve the current no-time behavior:

```text
Ascending:
date-only/invalid-time bucket first
then valid timed tasks from earliest → latest

Descending:
valid timed tasks from latest → earliest
then date-only/invalid-time bucket
```

If both tasks are date-only/invalid-time, keep stable input order.

If both valid times are equal, keep stable input order.

Do not mutate stored `dueTime` values as part of sorting.

### Required pure regression cases

```text
12:18 PM < 03:57 PM
12:00 AM < 01:00 AM
11:59 AM < 12:00 PM
12:59 PM < 01:00 PM
11:59 PM = latest valid time
No Date remains last in asc and desc
malformed legacy time does not throw
```

---

# 7. Central selection state

Use exactly one source of truth:

```js
selectionMode: false
selectedTaskIds: new Set()
selectionBatchBusy: false
```

Never maintain independent selected booleans in groups/columns.

Required methods conceptually:

```text
isSelectionMode()
enterSelectionMode()
exitSelectionMode()
isTaskSelected(id)
setTaskSelected(id, selected)
toggleTaskSelection(id)
selectTaskIds(ids)
unselectTaskIds(ids)
getSelectionCount()
pruneSelection()
getContainerSelectionState(ids)
syncSelectionUi()
handlePrimaryFabClick()
handleSelectionEscape(event)
```

## Enter mode

Before entering:

- refuse if a blocking modal is active;
- close workspace menu/settings submenu;
- close task action/context menus;
- cancel pending pointer drag;
- cancel pending touch drag;
- cancel active task drag safely;
- start with an empty Set;
- set Select mode;
- rerender/sync;
- switch the existing FAB to selection-actions mode.

## Exit mode

Do not exit while `selectionBatchBusy` is actively committing.

Otherwise:

- close nested bulk picker/panel;
- clear selected IDs;
- restore checkbox completion meaning;
- restore card Edit meaning;
- restore FAB Add Task state;
- rerender/sync once.

---

# 8. Individual task selection — one checkbox event path

Modify:

```text
TodoList-ui/js/components/task-renderer.js
```

The existing checkbox `change` listener remains the **single mutation event path**.

Conceptually:

```js
checkbox.addEventListener('change', async event => {
  event.stopPropagation();

  if (this.selectionMode) {
    this.setTaskSelected(task.id, checkbox.checked);
    return;
  }

  // existing completion path
  await AppDataService.toggleTaskStatus(task.id);
});
```

Do not add a separate checkbox `click` handler that also changes selection.

The wrapper may continue stopping propagation so task-body selection does not also fire.

### Checkbox state

Normal mode:

```text
checked = task.completed
label   = Mark ... completed/active
```

Select mode:

```text
checked = selectedTaskIds.has(task.id)
label   = Select task ... / Unselect task ...
```

### Task-body target

Current `.task-details` is `role="button"` with keyboard Edit semantics.

In Select mode:

```text
role="button"
aria-pressed="true|false"
aria-label="Select task: ..." or "Unselect task: ..."
Enter/Space → toggle selection
click/tap   → toggle selection
```

Outside Select mode:

- remove `aria-pressed`;
- restore Edit label/title;
- Enter/Space/click opens Task/Subtask editor as today.

Hide/disable each task `•••` action while Select mode is active.

---

# 9. Selection visual state

Keep the circle shape exactly as requested.

Add selection-specific style only:

```css
.selection-mode .task-checkbox:checked {
  background-color: var(--accent-color);
  border-color: var(--accent-color);
}
```

Use the same accent treatment for container circles.

This communicates:

```text
green checked circle → completed
accent checked circle → temporarily selected
```

Do not remove completed strike-through from a selected completed task.

---

# 10. Disable drag while selecting

Modify earliest task drag entry guards in:

```text
TodoList-ui/js/components/task-drag.js
TodoList-ui/js/components/task-drag-touch.js
```

If `selectionMode`:

```text
do not create drag pending state
do not start long-press drag
do not commit hierarchy drag
```

Entering Select mode must call the real existing cleanup methods:

```text
cancelPendingTaskDrag()
cancelPendingTouchDrag()
cancelTaskDrag()
```

Normal drag behavior outside Select mode remains unchanged.

---

# 11. Logical container membership

Never scrape arbitrary rendered DOM to decide batch targets.

Build logical membership from the same rows used by rendering.

Helper concept:

```text
expandRenderedTaskIds(rows)
```

Rules:

1. root display unit → root ID + every child card that `createTaskFamily()` renders;
2. standalone filtered subtask → only that subtask;
3. deduplicate IDs;
4. collapsed subtasks still belong because collapse is presentation-only;
5. Tag groups may overlap and share IDs;
6. missing/deleted IDs are pruned.

## Mixed completion rule — explicit

Container membership follows the **rendered family**, not each child's independent completion field.

Example:

```text
Active root
└─ completed child
```

If that family is rendered in the Active container, Active Select-All selects both visible logical task records.

Likewise a completed root family containing an active child still belongs to the Completed container if that is where the current renderer places the family.

This matches the request: select everything in that visible container.

---

# 12. Selection-mode counts

Current normal header/group counts are based on display rows such as `activeTasks.length` or `group.tasks.length`, which can count one root while the rendered family contains several concrete task cards.

Preserve existing counts outside Select mode.

In Select mode, use the expanded concrete ID list for the container's task count.

Example:

```text
2 root display rows
+ 4 rendered subtasks
= 6 selectable task IDs
```

The Select-mode container count should represent `6`, not `2`.

The action panel separately shows the global selection count such as:

```text
5 selected
```

Do not maintain a second selection state just to produce counts.

---

# 13. Container circle state including empty containers

For a normalized deduplicated ID list `C`:

```text
if C.length === 0:
  checked = false
  indeterminate = false
  disabled = true

otherwise:
  selectedCount = number of IDs in C present in selectedTaskIds
```

Then:

```text
0 selected          → unchecked
0 < selected < all → indeterminate
all selected        → checked
```

Never let `every([])` make an empty lane appear selected.

---

# 14. List headers and exact collapse-hook preservation

## Active section

When Select mode is active, reveal the Active section header and add its round selector.

Outside Select mode, restore existing visibility.

## Completed section

Current `ensureCompletedSectionToggle()` caches:

```text
:scope > .completed-section-toggle
```

Refactor static HTML to a non-interactive wrapper:

```text
.completed-section-header-row
├── container selector
└── button.completed-section-toggle
```

Then **update `ensureCompletedSectionToggle()` deliberately** to find/cache the collapse button in the new structure.

Keep on the actual collapse button:

```text
.completed-section-toggle
aria-controls="completed-task-list"
aria-expanded
collapse label
chevron behavior
```

Do not leave the old `:scope >` assumption unchanged after introducing the wrapper.

Selection click and collapse click must be independent.

---

# 15. Grouped List selectors

Modify:

```text
TodoList-ui/js/components/task-groups.js
TodoList-ui/css/components/task-groups.css
```

Refactor each current all-in-one group `<button>` into:

```text
.task-group-header-row
├── round container selector
└── button.task-group-header
    ├── chevron
    ├── group label
    └── count
```

Preserve:

- collapse key;
- `aria-expanded`;
- chevron state;
- list hidden state;
- drag lane metadata on the list.

In Select mode, count concrete expanded IDs.

Required groups:

```text
Priority
Date
Project
Tag
```

Tag overlap must produce correct partial circles from the global Set.

---

# 16. Kanban selectors

Modify:

```text
TodoList-ui/js/components/task-kanban.js
TodoList-ui/css/components/task-kanban.css
```

Each column has two independent logical lanes:

```text
Active
Completed
```

For grouped Kanban:

```text
○ High/Active
  active cards

○ Completed
  completed cards
```

Refactor the current `button.kanban-completed-header` into a wrapper with sibling selector + collapse button while preserving:

```text
aria-controls
aria-expanded
chevron
collapse state key
completed list ID
drop lane enable/disable
```

For Group=None, show a small Active lane header only while Select mode is active.

Zero-task active/completed lanes have disabled unchecked selectors.

---

# 17. Workspace menu + Escape ownership

Modify:

```text
TodoList-ui/index.html
TodoList-ui/js/components/workspace-controls.js
TodoList-ui/css/components/workspace-menu.css
```

Menu:

```text
View
[List] [Kanban] [Timeline]
────────────
Sort & Group ›
────────────
Select / Cancel Selection
```

WorkspaceControls delegates state changes to `TasksComponent`.

## Escape hierarchy

Selection adds one explicit:

```text
handleSelectionEscape(event)
```

Rules:

1. ignore non-Escape;
2. if `event.defaultPrevented`, do nothing;
3. if a blocking Task/Subtask/Schedule/Settings modal is active, do not exit Select mode;
4. if an inner bulk picker is open, close only it and `preventDefault()`;
5. else if the selection action panel is open, close only it and `preventDefault()`;
6. else exit Select mode and `preventDefault()`.

Because WorkspaceControls is already an Escape owner for its own menu/panel, the selection handler must not perform another close after that event was handled.

One key press = one layer.

---

# 18. FAB — exactly one owner

Reuse only:

```text
#btn-open-add-task
```

Do not add a second floating button.

Do not add a second competing primary click handler.

`handlePrimaryFabClick()` owns:

### Normal mode

```text
+ icon
aria-label="Add Task"
aria-expanded="false"
disabled=false
click → open Add Task
```

### Select mode, zero selected

```text
•••
aria-label="Selected task actions"
disabled=true
```

### Select mode, one or more selected

```text
•••
disabled=false
click → toggle batch action panel
aria-expanded mirrors panel
```

Exit Select mode restores the Add Task state.

---

# 19. Todo-local mutation coordination

This correction is required because a manual multi-step batch and a Todo AI multi-step mutation can otherwise interleave between individual `AppDataService` writes.

Add:

```text
TodoList-ui/js/todo-mutation-coordinator.js
```

Conceptual API:

```text
runExclusive(owner, work)
whenIdle()
isBusy()
```

Use a small FIFO promise chain/lease above `AppDataService`.

## Manual selection batch

When the user commits a batch action:

```text
TodoMutationCoordinator.runExclusive('manual-selection', async () => {
  preflight current batch
  perform sequential AppDataService writes
  reconcile
})
```

`selectionBatchBusy=true` from lease start through final reconciliation.

## Todo AI executor

Modify only the Todo-side files:

```text
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-registry.js (reuse existing isTodoMutationToolName)
```

Do not change tool declarations in ChatUI.

For a mutating Todo AI function:

```text
TodoMutationCoordinator.runExclusive('todo-ai', execute mutation request)
```

Acquire the coordinator **before** the executor's `AppDataService.whenIdle()`/dispatch phase so the full high-level mutation is protected.

For a read-only Todo tool:

```text
await TodoMutationCoordinator.whenIdle()
await AppDataService.whenIdle()
read AppState
```

This prevents AI reads from observing the middle of a manual batch.

## Cancellation

If an AI request is cancelled while waiting for the coordinator, the existing request cancellation flag must be checked again after the lease is acquired and before any mutation starts.

## No direct DB workaround

Do not bypass:

```text
AppDataService.enqueue()
IndexedDB service transactions
```

The coordinator only protects **high-level multi-step ownership**.

---

# 20. Batch execution contract — preflight first, then revalidate

For every action:

1. snapshot selected IDs;
2. normalize requested action/value;
3. acquire `TodoMutationCoordinator` lease;
4. re-resolve all current target tasks under the lease;
5. perform **whole-batch predictable preflight** before the first durable write;
6. if preflight fails, write nothing;
7. then execute sequential durable service calls;
8. immediately before each call, re-read/revalidate the specific entity;
9. if storage/runtime failure occurs mid-batch, report truthful partial success;
10. one final authoritative render/reconciliation.

Preflight predictable errors such as:

```text
chosen Project missing
selected subtask makes Project action illegal
chosen parent invalid
selected target already has children for Link Parent
Repeat end date before proposed bulk date
chosen Tag missing
invalid priority
Delete family normalization/confirmation consequence
```

Preflight cannot eliminate real mid-write failures, so partial-success handling remains required.

---

# 21. Done action

Meaning:

```text
make selected tasks completed
```

Never blind-toggle.

Preflight needs no special value validation, but normalize existing target IDs.

Execution order:

1. selected roots first;
2. selected subtasks second;
3. re-read every task immediately before acting.

For each:

```text
missing           → prune/skip
already completed → no-op
active            → AppDataService.toggleTaskStatus(id)
```

Root completion may complete children.

Therefore a selected child that was completed by its selected parent is re-read and skipped, never toggled back active.

Repeat behavior remains existing service behavior. A newly generated next occurrence is not auto-selected.

---

# 22. Date action — exact date-only behavior

Reuse the current Calendar/Schedule visual language through a dedicated bulk date-only mode such as:

```text
ScheduleComponent.openDateOnly(...)
```

Do not expose Time, Reminder, or Repeat controls in this mode if their edits will not be applied.

The bulk Date UI should visibly be **Date-only**.

Callback returns only:

```text
chosen dueDate
or explicit Clear intent
```

Do not reuse Task editor schedule draft state.

## Initial date

```text
all selected share dueDate → show that date
mixed values                → no single selected date / mixed state
```

## Exact final-date normalization per task

If user selects a date:

```text
finalDate = chosen date
```

If user chooses Clear:

```text
existing dueTime exists
→ finalDate = Today

active Repeat exists
→ finalDate = Today

neither dueTime nor active Repeat
→ finalDate = null
```

Do **not** clear dueTime, reminders, or Repeat as a side effect.

## Repeat end-date preflight

Before the first write, for every selected task:

```text
if repeat.end.type === 'date'
and finalDate exists
and repeat.end.date < finalDate
→ reject the batch before any durable mutation
```

Explain concisely that the chosen date is after one selected task's Repeat end date.

Then execution uses:

```text
AppDataService.updateTask(id, { dueDate: finalDate })
```

with per-item re-read under the coordinator.

This deliberately matches the normal Schedule invariant that Time/active Repeat cannot remain date-less.

---

# 23. Priority action

Picker:

```text
None
Low
Medium
High
```

Preflight:

- chosen value must be one of the allowed service values.

Apply to roots/subtasks:

```text
AppDataService.updateTask(id, { priority })
```

Do not reuse Task editor `selectedPriority`.

---

# 24. Tags action

Use `TaxonomyOrder` hierarchy/order and independent batch state.

For each Tag compute across current target tasks:

```text
none have it
some have it
all have it
```

Click behavior:

```text
all have Tag
→ remove from all selected tasks

none/some have Tag
→ add to all selected tasks
```

Preserve unrelated Tags per task.

Preflight chosen Tag still exists before any write.

Per task:

```text
AppDataService.updateTask(id, { tags: nextTagIds })
```

---

# 25. Project action

Subtasks inherit the parent Project.

Safe rule:

1. roots are valid Project targets;
2. selected child whose selected root is also a target is covered by the root write;
3. selected child whose root is not selected makes the Project action unavailable for that selection.

Reason text:

```text
Subtasks inherit their parent Project.
```

Preflight:

- chosen Project exists, or Inbox `''`;
- every effective target remains a root;
- no illegal lone-subtask target remains.

Apply each effective root:

```text
AppDataService.updateTask(rootId, { project })
```

Existing service propagation updates children.

---

# 26. Delete action

Normalize families before mutation.

If selected root is included:

```text
root deletion owns root + descendants
selected child IDs under that root are not separate delete calls
```

A selected child without selected root may be deleted individually through `deleteTaskFamily(childId)`.

Before coordinator commit, show **one** concise confirmation describing the real family consequence.

Inside coordinator, preflight target existence/family normalization again before the first write.

After mutation:

- remove deleted/missing IDs from selection;
- retain unattempted IDs on partial failure;
- final render from AppState.

---

# 27. Link Parent Task

Visible text action:

```text
Link Parent Task
```

Enable only if every selected effective target is currently:

```text
root
AND has no subtasks
```

Candidate parent must be:

```text
root
active/not completed
not one of selected target IDs
```

Use existing eligible-parent ordering.

Before first write under the coordinator, preflight all targets and chosen parent again.

Then before each individual link, re-read target + parent and revalidate.

Apply:

```text
AppDataService.linkTaskToParent(taskId, chosenParentId)
```

No bulk Unlink in this plan.

---

# 28. Action-level busy state

During durable batch execution:

```text
selectionBatchBusy = true
```

Until final reconciliation:

- batch action cells disabled;
- batch pickers cannot open another action;
- FAB cannot start another action;
- Cancel Selection does not destroy in-flight state;
- task selection toggles are temporarily ignored/disabled;
- sidebar filter navigation should not exit Select mode in the middle of a commit;
- Sort/Group/View changes should wait until the commit settles.

Scrolling remains allowed.

After success/failure:

```text
selectionBatchBusy = false
```

and UI state is rebuilt from authoritative AppState.

---

# 29. Error and partial-success bookkeeping

There is no one IndexedDB transaction covering every selected task.

Track internally:

```text
succeededIds
failedId + error
unattemptedIds
```

On predictable preflight failure:

```text
0 durable writes
selection remains
show concise error
```

On storage/runtime failure after some writes:

- never manually roll AppState backward;
- rerender authoritative AppState;
- preserve unattempted/failed targets in selection when still visible;
- prune deleted/hidden IDs;
- report with `AppPersistence.reportError()`;
- never automatically rerun the failed batch.

---

# 30. Selection lifecycle across renders

The Todo iframe can rerender because of normal user operations or Todo AI operations.

After every render while Select mode is active:

1. derive current logical selectable IDs for the current filter/view;
2. prune selected IDs that no longer exist or are no longer represented;
3. render checkbox selection state;
4. render task-body `aria-pressed` state;
5. recompute every container selector;
6. recompute Select-mode concrete counts;
7. update global selected count/FAB state.

## Sidebar filter/navigation

When not batch-busy, changing Inbox/Today/Completed/Project/Tag exits Select mode before rendering the new target.

## Sort/Group/List/Kanban

Presentation changes may keep Select mode active.

Recompute membership and prune selection after rerender.

## Shell app switch

Todo → Chat → Todo does not exit Select mode. The iframe is persistent.

---

# 31. Collapse behavior

Selection and collapse remain separate.

- selector click never toggles collapse;
- collapse click never changes selection;
- collapsed logical cards remain part of that container's select-all membership;
- selector state remains correct while collapsed;
- external changes recompute it.

Applies to:

```text
List Completed
List groups
Kanban Completed per column
```

---

# 32. Accessibility

Requirements:

- task circle remains native checkbox;
- task checkbox label reflects completion in normal mode and selection in Select mode;
- task-body selection target uses `aria-pressed` in Select mode;
- container controls are native checkbox controls;
- set `indeterminate=true` for partial containers;
- zero-ID selectors are disabled and unchecked;
- no interactive control nested inside another button;
- collapse button keeps correct `aria-controls`/`aria-expanded`;
- action FAB has correct `aria-expanded`;
- nested pickers get keyboard focus and return it sensibly;
- one Escape closes one layer;
- existing focus-visible styles remain.

Examples:

```text
Select all active tasks
Unselect all Medium tasks
Select completed tasks in High
```

---

# 33. Mobile behavior

Required:

- selection FAB stays above mobile bottom nav/safe area;
- panel opens upward and remains in iframe viewport;
- 3-column grid fits narrow screens;
- Link Parent text stays readable;
- visible circle may remain 22px but hit area is touch-friendly;
- task-body tap selects without Edit;
- long-press drag cannot start;
- Kanban horizontal scrolling still works;
- selection never toggles completion accidentally.

---

# 34. Files expected to change

Primary:

```text
TodoList-ui/index.html
TodoList-ui/js/components/tasks.js
TodoList-ui/js/components/task-renderer.js
TodoList-ui/js/components/task-groups.js
TodoList-ui/js/components/task-kanban.js
TodoList-ui/js/components/task-drag.js
TodoList-ui/js/components/task-drag-touch.js
TodoList-ui/js/components/workspace-controls.js
TodoList-ui/js/components/sidebar.js
TodoList-ui/js/components/schedule.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/css/layout/workspace-layout.css
TodoList-ui/css/components/workspace-menu.css
TodoList-ui/css/components/task-groups.css
TodoList-ui/css/components/task-kanban.css
TodoList-ui/css/components/task-cards.css
```

New:

```text
TodoList-ui/js/components/task-selection.js
TodoList-ui/js/components/task-selection-actions.js
TodoList-ui/js/components/task-selection-menus.js
TodoList-ui/js/todo-mutation-coordinator.js
TodoList-ui/css/components/task-selection.css
```

Potential verification changes:

```text
scripts/verify-integration.mjs
new Todo pure-JS verification script
.github/workflows/iframe-integration-check.yml
```

No ChatUI/Shell runtime file should change.

---

# 35. Implementation phases

## Phase 1 — Due Date comparator

1. Add defensive 12-hour parser.
2. Replace raw time-text comparison.
3. Pin No Date always last.
4. Preserve date-only behavior across asc/desc.
5. Add pure edge-case tests.

## Phase 2 — Todo mutation coordinator

1. Add Todo-local coordinator.
2. Wrap Todo AI mutating dispatch with coordinator.
3. Make Todo AI reads wait for coordinator idle + AppDataService idle.
4. Preserve request cancellation checks.
5. No ChatUI/Shell changes.

## Phase 3 — Selection state foundation

1. Add selection modules.
2. Add Set/mode/busy lifecycle.
3. Add workspace Select entry.
4. Replace FAB click ownership with `handlePrimaryFabClick()`.
5. Add Escape ownership.
6. Cancel/disable drag.

## Phase 4 — Individual task selection

1. Branch inside existing checkbox `change` handler.
2. Add task-body click/keyboard selection.
3. Add `aria-pressed` state.
4. Add accent selection styling.
5. Suppress per-task action/Edit behavior.

## Phase 5 — Membership + List selectors

1. Implement family-aware `expandRenderedTaskIds()`.
2. Add empty-container state.
3. Add Select-mode concrete counts.
4. Add Active selector.
5. Refactor Completed header and update `ensureCompletedSectionToggle()`.
6. Refactor grouped headers.
7. Test Tag overlap and mixed-status families.

## Phase 6 — Kanban selectors

1. Add active-lane selector per column.
2. Refactor completed header into selector + collapse siblings.
3. Preserve exact collapse/drop-lane hooks.
4. Add Group=None Active header in Select mode.
5. Test zero-ID lanes.

## Phase 7 — FAB/action panel + pickers

1. Add exact 2x3 layout.
2. Add Link Parent text row.
3. Add global selected count.
4. Add Priority picker.
5. Add Tags tri-state picker.
6. Add Project picker.
7. Add Date-only Schedule mode.
8. Add Link Parent candidate picker.

## Phase 8 — Batch preflight + persistence

For each action:

1. snapshot targets;
2. acquire coordinator;
3. whole-batch preflight;
4. per-item re-read/revalidation;
5. sequential service writes;
6. truthful partial bookkeeping;
7. one final reconciliation.

Implement Done, Date, Priority, Tags, Project, Delete, Link Parent.

## Phase 9 — Lifecycle hardening

1. filter navigation exits selection when safe;
2. Sort/Group/View retains valid selection;
3. Todo AI rerender prunes stale IDs;
4. batch-busy blocks conflicting local UI transitions;
5. app switch preserves selection;
6. keyboard/focus/Escape cleanup;
7. mobile safe-area behavior.

## Phase 10 — Verification

Static/syntax/pure-JS verification only.

No headless Chrome requirement.

The user performs real browser interaction testing.

---

# 36. Verification matrix

## Due Date

Test:

```text
12:18 PM before 03:57 PM ascending
03:57 PM after 12:18 PM descending according to real time
12:00 AM
01:00 AM
11:59 AM
12:00 PM
12:59 PM
01:00 PM
11:59 PM
No Date always last asc
No Date always last desc
date-only same-date asc/desc
malformed legacy time does not crash
same values preserve stable order
```

## FAB ownership

- normal click opens only Add Task;
- Select-mode click opens only selection panel;
- no double listener effect;
- zero selected disables action FAB;
- exit restores Add Task.

## Escape ownership

Test one Escape at each layer:

```text
Workspace Sort/Group panel
Workspace menu
bulk inner picker
batch panel
Select mode
Task/Subtask/Schedule modal
```

One press closes one appropriate layer only.

## Individual selection

- circle changes selection once per click;
- no click+change double toggle;
- task completion data remains unchanged;
- card-body click toggles once;
- Enter/Space toggles once;
- `aria-pressed` tracks state;
- selected circle is accent-colored;
- completed card keeps completed appearance.

## Family/container membership

Test:

- root only;
- root + one child;
- root + several children;
- collapsed children;
- standalone filtered child;
- active root + completed child;
- completed root + active child;
- Select-mode count equals concrete selected IDs.

## List selectors

- Active selector;
- Completed selector collapsed/expanded;
- Priority groups;
- Date groups;
- Project groups;
- Tag groups with overlapping task;
- empty section selector disabled;
- collapse state unaffected by selection.

## Kanban

- each Active lane local;
- each Completed lane local;
- High Completed never selects Medium Completed;
- Group=None Active selector;
- empty lane selector disabled;
- horizontal scroll works.

## Date batch

- common date;
- mixed dates;
- set date;
- Clear plain date-only task → null;
- Clear timed task → Today;
- Clear repeating task → Today;
- existing time preserved;
- reminders preserved;
- Repeat preserved;
- chosen date after Repeat end date rejects entire predictable batch before first write.

## Batch preflight

Force predictable invalid later targets and verify **zero earlier writes** for:

- missing Project;
- invalid Link Parent target;
- missing Tag;
- Repeat end-date conflict.

Then separately force a real storage failure mid-batch and verify truthful partial state.

## Todo AI/manual coordination

Test:

```text
manual selection batch active
→ Todo AI mutation waits until batch completes

Todo AI mutation active
→ manual batch waits until AI mutation completes

AI read during manual batch
→ read waits until batch is settled

cancelled AI mutation waiting on coordinator
→ cancellation checked before mutation begins
```

No ChatUI code change should be needed.

## Done

- mixed active/completed;
- selected root + selected child;
- root completion does not cause child to be toggled back active;
- repeat next occurrence not auto-selected.

## Tags

- none/some/all tri-state;
- add to all;
- remove from all;
- unrelated Tags preserved;
- nested ordering.

## Project

- roots only;
- Inbox;
- nested Project;
- selected root + child uses one effective root write;
- lone child disables Project.

## Delete

- child only;
- root only;
- root + selected child;
- several roots;
- one confirmation;
- family consequence correct;
- partial real storage failure remains truthful.

## Link Parent

- multiple eligible roots;
- target with children rejected before writes;
- selected child rejected;
- completed parent not offered;
- selected target cannot be candidate parent;
- revalidation before every link.

## Lifecycle/mobile

- Sort/Group/View while selecting;
- filter navigation exits selection;
- Todo → Chat → Todo retains selection;
- Todo AI deletion/update triggers prune;
- batch busy prevents conflicting navigation;
- mobile action panel fits;
- mobile safe area;
- no long-press drag;
- Kanban scroll remains usable.

---

# 37. Non-regression requirements

Do not break:

- normal single-task completion outside Select mode;
- Repeat-aware completion;
- parent family completion;
- Add Task FAB/modal;
- Task/Subtask editor keyboard continuity;
- Task drag/drop outside Select mode;
- Project/Tag taxonomy drag;
- List/Kanban rendering;
- Group By behavior;
- Custom ordering;
- existing Project/Tag hierarchy menu ordering;
- Completed/group/Kanban collapse behavior;
- embedded Todo iframe;
- standalone Todo page;
- Todo AI tools;
- TodoListDB persistence.

---

# 38. Acceptance criteria

Implementation is complete only when:

1. Due Date sorting uses real clock minutes.
2. `12:18 PM` sorts before `03:57 PM` on the same date ascending.
3. No Date is last in both sort directions.
4. malformed legacy dueTime cannot crash sorting.
5. workspace `•••` contains Select.
6. the existing round task circle becomes the selection control in Select mode.
7. selecting never mutates completion.
8. checkbox selection uses one `change` path and cannot double-toggle.
9. task body/keyboard can select with truthful `aria-pressed` state.
10. multiple task/subtask IDs can be selected.
11. each requested List/Kanban logical container has a round selector.
12. empty containers are disabled/unselected.
13. partial container state is correct, including overlapping Tag groups.
14. mixed-status families follow rendered-container membership explicitly.
15. Select-mode container counts use concrete expanded IDs.
16. Completed/group/Kanban header refactors preserve collapse hooks and ARIA.
17. exactly one FAB click owner exists.
18. FAB changes `+` ↔ `•••` correctly.
19. action panel is exactly based on:

```text
Done | Date | Priority
Tags | Project | Delete
Link Parent Task
```

20. No Pin exists.
21. Date mode is visibly date-only.
22. clearing date on Time/Repeat tasks resolves to Today without clearing Time/Repeat/Reminder data.
23. Repeat end-date conflicts are preflighted before writes.
24. predictable batch validation errors happen before the first durable mutation.
25. per-item dynamic state is still re-read before each mutation.
26. Done is desired-state completion, never blind toggle.
27. Tags preserve unrelated Tags.
28. Project respects subtask inheritance.
29. Delete normalizes root families.
30. Link Parent respects current one-level hierarchy rules.
31. Todo AI mutation and manual multi-select mutation cannot interleave at high level.
32. AI reads do not observe a half-completed manual batch.
33. selection is runtime-only; no schema change.
34. one Escape closes only one UI layer.
35. drag/edit/completion gestures do not conflict with Select mode.
36. selection survives harmless rerenders and prunes stale/hidden IDs.
37. normal Todo behavior is restored after leaving Select mode.
38. no ChatUI or Shell runtime code is modified.
39. no headless-browser test requirement is introduced.

---

# 39. Recommended implementation order

Use this order:

```text
Due Date comparator
→ Todo-local mutation coordinator
→ selection state
→ single-owner FAB/Escape behavior
→ individual circle/card selection
→ drag/editor guards
→ family membership + concrete counts
→ List headers/selectors
→ Kanban headers/selectors
→ action panel
→ Priority/Tags/Project/Date/Link Parent pickers
→ whole-batch preflight
→ batch persistence actions
→ lifecycle/AI reconciliation
→ accessibility/mobile polish
→ static/manual verification
```

Do not start with destructive batch actions before selection membership, event ownership, and mutation coordination are correct.
