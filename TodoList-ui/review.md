# Review — Implementation Plan ID 5

## Scope

This review checks **Implementation Plan ID 5 — To-Do Due-Date Sorting Fix + Multi-Select Mode** against the current TodoList-ui application.

This is a review of the plan **before implementation**. It does not change application code.

Reviewed areas include:

- `TodoList-ui/js/components/workspace-controls.js`
- `TodoList-ui/js/components/tasks.js`
- `TodoList-ui/js/components/task-renderer.js`
- `TodoList-ui/js/components/task-hierarchy.js`
- `TodoList-ui/js/components/task-groups.js`
- `TodoList-ui/js/components/task-kanban.js`
- `TodoList-ui/js/components/task-actions.js`
- `TodoList-ui/js/components/task-drag.js`
- `TodoList-ui/js/components/task-drag-touch.js`
- `TodoList-ui/js/components/sidebar.js`
- `TodoList-ui/js/components/schedule.js`
- `TodoList-ui/js/components/schedule-wheels.js`
- `TodoList-ui/js/storage/data-service.js`
- `TodoList-ui/js/storage/data-service-hierarchy.js`
- `TodoList-ui/js/task-filter.js`
- `TodoList-ui/js/task-model.js`
- current Todo AI mutation/executor behavior where it can affect the same Todo state
- current Todo HTML/CSS structure for headers, task circles, workspace menu and FAB

---

# Overall verdict

**The plan is good and is the correct general approach.**

It matches the requested product behavior well:

- no second checkbox is added to each task;
- the existing round task control becomes the selection control in Select mode;
- the requested action layout is correct;
- no Pin action is added;
- container selectors are circular controls rather than text Select All buttons;
- List and Kanban are both covered;
- grouped completed lanes in Kanban are handled separately;
- selection uses one central `Set` of task IDs;
- selection is runtime-only and does not change the database schema;
- existing Todo services are reused rather than writing directly to IndexedDB;
- drag is disabled while selecting;
- root/subtask family semantics are considered for Done, Delete and Project changes;
- overlapping Tag groups are recognized correctly;
- external Todo rerenders/AI changes are considered;
- the Due Date bug is correctly identified in `WorkspaceControls.sortTasks()`.

I would rate the plan approximately **8.8/10** in its current form.

I recommend fixing the findings below before implementation. Findings 1–5 are the most important.

---

# Finding 1 — HIGH — Reusing the existing FAB can accidentally open both Select actions and Add Task

## What the real application does now

`TasksCore.bindEvents()` currently permanently binds:

```js
this.openAddTaskBtn?.addEventListener('click', () => this.openModal());
```

The button is `#btn-open-add-task`.

Plan ID 5 correctly says to reuse this same button in Select mode instead of creating a second floating button.

However, the plan does not explicitly say that the **existing Add Task click listener itself must become mode-aware**.

## What can go wrong

An implementation agent could add a second listener from `task-selection.js`:

```text
existing listener → open Add Task
new listener      → open bulk actions
```

Then, in Select mode, clicking the blue `•••` FAB could open the selection panel **and** the Add Task modal.

Stopping propagation in another bubble listener is not a reliable design because the existing listener is already attached to the same element.

## Required plan correction

There should be exactly **one owner for the FAB click behavior**.

Change the existing binding conceptually to:

```js
this.openAddTaskBtn?.addEventListener('click', () => this.handlePrimaryFabClick());
```

Then:

```text
if Select mode
→ open/close selection action panel

else
→ open Add Task modal
```

Do not add two independent click handlers that both perform primary actions.

The same mode-aware method should own:

- icon;
- `aria-label`;
- `aria-expanded`;
- disabled state when selection count is zero;
- normal Add Task restoration after exiting Select mode.

---

# Finding 2 — HIGH — Escape handling can perform two actions from one key press

## Current application behavior

There are already several independent Escape handlers.

Examples:

- `WorkspaceControls` listens on `document` and closes the workspace menu/settings panel.
- `TaskActionMethods` listens on `document` and closes task action/parent menus.
- Task drag uses Escape to cancel an active drag.
- Schedule/modal components have their own Escape handling.

Some existing handlers call `preventDefault()` but do not stop every other `document` listener from receiving the same event.

## Why this matters

Plan ID 5 says Escape should work in this order:

```text
inner bulk picker
→ batch action panel
→ Select mode
```

That is correct.

But if the selection module adds another unconditional `document.keydown` handler, this can happen:

```text
Workspace menu is open while Select mode is active
↓
user presses Escape once
↓
WorkspaceControls closes workspace menu
↓
selection listener receives same event
↓
Select mode also exits
```

One Escape key press would unexpectedly perform two levels of closing.

## Required plan correction

The Select-mode Escape handler must respect existing event ownership.

At minimum:

```js
if (event.key !== 'Escape') return;
if (event.defaultPrevented) return;
```

It must also check higher-priority active Todo UI before exiting Select mode.

Prefer one explicit selection method such as:

```text
handleSelectionEscape(event)
```

with this order:

1. bulk Date/Tags/Project/Priority picker;
2. selection action panel;
3. only then Select mode;
4. never close an active Task/Subtask/Schedule modal as a side effect.

Existing handlers that own a higher layer should either mark the event handled or the selection handler should detect that layer before acting.

---

# Finding 3 — HIGH — Bulk Date needs exact scheduling invariants, not only “resolve safely”

## What the plan gets right

The plan correctly says Date is a **date-only bulk action** and must not silently overwrite:

- due time;
- reminders;
- Repeat rule.

It also notices that Clear cannot blindly create a strange time/repeat-only state.

## Important real-code difference

The normal Schedule UI has logic that the raw data service does not completely reproduce.

`ScheduleComponent.apply()` does this:

```text
time exists + no date
→ automatically use Today
```

It also validates:

```text
Repeat end date >= task/start date
```

But `AppDataService.updateTask(id, { dueDate })` alone does not enforce all of those UI-level invariants.

`AppDataService.buildTask()` automatically supplies Today for an active Repeat with no date, but it does **not** automatically supply Today merely because an existing `dueTime` remains.

## Failure case A — Clear date on a timed task

Task before:

```text
dueDate = 2026-08-20
dueTime = 03:00 PM
repeat = none
```

Bulk Date → Clear using only:

```js
AppDataService.updateTask(id, { dueDate: null })
```

can leave:

```text
dueDate = null
dueTime = 03:00 PM
```

That is different from the normal Schedule UI rule.

## Failure case B — move repeating task after its Repeat end date

Task:

```text
dueDate = 2026-08-20
repeat end date = 2026-08-25
```

Bulk Date chooses:

```text
2026-09-01
```

The bulk action must not leave a repeat end date that is before the new start date.

## Required plan correction

Define exact bulk-date normalization before the first write.

For every selected task:

```text
chosen date exists
→ use chosen date

Clear + existing dueTime
→ final date = Today

Clear + active Repeat
→ final date = Today

Clear + neither time nor Repeat
→ final date = null
```

Then prevalidate:

```text
if Repeat end.type == date
AND repeat end date < final date
→ reject/report before mutating that task
```

Prefer preflighting the whole date batch before the first durable mutation when possible, so a predictable validation error on task #5 does not occur after tasks #1–4 were already changed.

The bulk Date UI should also be **visibly date-only**. If it reuses the existing Schedule modal, Time/Repeat/Reminder editing must be hidden/disabled in bulk-date mode rather than letting the user edit controls whose changes will be ignored.

---

# Finding 4 — HIGH — Checkbox selection must use one event path or it can toggle twice

## Current task control

`TaskRendererMethods.createTaskCard()` currently uses:

```text
checkbox `change`
→ toggle completion
```

The wrapper separately stops click propagation.

## Risk in the plan wording

Plan ID 5 says conceptually:

```text
change/click → toggle selection only
```

That wording can be implemented incorrectly as both:

```js
checkbox.addEventListener('click', toggleSelection)
checkbox.addEventListener('change', toggleSelection)
```

A normal checkbox click fires both click and change.

Result:

```text
select
→ immediately unselect
```

## Required plan correction

Branch inside the **existing checkbox `change` flow**.

Conceptually:

```js
checkbox.addEventListener('change', async event => {
  if (this.selectionMode) {
    this.setTaskSelected(task.id, checkbox.checked);
    return;
  }

  // existing completion behavior
});
```

Use task-details/card click as the separate larger selection target.

Do not bind a second checkbox click mutation.

---

# Finding 5 — HIGH — Local batch busy state does not prevent Todo AI writes from interleaving

## What the plan already does well

The plan says:

- snapshot selected IDs;
- re-read each task before mutation;
- use one action-level busy state;
- stop a second UI batch from starting;
- handle partial success truthfully.

That is good.

## Remaining concurrency gap

The current shared application also has Todo AI tools.

