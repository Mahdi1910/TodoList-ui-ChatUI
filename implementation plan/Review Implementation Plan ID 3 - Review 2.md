# Second Review of Implementation Plan ID 3 — ChatUI → Todo AI Tool Integration

## Purpose

This is a fresh second review of the revised:

```text
implementation plan/Implementation Plan ID 3.md
```

The review compares the updated plan against the current TodoList-ui, ChatUI, and persistent iframe Shell implementation.

This document does **not** implement the feature. It exists so the implementation agent can repair the remaining design gaps before changing runtime code.

---

# Review baseline

Current `main` reviewed at:

```text
2dbe7ea8d04f4926f96ab7853e8721f5db33494c
```

Current revised Implementation Plan ID 3 blob:

```text
12a87a2e7782685b248ea7165ebced50f963b972
```

Important observation:

The runtime application code has **not changed** since the first review baseline. Between the first review baseline and this review, the repository changes are the previous review document and the rewritten Implementation Plan ID 3. Therefore the first review's source-code observations are still valid; this review focuses on whether the new plan successfully handles them and on new edge cases introduced by the revised decisions.

Important source areas rechecked include:

```text
Shell
shell/js/protocol.js
shell/js/frame-manager.js
shell/js/frame-bridge.js
shell/js/app-shell.js
index.html

ChatUI
ChatUI/js/app.js
ChatUI/js/state/store.js
ChatUI/js/storage/load.js
ChatUI/js/storage/records.js
ChatUI/js/storage/mutations.js
ChatUI/js/storage/backup-restore.js
ChatUI/js/chat/send-message.js
ChatUI/js/chat/generation-runner.js
ChatUI/js/chat/regenerate.js
ChatUI/js/chat/streaming.js
ChatUI/js/chat/activity-timeline.js
ChatUI/js/api/gemini.js
ChatUI/js/tools/function-tool-registry.js
ChatUI/js/workspace/workspace-tool-definitions.js
ChatUI/js/workspace/workspace-tool-executor.js
ChatUI/js/composer/composer.js
ChatUI/js/voice/live-voice-controller.js
ChatUI/js/embedded/shell-bridge.js
ChatUI/js/ui/chat-controls.js

TodoList-ui
TodoList-ui/js/app-main.js
TodoList-ui/js/state.js
TodoList-ui/js/state-sync.js
TodoList-ui/js/task-model.js
TodoList-ui/js/task-filter.js
TodoList-ui/js/task-relations.js
TodoList-ui/js/task-order.js
TodoList-ui/js/taxonomy-order.js
TodoList-ui/js/repeat/repeat-engine.js
TodoList-ui/js/storage/data-service.js
TodoList-ui/js/storage/data-service-hierarchy.js
TodoList-ui/js/storage/data-service-drag.js
TodoList-ui/js/storage/data-service-taxonomy.js
TodoList-ui/js/storage/data-service-taxonomy-drag.js
TodoList-ui/js/storage/data-service-reminders.js
TodoList-ui/js/storage/mappers.js
TodoList-ui/js/components/tasks.js
TodoList-ui/js/components/task-actions.js
TodoList-ui/js/components/task-hierarchy.js
TodoList-ui/js/components/task-renderer.js
TodoList-ui/js/components/task-drag-commit.js
TodoList-ui/js/components/subtask-editor.js
TodoList-ui/js/components/sidebar.js
TodoList-ui/js/components/sidebar-taxonomy-core.js
TodoList-ui/js/components/workspace-controls.js
TodoList-ui/js/components/schedule.js
TodoList-ui/js/components/schedule-repeat-end.js
TodoList-ui/js/components/schedule-time-reminders.js
TodoList-ui/js/components/schedule-wheels.js
TodoList-ui/js/embedded/shell-bridge.js

Verification/build
scripts/verify-integration.mjs
scripts/build-static.mjs
.github/workflows/iframe-integration-check.yml
```

---

# Overall verdict

The revised Implementation Plan ID 3 is **much better** than the first version.

Most of the original serious problems were addressed correctly:

- reminder support is now explicitly configuration-only;
- Todo RPC is no longer allowed to sit in the ordinary frame-manager deferred queue;
- Todo auto-wake/readiness is separated from mutation dispatch;
- mutation batch size was reduced to 10;
- Todo AI calls are serialized;
- reads wait for `AppDataService.whenIdle()`;
- task updates now use final hierarchy state instead of one incorrect universal ordering;
- completed parents are explicitly rejected for new subtasks;
- date/time/repeat input is intended to be strictly validated;
- repeat months use human `1..12` values;
- request **and response** budgets are now defined;
- task reads are paginated/summary-vs-full;
- per-item `PARTIAL_MUTATION` is acknowledged;
- partial failures still require UI reconciliation;
- Project/Tag descendants are explicitly defined;
- duplicate request delivery has a dedupe concept;
- mutation timeout no longer implies rollback;
- generation snapshot semantics for `tools.todo` are explicit;
- editor conflicts are rejected instead of redesigning all existing editors;
- Custom sort uses the existing snapshot + `activateCustomSort()` behavior;
- Todo provider classification is intended to be centralized;
- CI/static verification is explicitly updated;
- the user's no-headless-browser-testing rule is preserved.

That is a substantial improvement.

