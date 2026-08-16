# Review of Implementation Plan ID 3 — ChatUI → Todo AI Tool Integration

## Purpose

This document reviews:

- `implementation plan/Implementation Plan ID 3.md`
- the current root iframe shell
- the current ChatUI custom-function/generation/tool architecture
- the current TodoList-ui state, service, hierarchy, taxonomy, repeat, reminder, sorting, filtering, editor, and UI-refresh behavior

The purpose is **not** to implement the feature. The purpose is to give the next agent a precise list of changes that should be made to Implementation Plan ID 3 before implementation begins.

## Review baseline

Reviewed against `main` at:

```text
aa5334d86381a5f5de285fd9c86a07407c533e39
```

Important current source files checked include:

```text
shell/js/protocol.js
shell/js/frame-manager.js
shell/js/frame-bridge.js
shell/js/app-shell.js

ChatUI/js/tools/function-tool-registry.js
ChatUI/js/workspace/workspace-tool-definitions.js
ChatUI/js/workspace/workspace-tool-executor.js
ChatUI/js/api/gemini.js
ChatUI/js/chat/generation-runner.js
ChatUI/js/chat/send-message.js
ChatUI/js/chat/streaming.js
ChatUI/js/chat/activity-timeline.js
ChatUI/js/composer/composer.js
ChatUI/js/state/store.js
ChatUI/js/storage/load.js
ChatUI/js/storage/records.js
ChatUI/js/storage/mutations.js
ChatUI/js/voice/live-voice-controller.js
ChatUI/js/embedded/shell-bridge.js

TodoList-ui/js/app-main.js
TodoList-ui/js/state.js
TodoList-ui/js/state-sync.js
TodoList-ui/js/task-model.js
TodoList-ui/js/task-filter.js
TodoList-ui/js/task-relations.js
TodoList-ui/js/task-order.js
TodoList-ui/js/storage/data-service.js
TodoList-ui/js/storage/data-service-hierarchy.js
TodoList-ui/js/storage/data-service-drag.js
TodoList-ui/js/storage/data-service-taxonomy.js
TodoList-ui/js/storage/data-service-taxonomy-drag.js
TodoList-ui/js/storage/data-service-reminders.js
TodoList-ui/js/storage/mappers.js
TodoList-ui/js/repeat/repeat-engine.js
TodoList-ui/js/components/tasks.js
TodoList-ui/js/components/task-actions.js
TodoList-ui/js/components/task-hierarchy.js
TodoList-ui/js/components/task-renderer.js
TodoList-ui/js/components/subtask-editor.js
TodoList-ui/js/components/sidebar.js
TodoList-ui/js/components/workspace-controls.js
TodoList-ui/js/components/schedule-time-reminders.js
TodoList-ui/js/components/schedule-wheels.js
TodoList-ui/js/embedded/shell-bridge.js
TodoList-ui/problem is need to be fixed.md

scripts/build-static.mjs
scripts/verify-integration.mjs
.github/workflows/iframe-integration-check.yml
```

---

# Overall verdict

Implementation Plan ID 3 has a **good architecture and good product direction**. The most important decisions are correct:

- ChatUI must not write directly to `TodoListDB`.
- The Todo iframe must own Todo business logic.
- Chat → Shell → Todo is the correct iframe boundary.
- Existing `AppDataService` / hierarchy / taxonomy / repeat logic should be reused.
- The existing ChatUI Gemini custom-function loop should be extended instead of replaced.
- Plural/batch tools are a good choice.
- Semantic IDs and semantic position are better than exposing `sortOrder`.
- Todo capability must be separate from the saved ChatUI tool preference.
- Live Voice using the normal Chat generation path is a correct assumption.
- UI should refresh once after a batch instead of after every item.
- Standalone ChatUI should remain safe when no Todo iframe exists.
- New files under the existing `js` trees are already included by the combined build script.

However, the plan is **not yet safe enough to implement exactly as written**. There are several cases where an agent could follow the plan faithfully and still create incorrect data, duplicate mutations, stale UI, or lost user edits.

The findings below should be incorporated into the plan first.

---

# P0 — Fix before implementation

## 1. Reminder wording currently promises behavior that Todo does not have

### Problem

The plan's Live Voice example says:

```text
"Create a task called Buy medicine tomorrow at 5 PM and remind me 30 minutes before."
```

and expects Gemini to confirm the reminder.

But current Todo has **reminder configuration only**. The permanent Todo tracker still has this open item:

```text
[ ] Decide and implement real reminder delivery.
```

`TodoList-ui/js/storage/data-service-reminders.js` stores reminder definitions/relations, but there is no completed browser/system notification-delivery engine.

### Failure case

The user says:

```text
Remind me 30 minutes before.
```

The AI creates a task with a 30-minute reminder definition and says it will remind the user. No actual notification engine exists, so the user may never receive an alert.

### Required plan correction

Choose one of these explicitly:

**Option A — recommended for ID 3:** Todo tools can configure reminder metadata, but tool descriptions/results must call it `reminder configuration` and must not promise that a notification will actually fire.

**Option B:** Make real reminder delivery a prerequisite dependency and do not mark ID 3 complete until that separate Todo problem is implemented.

Do not let the AI claim a real alert exists when the app currently only stores reminder settings.

### Relevant files

```text
TodoList-ui/problem is need to be fixed.md
TodoList-ui/js/storage/data-service-reminders.js
TodoList-ui/js/storage/mappers.js
```

---

## 2. Todo mutation RPC must never use the current frame-manager queue while Todo is not READY

### Problem

Current `shell/js/frame-manager.js` deliberately queues ordinary messages when a frame is not `READY`:

```text
send()
→ if state !== READY
→ queue.push(message)
```

The queue is also preserved across retry/reload.

That behavior is acceptable for harmless synchronization messages such as route/appearance requests. It is **dangerous for Todo mutations**.

### Failure case

