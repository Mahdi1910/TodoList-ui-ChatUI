# Implementation Review ID 3 — Actual ChatUI → Todo AI Tool Implementation

## Purpose

This document reviews the **implemented runtime feature**, not the wording of `Implementation Plan ID 3`.

The audit traces the real code path:

```text
Gemini function call
→ ChatUI custom-function registry
→ Chat Todo bridge/replay protection
→ Shell same-origin RPC + auto-wake
→ Todo embedded bridge
→ TodoToolExecutor
→ existing AppDataService / hierarchy / taxonomy / repeat logic
→ TodoListDB + AppState
→ Todo UI reconciliation
→ result back through Shell → ChatUI → Gemini
```

The review looks for:

- wrong final Todo data;
- duplicate or delayed mutations;
- incorrect hierarchy/order behavior;
- partial-mutation reporting problems;
- stale editor/manual-interaction conflicts;
- iframe/reload/timeout/cancel problems;
- wrong read/query semantics;
- misleading tool results/activity UI;
- privacy/error-boundary issues;
- testing gaps;
- maintainability improvements.

No runtime code is changed by this review.

---

# Review baseline

Current `main` reviewed at:

```text
2404e8cdf828553baf4f8c30af272a31f79b6928
```

Implementation PR:

```text
PR #4 — Add ChatUI Todo AI tools
feature head: b12857ae91a28a1869ec84fc9a39d189f8329a47
merge commit: 2404e8cdf828553baf4f8c30af272a31f79b6928
```

The PR's `Iframe Integration Check` completed successfully on the final feature head.

Important implementation files reviewed include:

```text
Shell
shell/js/frame-manager.js
shell/js/frame-bridge.js
shell/js/protocol.js
shell/js/app-shell.js

ChatUI
ChatUI/js/todo/todo-tool-definitions.js
ChatUI/js/todo/todo-tool-executor.js
ChatUI/js/todo/todo-bridge-client.js
ChatUI/js/todo/todo-mutation-replay-guard.js
ChatUI/js/tools/function-tool-registry.js
ChatUI/js/tools/custom-tool-provider.js
ChatUI/js/tools/custom-tool-generation-context.js
ChatUI/js/chat/streaming.js
ChatUI/js/chat/regenerate.js
ChatUI/js/chat/generation-runner.js
ChatUI/js/chat/activity-timeline.js
ChatUI/js/api/gemini.js
ChatUI/js/composer/composer.js
ChatUI/js/embedded/shell-bridge.js
ChatUI/js/state/store.js
ChatUI/js/storage/load.js
ChatUI/js/storage/records.js
ChatUI/html/main-chat.html
ChatUI/html/right-sidebar.html

Todo
TodoList-ui/js/tools/todo-tool-registry.js
TodoList-ui/js/tools/todo-tool-normalizers.js
TodoList-ui/js/tools/todo-tool-read-selectors.js
TodoList-ui/js/tools/todo-tool-ui-guard.js
TodoList-ui/js/tools/todo-tool-ui-sync.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/embedded/shell-bridge.js
TodoList-ui/js/app-main.js
TodoList-ui/js/state.js
TodoList-ui/js/state-sync.js
TodoList-ui/js/task-filter.js
TodoList-ui/js/taxonomy-order.js
TodoList-ui/js/storage/data-service.js
TodoList-ui/js/storage/data-service-hierarchy.js
TodoList-ui/js/storage/data-service-drag.js
TodoList-ui/js/storage/data-service-taxonomy.js
TodoList-ui/js/storage/data-service-taxonomy-drag.js
TodoList-ui/js/storage/data-service-reminders.js
TodoList-ui/js/components/tasks.js
TodoList-ui/js/components/subtask-editor.js
TodoList-ui/js/components/task-renderer.js
TodoList-ui/js/components/task-kanban.js
TodoList-ui/js/components/task-groups.js
TodoList-ui/js/components/task-drag.js
TodoList-ui/js/components/task-drag-commit.js
TodoList-ui/js/components/sidebar-taxonomy-core.js
TodoList-ui/js/components/sidebar-taxonomy-drag.js
TodoList-ui/js/components/workspace-controls.js
TodoList-ui/js/components/schedule.js

Verification
scripts/verify-integration.mjs
scripts/verify-todo-tools.mjs
.github/workflows/iframe-integration-check.yml
```

---

# Overall verdict

The implementation has a **strong core architecture**. The important boundary is correct:

```text
ChatUI does not write TodoListDB directly.
Todo owns Todo business logic.
Shell only transports validated same-origin RPC.
```

Several difficult areas were implemented well: auto-wake without queueing mutations, same-request dedupe, reload-aware replay receipts, generation permission snapshots, cancellation routing, strict date/time/repeat handling, editor guards, and one final hidden-iframe UI reconciliation.

However, the feature should **not yet be considered fully finished**. There are confirmed correctness gaps around task ordering, multi-stage hierarchy changes, current-view ordering, strict read validation, and side-effect reporting. There are also important concurrency gaps because Chat can mutate Todo while the user is simultaneously interacting with Todo in the other persistent iframe.

Recommended readiness assessment:

```text
Architecture:              strong
Transport/RPC safety:      strong
Todo business reuse:       strong
Mutation correctness:      good, but several edge bugs remain
Concurrency safety:        needs work
Read/view fidelity:        needs a few fixes
Result truthfulness:       needs a few fixes
Automated verification:    useful but not deep enough yet
```