However, I would **still revise the plan before implementation**. The remaining issues are narrower than the first review, but several can still cause duplicate mutations, mutations after the user pressed Stop, incorrect task state, or a Todo view/order that unexpectedly jumps.

---

# P0 — Fix these in the plan before implementation

## 1. "A later user turn means duplicate confirmation" is not a safe confirmation protocol

### Current plan

The replay guard says:

```text
first exact mutation → execute
second exact successful mutation → DUPLICATE_CONFIRMATION_REQUIRED
same exact call in a later user turn → treat as confirmation and execute
same generation repeat → do not allow
```

### Problem

A **later user turn is not automatically a confirmation**.

Example:

```text
Turn 1:
User: Create task Buy medicine.
→ succeeds

Turn 2:
Gemini accidentally calls the exact same create.
→ duplicate guard asks confirmation

Turn 3:
User: What time is it due?
```

If Gemini happens to emit the same create call again in Turn 3, the current plan says the mere existence of a later user turn is enough to execute the duplicate.

The user never confirmed duplication.

This is especially dangerous in Live Voice where a conversational follow-up may not be an affirmative confirmation.

### Regenerate makes this more important

Current ChatUI has a real Regenerate path in:

```text
ChatUI/js/chat/regenerate.js
```

Regenerating an assistant answer reuses the same preceding user message and can run tools again.

A regenerated answer that originally created/deleted Todo data must **not** automatically repeat the mutation.

### Current code gap

The custom-tool execution context currently contains essentially:

```text
signal
activeTools
```

The Gemini function loop does **not** currently receive a stable `userTurnId`/user-message ID that the replay guard can use to distinguish:

```text
same generation
regeneration of same user turn
a genuinely new user turn
explicit duplicate confirmation
```

### Required correction

Add an explicit duplicate-confirmation protocol.

Recommended design:

1. Propagate the originating user message ID / `userTurnId` through the generation path.
2. `DUPLICATE_CONFIRMATION_REQUIRED` returns a bounded one-time confirmation token/receipt tied to:
   - mutation fingerprint;
   - previous mutation receipt;
   - originating user turn.
3. That token is **not valid inside the same user turn/generation**.
4. A later user turn must explicitly carry/use the confirmation token before the duplicate is allowed.
5. Regenerate of the same user message does **not** count as confirmation.

Possible plumbing path:

```text
send-message.js userMsgObj.id
or regenerate.js targetUser.id
→ generation-runner
→ streaming
→ gemini custom tool context
→ todo-tool-executor / replay guard
```

The implementation does not need a new public tool, but it does need a deterministic way to prove that a duplicate was actually confirmed.

### Relevant files

```text
ChatUI/js/chat/send-message.js
ChatUI/js/chat/generation-runner.js
ChatUI/js/chat/regenerate.js
ChatUI/js/chat/streaming.js
ChatUI/js/api/gemini.js
ChatUI/js/tools/function-tool-registry.js
planned ChatUI/js/todo/todo-mutation-replay-guard.js
```

### Must-test case

```text
Create succeeds → Regenerate answer → Todo mutation is not repeated.
```

---

## 2. The replay guard must survive a Chat iframe reload

### Problem

The plan describes a short-lived Chat-side recent mutation history, but does not state that it survives a ChatUI document reload.

That matters because the combined Shell intentionally supports iframe retry/reload.

### Failure case

1. Todo create commits successfully.
2. Chat receives the success or is waiting for the result.
3. Chat iframe reloads before the final assistant answer is durably saved.
4. The in-memory replay history disappears.
5. User/Regenerate/model repeats the same create.
6. A duplicate task is created.

The same problem exists for an **unknown** mutation outcome:

```text
request dispatched
→ Chat records nothing durable
→ Chat reloads
→ previous unknown state is forgotten
→ blind retry becomes possible
```

### Required correction

Store the bounded 5-minute replay state somewhere that survives a Chat iframe reload but remains temporary.

Recommended:

```text
sessionStorage
```

Store only bounded mutation receipts/status, for example:

```text
fingerprint
status: pending | success | partial | unknown
requestId
userTurnId
timestamp
small result receipt / affected IDs
```

Write `pending`/`unknown` state **before/at dispatch**, then update it when the final/late result arrives.

Do not put large full Todo responses into transient storage.

This also protects Regenerate after a ChatUI reload.

### Relevant files

```text
planned ChatUI/js/todo/todo-mutation-replay-guard.js
ChatUI/js/chat/regenerate.js
ChatUI/js/embedded/shell-bridge.js
```

---

## 3. Exact retry behavior after `PARTIAL_FAILURE` / `PARTIAL_MUTATION` is still undefined

### Problem

The revised plan now correctly reports partial mutation.

But its duplicate policy distinguishes mainly:

```text
successful mutation
failed without mutation
unknown outcome
```

It does not clearly define a **known partial commit**.

### Dangerous case

```text
todo_create_tasks([A, B, C, D])
```

Suppose:

```text
A created
B created
C fails
D unattempted
```

The tool returns:

```text
PARTIAL_FAILURE
```

If Gemini retries the exact same whole call with a new request ID, A and B can be created again.

This is not an unknown result. The system **knows** some work committed.

The same applies to one task item returning `PARTIAL_MUTATION` after hierarchy/field changes committed.