1. Todo iframe is `LOADING` or has failed.
2. Chat attempts `todo_create_tasks`.
3. Shell uses normal `frameManager.send()`.
4. Request is queued.
5. Chat bridge reaches its timeout and tells Gemini `TODO_UNAVAILABLE` / `BRIDGE_TIMEOUT`.
6. User later retries Todo iframe.
7. Old queued mutation is delivered after Todo becomes READY.
8. A task is created even though the original Chat operation already failed/timed out.

This creates a stale delayed side effect.

### Required plan correction

Add a hard rule:

```text
Todo tool mutation/read RPC is NEVER queued by frameManager.
```

Before forwarding a Todo RPC request, Shell must verify:

```text
Todo frame state === READY
AND app:ready advertised todo-tools-v1
```

If not, fail immediately with `TODO_UNAVAILABLE`.

Use a dedicated immediate RPC send path or a `sendNowIfReady()` method. Do not reuse the ordinary deferred queue for Todo RPC.

When Todo transitions `READY → LOADING/FAILED`, capability must immediately become unavailable in Chat.

### Relevant files

```text
shell/js/frame-manager.js
shell/js/frame-bridge.js
shell/js/app-shell.js
```

---

## 3. The 15-second timeout can cause duplicate non-idempotent mutations

### Problem

The plan says:

```text
Todo RPC timeout = 15 seconds
late response after timeout = ignored
```

But Todo mutation continues after Chat stops waiting. A 50-item sequential batch can legitimately take longer on a phone or slower IndexedDB environment.

Create/update/delete calls are not automatically idempotent.

### Failure case

1. Gemini calls `todo_create_tasks` for 40 tasks.
2. Todo commits 30 tasks.
3. Chat reaches 15 seconds and returns `BRIDGE_TIMEOUT`.
4. Todo continues and commits the rest.
5. The result arrives late and Chat ignores it.
6. Gemini retries the create request with a new request ID.
7. Duplicate tasks are created.

The same problem can happen if the iframe reloads after committing a mutation but before sending the response.

### Required plan correction

Add an explicit **mutation delivery/idempotency policy**:

- Todo executor keeps an in-memory request registry keyed by `requestId + functionName`.
- Duplicate delivery of the **same request ID** must return/reuse the same in-flight/completed result and must not execute twice.
- Chat must never automatically retry a timed-out non-idempotent mutation with a new request ID.
- After an uncertain mutation timeout, Chat/Gemini should perform a read-back/reconciliation step before retrying create/update/delete.
- Consider a longer mutation timeout (for example 30–60 seconds) or operation-aware timeouts; 15 seconds is too aggressive for a maximum 50-item sequential batch.
- Document that in-memory dedupe cannot protect across a full Todo iframe reload. After reload/uncertain completion, reconciliation is required before retry.

Also add a stable error/result state such as:

```text
MUTATION_OUTCOME_UNKNOWN
```

for cases where Chat stopped waiting but cannot prove whether Todo committed.

Do not report `REQUEST_ABORTED` as if committed work was rolled back.

---

## 4. `PARTIAL_FAILURE` only describes earlier batch items, but one single item can itself partially mutate

### Problem

The plan's task-update sequence is:

```text
updateTask()
→ hierarchy operation
→ position operation
→ toggleTaskStatus()
```

These are separate durable AppDataService operations/transactions.

The same problem exists for:

```text
create → position → complete
project/tag update → reparent/reorder
```

If a later stage fails, part of **the same item** may already be committed.

The current plan's `PARTIAL_FAILURE` structure mostly describes earlier successful array items followed by a failed item. It does not accurately describe partial mutation inside the failed item.

### Failure case

A single `todo_update_tasks` item asks to:

```text
rename task
move it to another parent
place it before another task
complete it
```

`updateTask()` commits the rename. The hierarchy operation commits the new parent. Position then fails because the target became invalid. The tool reports one failed item, but that item has already changed twice.

### Additional concurrency problem

Because separate service calls are awaited one by one, a manual user action can enter `AppDataService._writeQueue` between AI stages. One logical AI item is therefore not guaranteed to remain contiguous relative to manual Todo writes.

### Required plan correction

The plan needs one of these explicit strategies:

**Preferred:** add narrow Todo-domain compound service helpers for operations that cannot be safely represented as one public service call. The helper should own one queue entry and, where practical, one IndexedDB transaction/consistent operation plan. It must remain generic Todo logic, not Gemini-specific logic.

**If full transaction composition is too invasive:** define per-item staged partial mutation semantics. Return exactly which stages committed and use a code such as:

```text
PARTIAL_MUTATION
```

Then force UI refresh and return the final authoritative state.

The current wording "prefer no existing service changes" should be softened because the source proves that some compound operations cannot be treated as atomically successful merely by chaining public methods.

### Relevant files

```text
TodoList-ui/js/storage/data-service.js
TodoList-ui/js/storage/data-service-hierarchy.js
TodoList-ui/js/storage/data-service-taxonomy-drag.js
```

---

## 5. The fixed task-update ordering is wrong for subtask → root + project change

### Problem

The plan says ordinary fields are applied before hierarchy changes:

```text
3. AppDataService.updateTask()
4. link/unlink/reparent
```

But current `AppDataService.buildTask()` forces a subtask's project to its parent's project. Any supplied project value is ignored while the task is still a subtask.

### Concrete failure

Current task:

```text
Subtask S
parent = P
project = Work
```

AI request:

```text
Make S a root task and move it to Personal.
```

If the plan is followed literally:

1. `updateTask(S, { project: Personal })`
   - S is still a subtask.
   - service keeps parent's `Work` project.
2. `unlinkTask(S)`
   - S becomes root but keeps `Work`.

Final result is wrong: requested `Personal` was lost.

### Required plan correction

Replace one universal ordering with a **task mutation planner based on final hierarchy state**.

Rules should include:

- If final state is a subtask, explicit `projectId` is illegal/conflicting because project is inherited. Reject it rather than silently ignore it.
- Root → subtask: perform legal hierarchy transition; project becomes parent's project; reject conflicting `projectId`.
- Subtask → different parent: project is inherited from new parent; reject explicit `projectId`.
- Subtask → root with `projectId`: unlink first, then apply root project update.
- Subtask → root without `projectId`: preserve current unlink semantics/project unless product rules say otherwise.
- Root project change should report child tasks affected by project propagation.

This is not optional—the current generic order produces incorrect state.

---

## 6. Open-editor policy can lose user edits or overwrite AI changes

### Problem

The plan says:

```text
do not repopulate an open editor
underlying AppState changes immediately
user can close/reopen to see latest state
```

That avoids overwriting the visible draft immediately, but it creates a later **lost-update** problem.

Current Task and Subtask editors submit a full payload containing title, description, tags, date, time, reminders, repeat, priority, etc. They do not submit only fields the user changed.

### Failure case

1. User opens Task A editor.
2. Editor contains old priority/date/tags.
3. User starts typing a new title but has not saved.
4. AI changes Task A priority and date in the background.
5. Plan leaves editor fields untouched.
6. User presses Save.
7. Editor sends its old priority/date values and overwrites the AI changes.

The plan therefore does not actually prevent conflict—it delays it.

### Required plan correction

Add optimistic concurrency handling for open editors.

At minimum:

- capture entity `updatedAt` / version when the editor opens;
- after AI mutates the same entity, mark the open editor stale/conflicted;
- do not silently allow a stale full-form Save;
- preserve the user's typed draft;
- on Save, either:
  - show a conflict prompt/banner and let user reload/review, or
  - merge only fields actually edited by the user if field-level dirty tracking is implemented.

If the exact entity is deleted, close the editor safely as the plan already says.

Also handle related invalid state:

- deleted selected Project in an open Task editor;
- deleted selected Tags in Task/Subtask editor;
- parent task deleted while Subtask editor is open;
- Schedule/Repeat nested modal open for an entity that was deleted;
- taxonomy editor open for an entity AI deletes/changes.

Do not merely rebuild menus while leaving internal `selectedProject`/`selectedTags` pointing at removed IDs.

### Relevant files

```text
TodoList-ui/js/components/tasks.js
TodoList-ui/js/components/subtask-editor.js
TodoList-ui/js/components/task-actions.js
TodoList-ui/js/components/modal-focus.js
```

---

# P1 — Important correctness changes

## 7. Creating a subtask must explicitly reject a completed parent

### Problem

Current UI/hierarchy rules consider a completed root task ineligible as a parent.

`DataServiceHierarchyMethods.validateHierarchyLink()` rejects:

```text
Completed tasks cannot be used as parent tasks.
```

But `AppDataService.createTask({ parentTaskId })` does **not** use that validation. `buildTask()` only uses `AppState.validateParentTaskId()`, which verifies that the parent exists and is a root task; it does not reject completed parents.

### Failure case

An implementation agent assumes `createTask()` alone enforces every parent rule and creates an AI subtask beneath a completed task—something the normal task-link UI would not allow.

### Required plan correction

Before AI subtask create, explicitly validate:

```text
parent exists
parent is root
parent is not completed
```

Prefer a shared Todo-domain validation helper so create/link/tool behavior stays consistent.

Do not assume `createTask()` currently enforces the completed-parent rule.

---

## 8. Strict date/time validation is required because existing Task services accept arbitrary strings

### Problem

`TaskModel.normalizeTask()` accepts any non-empty string as `dueDate` and `dueTime`.

`AppDataService.buildTask()` does not strictly parse them.

Therefore the plan is correct to put validation in the tool normalizer, but this must be stated as a **hard correctness requirement**, not a light formatting check.

### Required plan correction

Tool normalizers must reject, not silently normalize:

```text
2026-02-31
2026-13-10
25:80 PM
00:30 AM
13:00 PM
random text
```

For `dueDate`, reuse a strict local-date parser/check equivalent to RepeatEngine's exact year/month/day validation.

For `dueTime`, require the exact AI contract and canonicalize one format, for example:

```text
01:05 PM
```

Define omitted vs `null` clearly:

```text
omitted = unchanged on update
null = clear
```

---

## 9. `RepeatEngine.validateRepeatRule()` is not strict enough by itself for AI input

### Problem

The plan says:

```text
Always validate through the existing RepeatEngine before persistence.
```

That is necessary but not sufficient.

`RepeatEngine.validateRepeatRule()` first calls `normalizeRepeatRule()`, which intentionally sanitizes/clamps/filter values:

- interval is clamped to 1..99;
- end count is clamped to 1..200;
- invalid weekday values are filtered;
- invalid month days are filtered;
- unsupported values can become defaults.

For a human UI this tolerant normalization is useful. For an AI tool it can silently change the model's requested meaning.

### Failure case

Gemini sends an invalid repeat interval/count/day. The adapter calls only `validateRepeatRule()`. The engine changes the value to a legal one and reports valid, so the tool says success even though it did not store the requested rule.

### Required plan correction

Use **two layers**:

1. strict AI-facing schema/value validation with no silent coercion;
2. then `RepeatEngine.validateRepeatRule()` / normalization for canonical internal behavior.

Strictly reject out-of-range interval/count/weekdays/monthDays/year dates.

---

## 10. AI-facing `yearDates` should not expose the internal 0-based month representation

### Problem

The plan currently exposes:

```text
yearDates?: object // existing RepeatEngine month-index → days representation
```

Current RepeatEngine uses month indexes `0..11` internally. That is implementation-friendly but not AI/user-friendly and creates off-by-one risk.

### Required plan correction

Use a human-facing shape such as:

```json
{
  "yearDates": [
    { "month": 1, "days": [5, 20] },
    { "month": 12, "days": [1] }
  ]
}
```

with `month: 1..12`.