---

# P0 — Fix first

## 1. `position: top` / `position: bottom` can produce the wrong order when Todo is currently using a non-Custom sort

### Confirmed problem

The implementation correctly builds a Custom-order snapshot when an explicit AI position forces Todo from a non-Custom sort into Custom.

But the order of operations is wrong.

Current code in `TodoList-ui/js/tools/todo-tool-executor.js` effectively does:

```text
1. calculate before/after reference from CURRENT STORED custom order
2. build snapshot from CURRENT VISIBLE non-Custom order
3. apply snapshot
4. insert relative to the old reference
```

Both `applyTaskPosition()` and `applyTaskHierarchyPosition()` call:

```text
positionRefsForTasks(...)
```

**before**:

```text
WorkspaceControls.buildCustomOrderSnapshot()
```

For `before` / `after` with an explicit `relativeToId`, this is usually fine because the exact target ID is named.

For `top` / `bottom`, it is not fine because the first/last sibling must come from the ordering that is about to become Custom.

### Example

Stored old Custom order:

```text
A, B, C
```

Current visible Name sort:

```text
B, C, A
```

AI says:

```text
Move C to the top.
```

Current implementation can choose `A` as the old first sibling, then build the visible snapshot `B,C,A`, then insert C before A.

Result can remain:

```text
B, C, A
```

instead of the requested:

```text
C, B, A
```

### Required fix

When sort is non-Custom:

1. build the same visible-order snapshot used by manual drag;
2. resolve `top` / `bottom` against the relevant sibling scope **inside that snapshot**;
3. then call `commitHierarchyDrag()` with the snapshot and correct references.

For `before` / `after`, still validate that the explicit target belongs to the final legal sibling scope.

Do not derive top/bottom references from stale persistent `sortOrder` and then apply a different snapshot.

### Files

```text
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/components/workspace-controls.js
TodoList-ui/js/storage/data-service-drag.js
```

### Verification

Test all four placements while sort is:

```text
Name
Due Date
Priority
Created
```

and while moving:

```text
root → root
subtask → same parent
root → subtask
subtask → another parent
```

Verify the application switches to Custom and the final Custom order exactly matches the requested placement.

---

## 2. Background AI mutation protection has a time-of-check/time-of-use race with manual Todo editors and drag sessions

### Confirmed architectural gap

`TodoToolUiGuard` checks open Task/Subtask/Project/Tag drafts before an AI mutation.

That is good, but it is only a snapshot check.

A Todo mutation can then `await` one or more IndexedDB/service operations. During those awaits, the user can switch to Todo and start a new editor or a drag operation because both iframes intentionally stay alive and interactive.

The new interaction did not exist when the guard was checked.

### Editor failure scenario

1. Chat starts an AI update for Task A.
2. Tool guard sees no Task editor open.
3. `AppDataService.updateTask()` begins an async IndexedDB write.
4. Before that write finishes, user opens Task A manually in Todo.
5. The editor loads the old AppState values.
6. AI write commits and updates AppState.
7. User later presses Save in the stale editor.
8. The full editor payload can overwrite the AI changes.

This recreates the stale-editor/lost-update problem that `EDITOR_CONFLICT` was intended to prevent.

### Drag failure scenario

Current Todo has persistent drag state such as:

```text
TasksComponent.dragSession
SidebarComponent.taxonomyDragSession
```

The AI guard does not check these.

If AI mutation finishes while a task/taxonomy drag is active, `TodoToolUiSync` can rerender task lists/sidebar trees while the drag session still holds references to:

```text
placeholder
source lane/host
preview before/after IDs
source context
floating drag unit
```

That can leave a stale drag session or cause the later manual drop to commit an unexpected order/hierarchy.

### Required fix

Add one small Todo-owned interaction/mutation coordination mechanism.

Recommended approach:

```text
Todo AI mutation acquires short-lived mutation lock
→ mutation-sensitive editor opens / drag starts check the lock
→ active manual editor/drag blocks AI mutation
→ AI mutation in progress blocks starting a new editor/drag until it settles
```

Do not make the whole Todo iframe unusable. Only protect mutation-sensitive operations.

At minimum protect:

```text
Task editor open/create
Subtask editor open/create
Project/Tag editors
Task drag start/active drag
Project/Tag drag start/active drag
nested Schedule/Repeat editor for a Task/Subtask draft
```

A generic Todo-domain interaction lock is better than making the AI tool layer know every DOM detail forever.

### Files

```text
TodoList-ui/js/tools/todo-tool-ui-guard.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/components/tasks.js
TodoList-ui/js/components/subtask-editor.js
TodoList-ui/js/components/task-drag.js
TodoList-ui/js/components/sidebar-taxonomy-drag.js
TodoList-ui/js/components/sidebar-taxonomy-core.js
```

### Verification

Manually test while an AI answer is still running in Chat:

```text
start Task drag → AI tries task mutation
start Project drag → AI tries project mutation
AI starts task mutation → immediately try to open that task editor
AI starts taxonomy mutation → immediately try to start taxonomy drag
```

No stale draft, broken drag layer, or unexpected final order should be possible.

---

## 3. Subtask → different parent without explicit position is still implemented as two durable hierarchy mutations

### Confirmed problem

`moveTaskHierarchy()` handles an existing subtask moving to another parent as:

```text
await unlinkTask(taskId)
await linkTaskToParent(taskId, targetParentId)
```

These are two separate AppDataService operations/transactions.

But the same application already has `commitHierarchyDrag()` which can move between parent scopes in one hierarchy/order operation.

### Failure case

Current:

```text
S is child of Parent A
```

AI asks:

```text
Move S under Parent B
```

Possible execution:

```text
unlink S from A       → committed
link S to B           → fails / request is cancelled / state changed
```

S is now a root task even though the requested final state failed.

### Reporting bug

There is an additional implementation problem.

The caller sets:

```text
itemMutation = true
```

only **after** `moveTaskHierarchy()` fully returns.

If unlink commits and link then fails, `entry.mutationOccurred` is true globally, but the current item still has `itemMutation === false`.

The item can therefore lose the precise `PARTIAL_MUTATION` stage/final-state reporting that the implementation is designed to provide.

### Required fix

Preferred:

Use `AppDataService.commitHierarchyDrag()` for subtask → different-parent moves even when no explicit position was supplied.

With no position, use the existing target-scope append semantics. That produces the same expected final child placement without the temporary root state.

If a split operation is ever unavoidable, track mutation state **per item and per stage**, not only through the global request flag.

### Files

```text
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/storage/data-service-hierarchy.js
TodoList-ui/js/storage/data-service-drag.js
```

### Verification

Force/simulate failure or cancellation after the first hierarchy stage and prove that either:

```text
nothing changed
```

or the result clearly says:

```text
PARTIAL_MUTATION
unlink = success
link = failed
final authoritative task = root
```

The preferred result is to remove the split operation entirely.

---

## 4. Duplicate confirmation is not actually bound to an explicit user confirmation

### Confirmed safety gap

The replay guard issues a one-use token after an exact successful mutation is requested again.

That part is good.

But token acceptance currently checks essentially:

```text
token matches
AND token not expired
AND new userTurnId != warning userTurnId
AND not regenerate
AND token not consumed
```

It does **not** have deterministic evidence that the new user turn actually confirmed the duplicate.

The token is exposed back to Gemini through the next function declaration description.

### Failure scenario

1. AI previously created Task X.
2. Exact duplicate is attempted.
3. Guard correctly returns `DUPLICATE_CONFIRMATION_REQUIRED`.
4. Assistant asks user whether to duplicate it.
5. User sends a different new message, for example:

```text
No. Show me today's tasks instead.
```

6. This is a new `userTurnId`.
7. If the model incorrectly supplies the still-valid token, the code accepts it as confirmed.

The safety guarantee is therefore partly based on model behavior rather than being enforced by the application.

### Required fix

The code should distinguish:

```text
new user turn
```

from:

```text
explicit duplicate confirmation
```

Possible safe designs:

- a small Chat-visible confirmation action for duplicate replay only; or
- a Chat-side confirmation state that is explicitly armed for one exact fingerprint/next turn through a deterministic UI/user action; or
- another deterministic confirmation mechanism that does not let the model self-authorize merely by possessing the token.

Keep Regenerate blocked as it is now.

This finding is about **duplicate replay confirmation**, not about adding a general delete confirmation dialog.

### Files

```text
ChatUI/js/todo/todo-mutation-replay-guard.js
ChatUI/js/tools/function-tool-registry.js
ChatUI/js/todo/todo-tool-executor.js
```

### Verification

After receiving `DUPLICATE_CONFIRMATION_REQUIRED`, test:

```text
user says Yes / do it again       → one duplicate allowed
user says No                       → duplicate cannot execute
user asks unrelated question       → duplicate cannot execute
Regenerate                          → duplicate cannot execute
same generation retries token      → duplicate cannot execute
```

---

## 5. A UI-reconciliation exception can lose the truthful `mutationOccurred` signal

### High-risk failure path

Data mutation and UI reconciliation are intentionally separate.

That is correct.

But if `TodoToolUiSync.reconcile()` itself throws after Todo data has already committed, the outer `executeRequest()` catch calls reconciliation again without protecting that second call.

If the second reconciliation also throws, `executeRequest()` rejects instead of returning its structured result.

The Todo embedded bridge then catches that exception and creates:

```text
INTERNAL_TODO_ERROR
meta.mutationOccurred = false
```

even though data may already have changed.

That is dangerous because Chat replay protection depends on the mutation flag to decide whether retry is safe.

### Required fix

Treat UI reconciliation failure as a **post-commit UI error**, never as proof that no mutation happened.

Recommended:

```text
try reconcile
catch UI error
  keep mutationOccurred=true
  return structured UI_RECONCILIATION_ERROR / INTERNAL_TODO_ERROR
  include final authoritative data when possible
```

The embedded bridge must never overwrite a known committed mutation with `mutationOccurred:false` merely because rendering failed.

Also do not let the recovery reconciliation call throw out of the executor catch.

### Files

```text
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-ui-sync.js
TodoList-ui/js/embedded/shell-bridge.js
```

### Verification

Inject a temporary test double that makes UI reconciliation throw after a successful create/update.

The response must still state:

```text
mutationOccurred = true
```

and an exact retry must be blocked/reconciled rather than executed blindly.

---

# P1 — Important correctness fixes

## 6. Update batches do not fully perform static validation before the first mutation

### Confirmed mismatch

Create batches pre-normalize all items before execution.