### Required correction

Replay state needs a separate committed-partial classification, for example:

```text
status = partial_committed
```

Any result where `mutationOccurred === true` must be protected against blind exact retry, including:

```text
ok:true
PARTIAL_FAILURE
PARTIAL_MUTATION
```

On exact retry of a known partial commit:

- do not rerun the whole request;
- return the previous compact receipt;
- tell Gemini to read/reconcile current Todo state;
- retry only the failed/unattempted remainder when appropriate.

### Must-test case

```text
Batch create commits first 3 items then fails → exact whole batch retry does not create first 3 again.
```

---

## 4. Generation Abort/Stop has no post-dispatch cancellation design

### Problem

The Chat bridge client is planned to respect `AbortSignal`, but once the Todo request has been posted to Todo, the Todo-side execution queue may still execute it later.

### Failure case

1. Gemini requests a Todo delete/update.
2. Shell dispatches it to Todo.
3. Todo request is waiting behind `AppDataService.whenIdle()` or another Todo tool call.
4. User presses **Stop generating**.
5. Chat drops the pending promise because its AbortSignal fired.
6. Todo queue later reaches the request and performs the mutation anyway.

The user can reasonably interpret Stop as preventing work that has not started yet.

### Required correction

Define cancellation by execution phase.

Recommended behavior:

#### Before Shell dispatch

```text
Abort → request discarded → no side effect
```

#### Dispatched but Todo has not started the first mutation stage

Add a correlated cancellation route, conceptually:

```text
chatui:todo-tool-cancel
→ shell
→ shell:todo-tool-cancel
→ Todo request registry marks request cancelled
```

Todo executor checks cancellation immediately before starting the call/item.

#### First durable mutation stage already started

Do **not** pretend it can roll back.

Return/treat as:

```text
outcome may be committed/in-flight
```

and keep the late-result/reconciliation logic.

`REQUEST_ABORTED` should be used only when the system can prove no Todo mutation began.

### Relevant files

```text
ChatUI/js/chat/generation-lifecycle.js
ChatUI/js/api/gemini.js
planned todo-bridge-client.js
shell/js/frame-bridge.js
TodoList-ui planned todo-tool-executor.js
```

---

## 5. `projectId: null` is contradictory for a current subtask

### Current plan

Shared update semantics say:

```text
projectId: null → Inbox/unassigned root task
```

The task planner later has a special ergonomic rule only for:

```text
current task is subtask
+ different non-null projectId
+ parentTaskId omitted
→ automatically unlink to root
→ set new Project
```

### Missing case

Current task is a subtask and Gemini sends:

```json
{
  "id": "subtask-id",
  "projectId": null
}
```

with `parentTaskId` omitted.

If the adapter directly calls `updateTask()`, current Todo business logic ignores the requested root project while the task is still a subtask because subtask Project is inherited from its parent.

The result will not match the public contract.

### Required correction

Explicitly define:

```text
current subtask + projectId:null + parentTaskId omitted
→ unlink to root first
→ set/keep project as Inbox/unassigned
```

This should be handled by the same final-state task planner as the non-null new Project rule.

Also define the case where a final `parentTaskId` is supplied together with `projectId:null`:

- if final state is a subtask, Project is inherited;
- conflicting Project intent must not be silently ignored.

### Relevant code

```text
TodoList-ui/js/storage/data-service.js
TodoList-ui/js/storage/data-service-hierarchy.js
```

---

## 6. Final date/time/repeat invariants are not defined, so the AI can create state different from the normal Todo UI

### Existing Todo behavior

Current Schedule UI has an important rule in:

```text
TodoList-ui/js/components/schedule.js
```

When the user applies a **time with no date**, the UI automatically assigns today's date.

Conceptually:

```text
time exists + no date
→ finalDate = today
```

Current `AppDataService.buildTask()` does not enforce that time rule by itself.

It **does**, however, enforce another rule:

```text
active repeat + no date
→ dueDate = today
```

### Conflict with the AI contract

The revised plan currently says generally:

```text
dueDate:null → clear date
dueTime omitted → unchanged
repeat omitted → unchanged
```

But that cannot always be true.

Example 1:

```text
existing task has 05:00 PM
AI sets dueDate:null but leaves dueTime unchanged
```

The public contract says the date is cleared, while normal Todo Schedule UI would restore today's date when saving a time.

Example 2:

```text
existing repeating task
AI sets dueDate:null
repeat remains active
```

`AppDataService` will assign today; the date will not actually clear.

### Required correction

Define a **final scheduling invariant** before persistence.

Recommended parity with current Todo UI/business behavior:

```text
final repeat active + no date → today
final dueTime non-null + no date → today
```

Then explicitly document that a task can be truly unscheduled only when the final state does not retain a time/repeat that requires a date.

Alternatively reject contradictory requests instead of silently changing them, but the plan must choose one deterministic rule.

The final returned task must show the resolved date so Gemini does not claim it was cleared when Todo assigned today.

### Must-test cases

```text
create task with time only
clear date while time remains
clear date while repeat remains
clear date + clear time + clear repeat
```

---

## 7. Strict Repeat validation still misses Todo's end-date rule

### Existing Todo UI rule

Both Schedule Apply and the Repeat Ends dialog enforce:

```text
repeat end date >= task due date
```

Current RepeatEngine validation alone does **not** enforce that relationship. It validates the calendar date itself but does not compare it against the task due date.

### Failure case

AI creates:

```text
dueDate = 2026-08-20
repeat daily
end.date = 2026-08-10
```

A normal user cannot save that rule through the existing Schedule UI, but a direct adapter could.

### Required correction

After resolving the final due date and strict Repeat shape:

```text
if repeat.end.type === 'date'
then end.date must be >= final dueDate
```

Return `INVALID_ARGUMENT` instead of storing a rule that the normal UI rejects.

### Additional strict year-date rule

AI-facing `yearDates` should also reject obviously impossible month/day pairs instead of relying on RepeatEngine clamping/filtering.

Examples that should not silently become another date:

```text
February 30
February 31
April 31
```

A deliberate February 29 yearly rule can remain valid according to existing recurrence behavior.

### Relevant files

```text
TodoList-ui/js/components/schedule.js
TodoList-ui/js/components/schedule-repeat-end.js
TodoList-ui/js/repeat/repeat-engine.js
```

---

## 8. Semantic task `position` must preserve the currently visible sorted order before forcing Custom

### Existing Todo drag behavior

This is a very important source-level detail.

Current UI task drag does **not** simply call `commitHierarchyDrag()` when the current sort is Due Date/Name/Priority/etc.

In:

```text
TodoList-ui/js/components/task-drag-commit.js
```

it does:

```text
if current sort is not custom
→ WorkspaceControls.buildCustomOrderSnapshot()
→ pass snapshot into AppDataService.commitHierarchyDrag()
→ service applies snapshot + move
→ sortKey becomes custom
```

This preserves the order the user was looking at before the drag changes the workspace to Custom.

### Problem in revised plan

The plan correctly documents this snapshot rule for:

```text
todo_update_workspace(sortKey='custom')
```

but it does **not** explicitly require the same behavior for:

```text
todo_create_tasks position
todo_update_tasks position
hierarchy + position operations
```

### Failure case

Current view is sorted by Due Date.

AI says:

```text
Move Task A before Task B.
```

If the adapter calls `commitHierarchyDrag()` without the current-sort snapshot:

- A is inserted into old persistent `sortOrder`;
- service switches workspace sort to Custom;
- every other task can jump back to its old custom order;
- the whole list changes unexpectedly, not just A.

### Required correction

For every **explicit task position operation**:

1. inspect current Workspace sort;
2. if non-Custom, build the same full custom-order snapshot used by existing drag UI;
3. apply the semantic hierarchy/position operation against that snapshot;
4. synchronize `WorkspaceControls.sortKey = 'custom'` after the service commits;
5. report this side effect in the tool result when relevant.

The timing must be defined when fields/hierarchy also change. The snapshot must correspond to the state immediately before the position/hierarchy commit and must pass the service's complete-sibling-scope validation.

### Relevant files

```text
TodoList-ui/js/components/task-drag-commit.js
TodoList-ui/js/components/workspace-controls.js
TodoList-ui/js/storage/data-service-hierarchy.js
TodoList-ui/js/storage/data-service-drag.js
```

---

## 9. Whole-batch prevalidation must not reject operations that become valid because of an earlier item

### Current plan

Before a batch starts it says to:

```text
validate envelope/schema
reject duplicate update IDs
resolve referenced IDs/obvious conflicts when possible
```

Items then execute sequentially.

### Problem

Some referential/hierarchy validity can change because of an earlier item in the same batch.

Example:

```text
Item 1: move Task A from subtask → root
Item 2: make Task B a child of Task A
```

At the beginning of the batch, Task A is not a legal parent because it is a subtask.

If the executor globally prevalidates Item 2's parent legality against the initial snapshot, it rejects a request that is valid under the plan's sequential execution semantics.

Similar cases exist for:

```text
Project reparenting
Tag reparenting
position targets whose sibling scope changes in an earlier item
```

### Required correction

Split validation into two levels.

#### Before any mutation

Only validate static things that cannot be changed by earlier items:

```text
JSON/schema shape
array limits
field types/ranges
duplicate target IDs
obviously malformed IDs
```

#### Immediately before each item

Validate dynamic state against the **current authoritative AppState**:

```text
entity still exists
parent currently legal
cycle currently legal
position target currently in legal sibling scope
editor guard currently clear
```

This keeps sequential batch semantics coherent.

---

## 10. `todo_update_workspace` can also partially mutate, but the plan's stage reporting focuses on Tasks/Projects/Tags

### Problem

One workspace call can request multiple changes:

```text
navigate
viewType
sortKey
sortDirection
groupKey
```

Current Todo persistence uses separate operations for several of these.

Example:

```text
navigate succeeds in memory
viewType persists
sortKey persists
later groupKey write fails
```

The workspace has still changed.

### Required correction

Give `todo_update_workspace` the same honest staged semantics used elsewhere.

Suggested stage receipt:

```text
navigation
view
sort
sortDirection
group
```

If a later stage fails after earlier changes:

```text
PARTIAL_MUTATION
```

Return the final authoritative workspace state and still run one final UI reconciliation.

Also define the order when one call contains both navigation and view change. Recommended:

```text
navigate first
→ apply view to the new current target
→ sort/direction/group
```