Those tools can mutate Todo while the persistent Todo iframe remains alive.

A selection batch will normally perform multiple awaited service calls:

```text
update task A
await
update task B
await
update task C
```

The selection action's local `busy` flag prevents another **selection UI** action, but it does not prevent a Todo AI request from being queued between those writes.

Possible sequence:

```text
Bulk Priority starts: A, B, C → High
A becomes High
↓
AI changes B → Low
↓
bulk continues
B becomes High
C becomes High
```

This does not necessarily corrupt IndexedDB because AppDataService serializes individual writes, but the final result can depend on timing and can be confusing to both the user and Gemini.

The risk is larger for hierarchy/delete operations.

## Recommended correction

Add a small **Todo-side mutation coordination rule**.

This does not require ChatUI changes.

Good options:

### Option A — shared Todo mutation guard

Expose a Todo runtime state such as:

```text
TasksComponent.selectionBatchBusy
```

and make the Todo tool executor reject/defer new mutating requests with a stable BUSY error while a manual multi-select batch is actively committing.

Reads may remain allowed after `AppDataService.whenIdle()`.

### Option B — one shared higher-level Todo mutation coordinator

Both manual multi-select and Todo AI acquire the same Todo-local mutation lease before multi-step work.

Do not try to solve this by writing directly to IndexedDB or by bypassing `AppDataService.enqueue()`.

At minimum, the implementation must document the last-write-wins behavior and keep the per-item re-read from the existing plan.

---

# Finding 6 — MEDIUM — Due Date descending/no-date behavior is underspecified

## Current behavior

In `WorkspaceControls.sortTasks()` the scheduled-vs-unscheduled check returns before multiplying by sort direction:

```text
scheduled tasks stay before no-date tasks
```

This is true even when direction is Descending.

For same-date values, the current raw text comparison also gives a specific no-time placement.

## Plan ambiguity

The plan says:

- dated tasks stay ahead of unscheduled tasks **in ascending order**;
- apply ascending/descending correctly;
- preserve current no-time behavior consistently.

That leaves room for two implementations:

```text
Descending → No Date first
```

or:

```text
Descending → No Date still last
```

## Recommended correction

Pin the rule explicitly.

I recommend preserving current product behavior:

```text
No Date is always after dated tasks,
regardless of Ascending/Descending.
```

Within the same date, define exactly where a date-only task belongs relative to timed tasks.

Also make `parseDueTimeMinutes()` defensive. `TaskModel.normalizeTask()` accepts any non-empty dueTime string, so restored/legacy malformed values should not create `NaN` comparator behavior.

Recommended parser contract:

```text
valid 12-hour time → numeric minutes
missing time       → null
invalid time       → null/fallback and stable ordering
```

Do not throw during rendering because one old task has a malformed time string.

---

# Finding 7 — MEDIUM — Container counts can disagree with how many concrete tasks Select All selects

## Why this exists

The renderer is family-based.

`TaskFilter.getDisplayTasks()` may return one root task, while `createTaskFamily(root)` renders:

```text
root
+ all its subtasks
```

The plan correctly says container membership should expand a rendered root into its child task IDs.

But current header counts use display units:

```text
activeTasks.length
group.tasks.length
```

not expanded concrete task-card IDs.

## Example

A Medium group contains:

```text
Parent A + 3 subtasks
Parent B + 1 subtask
```

Current group count can say:

```text
Medium  2
```

but the new selector may select:

```text
6 concrete task IDs
```

## Recommended correction

Define selection-mode count semantics explicitly.

Best option:

- preserve existing normal counts outside Select mode;
- when Select mode is active, container selector/count state should use the concrete expanded ID list;
- if the normal display-unit count remains visible, add a compact selected count so the user is not told `2 tasks` after selecting 6 actual task records.

At minimum, document this difference and test parent/subtask families.

---

# Finding 8 — MEDIUM — Mixed completion states inside a task family need an explicit selection rule

## Current renderer behavior

List/Kanban lane membership is based primarily on the task returned by `TaskFilter`—normally the root display unit.

A root family can render child cards whose own `completed` value differs from the root.

Examples are possible:

```text
active root
└─ completed subtask
```

or:

```text
completed root
└─ subtask later made active
```

## Current plan decision

The plan says a root display unit expands to the root plus all children, so the Active/Completed container selector would select the whole rendered family.

That is internally consistent, but it needs to be explicit because the product wording says things like:

```text
select all Active Tasks
select Completed
```