Update batches do not.

For `todo_update_tasks`, the code prevalidates only IDs/duplicate IDs, then calls `normalizeTaskUpdateInput()` inside the execution loop.

For Project/Tag updates, the full `normalizeTaxonomyUpdateInput()` also happens inside the loop.

### Failure scenario

```text
item 1: valid rename
item 2: impossible date / invalid viewType / malformed position
```

Current behavior can be:

```text
item 1 commits
item 2 static input validation fails
→ PARTIAL_FAILURE
```

The invalid second item could have been rejected before item 1 changed anything.

### Required fix

Split validation into two passes:

**Pass A — before any write**

Validate all facts that do not depend on changes from earlier items:

```text
object shape
field types
text lengths
enums
date/time syntax
repeat shape/ranges
position shape
IDs syntax
duplicate target IDs
```

**Pass B — immediately before each item**

Re-resolve dynamic facts:

```text
entity still exists
parent still legal
cycle state
relative target still sibling
current completion/project/hierarchy state
editor/interaction conflict
```

This keeps sequential batch semantics while preventing avoidable partial writes caused by a malformed later item.

### Files

```text
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-normalizers.js
```

---

## 7. Creating a subtask with explicit `projectId: null` can silently ignore a conflicting Project request

### Confirmed bug

`normalizeTaskCreateInput()` converts both:

```text
projectId omitted
```

and:

```text
projectId: null
```

into internal:

```text
project: ''
```

without retaining whether the Project field was explicitly supplied.

The create executor's conflict check is:

```text
if (spec.taskData.project && spec.taskData.project !== parent.project) ...
```

That check only runs when the requested project is truthy.

### Failure scenario

Parent task is in Project `work`.

AI explicitly sends:

```json
{
  "title": "Child",
  "parentTaskId": "parent-id",
  "projectId": null
}
```

The public contract means the AI explicitly requested Inbox/unassigned.

For a final subtask that conflicts with the parent's Project and should be rejected.

Current code instead silently changes it to the parent's `work` Project and succeeds.

### Required fix

Preserve create-time field presence:

```text
projectSpecified
projectId
```

exactly as update normalization already does.

Then for a final subtask:

```text
if projectId was explicitly supplied
AND normalized requested project != parent.project
→ INVALID_ARGUMENT
```

This must include explicit `null`/Inbox.

### Files

```text
TodoList-ui/js/tools/todo-tool-normalizers.js
TodoList-ui/js/tools/todo-tool-executor.js
```

---

## 8. Some predictable task/taxonomy hierarchy conflicts fall through as `INTERNAL_TODO_ERROR`

### Confirmed gap

The executor validates many hierarchy rules itself, but not all of the rules enforced by the underlying services.

Examples include:

### Task tries to become its own parent

The executor can resolve the target task but does not explicitly reject:

```text
targetParentId === taskId
```

The hierarchy service later throws a normal `Error`.

### Root task with existing subtasks tries to become a subtask

The normal Todo hierarchy service rejects roots that still have children.

The tool layer does not explicitly prevalidate that rule before calling the service.

### Project/Tag cycle/self-parent

The executor confirms the target parent exists and checks UI draft safety, but the actual taxonomy cycle/self-parent validation still lives in `commitTaxonomyDrag()` / service logic.

Those service errors are plain `Error` objects.

### Result problem

`toolError()` maps non-`TodoToolValidationError` exceptions to:

```text
INTERNAL_TODO_ERROR
```

So a normal business conflict can incorrectly appear to Gemini as an internal system failure.

### Required fix

Add explicit tool-layer final-state hierarchy validators that return stable codes:

```text
INVALID_PARENT
HIERARCHY_CONFLICT
POSITION_CONFLICT
```

before the service call whenever the condition is predictable from current AppState.

Do not parse English service error messages.

The service must still revalidate as the final authority.

### Files

```text
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/storage/data-service-hierarchy.js
TodoList-ui/js/storage/data-service-taxonomy-drag.js
```

---

## 9. Cancellation after partial work loses the detailed batch/stage result

### Confirmed problem

`assertNotCancelled(entry)` can throw `AbortBeforeMutation` between batch items or between stages.

Several loops rethrow that error directly to the outer request catch.

If earlier work already committed, the outer catch returns only a generic shape such as:

```text
PARTIAL_FAILURE
Todo request was stopped after some changes were already saved.
```

It can lose:

```text
succeeded[]
current failed input index
unattempted[]
per-stage status
final authoritative entity for a partially mutated current item
```

### Important example

One task update has already committed its `fields` stage.

User presses Stop before `position` or `completion`.

The intended staged result should explain:

```text
fields = success
position = skipped/aborted
completion = skipped
finalTask = authoritative current state
```

Current cancellation can bypass that detailed item result.

### Required fix

Handle cancellation inside the same batch/item result machinery as other failures.

If no mutation occurred:

```text
REQUEST_ABORTED
```

If current item partially mutated:

```text
PARTIAL_MUTATION
```

If earlier batch items committed:

```text
PARTIAL_FAILURE
succeeded[]
failed/current item
unattempted[]
```

Do not throw away the already-built operation status just because the cause is cancellation.

### Files

```text
TodoList-ui/js/tools/todo-tool-executor.js
ChatUI/js/todo/todo-bridge-client.js
shell/js/frame-bridge.js
```

---

