# Implementation Plan ID 5 — To-Do Due-Date Sorting Fix + Multi-Select Mode

## Status

**Plan only. Do not implement until explicitly approved.**

Baseline inspected for this plan:

```text
main @ 189c18b84b7afaa54001436cd027c185c5634609
```

This plan is intentionally **To-Do-only**.

Do not modify ChatUI, Shell routing/RPC, Gemini tools, ChatUI databases, or shared iframe architecture as part of this implementation.

The Todo AI integration may continue to call normal Todo rendering/service methods while this feature exists, but no ChatUI code is part of this plan.

---

# 1. Goals

Implement two Todo improvements:

1. Fix **Due Date sorting** so tasks on the same date are ordered by real clock time instead of lexicographic 12-hour text.
2. Add a complete **multi-select mode** for tasks/subtasks in List and Kanban views.

The multi-select mode must support:

- entering Select mode from the top-right `•••` workspace menu;
- selecting many individual tasks using the **existing circular task checkbox/control**;
- using the task card itself as a convenient selection target while Select mode is active, without opening the editor;
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

## 2.1 Existing task circle becomes the selection control

Do **not** add a second checkbox beside every task.

Normal mode:

```text
circle click
→ toggle completed/active
```

Select mode:

```text
same circle click
→ select/unselect this task
→ no completion mutation
```

The circle keeps the existing visual language.

Its checked state means:

```text
Normal mode → task completed
Select mode → task selected
```

The task card's completed styling still shows whether the underlying task is completed.

## 2.2 Select mode entry

Add a new action to the existing top-right workspace `•••` menu:

```text
Select
```

When Select mode is active, the same menu action can become:

```text
Cancel Selection
```

or equivalent clear wording.

`Escape` should also exit Select mode when no higher-priority modal/menu owns Escape.

## 2.3 Selection-actions layout

While Select mode is active, replace the blue `+` FAB's behavior/icon with a blue `•••` selection-actions FAB.

Clicking it opens a compact panel above the FAB.

Required layout:

```text
┌────────┬────────┬──────────┐
│  Done  │  Date  │ Priority │
├────────┼────────┼──────────┤
│  Tags  │ Project│  Delete  │
└────────┴────────┴──────────┘

[ Link Parent Task ]
```

Use the existing Todo visual/icon language:

- Done → clear check/done icon;
- Date → existing calendar icon;
- Priority → existing flag icon;
- Tags → existing tag icon;
- Project → existing folder/project icon;
- Delete → trash icon;
- Link Parent Task → text label is required because the action is less obvious; an icon is optional but text must remain visible.

Do not add Pin.

## 2.4 Container select-all controls are circles, not text buttons

Do not add ugly `Select All` / `Deselect All` text buttons next to section names.

Use a small circular checkbox/control matching the task-circle style.

Click behavior:

```text
not all tasks in this container selected
→ select all task IDs belonging to this container

all tasks in this container selected
→ unselect all task IDs belonging to this container
```

If only some tasks are selected, show a subtle indeterminate/partial visual state in the same circle.

## 2.5 Every logical visible container gets its own selector

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
  ○ active lane
  ○ Completed

Medium
  ○ active lane
  ○ Completed