The Todo adapter maps that to the internal `0..11` object expected by RepeatEngine.

Do not make Gemini reason about JavaScript month indexes.

---

## 11. Reminder conversion needs an exact adapter rule and current UI range

### Problem

The plan says semantic `minutesBefore` is converted to existing custom reminder representation, but it does not state the exact safest service path.

Current Todo custom reminder IDs are deterministic:

```text
custom-<day>d-<hr>h-<min>m
```

`AppDataService.resolveReminders()` can reconstruct/persist an unknown custom definition from that ID as part of the task aggregate transaction.

The normal custom reminder UI currently exposes roughly:

```text
minutes 0..60
hours   0..23
days    0..60
```

### Required plan correction

Define:

- a maximum accepted `minutesBefore` compatible with current Todo UI/data expectations;
- canonical conversion of total minutes → day/hour/minute components;
- built-in IDs are reused first (`on_time`, `5_min`, `10_min`, etc.);
- otherwise create the deterministic custom ID and pass that reminder ID into `createTask()` / `updateTask()`.

**Do not pre-save a custom reminder definition with `saveReminderDefinition()` before the task mutation unless truly necessary.** The aggregate path can persist/resolve it. Pre-saving separately can leave an orphan custom reminder if the task operation later fails.

Also define update semantics:

```text
reminders omitted = unchanged
reminders: []      = clear reminders
```

---

## 12. `position` combined with completion has ambiguous/incorrect visual semantics

### Problem

Task custom ordering is shared by sibling scope, while active and completed tasks are rendered in separate lanes/sections.

The plan says position is applied before completion, and completion is applied last.

### Failure case

AI requests:

```text
complete Task A and place it before active Task B
```

The tool positions A relative to B while A is active, then completion moves A into the Completed section. The relative relationship is no longer visible/meaningful.

Repeating completion is even more complex because completing the requested task may create a **new task ID** for the next occurrence.

### Required plan correction

For v1, choose a simple deterministic rule. Recommended:

```text
Reject a TaskCreate/TaskUpdate item that combines a completion-state transition with explicit position.
Ask/use two tool rounds when both are needed.
```

If the plan chooses to support the combination, it must define whether position applies to:

- the original completed occurrence;
- the generated next repeat occurrence;
- final active/completed lane;
- which sibling target types are legal.

Do not leave it implicit.

Also validate `before/after` targets are in the correct final sibling scope and, if visual semantics are intended, the correct active/completed lane.

---

## 13. `current_view` must use the real family-aware display selector, not a simple task filter

### Problem

Current Todo rendering deliberately uses:

```text
TaskFilter.getDisplayTasks()
```

not just `AppState.getFilteredTasks()`.

Its family behavior is special:

- if a root task matches, the root is returned and rendering then displays its child family;
- if the root does not match, individually matching children can appear as standalone filtered subtasks.

Therefore `scope: current_view` and `todo_get_workspace.visibleTaskIds` can easily disagree with what the user actually sees if implemented with only `AppState.matchesFilter()` / `getFilteredTasks()`.

### Required plan correction

Create one Todo-side **AI-visible-current-view selector** based on the same `TaskFilter.getDisplayTasks()` and family expansion used by `TaskRendererMethods`.

Use the same selector for:

```text
todo_find_tasks(scope=current_view)
todo_get_workspace.visibleTaskIds
visibleTaskCount
```

Define whether collapsed subtasks count as "visible". Recommended distinction:

```text
displayScopeTaskIds = tasks belonging to current rendered filter/families
currentlyExpandedVisibleTaskIds = optional UI-only subset
```

Do not invent separate filter logic in the tool executor.

---

## 14. Read tools should wait for pending Todo writes before reading AppState

### Problem

Todo mutations are serialized through `AppDataService._writeQueue`. AppState is updated after persistence stages.

A read tool that directly reads `AppState` can race with an already-running manual/UI write and return stale data.

### Failure case

1. User changes a task manually.
2. IndexedDB write is in progress.
3. Chat immediately calls `todo_find_tasks`.
4. Tool reads AppState before the queued mutation finishes.
5. Gemini receives old state and may make a wrong follow-up mutation.

### Required plan correction

Before a Todo read tool takes its state snapshot, call:

```text
await AppDataService.whenIdle()
```

Then serialize a consistent AppState snapshot.

The same applies to pre-read state used to calculate mutation results/side effects when correctness depends on the latest committed state.

---

## 15. UI refresh must happen after partial failure too

### Problem

The plan correctly says one UI refresh after a batch, but some wording says refresh after a "successful AI mutation".

A tool can return `ok:false / PARTIAL_FAILURE` after earlier items were durably committed. The Todo DOM still needs to show those committed changes immediately.

### Required plan correction

Todo executor/UI-sync layer must track something like:

```text
mutationOccurred = true/false
mutationDomains = task/project/tag/workspace
```

In `finally`, if any durable mutation occurred, run one final UI reconciliation **even when the overall tool result is an error or PARTIAL_FAILURE/PARTIAL_MUTATION**.

Do not tie UI refresh only to `result.ok === true`.

---

## 16. Capability state must follow every Todo frame state transition, not only initial READY

### Problem

The plan says Shell tells Chat whether `todo-tools-v1` is available. Good—but exact lifecycle behavior needs to be stronger.

Current frame lifecycle includes:

```text
NOT_CREATED
LOADING
READY
FAILED
retry → LOADING → READY/FAILED
```

### Required plan correction

Define:

- `READY + capability` → available;
- any transition to `LOADING`, `FAILED`, navigation-away, or frame replacement → unavailable immediately;
- new `READY` → available again;
- saved `tools.todo` preference remains unchanged.

Shell must rebroadcast availability changes to Chat.

ChatUI tool declaration rule must use:

```text
generation saved-tool snapshot says Todo enabled
AND live bridge capability is READY at generation start
```

If capability disappears after declarations were already sent to Gemini, the executor must return `TODO_UNAVAILABLE` rather than trying to queue the mutation.