## 10. `current_view` ordering does not match Kanban rendering when Group By is active

### Confirmed bug

`TodoList-ui/js/tools/todo-tool-read-selectors.js` has one `currentViewOrder()` implementation for both List and Kanban.

Its current logic is effectively:

```text
all ACTIVE groups in group order
then ALL COMPLETED tasks globally
```

That matches List view reasonably well because List has one global Completed section.

Kanban does something different.

`task-kanban.js` renders each column as:

```text
Group A active
Group A completed
Group B active
Group B completed
Group C active
Group C completed
```

The AI selector currently behaves more like:

```text
Group A active
Group B active
Group C active
all completed tasks
```

### Why this matters

It affects:

```text
todo_find_tasks(scope=current_view)
todo_get_workspace.currentViewTaskIds
pagination offset/order
requests like "the first task on this board"
```

The IDs may be mostly the same, but their logical visible order is wrong.

### Required fix

`currentViewOrder()` must branch on current `WorkspaceControls.viewType`.

For List:

```text
use List ordering rules
```

For Kanban:

```text
build the same group/column order as renderKanban()
for each column:
  active sorted tasks
  completed sorted tasks
then family expansion/dedupe
```

Do not duplicate business definitions if a small shared pure ordering helper can be extracted from Tasks rendering.

### Files

```text
TodoList-ui/js/tools/todo-tool-read-selectors.js
TodoList-ui/js/components/task-renderer.js
TodoList-ui/js/components/task-kanban.js
TodoList-ui/js/components/task-groups.js
```

---

## 11. Read-tool validation is still permissive in several places and can silently change query meaning

### Confirmed examples

`todo_find_tasks` currently silently treats unknown detail as `auto`:

```text
invalid detail → auto
```

Unknown scope is effectively treated as `all`:

```text
anything except exactly current_view → all
```

Unknown `tagMatch` becomes `any`.

`completed` is handled with `Boolean(args.completed)`, so a malformed string such as:

```text
"false"
```

would behave as true rather than being rejected.

`parentTaskId` is converted with `String()` rather than the normal strict ID validator.

`includeProjectDescendants`, `includeTagDescendants`, `includeSubtasks`, and taxonomy `includeCounts` mostly use `=== false` checks instead of strict boolean validation.

Some numeric fields use `Number(...)`, allowing numeric strings even though the public schema says integer.

### Why this matters

The Gemini declaration normally helps produce valid types, but the Todo executor is supposed to be the final deterministic boundary.

A malformed function call should not silently become a different query, especially because a wrong read can drive a wrong follow-up mutation.

### Required fix

Create one strict read-argument normalizer and reject invalid values/types.

Examples:

```text
scope must be all|current_view
detail must be auto|summary|full
tagMatch must be any|all
completed must be boolean
include* fields must be boolean
parentTaskId must use normalizeId(..., nullable=true)
offset/limit must be actual integers, not coercible strings
```

Also reject an impossible range such as:

```text
dueFrom > dueTo
```

rather than silently returning no results.

### Files

```text
TodoList-ui/js/tools/todo-tool-read-selectors.js
TodoList-ui/js/tools/todo-tool-normalizers.js
```

---

## 12. AI result serialization does not fully enforce the planned total response budget or bound all existing user strings

### Confirmed problem

The implementation bounds some fields:

```text
full description → 4,000 chars
page size → 10/20/50 items
```

But it does not enforce an internal ~48 KiB target budget before the 64 KiB transport boundary.

It also returns some existing Todo strings without truncation, including examples such as:

```text
task title
Project name
Tag name
some tree/overview labels
```

AI-created new values have input limits, but **existing manually-created/old data** is not guaranteed to follow those new AI limits.

### Failure behavior

A broad result can pass the item-count limits and still exceed 64 KiB.

The embedded bridge then replaces the whole useful result with:

```text
RESULT_TOO_LARGE
```

This is safe, but it is a poor result strategy and weaker than the intended bounded serializer.

### Required fix

Add a serializer budget layer before transport:

- bound every string returned to AI, including old/manual titles/names;
- track serialized total size while building the page;
- stop adding rows before the target budget;
- set `hasMore=true` / return a narrowing hint;
- keep the 64 KiB bridge limit as the final hard safety net, not the normal pagination mechanism.

Also bound large child-ID arrays if needed.

### Files

```text
TodoList-ui/js/tools/todo-tool-read-selectors.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/embedded/shell-bridge.js
shell/js/frame-bridge.js
```

---

## 13. `affectedChildTaskIds` is over-reported for many root task updates

### Confirmed result-truthfulness bug

After every successful `todo_update_tasks` item, the result currently does approximately:

```text
if final task is root
→ affectedChildTaskIds = all current subtasks
```

regardless of what field actually changed.

### Wrong examples

AI only changes root title:

```text
affectedChildTaskIds = all children
```

AI only changes root priority/date/tag:

```text
affectedChildTaskIds = all children
```

AI activates a completed root:

Current Todo `uncompleteTask()` only activates the root; it does not automatically activate every child.

The result can still list all children as affected.

### When children really are affected

Examples include:

```text
root Project change that propagates Project to children
plain root completion that completes the family
repeat root completion that completes old family / creates new occurrence family
root family deletion
```

### Required fix

Track side effects by operation, not by final shape.

Use separate fields when useful:

```text
childIds                // informational family membership
affectedChildTaskIds    // children actually changed by this operation
```