```

`Completed` under `High` selects only completed tasks in the High column.
It must not select completed tasks in Medium/Low/None.

The same model applies to Date, Project and Tag grouping.

## 2.6 Selection is temporary UI state

Do not persist selected task IDs to IndexedDB/localStorage.

No database schema change.

Selection exists only in the live Todo iframe/runtime.

---

# 3. Current code findings

## 3.1 Due-date sort bug is confirmed

Current code:

```text
TodoList-ui/js/components/workspace-controls.js
WorkspaceControls.sortTasks()
```

For `sortKey === 'dueDate'`, it currently compares:

```text
`${dueDate}|${dueTime}`
```

as text.

Therefore on the same date:

```text
03:57 PM
06:56 PM
...
12:18 PM
```

can be incorrectly ordered because `03` sorts before `12` even though 12:18 PM is earlier than 3:57 PM.

## 3.2 Existing task control is already suitable

`TaskRendererMethods.createTaskCard()` creates:

```text
input.task-checkbox
+ SVG check icon
```

and currently binds completion directly to its `change` event.

This should be mode-aware rather than replaced.

## 3.3 Current task rendering has several container shapes

Relevant files:

```text
TodoList-ui/js/components/task-renderer.js
TodoList-ui/js/components/task-groups.js
TodoList-ui/js/components/task-kanban.js
TodoList-ui/js/components/task-hierarchy.js
```

Selection membership must follow the same logical rows/families that these renderers create.

## 3.4 Group headers cannot receive a nested checkbox as-is

Current active group header is itself a `<button>`.
Current completed section header is itself a `<button>`.
Current Kanban completed header is itself a `<button>`.

Do not place a checkbox/button inside those buttons.
That would create invalid nested interactive controls and poor keyboard/accessibility behavior.

The implementation must refactor those headers into non-interactive wrappers containing two siblings:

```text
header row
├── circular container selector
└── existing collapse/expand button/content
```

## 3.5 Tag grouping overlaps

A task with multiple Tags can appear in multiple Tag groups.

Therefore one task ID can belong to more than one visible group selector.

Container selectors must derive their state from the central selected-ID Set instead of storing separate Boolean selection state per group.

---

# 4. Recommended module structure

Keep the feature modular and avoid turning `tasks.js` into another large responsibility bucket.

Add:

```text
TodoList-ui/js/components/task-selection.js
TodoList-ui/js/components/task-selection-actions.js
TodoList-ui/js/components/task-selection-menus.js
TodoList-ui/css/components/task-selection.css
```

Recommended responsibilities:

## `task-selection.js`

Owns:

```text
selectionMode
selectedTaskIds: Set
enter/exit/toggle selection
pruning stale IDs
card selection state
container select-all state
FAB mode switch
workspace-menu Select/Cancel Selection state
```

## `task-selection-actions.js`

Owns batch persistence coordination:

```text
Done
Date
Priority
Tags
Project
Delete
Link Parent Task
```

It should use existing `AppDataService` methods rather than writing AppState/IndexedDB directly.

## `task-selection-menus.js`

Owns the selection-action panel and the temporary Date/Priority/Tag/Project pickers.

Do not reuse the Task editor's mutable draft fields such as:

```text
TasksComponent.selectedPriority
TasksComponent.selectedProject
TasksComponent.selectedTags
```

Those belong to the create/edit modal.

Bulk selection controls need independent transient state so opening a bulk Tag/Project/Priority picker can never corrupt an open editor draft.

## `task-selection.css`

Own only selection-specific styles:

```text
selection-mode card state
container selection circle
indeterminate state
selection action FAB
2x3 action panel
Link Parent Task text action
bulk popovers
mobile positioning
```

Import it from `TodoList-ui/index.html` with the other Todo component CSS files.

---

# 5. Compose selection behavior into `TasksComponent`

Modify:

```text
TodoList-ui/js/components/tasks.js
```

Import the selection method objects and compose them into `TasksComponent` like the current Task renderer/drag/group modules.

During `TasksCore.init()` initialize selection after required DOM references exist.

Suggested order:

```text
render menus
init task actions
init hierarchy
init drag
init selection
bind normal editor events
render
```

Selection methods must be available to renderers before the first user interaction.

---

# 6. Fix Due Date sorting correctly

Modify:

```text
TodoList-ui/js/components/workspace-controls.js
```

Do not compare `hh:mm AM/PM` as raw text.

Add a small pure helper, conceptually:

```text
parseDueTimeMinutes("12:18 PM") → 738
parseDueTimeMinutes("03:57 PM") → 957
parseDueTimeMinutes("12:00 AM") → 0
parseDueTimeMinutes("12:00 PM") → 720
```

Algorithm:

```text
hour 12 → 0 before applying AM/PM
PM      → +12 hours
minutesSinceMidnight = hour * 60 + minute
```

For Due Date sorting:

1. tasks with a date remain ahead of unscheduled tasks in ascending order, preserving current product behavior;
2. compare ISO `YYYY-MM-DD` first;
3. when dates match:
   - preserve current no-time behavior consistently;
   - compare real numeric minutes for tasks that have times;
4. preserve stable input order for equal date/time values;
5. apply existing ascending/descending direction correctly.

Do not mutate stored task values.

### Required regression cases

Same day ascending:

```text
12:18 PM
03:57 PM
06:56 PM
07:46 PM
08:01 PM
08:11 PM
08:15 PM
```

Also verify:

```text
12:00 AM < 01:00 AM
11:59 AM < 12:00 PM
12:59 PM < 01:00 PM
11:59 PM is last timed value of the day
```

Different dates still sort by date before time.

---

# 7. Central selection state

Use one authoritative state:

```js
selectionMode: false
selectedTaskIds: new Set()
```

Never maintain independent selection copies in List/Kanban/group components.

Required methods conceptually:

```text
isSelectionMode()
enterSelectionMode()
exitSelectionMode()
isTaskSelected(taskId)
toggleTaskSelection(taskId)
selectTaskIds(ids)
unselectTaskIds(ids)
setContainerSelection(ids)
getSelectionCount()
pruneSelection()
syncSelectionUi()
```

## Enter mode

On entry:

- close workspace menu/settings submenu;
- close task action/context menus;
- cancel any pending task drag/touch-drag;
- cancel an active drag safely before changing rendering;
- set `selectionMode=true`;
- start with an empty `selectedTaskIds` Set;
- rerender/sync cards and container controls;
- change FAB from `+` to `•••` selection-actions mode.

## Exit mode

On exit:

- close all bulk menus/action panel;
- clear selected IDs;
- restore normal checkbox completion state;
- restore normal card click/edit behavior;
- restore FAB `+` behavior/icon/ARIA;
- rerender/sync once.

---

# 8. Individual task selection

Modify:

```text
TodoList-ui/js/components/task-renderer.js
```

Inside `createTaskCard()`:

## Normal mode

Preserve current behavior exactly:

```text
checkbox.checked = task.completed
change → AppDataService.toggleTaskStatus(task.id)
```

## Select mode

Use:

```text
checkbox.checked = selectedTaskIds.has(task.id)
change/click → toggle selection only
```

Do not call `AppDataService` when merely selecting.

Change ARIA text appropriately:

```text
Select task: <title>
Unselect task: <title>
```

The task card keeps `.completed` if the task itself is completed, even if the selection circle is unchecked.

## Card-body behavior in Select mode

While Select mode is active:

- clicking/tapping the task details/card toggles selection instead of opening Edit;
- Enter/Space on the task's task-details selection target toggles selection;
- individual task `•••` action buttons should be hidden or non-interactive in Select mode;
- subtask edit opening is suppressed in Select mode.

This makes multi-select practical on mobile without adding more controls.

---

# 9. Disable drag/reparent gesture while Select mode is active

Modify the task drag entry guards in:

```text
TodoList-ui/js/components/task-drag.js
TodoList-ui/js/components/task-drag-touch.js
```

At the earliest drag-target/pointer/touch entry point:

```text
if TasksComponent.selectionMode
→ do not begin drag
```

When entering Select mode:

```text
cancel pending drag
cancel active drag safely
```

Reason:

Selection tap/long-press and drag long-press cannot own the same gesture reliably.

Do not remove drag functionality from normal mode.

---

# 10. Define logical container membership once

Do not discover batch targets by scraping arbitrary DOM after rendering.

Create helper(s) that expand the same data rows used by the renderer into concrete task IDs.

Conceptually:

```text
expandRenderedTaskIds(rows)
```

Rules:

- root display unit includes its root card plus the child cards that `createTaskFamily()` renders;
- standalone filtered subtask includes only that subtask;
- deduplicate IDs inside one container;
- collapsed subtasks still belong to the logical rendered family/container because collapse is presentation only;
- selector state is based on task IDs, not DOM node count.

This keeps selection correct after rerender, on mobile, and when group sections are collapsed.

---

# 11. List-view container selectors

## Group=None — Active Tasks

The Active Tasks section currently has a header that can be hidden in normal presentation.

In Select mode, ensure the Active Tasks header is visible and includes:

```text
○  Active Tasks                         N tasks
```

The circle selects exactly the logical task IDs represented in the active section.

When leaving Select mode, return the header to its existing normal visibility behavior.

## Completed section

Refactor its current all-in-one collapse `<button>` into:

```text
completed header row
├── selection circle (Select mode only)
└── collapse button
    ├── Completed
    ├── count
    └── chevron