## Recommended correction

Keep the family-based rule if that is the intended product behavior, but state it clearly:

> Container selection follows the application's existing rendered-family membership, not each child's independent completion property.

Add regression tests for mixed-status families.

If the desired behavior is instead “only tasks whose own `completed` state matches the lane,” change the membership helper before implementation. Do not leave this accidental.

---

# Finding 9 — MEDIUM — The task-details keyboard selection target needs state semantics

## Current card semantics

`.task-details` is currently:

```text
role="button"
tabindex="0"
aria-label="Edit task: ..."
```

The plan correctly changes Enter/Space in Select mode so it toggles selection rather than opening Edit.

## Missing accessibility state

If `.task-details` acts as a second selection control, changing only its label is not enough.

A keyboard/screen-reader user should know whether that task is currently selected.

## Recommended correction

In Select mode:

```text
role="button"
aria-pressed="true|false"
aria-label="Select task: ..." / "Unselect task: ..."
```

Outside Select mode, remove `aria-pressed` and restore existing Edit semantics.

The native circular checkbox remains the primary checkbox state; this simply makes the larger keyboard/click target truthful.

---

# Finding 10 — MEDIUM — Selection circles should visually distinguish selection from completion without changing shape

## Current CSS

`.task-checkbox:checked` uses:

```text
--success-color
```

which visually means Done/completed.

## Product request

The user explicitly wants the same circular shape and does not want a new checkbox shape.

That does **not** require the checked selection state to remain green.

## Recommendation

Keep the exact same round control, but in Select mode consider:

```css
.selection-mode .task-checkbox:checked {
  background: var(--accent-color);
  border-color: var(--accent-color);
}
```

Use the same accent treatment for container select-all circles.

This makes:

```text
green → completion meaning
blue/accent → temporary selection meaning
```

without changing the requested control shape.

This is an improvement, not a blocker.

---

# Finding 11 — MEDIUM — Preflight predictable batch errors before the first mutation

The plan correctly supports partial success because storage can fail mid-batch.

However, predictable validation failures should not unnecessarily create partial state.

Before the first durable write, validate as much of the full target set as possible:

- Project action: selection eligibility and chosen Project existence;
- Link Parent: all selected targets still root/no-children and chosen parent still legal;
- Date: final date/repeat-end invariants;
- Priority: allowed value;
- Tags: target Tag IDs still exist;
- Delete: normalized family targets and confirmation consequence.

After preflight, still re-read each entity immediately before each mutation because data can change asynchronously.

This gives both:

```text
preflight predictable errors first
+
revalidate dynamic state per item
```

and reduces preventable partial batches.

---

# Finding 12 — LOW/MEDIUM — Header refactors must preserve the exact collapse button hooks used by existing code

The plan correctly says not to nest an interactive selector inside the current header buttons.

For the normal Completed section, current code caches:

```text
:scope > .completed-section-toggle
```

inside `ensureCompletedSectionToggle()`.

When changing the static HTML to:

```text
header row
├── selection checkbox
└── collapse button
```

the actual collapse button must still have:

```text
.completed-section-toggle
aria-controls="completed-task-list"
```

and remain a direct element that `ensureCompletedSectionToggle()` can resolve, or that method must be updated deliberately.

The same care is required for dynamic group/Kanban headers so collapse state, `aria-expanded`, chevrons and drag-lane state do not regress.

---

# Finding 13 — LOW/MEDIUM — Empty container selectors need an explicit disabled behavior

A container can exist with zero selectable IDs, especially during transitions/rerenders.

Define:

```text
0 IDs
→ selector unchecked
→ indeterminate false
→ disabled/non-interactive
```

Do not allow an empty container checkbox to appear checked because `every()` on an empty array is mathematically true.

This should be handled in the shared container-state helper.

---

# Finding 14 — LOW — Sort helper should be pure and reused everywhere through `WorkspaceControls.sortTasks()`

The plan correctly fixes `WorkspaceControls.sortTasks()` rather than patching only List rendering.

Keep it that way.

Do not add separate time-sort implementations in:

- List;
- Kanban;
- Groups;
- subtasks.

All those paths already call `WorkspaceControls.sortTasks()`, so one pure parser/comparator fix gives consistent behavior everywhere.

Recommended pure tests:

```text
12:00 AM → 0
01:00 AM → 60
11:59 AM → 719
12:00 PM → 720
12:18 PM → 738
03:57 PM → 957
11:59 PM → 1439
invalid → safe fallback
```