unless a different product behavior is intended.

---

# P1 — Important remaining correctness/robustness changes

## 11. Project/Tag list tools have no real pagination/narrowing contract

### Problem

The revised task read tool has a good detailed pagination/budget design.

But the revised sections for:

```text
todo_list_projects
todo_list_tags
```

only say they return a bounded hierarchy. They no longer clearly define arguments such as:

```text
ids
query
offset
limit
includeCounts
```

### Failure case

A large Todo database has many Projects/Tags or long existing names.

The result hits the 64 KiB response limit.

Gemini receives `RESULT_TOO_LARGE` but has no supported way to ask for the next page/narrow by query.

### Required correction

Add a simple bounded read contract for Projects and Tags, for example:

```text
ids?: string[]
query?: string
offset?: integer >= 0
limit?: integer with a small hard max
includeCounts?: boolean
```

Return:

```text
totalMatched
offset
returnedCount
hasMore
```

Preserve hierarchy metadata (`parentId`, `childrenIds`, depth/order) in each returned item.

The model must always have a supported path to narrow a result after `RESULT_TOO_LARGE`.

---

## 12. `tagMatch=all` with descendant inclusion is ambiguous and easy to implement incorrectly

### Current public shape

```text
tagIds
tagMatch: any | all
includeTagDescendants: true by default
```

### Wrong naive implementation

Suppose:

```text
Tag A has children A1, A2
Tag B has children B1, B2
```

Expanding everything into one array and then doing:

```text
all expanded tag IDs must be present
```

would require the task to contain A, A1, A2, B, B1 and B2 simultaneously.

That is not a useful meaning of "all requested tags".

### Required correction

Define requested Tag trees independently.

For each requested tag ID:

```text
Tree(tag) = tag itself + descendants when enabled
```

Then:

```text
tagMatch:any
→ task has at least one assigned tag in at least one requested tree

tagMatch:all
→ for every requested tree, task has at least one assigned tag inside that tree
```

This preserves intuitive semantics when parent Tags are used as filters.

---

## 13. Read ordering must be deterministic before using `offset` pagination

### Problem

The task read plan defines `offset`/`limit`, but not the exact ordering of broad results.

Offset pagination without stable ordering can skip/duplicate tasks between pages even when the database did not change.

### Required correction

Define deterministic result order.

Recommended:

#### `scope=current_view`

Use the same current Todo display/family ordering that the user is seeing.

#### `scope=all`

Use one stable canonical Todo order, for example the existing family/sibling `sortOrder` order plus stable `createdAt/id` tie-breakers.

If query/filtering is applied, filter **after** establishing that deterministic base order unless the product intentionally defines another order.

Also define whether `includeSubtasks:false` removes only child records or changes root-family expansion behavior.

---

## 14. Todo request dedupe should bind one request ID to one exact request, not only `requestId + functionName`

### Current plan

Todo registry concept:

```text
requestId + functionName → in-flight/completed result
```

### Problem

A request ID is also the RPC correlation identity.

If a bug reuses one request ID with different arguments—or even a different function name—the Todo registry must not silently return an unrelated old result or execute a second mutation under the same correlation ID.

### Required correction

Key the registry primarily by:

```text
requestId
```

Store with it:

```text
functionName
canonical request fingerprint
status/result
```

Rules:

```text
same requestId + same function + same args
→ reuse same in-flight/completed result

same requestId + different function or args
→ protocol error / INVALID_ARGUMENT
→ never execute second mutation
```

Chat pending-map logic should also reject local request-ID collision.

---

## 15. Todo tool queue and shared `ensureReady()` Promise must be failure-resilient

### Problem

The plan conceptually shows:

```text
TodoToolExecutor._queue = Promise.resolve()
```

If implemented naively as:

```text
_queue = _queue.then(work)
```

one unexpected rejection can leave `_queue` permanently rejected, causing every future Todo tool call to fail without executing.

Current `AppDataService` already demonstrates the safer pattern by keeping its internal queue recoverable.

The same issue applies to the shared Shell `ensureTodoReady()` Promise: if the shared Promise rejects and is never cleared, all future calls can reuse a permanently failed Promise.

### Required correction

For Todo executor queue:

- each call gets its own returned Promise;
- the internal tail always catches/reset failures so future work can continue.

Conceptually follow the existing AppDataService approach:

```text
run = tail.then(work, work)
tail = run.catch(() => {})
return run
```

For shared readiness:

```text
create one promise while loading
clear the shared promise in finally after resolve/reject
next function call may attempt readiness again according to retry policy
```

Add pure-JS tests proving one failed tool/readiness attempt does not poison all later calls.

---

## 16. Editor guard still misses important **new-draft and related-entity** cases

The rejection strategy is good and much simpler than redesigning all editors, but the guard matrix should be expanded.

### A. New Project/Subproject or Tag/Subtag modal

Current taxonomy UI stores:

```text
editingProjectId = null
editingTagId = null
```

when creating a new entity.

The draft can still have a selected parent in:

```text
projectParentSelect
tagParentSelect
```

If AI deletes/reparents that selected parent, the draft can become invalid even though `editingProjectId/editingTagId` is null.

### B. New Subtask editor

Current Subtask editor has:

```text
editingSubtaskId = null
parentTaskId = existing parent ID
```