```

Clicking the circle must **not** collapse/expand Completed.
Clicking the normal completed header/collapse area must **not** change selection.

The completed selector remains available even if the list is visually collapsed.

---

# 12. Grouped List selectors

Modify:

```text
TodoList-ui/js/components/task-groups.js
TodoList-ui/css/components/task-groups.css
```

Refactor every group header from one interactive button into a row with:

```text
○ | collapse/expand group label + count
```

Selector selects only IDs represented in that group.

Required for:

```text
Priority
Date
Project
Tag
```

Example:

```text
○ None      3
○ Low       5
○ Medium    4
○ High      2
```

The global Completed list remains its own independent selector in List view because current List rendering does not place completed tasks inside each active group.

---

# 13. Kanban selectors

Modify:

```text
TodoList-ui/js/components/task-kanban.js
TodoList-ui/css/components/task-kanban.css
```

Each Kanban column has two independent selectable lanes:

```text
active lane
completed lane
```

For grouped Kanban, the column heading should expose the active-lane circle cleanly without changing the grouping label.

Conceptually:

```text
○ High
  [active cards]

○ Completed  3   ▾
  [completed cards]
```

The Completed header must be refactored so selection and collapse are separate interactive siblings—never nested buttons.

For Group=None, create a small unobtrusive `Active` lane header only in Select mode so there is a place for its container circle.

### Exact required behavior

If the High column contains five completed tasks:

```text
click High → Completed circle
→ select those five completed High tasks only
```

It must not select:

- High active tasks;
- Medium completed tasks;
- completed tasks in any other column.

---

# 14. Container circle state

Every container selector derives state from its task-ID list and the global `selectedTaskIds` Set.

For container IDs `C`:

```text
selectedCount = count(id ∈ C where selectedTaskIds has id)
```

State:

```text
selectedCount === 0
→ unchecked