---

## 17. Define generation-snapshot semantics separately from live UI toggle state

### Problem

Current Chat generation stores a snapshot of `activeTools` on the assistant message. `streamChat()` receives that snapshot.

The plan says Todo executor should verify that the tool is "currently enabled". If that means reading live `state.tools.todo`, toggling the UI while a response is already generating can change permissions in the middle of one Gemini turn.

### Required plan correction

Use this rule:

```text
Enabled for this generation = context.activeTools.todo captured for that assistant generation.
Available to execute now = live Todo bridge capability.
```

Do not use the persisted/live checkbox alone to decide whether an already-started generation may execute its declared Todo function.

This keeps one generation internally consistent while still failing safely if Todo itself becomes unavailable.

---

## 18. Response payloads also need hard bounds, not only requests

### Problem

The plan adds a 128 KiB Todo RPC envelope limit and field limits for requests. Good.

But `todo_find_tasks` can return up to 100 tasks, each including description, repeat, reminders, resolved names, timestamps, and ordering data. One response can exceed 128 KiB or consume excessive Gemini context even if the request was tiny.

A single stored Todo description may also already be larger than the new AI input guardrail because existing Todo data has no matching 4,000-character schema limit.

### Required plan correction

Add a **response serializer budget**:

- enforce the 128 KiB RPC cap on responses before `postMessage`;
- bound/truncate every returned string independently;
- return compact task summaries for list/search by default;
- consider omitting or truncating description in list results (for example a bounded preview) and add metadata indicating truncation;
- cap arrays/results based on actual serialized size, not only item count;
- never silently drop the whole response because it exceeded the shell cap—return a structured bounded error/result such as `RESULT_TOO_LARGE` with guidance to narrow the query.

Remember that the same result is then sent to Gemini as a `functionResponse`, so context size matters even before the shell limit is reached.

---

## 19. The 32 KiB vs 128 KiB protocol split must happen before the existing generic validator rejects the message

### Problem

Current `shell/js/frame-bridge.js` applies the normal ~32 KiB payload check to inbound protocol messages.

Current Chat/Todo embedded bridges also contain their own ~32 KiB validation.

If the implementation merely adds a new Todo case **after** the existing generic size validation, a valid 80 KiB Todo RPC message will be rejected before the Todo-specific 128 KiB rule is reached.

### Required plan correction

The protocol layer should choose the cap based on an allowlisted message type **before** applying the size test.

Prefer one shared concept such as:

```text
getProtocolPayloadLimit(message.type)
```

with:

```text
ordinary shell messages = 32 KiB
Todo RPC request/response = 128 KiB
```

Then reuse that rule in Shell, Chat embedded bridge, and Todo embedded bridge.

Avoid two competing message listeners with slightly different validators if one centralized validator can do the job.

---

## 20. Error mapping must not depend on parsing English exception messages

### Problem

Existing Todo services throw normal `Error` objects with human-readable messages and some delete methods return `false` for missing entities.

The plan wants stable codes such as:

```text
TASK_NOT_FOUND
INVALID_PARENT
POSITION_CONFLICT
STORAGE_ERROR
```

### Required plan correction

Generate stable codes from **tool-layer prevalidation and known branches**, not by fragile substring matching on service error text.

For example:

- check task existence → `TASK_NOT_FOUND`;
- check legal parent → `INVALID_PARENT`;
- check before/after scope → `POSITION_CONFLICT`;
- `deleteTaskFamily/deleteProject/deleteTag === false` → explicit NOT_FOUND/NO_OP decision;
- unexpected IndexedDB/service failures → `STORAGE_ERROR` or `INTERNAL_TODO_ERROR` without exposing raw internals.

A small `TodoToolError(code, message, details)` type inside the tool layer is appropriate.

Do not change AppDataService's public error messages solely for Gemini.

---

## 21. Mutation results must report all real Todo side effects, especially Repeat and task families

### Problem

Several existing service methods affect more records than the returned task alone indicates.

Examples:

- completing a non-repeating root completes its subtasks;
- completing a repeating root can complete old root/children and create a new root/new child occurrences;
- changing a root project's project assignment propagates that project to its subtasks;
- deleting a root deletes the whole family;
- deleting a Project unassigns tasks;
- deleting a Tag removes it from tasks.

### Required plan correction

Before/after snapshots should be used where needed so the tool result contains canonical side-effect IDs.

For task status/repeat operations, return a structured shape such as:

```text
requestedTaskId
updatedTaskIds
completedTaskIds
createdTaskIds
nextOccurrenceId
nextOccurrenceChildIds
deletedTaskIds
```

only when relevant.

Do not let Gemini infer side effects from one returned root ID.

This is especially important because repeat completion can return a different task object/new occurrence from `toggleTaskStatus()`.

---

## 22. Workspace custom-sort behavior needs exact service steps

### Problem

The plan correctly says switching to `custom` must preserve the currently visible order, but implementation details matter.

Current UI does **not** simply call:

```text
setSetting('sortKey', 'custom')
```

It calls:

```text
WorkspaceControls.buildCustomOrderSnapshot()
→ AppDataService.activateCustomSort(snapshot)
```

The snapshot must cover every sibling scope.

### Required plan correction

State explicitly:

- `todo_update_workspace(sortKey='custom')` must use the same full snapshot + `activateCustomSort()` semantics as the current UI;
- never persist `sortKey=custom` alone;
- if a task move/reparent and custom-sort activation happen in one logical item, make clear whether the snapshot is taken before or after hierarchy mutation and ensure it is valid for the scope expected by the service;
- `sortDirection` has no visible meaning while custom sort is active; decide whether to preserve it silently or reject attempts to change it in custom mode.

Also document that `viewType` persistence differs:

- Project/Tag target → persisted on that entity;
- smart view (`Inbox/Today/Completed`) has no entity-level persisted view setting in the current service and may be session-only.