while creating a new subtask.

If AI does any of these to that parent before the user saves:

```text
delete parent
complete parent
move/link parent so it becomes a subtask
```

then the new Subtask draft can no longer be legally saved under that parent.

The current plan explicitly mentions parent deletion, but not the other parent-invalidating mutations.

### C. Taxonomy hierarchy update can invalidate an open taxonomy draft without deleting anything

Example:

```text
User edits Project X and has unsaved parent = Y
AI reparents Y underneath X
```

The user's pending save would now create a cycle and fail.

### Required correction

The guard should inspect **active modal + draft references**, not only editing IDs.

A conservative v1 rule is acceptable:

- reject hierarchy/destructive mutations touching an entity or parent relationship referenced by an active same-domain draft;
- re-check the guard immediately before each mutation item, not only once when the whole tool call begins.

This still avoids changing normal editor save logic.

### Relevant files

```text
TodoList-ui/js/components/tasks.js
TodoList-ui/js/components/subtask-editor.js
TodoList-ui/js/components/sidebar-taxonomy-core.js
```

---

## 17. Final UI sync should include Subtask-editor metadata and stale transient menus

### Problem

The plan's final Tag refresh mentions:

```text
Sidebar Tag tree
Task Tag menu
Task render
counts
```

But the Todo app has a separate Subtask Tag menu in:

```text
TodoList-ui/js/components/subtask-editor.js
```

### Failure case

1. User has Subtask editor open.
2. AI creates or renames a Tag that is not currently selected by the draft, so editor guard correctly allows it.
3. Final UI sync updates Sidebar + Task menu only.
4. Open Subtask Tag menu still shows old data until the editor is reopened.

Project metadata can have a similar presentation issue because the Subtask editor shows a Project lock label based on the parent Project.

Task hierarchy mutation can also leave body-level transient UI such as the Task parent picker/action menu containing stale IDs.

### Required correction

`todo-tool-ui-sync.js` should reconcile safe, non-draft presentation state too.

Examples:

```text
Tag domain changed
→ SubtaskEditorComponent.renderTagMenu()
→ if Subtask editor active, resync selected-state UI without modifying typed fields

Parent Project metadata changed
→ refresh Subtask project lock text if Subtask editor is active

Task hierarchy/deletion changed
→ close stale Task action/parent picker/context menus before/after render
```

The rule remains:

```text
never overwrite title/description/unsaved schedule fields
```

but visible metadata should not remain stale.

---

## 18. Standalone ChatUI needs an explicit **effective declaration gate**, not only a disabled checkbox

### Existing state behavior

The same `ChatUI_DB` can contain:

```text
tools.todo = true
```

from a previous combined-shell session.

Standalone ChatUI can then load that saved preference even though no Shell/Todo sibling exists.

### Problem

Current generic function registry is shaped like:

```text
getCustomFunctionDeclarations(activeTools)
```

and currently Workspace declarations depend only on the active tool snapshot.

If Todo is added with only:

```text
if (activeTools.todo) declarations.push(...TODO_DECLARATIONS)
```

standalone ChatUI will still advertise Todo functions even though its UI looks disabled/unavailable.

### Required correction

Define two separate concepts:

```text
saved/generation permission = activeTools.todo
bridge support = Chat is embedded in a compatible Shell Todo-RPC environment
```

Todo declarations require both.

Because the revised product intentionally allows Todo to auto-wake, bridge support does **not** need to mean the Todo iframe is already READY. It means a compatible Shell RPC path exists and can perform `ensureTodoReady()`.

Standalone:

```text
bridge support false
→ no Todo declarations
→ executor returns unavailable if somehow invoked
→ saved preference remains untouched
```

---

## 19. Project/Subproject and Tag/Subtag parent+child creation flow was lost from the revised plan

The task section correctly keeps the rule:

```text
create parent first
→ use returned real parent ID in next tool round
→ no temporary fake IDs
```

The revised Project/Tag sections no longer state the same rule clearly.

### Required correction

Add to both create tool descriptions:

```text
A newly created Project/Tag does not have an ID until Todo commits it.
If the user wants a new parent and new child together, create the parent first, then use its returned ID in the next function round.
Do not invent temporary parent IDs inside one batch.
```

This is especially important because the model will otherwise naturally try to create nested taxonomy items in one call.

---

## 20. The To-Do tool UI still does not explain the data/privacy boundary

### Problem

Todo data is local in `TodoListDB` until a Todo read result is returned to Chat/Gemini.

When Gemini uses:

```text
todo_find_tasks
todo_list_projects
todo_list_tags
todo_get_workspace
```

selected Todo content is included in the model request/function-response conversation and therefore sent to the configured Gemini endpoint.

The revised UI text currently proposed is only:

```text
Manage tasks, projects & tags
```

### Required correction

Add a concise user-facing permission description somewhere appropriate in the tool card/tooltip/settings, for example:

```text
Allows AI to read and change your To-Do data. Todo information used by the AI may be sent to your configured model endpoint.
```

Keep result data minimal/bounded as already planned.

This is transparency, not a database architecture change.

---

## 21. "Canonical normalized args" on the Chat-side replay guard risks duplicating Todo business normalization

### Problem

The replay plan says Chat fingerprints:

```text
functionName + canonical normalized args
```

But the authoritative normalizers are deliberately planned on the Todo side.

If Chat independently reproduces Todo normalization for:

```text
priority
reminders
repeat
project/tag semantics
position
omitted/default fields
```

there will now be two sources of semantic normalization—the exact architecture the plan otherwise tries to avoid.

### Also: some arrays are set-like while others are ordered

Examples:

```text
tagIds [A,B] and [B,A] are semantically equivalent
reminders may be semantically set-like
mutation batch item order is intentionally meaningful
```

A generic JSON canonicalizer that preserves every array will miss some semantic duplicates. Sorting every array would incorrectly change batch semantics.

### Required correction

Define replay fingerprint ownership precisely.

Safe options:

### Option A — simple Chat structural fingerprint

Chat fingerprints only the exact JSON semantics it received:

- recursively sort object keys;
- preserve array order;
- no Todo business coercion.

This can miss some semantically equivalent duplicates but does not duplicate Todo business rules.

### Option B — Todo-owned canonical mutation fingerprint

Todo normalizer produces the authoritative normalized fingerprint/receipt and returns it with mutation results. Todo-side recent replay protection can compare future normalized calls before execution.

If this is moved Todo-side, retain temporary persistence across Todo iframe reload if duplicate safety across retry/reload is required.

Do not copy the complete Todo normalizer into Chat only for replay detection.

---

## 22. `position` and returned "order summary" still need exact semantic wording

### Two different concepts exist

Todo has:

```text
persistent sibling/custom order
current rendered order under Due Date/Priority/Name/Created sorting
```

They are not always the same.

### Required correction

Define:

```text
position.top/bottom
→ top/bottom of the full legal sibling scope used by persistent Custom order

position.before/after
→ relative to the specified legal sibling ID
```

When an explicit Task position causes the workspace to switch to Custom, return/report that side effect.

For read results, do not use an ambiguous field like:

```text
position: 3
```

without saying what it means.

Prefer explicit names such as:

```text
customSiblingIndex
currentViewIndex
```

only when needed.

Do not claim a persistent custom index is the current visual position while the workspace is sorted by Due Date/Name/Priority/etc.

---

# P2 — Smaller semantics/testing improvements

## 23. Define whether collapsed subtasks are included in `visibleTaskIds`

The plan correctly says current-view reads must use Todo's family-aware display source.

But the word:

```text
visibleTaskIds
```

can mean either:

```text
tasks belonging to the current rendered family/filter
```

or literally:

```text
cards currently expanded and visible on screen
```

Todo has collapsible subtask families.

### Recommended wording

Use something like:

```text
currentViewTaskIds
```

for the filter/family membership returned to AI.

Do not make AI behavior depend on whether the user happened to collapse a parent unless that is deliberately desired.

If literal expansion state is ever needed, expose it separately.

---

## 24. Request/result dedupe registries need explicit bounds/expiry

The plan says Todo's request registry is bounded but does not define its lifetime/eviction.

Add simple limits such as:

```text
maximum recent entries
TTL
remove settled entries after TTL
never evict an in-flight entry
```

Do the same for Chat replay receipts.

This prevents a long-running tab from accumulating tool results indefinitely.

---

## 25. Add the new second-review cases to static/pure-JS/manual verification

The revised testing section is strong, but add tests for the remaining issues above.

### Pure-JS / service-level cases

```text
1. Todo tool queue continues after one unexpected rejected call.
2. Shared ensureReady promise clears after rejection and a later call can recover.
3. Same requestId + different args/function is rejected.
4. Known PARTIAL_FAILURE/PARTIAL_MUTATION blocks blind exact replay.
5. projectId:null on a subtask unlinks it to Inbox/root according to final-state rules.
6. dueTime with no date follows the chosen Todo scheduling invariant.
7. dueDate:null while repeat remains active follows the chosen invariant.
8. repeat end date before due date is rejected.
9. explicit task position from non-Custom sort uses a custom-order snapshot.
10. tagMatch=all + descendant Tags uses one match per requested Tag tree.
11. project/tag list pagination stays under response budget.
12. sequential batch validation uses current state per item rather than only initial state.
```

### Browser/manual cases

```text
13. Successful Todo mutation → Regenerate answer → mutation does not run again.
14. Duplicate guard asks confirmation → unrelated next user message does not count as confirmation.
15. Stop generation while Todo request is dispatched but not started → request does not mutate later if cancellation proves it never started.
16. Chat iframe reload after success/unknown mutation → replay protection still prevents blind duplicate.
17. New Subtask editor open → AI cannot complete/move/delete its parent in a way that invalidates the draft.
18. New Subproject/Subtag modal open → AI cannot invalidate selected parent hierarchy.
19. Tag created/renamed while unrelated Subtask editor is open → its Tag UI refreshes without losing typed draft.
20. Task explicit position while sorted by Due Date → only intended order transition occurs; remaining tasks preserve the visible order when Custom activates.
21. Standalone ChatUI with saved tools.todo=true → Todo declarations are still absent.
22. Large Project/Tag collection → model can paginate/narrow instead of hitting an unrecoverable RESULT_TOO_LARGE.
```

---

# First-review findings that are now resolved or intentionally decided

The next implementation agent should **not reopen these unless implementation proves a new problem**.