0 < selectedCount < C.length
→ indeterminate/partial

selectedCount === C.length
→ checked
```

Click:

```text
checked/all selected
→ remove every C ID from global selection

unchecked or indeterminate
→ add every C ID to global selection
```

This is especially important for Tag grouping because the same task may appear in multiple Tag groups.

A Tag group circle becoming partial because one overlapping task was selected through another Tag group is correct behavior.

---

# 15. FAB switching

Reuse the existing:

```text
#btn-open-add-task
```

Do not create two floating buttons occupying the same place.

Normal mode:

```text
+ icon
aria-label="Add Task"
click → open Task creation modal
```

Select mode:

```text
••• icon/text
aria-label="Selected task actions"
click → open batch action panel
```

When selection count is zero:

- keep the button visible so the mode is understandable;
- it may be disabled/dimmed until at least one task is selected;
- it must never open the normal Add Task modal while Select mode is active.

When at least one task is selected, the action panel should show the count in a compact label such as:

```text
5 selected
```

without changing the requested action-grid layout.

---

# 16. Batch action panel

Add one Todo-owned panel near the FAB in `TodoList-ui/index.html`.

Recommended semantics:

```text
role="dialog" or menu-like popover
```

Use a dialog/popover role if nested Priority/Tag/Project controls are interactive rather than pretending the whole surface is one flat ARIA menu.

Required visual structure:

```text
5 selected

[✓ Done] [📅 Date] [⚑ Priority]
[Tag]    [Folder Project] [Trash Delete]

[ Link Parent Task ]
```

The first six actions are compact equal-width action cells.

`Link Parent Task` is a separate text action across the width below the grid.

Panel should:

- open upward/left from FAB as needed;
- remain within Todo iframe viewport;
- work above the shared mobile bottom nav;
- close on outside click and Escape;
- return focus to FAB when keyboard-opened/closed;
- never open the Add Task modal.

---

# 17. Batch execution rules

All mutations go through existing Todo services.

Do not write directly to `AppState` or IndexedDB from selection modules.

Snapshot selected IDs at action start:

```text
const targetIds = [...selectedTaskIds]
```

Then re-read each task from `AppState` before mutating because another Todo operation/AI tool may have changed data since the task was selected.

Use one action-level busy state:

- temporarily disable action controls while applying;
- prevent a second batch action from starting concurrently;
- reconcile/rerender once at the end whenever practical;
- if a mid-batch storage error occurs, report accurately and preserve remaining selection so the user can see/retry intentionally.

Do not silently claim all selected tasks changed when only some succeeded.

---

# 18. Done action

Meaning:

```text
make selected tasks Done/completed
```

It is **not** a generic toggle.

For every selected ID:

```text
if task no longer exists → prune/skip
if already completed     → no-op
if active                → AppDataService.toggleTaskStatus(id)
```

### Parent + selected child

Todo completion semantics already complete a root family together.

Therefore process selected root tasks before selected subtasks, and always re-read each later selected task before toggling.

Example:

```text
Root A selected
Child A1 selected

complete Root A
→ Child A1 becomes completed through family semantics

later process Child A1
→ already completed
→ skip
```

Never toggle it back to active.

### Repeat

Preserve existing Repeat behavior:

```text
completing repeating occurrence
→ old occurrence completed
→ next occurrence may be created with a new ID
```

The new occurrence is not automatically added to the current selection.

---

# 19. Date action

The requested action is **Date**, not a hidden full replacement of every task's Schedule fields.

Reuse the existing Calendar/Schedule visual system, but add a safe bulk date-only entry point.

Recommended change in:

```text
TodoList-ui/js/components/schedule.js
```

Add an additive wrapper/mode such as:

```text
openDateOnly(initialDate, onApply, focusPolicy)
```

or equivalent.

In bulk Date mode:

- show the Date calendar/quick actions;
- do not let a bulk Date action silently replace dueTime, reminders, or Repeat rules;
- callback returns only the chosen `dueDate`/clear intent.

Initial date:

```text
all selected tasks share same dueDate → show that date
mixed dueDate values                 → no selected date/mixed state
```

Apply chosen date to every selected task with:

```text
AppDataService.updateTask(id, { dueDate: chosenDate })
```

### Clear-date invariant

Preserve current Todo scheduling semantics.

If user chooses Clear on a task that still has:

```text
active Repeat
or dueTime
```

resolve the final date safely so Todo does not end with an invalid/strange time/repeat-only state.

Match the normal Schedule behavior:

```text
Repeat requires a date → Today
Time requires a date   → Today
```

Do not change each task's existing time/reminders/repeat just because a date was applied.

---

# 20. Priority action

Open a compact Priority picker using the existing Todo priority names/styles:

```text
None
Low
Medium
High
```

One click applies the desired final priority to every selected task through:

```text
AppDataService.updateTask(id, { priority })
```

Works for root tasks and subtasks.

Do not reuse `TasksComponent.selectedPriority` editor state.

---

# 21. Tags action

Tags are multi-valued and selected tasks can start with different Tag sets.

Do not implement bulk Tags as “replace every selected task with the first task's tags.”

Use the existing `TaxonomyOrder` hierarchy and Tag menu visual language with independent bulk state.

For each Tag, derive:

```text
none of selected tasks have tag
some selected tasks have tag
all selected tasks have tag
```

Use a tri-state/check presentation.

Click behavior:

```text
all have Tag
→ remove this Tag from all selected tasks