---

# Finding 15 — LOW — Select mode should not be implemented by attaching behavior to arbitrary rendered DOM only

The plan already says not to scrape arbitrary DOM for target IDs. That is correct and important.

Keep the authoritative model as:

```text
selectedTaskIds Set
+
logical container membership derived from AppState/render rows
```

DOM should only display that state.

This is especially important because:

- Tag groups can overlap;
- a root family expands into subtasks;
- subtasks can be collapsed;
- List/Kanban can rerender because of Todo AI changes;
- sort/group/view can change while selection remains active.

No correction needed here; this is a confirmed strong part of the plan.

---

# Important parts of the plan that are already correct

The implementation agent should **not redesign these without a reason**.

## Due Date bug location

Correct location:

```text
WorkspaceControls.sortTasks()
```

Fixing it there automatically affects List, Kanban, groups and subtasks because they already reuse that sorter.

## One selection source of truth

Correct:

```text
selectionMode
selectedTaskIds: Set
```

Do not maintain separate Boolean states in each group/column.

## Existing task circle reused

Correct and matches the request.

Do not add another square checkbox beside every task.

## Exact action layout

Correct:

```text
Done | Date | Priority
Tags | Project | Delete
Link Parent Task
```

No Pin.

## Tag tri-state behavior

Correct:

```text
all have tag   → remove from all
none/some      → add to all
```

while preserving unrelated Tags.

## Done root-family handling

Correctly recognizes that completing a root can complete its subtasks.

Process roots first and re-read selected children afterward so an already-completed child is not toggled back to active.

## Delete family normalization

Correctly avoids separately deleting selected child IDs when their selected root family is already being deleted.

One concise confirmation is appropriate.

## Project/subtask inheritance

Correctly recognizes:

```text
subtasks inherit parent Project
```

A lone selected subtask should not pretend it can receive an independent Project.

## Link Parent eligibility

Correctly mirrors existing Todo rules:

- targets must be roots;
- targets must not already have children;
- selected targets are excluded from parent candidates;
- chosen parent must be an active root;
- revalidate before each link.

## Filter/navigation lifecycle

Correctly exits Select mode when navigating to another Inbox/Today/Completed/Project/Tag target, preventing hidden selections from the previous filter.

## Sort/Group/List/Kanban rerenders

Correctly allows selection to survive presentation-only changes while pruning IDs that are no longer represented.

## Drag conflict

Correctly disables pointer/touch drag while Select mode is active and requires pending/active drag cancellation on entry.

Use the real existing methods:

```text
cancelPendingTaskDrag()
cancelPendingTouchDrag()
cancelTaskDrag()
```

Do not commit a drag while entering Select mode.

## No persistence changes

Correct:

- no new TodoListDB schema/version;
- no saved selected IDs;
- no ChatUI database changes;
- no Shell routing changes.

---

# Recommended plan changes before implementation

Before approving implementation, I recommend updating Implementation Plan ID 5 with these explicit changes:

1. Make the existing `#btn-open-add-task` click handler itself mode-aware; never add a second competing primary-action listener.
2. Define Escape event ownership using `event.defaultPrevented` / higher-layer checks so one Escape does not close two UI layers.
3. Define exact bulk Date normalization for Clear + Time, Clear + Repeat, and Repeat end-date validation.
4. Require one checkbox event path (`change`) in Select mode to prevent click+change double toggling.
5. Add a Todo-side rule for manual multi-select batch vs Todo AI mutation concurrency.
6. Pin Due Date Descending / No Date / no-time / malformed-time behavior explicitly.
7. Clarify selection-mode container counts when a root family expands to multiple task IDs.
8. Explicitly define mixed-status subtask behavior inside Active/Completed family lanes.
9. Add `aria-pressed`/truthful state to the task-details keyboard selection target.
10. Preflight predictable full-batch validation before the first write, while still re-reading dynamically before each mutation.
11. Preserve exact existing collapse hooks when refactoring headers.
12. Define zero-ID container selectors as disabled/unselected, never accidentally checked.

---

# Final recommendation

**Do not discard this implementation plan.**

Its architecture and product interpretation are mostly correct and it is a strong basis for implementation.

The most important improvements are narrow and concrete rather than a redesign:

```text
FAB event ownership
Escape ownership
bulk Date invariants
checkbox event ownership
manual-batch vs AI mutation coordination
exact sort edge-case semantics
```

After those are added, the plan should be safe to implement with much lower regression risk.