Do not claim all `viewType` changes persist identically.

---

## 23. Project/Tag update + reparent + position has the same compound-operation problem as tasks

### Problem

Current taxonomy APIs split responsibilities:

```text
updateProject/updateTag
→ updateTaxonomyEntityWithOrder()

commitTaxonomyDrag()
→ parent + before/after ordering in one hierarchy operation
```

If the plan first updates fields/reparents and then separately reorders, one item can partially commit and `updateTaxonomyEntityWithOrder()` can temporarily append the moved entity to the end of its target parent before the second operation.

### Required plan correction

Define a deterministic taxonomy mutation planner:

- prevalidate final parent and before/after target;
- when parent + semantic position are both requested, prefer one hierarchy/order operation for those two concerns (`commitTaxonomyDrag`), not "reparent then reorder" as separate hierarchy operations;
- normal name/icon/view fields can then be applied through the narrowest safe service path;
- if this still cannot be made one logical atomic item, use the same `PARTIAL_MUTATION` contract described earlier or add a narrow generic compound taxonomy helper.

Do not silently present a multi-transaction taxonomy edit as atomic.

---

## 24. Exact filter/count semantics need to be documented

### Problem

Several tool read fields are currently ambiguous:

```text
projectId filter
projectIds filter
tagIds filter
project directTaskCount/treeTaskCount
tag direct/tree counts
```

Current Todo UI Project views include descendant Projects. Tag views include descendant Tags. Sidebar counts count **active** tasks, not all tasks.

### Required plan correction

For each AI-facing read option, state whether it is:

```text
exact entity only
or entity + descendants
```

Recommended:

- explicit `projectId/projectIds` filters are exact unless a separate `includeDescendants` option is true;
- explicit tag filter behavior is similarly explicit;
- `scope=current_view` follows the real Todo current-view descendant/family rules;
- count field names should say what they count. Prefer names such as:

```text
activeDirectTaskCount
activeTreeTaskCount
totalDirectTaskCount
totalTreeTaskCount
```

or clearly document that existing Sidebar-style counts exclude completed tasks.

Do not return a generic `treeTaskCount` whose completed/active meaning is unclear.

---

## 25. Duplicate mutation IDs inside one update batch need a rule

### Problem

Delete tools explicitly deduplicate IDs, but update tools do not define what happens if the same task/project/tag ID appears twice in one array.

Sequential execution would make the result order-dependent and can complicate partial-failure reporting.

### Required plan correction

For v1, reject duplicate IDs inside:

```text
todo_update_tasks
todo_update_projects
todo_update_tags
```

with `INVALID_ARGUMENT` before mutation.

For delete calls, keep the plan's dedup/coverage behavior.

This makes batch semantics much easier to reason about.

---

## 26. Gemini function declarations must use the schema style the current ChatUI actually sends

### Problem

The plan uses convenient pseudo-types and union notation such as:

```text
navigate?: {type:"smart", ...} | {type:"project", ...} | ...
```

Current ChatUI Workspace function declarations use Gemini-compatible declaration objects with the existing uppercase type style:

```text
OBJECT
ARRAY
STRING
INTEGER
BOOLEAN
enum
```

### Required plan correction

Treat the plan's TypeScript-like unions as **conceptual documentation only**.

`todo-tool-definitions.js` must encode a schema that the existing Gemini endpoint accepts, then enforce conditional combinations in the Todo normalizer/executor.

For example, `navigate` may need one object containing:

```text
type
id
value
```

with the executor enforcing which fields are legal for each type.

Likewise, test omitted-vs-null semantics against the exact declaration format used by this app instead of assuming every JSON-Schema construct is accepted.

Do not copy the pseudo-schema directly into Gemini declarations without adapting it to the existing declaration format.

---

# P1 — Security/product safety and transparency

## 27. Destructive tool authorization is too weak when other tools can supply untrusted content

### Problem

The plan says:

```text
explicit conversational request + model tool call = authorization
no Chat confirmation required
```

Avoiding a hidden Todo `window.confirm()` is correct. But the current rule leaves deletion entirely to model judgment.

ChatUI can also use URL Context, Google Search, Workspace files, uploaded content, and Todo task text. Untrusted content can contain instructions that influence the model.

A model that is prompt-injected could call:

```text
todo_delete_tasks
todo_delete_projects
todo_delete_tags
```

without the user actually asking for deletion.

### Required plan correction

Do **not** reintroduce a hidden Todo confirmation dialog.

Instead make a deliberate Chat-side destructive policy. Recommended options, strongest first:

1. Chat-visible approval for destructive Todo calls before dispatch; or
2. a two-step destructive flow (preview/resolve targets → explicit delete call only after clear user confirmation); or
3. at minimum, a strict code-level/user-turn gate plus very conservative tool descriptions and no automatic retry.

For Live Voice, define how destructive confirmation works without silently blocking the hidden Todo iframe.

Batch delete of up to 50 entities deserves stronger protection than ordinary field updates.

If the product intentionally chooses no confirmation, the plan should explicitly record that risk instead of calling the model tool call itself sufficient proof of user intent.

---

## 28. Enabling the Todo tool sends local Todo content to Gemini; the UI should say this

### Problem

Todo data remains local in IndexedDB until a read tool result is returned to Chat/Gemini. Once `todo_find_tasks`, project/tag list, or workspace data is sent as a Gemini `functionResponse`, that selected Todo content is transmitted to the configured model endpoint.

The plan focuses on local architecture but does not make this user-facing privacy boundary explicit.

### Required plan correction

The To-Do tool UI/description should make the permission understandable, for example:

```text
Allows ChatUI to read and change your To-Do data. Todo information used by the AI may be sent to your configured Gemini endpoint.
```

Do not imply that Todo data remains entirely local once the AI tool is enabled and used.

Keep returned data minimal/bounded to what Gemini needs.

---

# P2 — Quality/maintainability improvements