none/some have Tag
→ add this Tag to all selected tasks
```

Preserve every unrelated Tag on each task.

For each affected task:

```text
AppDataService.updateTask(id, { tags: nextTagIds })
```

Use `TaxonomyOrder.getChildren()` / `flattenTree('tag')` ordering so the bulk picker matches the rest of Todo.

Works for roots and subtasks.

---

# 22. Project action

Use existing Project hierarchy/order and Inbox option.

Important Todo rule:

```text
Subtasks inherit their parent Project.
```

Therefore do not pretend a standalone subtask Project can be changed independently.

Recommended safe rule:

1. Selected root tasks are valid Project targets.
2. If a selected subtask's root parent is also selected, the subtask is covered by the root Project update and does not need a separate write.
3. If the selection contains a subtask whose root parent is **not** selected, disable Project for that selection and show a short reason:

```text
Subtasks inherit their parent Project.
```

This avoids unexpectedly changing a parent/sibling family merely because one subtask was selected.

For each selected root:

```text
AppDataService.updateTask(rootId, { project })
```

Existing service behavior propagates the root Project to its children.

Inbox means:

```text
project: ''
```

---

# 23. Delete action

Use existing family deletion semantics.

Normalize selected IDs before deletion:

- if a selected root is being deleted, its selected child IDs do not require separate deletion calls;
- root deletion removes its family using `AppDataService.deleteTaskFamily(rootId)`;
- selected child without selected root can be deleted individually through the same service;
- process/re-read each ID so descendants already removed by a root deletion are skipped instead of producing false errors.

Because this is a destructive bulk UI action, show one concise confirmation before persistence.

The confirmation should state the real consequence when selected roots have subtasks, for example:

```text
Delete the selected tasks?
Parent tasks will also delete their subtasks.
```

Do not show one confirmation per task.

After successful delete:

- remove deleted IDs from selection;
- prune missing descendants;
- rerender once;
- if no selected IDs remain, Select mode may remain active with zero selected until the user exits, but the action FAB becomes disabled.

---

# 24. Link Parent Task action

Use a clear text action:

```text
Link Parent Task
```

Do not use an icon-only control for this action.

The v1 bulk action should mirror the existing normal `Link to Parent` rule rather than inventing arbitrary hierarchy transformations.

### Selection eligibility

Enable Link Parent Task only when every effective selected target is:

```text
root task
AND has no subtasks
```

If selection includes:

- an existing subtask;
- a root that already owns subtasks;

show/disable with a concise reason rather than partially linking only some selection.

### Candidate parent picker

Candidate parent tasks must be:

```text
root
not completed
not one of selected target IDs
```

Use the same ordering as `TasksComponent.getEligibleParentTasks()`.

### Apply

For each selected task, revalidate immediately before mutation then call:

```text
AppDataService.linkTaskToParent(taskId, chosenParentId)
```

Do not add bulk Unlink in this plan; it was not requested.

---

# 25. Selection lifecycle across renders and external Todo changes

The Todo iframe remains alive and other Todo operations, including the existing AI Todo tool, may cause `TasksComponent.render()` while Select mode is active.

The selection feature must survive harmless rerenders.

After every render in Select mode:

1. derive the currently selectable/rendered logical task IDs for the current Todo view;
2. remove selected IDs that no longer exist or are no longer represented in the current filter/view;
3. rebuild card checked state;
4. rebuild every container selector state;
5. update the selected count/FAB enabled state.

Do not modify ChatUI to accomplish this.

## Navigation/filter changes

When the user navigates to another Inbox/Today/Completed/Project/Tag target through the Todo sidebar, exit Select mode and clear selection before rendering the new target.

This prevents invisible selected tasks from one filter being edited from another filter.

## Sort / Group / List / Kanban changes

These change presentation of the same current Todo target.

Selection may remain active and selected IDs may remain selected, provided they are still represented after rerender.

Recompute all container-circle state after the change.

## Shared app switch

Do not exit Select mode merely because the Shell hides the Todo iframe and shows ChatUI.

Both iframes are persistent; when the user returns to Todo, selection may still be present unless Todo data changes pruned it.

---

# 26. Collapse/expand behavior

Selection and collapse are independent.

- Clicking a group/container select circle must not expand/collapse it.
- Clicking the group's chevron/header collapse button must not change selection.
- A collapsed group's logical tasks can still be selected by its group circle.
- If a group is fully selected then collapsed, the circle remains checked.
- If external data removes tasks, recompute state.

This applies to:

```text
List Completed
List grouped sections
Kanban Completed per column
```

---

# 27. Workspace menu changes

Modify:

```text
TodoList-ui/index.html
TodoList-ui/js/components/workspace-controls.js
TodoList-ui/css/components/workspace-menu.css
```

Add one standard menu action under the existing View / Sort & Group controls.

Conceptually:

```text
View
[ List ] [ Kanban ] [ Timeline ]
────────────
Sort & Group   ›
────────────
Select
```

While active:

```text
Cancel Selection
```

`WorkspaceControls` should delegate to `TasksComponent.enterSelectionMode()` / `exitSelectionMode()` rather than owning selected IDs itself.

Keep selection state in Tasks/selection component because it is task UI state, not a persistent workspace setting.

---

# 28. Avoid editor/action conflicts

Before entering Select mode:

- do not force-close an unsaved Task/Subtask edit modal unexpectedly;
- if a task editor modal is active, either disable the workspace Select command until the modal closes or close only transient menus and refuse entry.

Recommended: **do not enter Select mode while a Task/Subtask/Schedule modal is active**.

While Select mode is active:

- Add Task modal cannot open from FAB;
- task detail click cannot open edit;
- task task-action `•••` is unavailable;
- drag is unavailable;
- Schedule opens only when the user chooses the bulk Date action.

Project/Tag sidebar editing remains separate, but changing the current filter should exit Select mode as section 25 specifies.

---

# 29. UI synchronization after a batch action

Avoid rendering after every single selected task when possible.

Existing AppDataService methods update AppState after each durable write.

At action level:

```text
perform sequential writes
→ one final TasksComponent.render()/refreshAfterTaskMutation()
→ SidebarComponent.updateCounts()
→ prune selection
→ sync action count/container selectors
```

For Project changes, Tag changes, Date, Priority and Done, use one final Todo task UI reconciliation.

If a selected action can affect the current filter so tasks disappear (for example Done while viewing active Inbox/Today), the final render/prune must remove those now-hidden IDs from selection.

Do not keep hidden stale selections.

---

# 30. Error/partial-success behavior

Bulk UI actions are multiple durable service calls; there is no global IndexedDB transaction across all selected tasks today.

Therefore be truthful on failure.

Pattern:

```text
succeeded IDs
failed ID + error
unattempted IDs
```

User-facing error can remain concise, but internal result/state must know what happened.

On failure:

- never roll AppState backward manually;
- rerender from authoritative AppState;
- leave uncompleted/unmodified remaining tasks selected so user can retry intentionally;
- remove IDs that were deleted/disappeared;
- report error through existing `AppPersistence.reportError()`.

Do not execute a failed batch again automatically.

---

# 31. Accessibility

Selection mode must remain keyboard-usable.

Requirements:

- existing task circle remains a real checkbox;
- its label changes from completion to selection meaning in Select mode;
- container circles are real checkbox controls with meaningful labels such as:
  - `Select all active tasks`
  - `Unselect all Medium tasks`
  - `Select completed tasks in High`
- set `.indeterminate = true` for partial groups and expose mixed state where appropriate;
- do not nest interactive controls inside buttons;
- action FAB has correct `aria-expanded` when panel is open;
- action panel nested pickers receive sensible focus;
- Escape closes inner picker → batch panel → selection mode in that order;
- focus returns to a sensible connected control after rerender.

Do not remove existing focus-visible styles.

---

# 32. Mobile behavior

The feature must be designed for the embedded Todo iframe on phone.

Required:

- selection action FAB remains above the mobile bottom nav/safe area exactly like current Add FAB;
- action panel must open upward and stay inside viewport;
- three equal columns must fit narrow screens;
- Link Parent Task text row stays readable;
- tapping a task card in Select mode should be an easy target;
- no long-press drag can accidentally begin while selecting;
- container selector circles must have at least a practical touch hit area even if the visible circle stays 22px;
- Kanban horizontal scrolling still works while Select mode is active;
- selecting a task must not accidentally trigger card edit or checkbox completion.

---

# 33. CSS details

Reuse current variables:

```text
--accent-color
--bg-secondary
--bg-hover
--border-color
--border-subtle
--text-primary
--text-secondary
--text-muted
--danger-color
--success-color
```

Do not introduce a separate visual theme.

Recommended selection card state:

- subtle accent border/ring/background only;
- do not overpower priority/date badges;
- completed task strike-through remains visible;
- selected state must be visible in both dark and light themes.

Container selection circle should visually match `.task-checkbox` rather than a new square checkbox style.

Delete action uses danger styling.

---

# 34. No persistence/schema changes

Do not change:

```text
TodoListDB version/schema
ChatUI_DB
Todo task record shape
Project/Tag record shape
Shell messages
ChatUI Todo tool declarations
```

Selected IDs and Select mode are runtime-only UI state.

---

# 35. Interaction with Todo AI implementation

No ChatUI code changes are in scope.

However current Todo AI mutations can invoke Todo UI reconciliation while the iframe is hidden or visible.

The new Todo selection renderer must therefore be defensive:

```text
AI updates selected task
→ task remains selected if still represented in current Todo view