For completion/project propagation, take before/after snapshots or use known service semantics to return only the IDs that actually changed.

### Files

```text
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/storage/data-service.js
```

---

## 14. Unexpected Todo service errors are still exposed as raw messages and lose stable business codes

### Confirmed behavior

`toolError()` returns any non-validation exception as:

```text
code = INTERNAL_TODO_ERROR
message = error.message
```

The embedded bridge also exposes `error.message` for an unexpected executor rejection.

### Problems

1. A predictable business race can be misclassified as an internal error.
2. Internal storage/service wording can leak to Gemini.
3. Error contracts become dependent on implementation-specific English strings.

For example, a hierarchy condition can change after tool prevalidation but before the queued service work executes. The service correctly rejects it, but the AI can receive `INTERNAL_TODO_ERROR` instead of a stable hierarchy code.

### Required fix

Keep detailed internal exception text in local console diagnostics only.

For AI-facing results:

- known tool-layer conditions → stable business code;
- after service failure, re-check known state when possible to classify without string parsing;
- unknown service/storage exception → generic safe message such as `Todo could not complete the operation.` with `STORAGE_ERROR` or `INTERNAL_TODO_ERROR`.

Do not expose raw IndexedDB/store/internal exception messages to the model.

### Files

```text
TodoList-ui/js/tools/todo-tool-normalizers.js
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/embedded/shell-bridge.js
```

---

# P2 — Improvements / maintainability / UX

## 15. Success duplicate-confirmation protection is broader than needed and can block legitimate idempotent re-application

### Current behavior

The replay guard treats all Todo mutation tools the same for successful exact-repeat confirmation, including:

```text
todo_update_tasks
todo_delete_tasks
todo_update_projects
todo_delete_projects
todo_update_tags
todo_delete_tags
todo_update_workspace
```

### Why this can be annoying

Most update tools express a desired final state and are naturally idempotent.

`todo_update_workspace` is especially temporary/session-oriented in some smart-view cases.

Example:

```text
AI sets Inbox to Kanban
user later changes it manually
AI later receives the same exact "set Kanban" request
```

The old successful fingerprint may require duplicate confirmation even though reapplying the desired state is not a dangerous duplicate side effect.

### Recommended improvement

Keep these protections for **all** mutations:

```text
same requestId dedupe
pending/unknown outcome blocking
partial-commit blocking
no blind retry after timeout
```

But consider requiring explicit **success duplicate confirmation** only for truly additive/non-idempotent functions, mainly:

```text
todo_create_tasks
todo_create_projects
todo_create_tags
```

Updates/deletes can generally safely execute again against the current canonical IDs and return no-op/not-found/current-state results.

This is an improvement, not a blocker.

---

## 16. Todo activity titles use past tense before the operation has actually succeeded

### Current behavior

Todo activity summary formatting produces strings such as:

```text
Created 3 tasks
Updated 1 task
Deleted 2 tags
```

from the function arguments when the function is first requested/running.

If the operation later fails before changing anything, the timeline can still show a failed tool row titled something like:

```text
To-Do · Created 3 tasks
```

The failed status may be visible, but the wording is misleading.

### Recommended fix

Use neutral/in-progress text before result:

```text
Create 3 tasks
Update 1 task
Delete 2 tags
```

Then on completion/failure, replace the summary from the actual structured result/overview:

```text
Created 2 tasks
Partially updated 1 task
Task creation failed
```

### Files

```text
ChatUI/js/chat/activity-timeline.js
```

---

## 17. The low-level Gemini custom-tool loop still contains Workspace-specific wording/provider emission

### Confirmed leftover

`ChatUI/js/api/gemini.js` was not generalized with the new provider helper.

It still emits custom activity provider as:

```text
workspace_ → workspace
otherwise → unknown
```

The activity timeline later repairs Todo provider classification from the function name, so the visible provider mostly works.

But the source is still inconsistent.

More importantly, loop-limit errors still say:

```text
Gemini Workspace tool loop exceeded ...
```

when the loop may contain Todo tools or a combination of providers.

### Recommended fix

Use `getCustomToolProvider()` at the Gemini event source and rename errors to:

```text
Gemini custom tool loop exceeded ...
```

This removes provider-specific assumptions from the generic engine.

### Files

```text
ChatUI/js/api/gemini.js
ChatUI/js/tools/custom-tool-provider.js
ChatUI/js/chat/activity-timeline.js
```

---

## 18. Automated verification is useful, but several highest-risk behaviors are not actually executed in tests

### What is good

The PR CI passed and verifies:

```text
syntax
build
routes
iframe invariants
normalizer examples
repeat/date examples
fingerprint stability
some source invariants
```

### Remaining weakness

`scripts/verify-todo-tools.mjs` contains many source-string assertions such as checking that a particular code string exists.

That proves implementation shape, but not behavior.

It does not execute the full TodoToolExecutor with fake services/state for many dangerous cases.

### Add pure-JS tests for at least