## Resolved: reminder promise mismatch

The revised plan explicitly says reminder configuration is supported now while real browser/system delivery is a separate Todo feature.

Good.

## Resolved: stale frame-manager mutation queue

The plan explicitly forbids placing Todo RPC in the normal deferred frame queue and separates readiness waiting from actual dispatch.

Good.

## Resolved: aggressive 15-second universal timeout

The revised plan now separates readiness/read/mutation timeouts and treats post-dispatch mutation timeout as an uncertain outcome.

Good, subject to the cancellation/replay refinements in this second review.

## Resolved: fixed task-update order

The plan now uses final hierarchy state and handles subtask → root before root Project assignment.

Good, except the remaining `projectId:null` case described above.

## Resolved: full open-editor concurrency redesign

The user intentionally chose `EDITOR_CONFLICT` rejection instead of rewriting all editors with version tracking.

That is a reasonable v1 decision. This review only asks to expand the guard coverage to all active draft dependencies.

## Resolved: completed-parent subtask creation

Explicitly included.

## Resolved: strict AI-facing date/time/repeat validation

The plan now correctly requires strict validation before tolerant RepeatEngine normalization. This review only adds the missing final scheduling/end-date invariants.

## Resolved: AI-facing year months

Human 1..12 month format is now explicit.

## Resolved: reminder conversion path

The revised plan correctly uses deterministic custom reminder IDs and does not pre-save custom reminder definitions separately.

## Intentionally decided: completion + position is supported

The user explicitly chose this behavior and the plan defines position as applying to the requested occurrence before normal completion behavior.

Do not reopen the previous recommendation to reject the combination. Just fix the non-Custom snapshot behavior and report actual repeat side effects accurately.

## Resolved: current-view selector

The plan explicitly points to Todo's family-aware display source rather than inventing separate AI filter behavior.

## Resolved: `whenIdle()` before reads/snapshots

Included.

## Resolved: UI refresh after partial changes

Included.

## Resolved: request and response payload budgets

Both are now bounded with compact Task summaries/full detail modes.

## Resolved: stable error codes without parsing service error strings

Included.

## Resolved: repeat/family/taxonomy side-effect reporting

Included.

## Resolved: Custom workspace sort activation

The exact `buildCustomOrderSnapshot()` → `activateCustomSort()` behavior is now documented for workspace sort changes.

## Resolved: duplicate target IDs in updates

Explicitly rejected.

## Resolved: Gemini declaration format

The plan explicitly treats pseudo-types as conceptual and requires the same declaration format Workspace already uses.

## Intentionally decided: no extra Chat delete confirmation in v1

The user explicitly chose this product behavior.

Do not add a hidden Todo `window.confirm()` or surprise approval modal during implementation.

The implementation should still keep deletes separate, accurately described, non-retried, and fully reported.

## Resolved: provider-neutral Todo activity design

Central provider resolver is now planned.

## Resolved: CI/static verifier update

The plan explicitly removes the old "Todo bridge must not exist" invariant and adds Todo-RPC checks.

---

# Recommended plan repair order after this second review

Revise Implementation Plan ID 3 in this order:

1. **Fix duplicate confirmation identity** — explicit confirmation token + user-turn identity; Regenerate is not confirmation.
2. **Persist replay receipts across Chat iframe reload** and cover known partial commits.
3. **Define Abort/cancel phases** so Stop cannot leave an unstarted queued mutation that executes later.
4. **Complete Task final-state rules** for subtask `projectId:null` and date/time/repeat scheduling invariants.
5. **Add Repeat end-date-vs-due-date strict validation.**
6. **Require current-sort snapshot for every explicit task position operation.**
7. **Split batch validation into static prevalidation + dynamic per-item validation.**
8. **Give workspace updates staged partial-mutation semantics.**
9. **Add Project/Tag query/pagination contracts and deterministic Task read ordering.**
10. **Strengthen request-ID binding and failure-resilient queues/readiness promises.**
11. **Expand editor guard to new drafts/related hierarchy dependencies and update safe open-editor metadata UI.**
12. **Make standalone declaration gating explicit.**
13. **Restore parent→child sequential creation guidance for Projects/Tags.**
14. **Add privacy disclosure and precise position/order wording.**
15. **Add the second-review tests.**

---

# Final assessment

The revised plan is now **close to implementation-ready**.

The first version had major architectural/correctness gaps. The current version fixed most of them. The remaining dangerous cases are concentrated around:

```text
1. proving that a duplicate mutation was truly confirmed;
2. preserving replay protection across Chat reload/Regenerate;
3. preventing an aborted-but-not-started Todo request from mutating later;
4. handling known partial commits safely;
5. matching Todo's real date/time/repeat final-state rules;
6. preserving visible ordering when AI position switches a non-Custom workspace to Custom;
7. guarding new/related editor drafts, not only exact editing IDs.
```

Once those are incorporated, the existing high-level architecture remains the right one:

```text
Gemini custom function
→ Chat Todo bridge
→ Shell exact-origin correlated RPC
→ Todo-owned tool adapter
→ existing Todo services/AppState/IndexedDB
→ one safe UI reconciliation
→ structured result back to Gemini
```

There is no need to redesign the Todo application or replace the persistent iframe architecture to implement this feature.