AI deletes selected task
→ selected ID is pruned

AI changes task so it leaves current filter
→ selected ID is pruned after render
```

Do not make Todo AI executor aware of Select mode unless a concrete runtime conflict is discovered during implementation.

Selection state should simply reconcile from authoritative AppState after existing renders.

---

# 36. Files expected to change

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
TodoList-ui/css/layout/workspace-layout.css
TodoList-ui/css/components/workspace-menu.css
TodoList-ui/css/components/task-groups.css
TodoList-ui/css/components/task-kanban.css
```

New:

```text
TodoList-ui/js/components/task-selection.js
TodoList-ui/js/components/task-selection-actions.js
TodoList-ui/js/components/task-selection-menus.js
TodoList-ui/css/components/task-selection.css
```

Potentially adjust:

```text
TodoList-ui/css/components/task-cards.css
scripts/verify-integration.mjs or a new Todo pure-JS verification script
.github/workflows/iframe-integration-check.yml
```

Only adjust the verification workflow if new modules need syntax/static checks.

---

# 37. Implementation phases

## Phase 1 — Due Date sorting fix

1. Add pure 12-hour-time → minutes helper.
2. Replace text-time comparison in `sortTasks()`.
3. Verify AM/PM/no-time/different-date/direction cases.
4. Do not touch persistence.