```text
1. non-Custom Name sort + position top/bottom → exact final Custom order
2. subtask A → Parent B failure/cancel → no unreported root intermediate state
3. explicit projectId:null + parent in Project → INVALID_ARGUMENT
4. root with subtasks → attempt to become subtask → HIERARCHY_CONFLICT
5. task self-parent → INVALID_PARENT
6. Project/Tag cycle → HIERARCHY_CONFLICT
7. invalid item 2 in update batch → item 1 never mutates during static preflight failure
8. cancellation after item/stage commit → truthful succeeded/failed/unattempted data
9. Kanban Group By current_view order matches render semantics
10. malformed read boolean/enum/ID → INVALID_ARGUMENT, never silent coercion
11. UI reconciliation throws after commit → mutationOccurred stays true
12. duplicate warning + unrelated next user turn → duplicate cannot execute
13. oversized pre-existing title/name data → bounded useful result, not full-response loss
```

These can be unit/pure-JS tests. They do not require headless Chrome.

### CI improvement

The workflow syntax-check list also does not explicitly `node --check` every JavaScript file changed by PR #4, such as some activity/UI files. Either check all `.js` under the touched runtime trees or generate the changed-file list automatically.

### Files

```text
scripts/verify-todo-tools.mjs
scripts/verify-integration.mjs
.github/workflows/iframe-integration-check.yml
```

---

## 19. The 32/64 KiB guards measure JavaScript string length, not actual UTF-8 bytes

### Current behavior

The bridges use roughly:

```text
JSON.stringify(message).length
```

and compare it with:

```text
32 * 1024
64 * 1024
```

That is a character/code-unit count, not a byte count.

Emoji and many non-ASCII characters can occupy more UTF-8 bytes than this number suggests.

### Recommended fix

Either:

- rename/document the limit as a character limit; or
- if it is truly intended as KiB, measure with `TextEncoder().encode(serialized).byteLength`.

Use the same rule in Chat, Shell, and Todo so they cannot disagree.

### Files

```text
ChatUI/js/todo/todo-bridge-client.js
shell/js/frame-bridge.js
TodoList-ui/js/embedded/shell-bridge.js
```

---

## 20. `todo_get_workspace.currentViewTaskCount` has an arbitrary 10,000-task ceiling

### Current behavior

Workspace state returns:

```text
currentViewTaskIds: currentViewTaskIds(100)
currentViewTaskCount: currentViewTaskIds(10000).length
```

For this personal application, 10,000 tasks is unlikely, so this is not urgent.

But the field is named as the total count, while it is technically capped.

### Recommended fix

Compute the logical current-view order once:

```text
allCurrentViewIds
```

then return:

```text
currentViewTaskIds = first 100
currentViewTaskCount = allCurrentViewIds.length
```

This also avoids building the current-view order twice.

### Files

```text
TodoList-ui/js/tools/todo-tool-executor.js
TodoList-ui/js/tools/todo-tool-read-selectors.js
```

---

# Things the implementation did well

These parts were checked and should generally be preserved.

## 1. Correct application boundary

ChatUI does not import Todo `AppDataService`, Todo DOM, or Todo IndexedDB modules.

Flow stays:

```text
Chat → Shell → Todo owner
```

This is the right architecture.

## 2. Todo mutation RPC is not placed in the ordinary deferred iframe queue

Shell has dedicated:

```text
ensureReady()
sendNow()
```

for Todo RPC.

That avoids the old dangerous case where a timed-out mutation could sit in `frameManager.queue` and execute much later after iframe recovery.

## 3. Auto-wake/retry is implemented cleanly

Todo can be:

```text
NOT_CREATED
LOADING
FAILED
READY
```

and Shell shares a readiness Promise instead of starting multiple retries for concurrent callers.

The readiness Promise is cleared after settlement so one failure does not permanently poison future calls.

## 4. Same-request dedupe is implemented on the Todo side

Todo binds:

```text
requestId + functionName + exact args fingerprint
```

and returns the existing in-flight/completed result for exact redelivery.

Reusing one requestId for different work is rejected.

This is a strong protection.

## 5. Unknown timeout/reload outcomes are treated conservatively

Chat keeps mutation receipts in `sessionStorage`.

Pending receipts become unknown after reload.

Timed-out dispatched mutations are not blindly retried.

Late results can repair the receipt state.

That is substantially safer than a normal request/timeout/retry implementation.

## 6. Generation permission uses the saved generation snapshot

Todo execution checks the generation's captured `activeTools.todo`, not only the live checkbox.

Turning Todo off during an already-running answer therefore does not silently change permissions in the middle of that same generation.

## 7. Regenerate has an explicit generation mode

Regenerate is marked as:

```text
generationMode = regenerate
```

and cannot consume duplicate confirmation merely because it has the same historical user turn.

That is correct.

## 8. Date/time/repeat handling is mostly strong

The implementation correctly includes:

```text
strict YYYY-MM-DD
strict hh:mm AM/PM
Today auto-assignment for time without date
Today auto-assignment for repeat without date
repeat end date >= final due date
human 1..12 months mapped to RepeatEngine 0..11
impossible yearly month/day validation
```

The reminder adapter also reuses built-ins and deterministic custom reminder IDs without pre-saving orphan definitions.

## 9. Repeat completion uses existing Todo semantics

The implementation correctly calls:

```text
AppDataService.toggleTaskStatus()
```

instead of writing `completed=true` directly.

It captures generated next-occurrence metadata.

## 10. Project/Tag delete side effects are based on the real Todo services

Project deletion leaves tasks and unassigns direct assignments.

Tag deletion leaves tasks and removes the tag relationship.

Changed child taxonomy parent IDs are returned after the real deletion behavior.

## 11. Editor guard coverage is broad at the initial check