## 29. Keep business-result failures inside the existing custom function loop

### Verified current behavior

Current `ChatUI/js/api/gemini.js` already does the right thing for a custom tool result shaped like:

```json
{ "ok": false, "error": { ... } }
```

It emits a failed activity but still sends the structured result back to Gemini as `functionResponse`. It only throws for unsupported/malformed calls or execution-level exceptions.

### Plan correction

Make this an explicit invariant:

- Todo business validation failures return structured `{ok:false}`;
- they should not throw through the custom loop;
- `AbortError` and true transport/runtime failures may reject/throw as appropriate;
- provider-neutral refactor must preserve this existing behavior.

This prevents an implementation agent from accidentally turning a normal `TASK_NOT_FOUND` into a whole-response failure.

---

## 30. Todo provider/activity classification needs to be centralized

### Verified current behavior

Current Gemini activity emission hardcodes:

```text
workspace_ → workspace
otherwise → unknown
```

`activity-timeline.js` also knows Workspace and built-in providers but not Todo.

### Plan correction

Instead of adding `name.startsWith('todo_')` in several files independently, introduce/reuse one provider resolver for custom function names.

It should return at least:

```text
workspace
todo
unknown
```

Use it for requested/running/completed/failed events and summaries.

This keeps future providers consistent.

---

## 31. UI descriptor refactor is good; define saved preference vs effective availability in the UI

### Problem

Current Composer Tools UI has one simple boolean per tool. Todo has two states:

```text
saved preference
runtime capability availability
```

### Required plan correction

The descriptor/UI model should expose both.

Example states:

```text
preference=false, available=true  → unchecked enabled
preference=true, available=true   → checked enabled / active pill
preference=true, available=false  → checked-but-unavailable (or clear visual equivalent), declarations disabled
preference=false, available=false → unchecked disabled
```

Do not clear the saved preference when Todo temporarily fails/reloads/standalone ChatUI is opened.

The active pill should represent **effective active tool availability**, not falsely show an executable Todo tool when the iframe is unavailable.

---

## 32. Current build assumption is correct, but CI must be extended for the new modules/protocol

### Verified current behavior

`scripts/build-static.mjs` recursively copies:

```text
ChatUI/js
TodoList-ui/js
```

so new Todo-tool modules under those trees do not need special build-copy entries.

However, the current GitHub workflow only syntax-checks a fixed list of existing JS files. New Todo tool modules would not automatically be `node --check`ed.

The current integration verifier also still contains an old invariant from the first iframe integration era saying the future Todo command bridge is not implemented in the root shell.

### Required plan correction

Update testing/CI steps to include:

- syntax checks for all new Chat/Todo tool bridge modules;
- static assertions for `todo-tools-v1` capability and exact-origin routing;
- static test that ordinary protocol remains 32 KiB while Todo RPC has its dedicated cap;
- static test that Todo RPC cannot be queued while Todo is not READY;
- pure-JS tests for normalizers/date/time/repeat/reminder/position validation;
- request dedupe/timeout/late-response tests with fake bridge/service dependencies;
- structured partial-result tests;
- standalone ChatUI startup test with Todo unavailable.

Respect the existing project testing preference: do not introduce headless Chrome as a requirement. Keep browser behavior in the manual test matrix unless the user changes that rule.

### Relevant files

```text
.github/workflows/iframe-integration-check.yml
scripts/verify-integration.mjs
scripts/build-static.mjs
```

---

# Additional semantic decisions the revised plan should state explicitly

These are smaller than the blockers above, but leaving them ambiguous will produce inconsistent agent behavior.

## A. Task-create defaults

Current Todo UI creates a new task with `on_time` selected by default, because `TasksComponent.resetSelections()` sets:

```text
selectedReminders = ['on_time']
```

Direct `AppDataService.createTask()` with omitted reminders ends up with no reminder/`none` semantics.

The AI tool must explicitly choose its own contract:

```text
reminders omitted on create = ?
```

Recommended safety choice is **no reminder unless the user/model explicitly supplies one**, but if the goal is exact user-UI parity, use `on_time`. Either is valid; it must not be accidental.

## B. Project assignment for subtasks

State explicitly:

```text
projectId on a final subtask is invalid/conflicting
```

because subtask project is inherited.

Do not let the service silently ignore the requested project and then report success.

## C. `position` result meaning

When workspace sort is not `custom`, persisted sibling `sortOrder` is not necessarily the current visible order.

A returned "position/order summary" must say whether it means:

```text
persistent custom sibling order
current rendered/sorted index
or both
```

Do not call a hidden custom-order index the current visual position while `sortKey=dueDate/name/...`.

## D. Project/Tag delete promotion semantics

Current taxonomy delete behavior should be stated very concretely in tool descriptions/results. For nested taxonomy, child entities may be promoted according to current `prepareTaxonomyDelete()` behavior rather than simply taking the deleted entity's old parent.

Return the final parent IDs of affected children so Gemini does not have to guess.

## E. Batch update order

For update arrays, execute input order as planned, but reject duplicate target IDs first. Results should include input index so Gemini can correlate failures to the original item.

## F. Uncertain outcome after iframe reload

If Todo reloads while a mutation is in flight, the shell/Chat side cannot always know whether the database committed before the reload. Treat this as uncertain outcome and reconcile with reads. Do not claim safe automatic retry.

---

# Claims in Implementation Plan ID 3 that were checked and are correct

The next agent should **keep** these decisions rather than changing them unnecessarily.

## 1. Live Voice can reuse the normal Todo custom-function path

Verified.

`ChatUI/js/voice/live-voice-controller.js` sends the recorded user turn through normal `sendMessage()`, which reaches the standard generation/streaming path. A separate Live-Voice-only Todo tool engine is not needed.

## 2. Existing Chat custom-function loop should be reused

Verified.

`ChatUI/js/api/gemini.js` already supports:

```text
function declarations
streamed functionCall parts
sequential custom execution
functionResponse parts
multiple rounds
AbortSignal
structured ok:false tool failures
```

Todo should plug into this rather than creating a second Gemini loop.

## 3. No direct ChatUI write to Todo IndexedDB

Correct and should remain a hard rule.

Todo business rules are spread across `AppDataService`, hierarchy, taxonomy, repeat, relation, and state-sync modules. Direct Chat writes would bypass them.

## 4. Existing databases do not need to be merged

Correct.

Keep:

```text
ChatUI_DB
TodoListDB
```

separate.

## 5. `tools.todo` can be stored without a ChatUI DB schema-version migration

Correct in the current Chat settings design. `tools` is serialized as part of the settings object. `load.js` and state defaults still need to be updated to read the new field explicitly.

## 6. Todo capability should only be advertised after Todo startup/hydration/UI initialization

Correct.

Current Todo embedded bridge is initialized near the end of `UI_INIT`, after persistence/hydration/repair and component initialization. Add `todo-tools-v1` only when the executor is actually ready.

## 7. Project deletion does not delete tasks

Verified.

Current project delete unassigns tasks directly assigned to the deleted Project and updates taxonomy hierarchy. Keep this tool description.

## 8. Tag deletion removes tag relations but not tasks

Verified.

Keep this tool description.

## 9. Root task deletion uses family deletion

Verified.

`deleteTaskFamily(rootId)` deletes the root and its subtasks. Deleting a subtask alone removes only that subtask.

## 10. Completion must use repeat-aware `toggleTaskStatus()`

Correct.

Do not implement `completed = true` as a direct row/property update. Existing completion logic can create next repeat occurrences and handles task families.

## 11. Build script already copies new JS modules recursively

Correct.

No build allow-list change should be required merely because new modules are placed under existing `ChatUI/js` and `TodoList-ui/js` directories.

---

# Recommended repair order for Implementation Plan ID 3

The next agent should revise the plan in this order before touching application code:

1. **Correct reminder product claims** — decide configuration-only vs prerequisite real notification delivery.
2. **Define fail-fast RPC availability** — no queued Todo mutations.
3. **Define timeout/idempotency/uncertain-outcome behavior** — prevent duplicate mutations.
4. **Replace the universal TaskUpdate ordering with a final-state mutation planner.**
5. **Define per-item atomic/partial-mutation semantics and narrow service helpers where needed.**
6. **Add strict date/time/repeat/reminder validation rules.**
7. **Fix current-view/read consistency and `whenIdle()` rules.**
8. **Add editor concurrency/version conflict handling.**
9. **Define capability lifecycle + generation snapshot semantics.**
10. **Bound response size as well as request size.**
11. **Define destructive-action safety and Todo-data privacy disclosure.**
12. **Update CI/static/pure-JS/manual tests for the new bridge and tools.**

Only after those plan corrections should implementation begin.

---

# Minimum acceptance additions the revised plan should contain

Before ID 3 can be considered implementation-ready, add explicit tests for these cases:

```text
1. Todo LOADING + Gemini tries create → fails immediately; request is never executed later.
2. Todo FAILED/retry → no stale queued mutation executes after READY.
3. Create batch exceeds Chat wait timeout → no automatic duplicate retry.
4. Duplicate delivery with same requestId → executes once.
5. Uncertain outcome after frame reload → read-back reconciliation before retry.
6. Subtask → root + project change → requested final project is correct.
7. Root → subtask + conflicting projectId → rejected.
8. Create subtask under completed parent → rejected.
9. Invalid date/time/repeat values → rejected, never silently normalized to different intent.
10. yearDates January/December mapping → no 0/1-based month error.
11. Reminder metadata configured → AI does not falsely promise an actual notification unless delivery exists.
12. Read immediately after a pending manual write → read waits and returns latest committed state.
13. current_view task IDs exactly match Todo family-aware filter semantics.
14. Partial batch failure after committed items → UI refreshes committed state once.
15. Single compound item partially commits → result reports exact committed stages/final state.
16. AI updates task while its editor is open → later manual Save cannot silently erase AI changes.
17. AI deletes task while Task/Schedule/Subtask editor is open → invalid editor stack closes safely.
18. Project/Tag deletion invalidates open menu selection → draft state is reconciled safely.
19. Repeat root completion → result reports old completed family and new occurrence IDs.
20. Root project change → result reports affected child task IDs.
21. Todo capability drops during an already-started generation → call returns TODO_UNAVAILABLE, never queues.
22. Todo saved preference remains true across temporary unavailability/standalone ChatUI.
23. 100 large task results → response remains under bridge/model budget or returns bounded RESULT_TOO_LARGE.
24. Todo RPC >32 KiB but <128 KiB → accepted by dedicated validator.
25. Ordinary shell message >32 KiB → still rejected.
26. Duplicate target ID in one update batch → rejected before mutation.
27. Delete call triggered from ambiguous/untrusted content → follows the chosen destructive approval policy.
28. Standalone ChatUI starts normally with Todo unavailable.
29. Live Voice Todo create/update/read works through the same normal generation path.
30. Chat generation, recording, Live Voice, and Read Aloud still continue across app switching after Todo tools are added.
```

---

# Final review assessment

The plan's **architecture is good** and should not be thrown away. The main weaknesses are not the high-level design; they are the edge cases where the current Todo services have different invariants depending on which method is used, and where asynchronous iframe RPC can create uncertain side effects.

The most dangerous mistakes would be:

```text
1. queueing a stale Todo mutation until iframe recovery;
2. retrying a timed-out create/delete and duplicating work;
3. reporting a compound item as failed even though part of it already committed;
4. following the current fixed update order and losing project intent during subtask → root conversion;
5. allowing an open stale editor to overwrite AI changes later;
6. promising reminder notifications that Todo does not currently deliver.
```

Fix those in the implementation plan first. After those corrections, the overall ChatUI → Shell → Todo tool architecture is a strong fit for the current application.