## Phase 2 — Selection state foundation

1. Add `task-selection.js`.
2. Add runtime Set and mode lifecycle.
3. Add workspace `Select` entry.
4. Make existing card checkbox mode-aware.
5. Change card click behavior in Select mode.
6. Disable/cancel drag while selecting.

## Phase 3 — List container selectors

1. Active section selector.
2. Refactor Completed header into separate selector + collapse control.
3. Refactor grouped active headers.
4. Implement partial/full selector state.

## Phase 4 — Kanban selectors

1. Add active-lane selector per column.
2. Refactor each completed header.
3. Add Group=None Active label only in Select mode.
4. Verify column-local Completed selection.

## Phase 5 — Selection FAB/action panel

1. Reuse existing FAB.
2. Implement mode/icon/ARIA switching.
3. Add 2x3 panel.
4. Add Link Parent Task text action.
5. Add selected count and focus/outside-click behavior.

## Phase 6 — Bulk Priority/Tags/Project/Date pickers

1. Priority single-choice picker.
2. Tags tri-state add/remove picker.
3. Project hierarchy picker with Inbox and subtask eligibility logic.
4. Add Schedule date-only mode.

## Phase 7 — Batch persistence actions

1. Done desired-state logic.
2. Date updates.
3. Priority updates.
4. Tag updates.
5. Project root-family updates.
6. Delete normalization + one confirmation.
7. Link Parent validation + service calls.
8. One final render/count reconciliation.

## Phase 8 — Lifecycle and cross-render hardening

1. Sidebar filter change exits selection.
2. Sort/group/view rerender preserves valid selections.
3. External/AI Todo render prunes invalid/hidden selection IDs.
4. Escape/focus cleanup.
5. Mobile safe-area positioning.

## Phase 9 — Verification

Run static/syntax/pure-JS verification only.

No headless Chrome requirement.

The user performs browser interaction testing.

---

# 38. Manual verification matrix

## Due Date sorting

- same day: 12:18 PM before 03:57 PM;
- 12:00 AM before 01:00 AM;
- 11:59 AM before 12:00 PM;
- 12:59 PM before 01:00 PM;
- ascending and descending;
- different dates;
- date-only tasks;
- unscheduled tasks.

## Enter/exit Select mode

- open top-right `•••` → Select;
- normal completion circle becomes selection circle behavior;
- task completion data does not change when selecting;
- task body toggles selection instead of editing;
- task action `•••` unavailable;
- FAB changes `+` → `•••`;
- Cancel Selection/Escape restores everything.

## List, no grouping

- select one Active task;
- Active circle becomes partial;
- Active circle selects all active tasks;
- click again unselects all active tasks;
- Completed selector affects completed only;
- collapsed Completed selector still works.

## List grouping

Test each:

```text
Priority
Date
Project
Tag
```

For every group:

- its circle selects only that group's logical cards;
- partial state works;
- collapse remains independent;
- Tag overlap does not corrupt global selection.

## Kanban

- each column active selector is local;
- each column Completed selector is local;
- High Completed does not select Medium Completed;
- Group=None has usable Active/Completed selectors;
- horizontal scrolling still works.

## Subtasks

- select parent only;
- select subtask only;
- select parent + subtask;
- collapsed subtask family and parent container selector;
- standalone filtered subtask;
- Done never reactivates a child already completed through parent completion.

## Done

- one active task;
- mixed active/completed selection;
- parent family;
- repeating task creates next occurrence without selecting it.

## Date

- all same date;
- mixed dates;
- apply date;
- clear date;
- task with existing time;
- task with active Repeat;
- other schedule fields are preserved.

## Priority

- None/Low/Medium/High;
- roots and subtasks;
- selected tasks can disappear/reorder under Priority sorting/grouping without stale selection.

## Tags

- tag on none/some/all selected tasks;
- add tag to all;
- remove tag from all;
- unrelated tags preserved;
- nested Tag hierarchy order.

## Project

- root tasks only;
- Inbox;
- Project/subproject;
- parent Project propagation to children;
- lone selected subtask disables Project with clear reason;
- selected parent + selected child does not duplicate writes.

## Delete

- selected root;
- selected child;
- root + its selected child;
- multiple roots;
- parent with unselected subtasks confirms family deletion once;
- partial storage failure leaves authoritative UI.

## Link Parent Task

- multiple eligible root tasks;
- selected target cannot be chosen as parent;
- completed parent not offered;
- selection containing subtask disabled;
- selection containing root with children disabled;
- successful links preserve normal hierarchy rules.

## Mode/lifecycle

- change List ↔ Kanban during Select mode;
- change Sort during Select mode;
- change Group during Select mode;
- change sidebar filter exits Select mode;
- switch Todo → Chat → Todo and selection remains live;
- external Todo AI mutation causes render and stale IDs are pruned.

## Mobile

- task tap selection;
- no accidental edit;
- no long-press drag;
- FAB above bottom nav;
- action grid fits screen;
- Date/Tag/Project/Priority pickers stay onscreen;
- Kanban scroll + selection.

---

# 39. Non-regression requirements

Do not break:

- normal single-task completion checkbox behavior outside Select mode;
- Repeat-aware completion;
- parent completion family semantics;
- Add Task FAB/modal outside Select mode;
- Task/Subtask editor keyboard continuity;
- Task drag/drop outside Select mode;
- Project/Tag taxonomy drag;
- List/Kanban rendering;
- Group By behavior;
- Custom task ordering;
- existing Project/Tag menu ordering;
- embedded Todo iframe behavior;
- standalone `TodoList-ui/index.html` behavior;
- Todo AI tool integration;
- `TodoListDB` persistence.

---

# 40. Acceptance criteria

Implementation is complete only when all of the following are true:

1. Due Date sorting uses real clock time and fixes the demonstrated `12:18 PM` ordering error.
2. Workspace `•••` contains Select.
3. Existing task circle selects tasks instead of changing completion while Select mode is active.
4. Multiple tasks/subtasks can be selected.
5. Every requested List/Kanban logical container has its own circular select-all control.
6. Container circle toggles all/none and supports partial state.
7. Group-specific Completed selection in Kanban affects only that group.
8. FAB changes from `+` to selection `•••` while selecting.
9. Action panel is exactly based on:

```text
Done | Date | Priority
Tags | Project | Delete
Link Parent Task
```

10. No Pin action exists.
11. Priority/Tag/Project/Date UI reuses Todo's visual language without sharing Task editor draft state.
12. Batch Done is desired-state completion, never blind toggling.
13. Batch Tags preserve unrelated tags.
14. Batch Project respects subtask Project inheritance.
15. Delete handles root+child selection without duplicate deletion.
16. Link Parent Task respects current one-level hierarchy rules.
17. Selection is runtime-only; no DB schema change.
18. Drag/edit/completion gestures do not conflict with Select mode.
19. Selection remains correct after rerenders and prunes stale/invisible IDs.
20. Normal Todo behavior is unchanged after leaving Select mode.
21. No ChatUI or Shell runtime code is modified for this feature.
22. No headless-browser test requirement is added.

---

# 41. Recommended implementation order for the next agent

Do not begin with the action panel.

The safest order is:

```text
Due Date comparator
→ selection state
→ individual circle/card selection
→ drag/editor guards
→ List container membership/selectors
→ Kanban membership/selectors
→ FAB/action panel
→ Priority/Tags/Project/Date pickers
→ batch mutations
→ lifecycle pruning
→ CSS/mobile/accessibility polish
→ static/manual verification
```

This order makes selection semantics correct before destructive batch actions are connected.