The implementation checks:

```text
Task drafts
Subtask drafts
Project drafts
Tag drafts
selected Project/Tags
Subtask parent dependencies
new taxonomy child drafts
```

The remaining problem is the concurrency race after that initial check, not a lack of initial coverage.

## 12. Hidden Todo UI reconciliation is centralized

The implementation has one `TodoToolUiSync` module instead of scattering renders through every handler.

It refreshes task menus, sidebar trees/counts, current filter state, Subtask metadata, and workspace controls based on mutation domain.

That is the correct design direction.

## 13. Standalone ChatUI remains safe

Todo declarations depend on compatible embedded Shell support.

Standalone ChatUI does not attempt to execute Todo through a nonexistent sibling frame.

Saved `tools.todo` preference is not erased just because the bridge is unavailable.

## 14. Privacy disclosure was added

Both Todo tool UI locations tell the user that Todo information used by AI may be sent to the configured model endpoint.

That correctly describes the privacy boundary.

## 15. Existing databases remain separate

No schema merge was introduced:

```text
ChatUI_DB
TodoListDB
```

This should remain unchanged.

---

# Recommended repair order

Fix in this order:

```text
1. Correct non-Custom top/bottom task positioning.
2. Add real Todo mutation/manual-interaction coordination for editors + drag sessions.
3. Replace split subtask→parent move with one hierarchy commit / truthful per-item tracking.
4. Strengthen duplicate confirmation so a new turn alone is not treated as explicit confirmation.
5. Make UI reconciliation failures preserve mutationOccurred=true.
6. Add true static preflight validation for update batches.
7. Preserve explicit projectId presence during subtask creation.
8. Add complete hierarchy/cycle tool-layer validation with stable codes.
9. Preserve detailed partial results when cancellation happens.
10. Make current_view order match Kanban rendering.
11. Make read argument validation fully strict.
12. Add total response budgeting + bounds for old/manual strings.
13. Correct affectedChildTaskIds reporting.
14. Hide raw internal service errors behind stable AI-facing errors.
15. Then do P2 replay/activity/provider/test/limit cleanup.
```

---

# Manual regression checklist after fixes

The user can perform these without headless browser automation.

## Ordering

```text
Name sort → AI top/bottom task → switch to Custom → exact order correct
Due Date sort → same
Priority sort → same
Created sort → same
before/after still correct
root/subtask/reparent scopes correct
```

## Concurrent manual interaction

```text
Chat generation running → switch Todo → start Task drag while AI mutation arrives
Chat generation running → start Project/Tag drag while AI mutation arrives
AI mutation starts → immediately try to open same entity editor
open editor first → AI mutation returns conflict
no stale draft can later overwrite AI work
```

## Hierarchy

```text
subtask A → Parent B succeeds without temporary root behavior
failure/cancel during move never produces unreported partial state
root with children cannot become subtask
self-parent rejected with stable business code
Project/Tag cycle rejected with HIERARCHY_CONFLICT
```

## Batch behavior

```text
item 2 has malformed date → item 1 does not mutate
item 2 becomes dynamically invalid after item 1 → truthful PARTIAL_FAILURE
Stop after first committed item → succeeded/failed/unattempted returned
Stop after one stage of current item → PARTIAL_MUTATION with final state
```

## Create semantics

```text
subtask + omitted projectId → inherits parent Project
subtask + same explicit projectId → accepted
subtask + conflicting Project → rejected
subtask + explicit projectId:null while parent has Project → rejected
```

## Reads

```text
List + Group By → current_view order matches screen
Kanban + Group By → current_view order matches columns
invalid scope/detail/tagMatch/boolean → INVALID_ARGUMENT
reversed due range → INVALID_ARGUMENT
large old title/name/description data → useful bounded result
```

## Replay/cancel

```text
same requestId redelivery → executes once
unknown timeout → no blind retry
late success repairs receipt
partial commit blocks exact blind replay
duplicate warning + Yes → one duplicate
duplicate warning + No → no duplicate
duplicate warning + unrelated next message → no duplicate
Regenerate → cannot confirm duplicate
```

## Result truthfulness

```text
rename root only → children not reported as affected
change root Project → affected children reported
complete root → actually changed children reported
activate root → children not falsely reported if unchanged
failed create activity must not say "Created N tasks" as if successful
```

## Persistent iframe behavior

```text
Chat text generation continues while Todo visible
Live Voice continues while Todo visible
voice recording continues while Todo visible
Read Aloud continues while Todo visible
Todo AI mutation while Todo hidden appears immediately when opened
no iframe reload during app switching
```

---

# Final assessment

Implementation Plan ID 3 was implemented with a **good architecture and substantial defensive work**. The implementation is not a failed integration and does not need to be thrown away.

The main problems are concentrated in edge semantics and concurrent interaction:

```text
- wrong top/bottom ordering when converting a non-Custom sort to Custom;
- one split hierarchy move can partially commit incorrectly;
- editor/drag protection is vulnerable to interactions that start after the initial guard check;
- duplicate confirmation does not deterministically prove explicit confirmation;
- several error/partial-result paths can be more truthful;
- current_view ordering is List-centric and not fully Kanban-aware;
- response/read validation needs tighter bounds and strictness.
```

These are repairable within the current architecture. The correct next step is **targeted fixes**, not rollback or redesign of the Chat → Shell → Todo tool architecture.
