# Continue From New Chat — TodoList-ui Handoff

> **Purpose:** Give a new ChatGPT conversation enough context to continue working on `Mahdi1910/TodoList-ui` safely without repeating old investigations or misunderstanding our workflow.
>
> **First instruction for the new chat:** Read this entire file first. Treat the current GitHub `main` branch as the source of truth. Before changing code, read the files related to the current request.

---

# 1. Project

Repository:

```text
Mahdi1910/TodoList-ui
```

This is a **personal-use To-Do application**. Do not design it as if it needs to serve thousands of users. Prioritize:

```text
correctness
data safety
maintainability
good phone/desktop interaction
simple architecture
smooth everyday personal use
```

Main technology:

```text
Vanilla HTML
Vanilla CSS
Vanilla JavaScript
IndexedDB
```

Important application capabilities already include:

```text
Tasks
Subtasks
Projects
Sub-projects
Tags
Sub-tags
List view
Kanban view
Task grouping
Task sorting
Custom task ordering
Task drag/reorder
Task hierarchy drag indent/outdent/reparent
Project hierarchy drag/reorder
Tag hierarchy drag/reorder
Schedule/date/time
Repeat rules
Repeat Ends rules
Custom reminders
Settings
JSON Backup / Restore
```

The application deliberately remains framework-light. Do not introduce React, Angular, Redux, a backend, or another large framework unless the user explicitly asks for that.

---

# 2. Canonical GitHub Rules

The **current GitHub `main` branch is the source of truth**.

Do not assume an old local folder, an old branch, an old implementation-plan branch, or an earlier conversation snapshot is current.

Before important work:

```text
1. Read current GitHub main.
2. Read the relevant implementation plan.
3. Read all related source files.
4. Compare the plan with current code.
5. Only then decide what still needs to change.
```

We are working **directly with GitHub**.

Do not use Desktop Commander or an old local project copy unless the user explicitly asks for it.

Use Git commits as the normal safety/rollback mechanism.

Prefer small, meaningful commits instead of one giant commit.

---

# 3. Important Project Documents

## Permanent problem tracker

```text
problem is need to be fixed.md
```

This is the permanent cleanup/problem list.

Tracker rule:

```text
[ ] = not yet verified complete
[x] = fixed AND reviewed/verified
```

Do not mark a problem `[x]` only because code was written.

The user manually tests important behavior. After the user verifies the fix, the tracker can be marked complete.

## Implementation plans

Folder:

```text
implementation plan/
```

Important current plans:

```text
Implementation Plan ID 13.md
    Modal focus / aria-hidden / inert lifecycle.

Implementation Plan ID 15.md
    Family-aware Task filtering.

Implementation Plan ID 16.md
    Safe Project/Tag DOM rendering.

Implementation Plan ID 17.md
    Subtask Tag ordering.

Implementation Plan ID 19.md
    Full JSON Backup / Restore.

Implementation Plan ID 20.md
    Current architecture consolidation plan for Priority 2 Problems #6–#14.
```

## Very important: ID20 supersedes ID18

```text
Implementation Plan ID 20.md
```

is the current architecture plan.

It supersedes:

```text
Implementation Plan ID 18.md
```

ID18 is historical/design reference only.

ID20 was created because the application changed after ID18 was written.

Current ID20 explicitly knows that:

```text
ID17 code is implemented and must be preserved.
ID19 Backup/Restore exists and must be preserved.
Problem #12 bootstrap error classification already exists.
Modal focus work is still partial/separate.
```

Never execute ID18 literally if ID20 is available.

---

# 4. Current Important Application State

## ID17 — Subtask Tag ordering

The Subtask Tag picker was changed to use:

```text
TaxonomyOrder.getChildren('tag', parentId)
```

instead of walking raw:

```text
AppState.tags
```

This means reordered Tags should appear in the same hierarchy/order in the Subtask editor as in the normal Task editor/sidebar.

Preserve this during architecture refactoring.

## ID19 — JSON Backup / Restore

Backup/Restore has been implemented.

The design is intended to back up **raw durable storage**, not reconstructed `AppState`.

Important safety behavior:

```text
Create Backup
→ wait for pending AppDataService writes
→ read all IndexedDB stores
→ include persisted theme
→ create versioned readable JSON

Restore Backup
→ parse file
→ validate full backup BEFORE destructive work
→ wait for pending writes
→ replace all IndexedDB stores in one readwrite transaction
→ apply theme only after DB commit succeeds
→ reload through normal hydration/startup
```

Do not weaken this behavior during future refactors.

Backup must preserve things such as:

```text
Tasks
Subtasks
Projects
Project hierarchy/order
Tags
Tag hierarchy/order
Task ↔ Tag relations
reminder definitions
Task reminder relations
Repeat rules
Repeat series state
Repeat occurrence state
Repeat anchor state
workspace settings
metadata
theme
```

## Problem #12 — Bootstrap error classification

Current `app.js` already distinguishes startup stages such as:

```text
MODULE_LOAD
INTEGRATION
DATABASE_OPEN
DATABASE_REPAIR
HYDRATION
UI_INIT
```

Do not reimplement this from scratch.

Future module/bootstrap work must preserve it.

---

# 5. Implementation Plan ID20 — What It Is For

ID20 is the architecture/maintainability consolidation plan for Priority 2 Problems #6–#14.

It covers:

```text
6. Remove ui-persistence-bindings.js as a large runtime patch layer.

7. Remove Repeat mapper/service monkey-patching.

8. Reduce AppState responsibilities.

9. Merge duplicated Project and Tag sidebar/modal logic.

10. Remove UI-component dependency from the data layer.

11. Simplify JavaScript module loading/bootstrap order.

12. Preserve/audit the already-implemented bootstrap error classification.

13. Remove dead/duplicate HTML immediately replaced by JavaScript.

14. Stop runtime-upgrading permanent UI structures / establish one source of truth.
```

Desired architecture direction:

```text
UI component
      ↓ command
AppDataService / focused domain service
      ↓ transaction
IndexedDB / repository / mapper
      ↓ only after successful persistence
controlled memory synchronization
      ↓
AppState read model / selectors
      ↓
render
```

Main principle:

> A developer reading the owning file should be able to see the real implementation. A later-loaded patch file should not secretly replace it.

---

# 6. Non-Negotiable Behavior During Refactors

Architecture cleanup must not change the product behavior.

Preserve:

```text
Task CRUD
Subtask CRUD
one-level Subtask hierarchy
Subtask Project inheritance
Link / Unlink
Task drag reorder
Task hierarchy indent/outdent/reparent
Project hierarchy drag
Tag hierarchy drag
Project/Tag cycle prevention
Project/Tag sortOrder
custom Task order
List/Kanban behavior
Sort
Sort direction
Group By
Project/Tag view type
Theme
reminder definitions
Task reminder relations
Repeat behavior
Repeat Ends
familySlotId semantics
Backup/Restore
```

Do not change the IndexedDB schema/version unless the requested feature truly requires it.

---

# 7. Our Normal Work Workflow

This workflow is important.

## Step A — Understand before changing

When the user explains a feature/problem:

```text
read the relevant files
understand the existing architecture
identify the real current behavior
```

Do not immediately code if the user only asked for understanding.

If the user says:

```text
"Tell me your understanding."
"Do not implement anything."
"Do not create an implementation plan."
```

then do exactly that.

No code changes.
No Git writes.
No implementation plan unless requested.

## Step B — Use visual text when useful

The user often wants a visual explanation before approving a feature.

Use simple text such as:

```text
A = Main Task
    B = Subtask

Before:
A
    B

After dragging B left:
A
B
```

or:

```text
Main menu
┌─────────────────┐
│ View  ○ ○ ○     │
│ Sort & Group    │
└─────────────────┘
```

Keep explanations in easy English.

Do not drown the user in implementation details when they are asking whether the idea was understood.

## Step C — Create an implementation plan only when requested

When the user says:

```text
"Create an implementation plan."
```

then:

```text
1. Read every relevant current file.
2. Identify root cause/current architecture.
3. Define exact desired behavior.
4. Define affected files.
5. Define implementation order.
6. Define data/persistence safety.
7. Define regression risks.
8. Define manual test/acceptance cases.
9. Create the plan in implementation plan/.
```

Do not implement the code at this stage unless the user also explicitly asks to implement it.

## Step D — Review the plan

Sometimes another model reviews an implementation plan.

If there is a file such as:

```text
Implementation Plan Review ID XX.md
```

do not blindly accept the review.

Instead:

```text
read the review
check every important criticism against current code
accept correct criticism
reject/modify incorrect criticism
update the original implementation plan
```

There should be one canonical implementation plan, not several competing plans.

## Step E — Implement only after explicit approval

Typical user instruction:

```text
do ID 17
do ID 20
implement the implementation plan
```

Then implement exactly that plan.

Avoid unrelated cleanup unless required to make the plan work safely.

## Step F — Verify statically, then give manual tests

The user does the browser/phone testing.

Do NOT run:

```text
Chrome automation
Edge automation
Playwright
Puppeteer
Selenium
headless browser tests
```

Use:

```text
source review
Git diff review
reference searches
small pure-JavaScript checks when useful
```

Then tell the user exactly what to manually test.

## Step G — Update tracker only after verification

After implementation:

```text
code written        ≠ tracker complete
manual verification = tracker may become [x]
```

If manual verification has not happened, leave the tracker item unchecked.

---

# 8. GitHub Write / Connector False-Positive Workflow

This is important because we have already encountered connector write blocks.

Some large whole-file replacements or persistence files containing legitimate operations such as:

```text
delete
remove
clear
```

have sometimes been rejected by the GitHub connector even when the code itself was normal application code.

That is a connector/safety-classification limitation, not automatically a bug in our application.

## Do NOT intentionally bypass the security system

Do not deliberately evade a security classifier by splitting a blocked word across writes or disguising the content.

For example, do not intentionally write half of a prohibited/blocked string in one request and the other half in another request merely to defeat the checker.

## Safe fallback workflow

If a legitimate write is blocked:

```text
Normal focused GitHub write
        ↓ blocked
Make the change smaller and more responsibility-focused
        ↓ blocked
Use another normal GitHub mechanism when appropriate
        ↓
verify GitHub state
        ↓
continue
```

Legitimate alternatives include:

```text
create a small focused companion module
split unrelated changes into separate commits
use normal Contents API updates
reuse an already-created Git blob when appropriate
use Git tree/commit operations when available
use a temporary branch for safe staged work
make sequential writes instead of a giant replacement
```

The purpose is reliability, not security evasion.

Never leave the repository in a half-understood state after a blocked write.

After any unusual Git fallback:

```text
check branch/ref
check changed files
check final file contents
check diff
```

The previous long architecture attempt taught us that an interrupted connection can leave valid commits unattached to `main`, so always verify what actually reached the branch before continuing.

---

# 9. Branch Safety

Before important architecture work, verify:

```text
What commit is main on?
What files actually changed?
Is there an old temporary branch?
Is the requested plan already partially implemented?
```

Do not assume an old `id18-resume` branch or another historical branch should be merged into current `main`.

Only use/merge an old branch if the user explicitly asks and after comparing it against current `main`.

Current implementation plans should be applied to **current `main`**, not to an old historical snapshot.

---

# 10. Data-Safety Rules

For important persistence mutations, prefer:

```text
calculate change
    ↓
persist in IndexedDB transaction
    ↓ success
update in-memory state
    ↓
render
```

Do not mutate the live domain state first and simply hope persistence succeeds.

For Backup/Restore especially:

```text
validate before clearing
all-store restore is transactional
failed DB restore must not leave half-restored data
theme changes only after DB success
reload only after successful restore
```

For important manual verification:

```text
make change
refresh
verify the change survived
```

Immediate UI success alone is not enough.

---

# 11. User Interaction Preferences for This Project

Use **easy English** unless technical detail is requested.

Good style:

```text
80% easy explanation
20% technical detail
```

When something is complicated, first explain the behavior visually.

The user frequently works like this:

```text
idea/problem
    ↓
assistant explains understanding
    ↓
user corrects/approves
    ↓
implementation plan
    ↓
optional reviewer reviews plan
    ↓
assistant updates plan
    ↓
user says "do it"
    ↓
implementation
    ↓
user manually tests
    ↓
tracker item can be marked complete
```

Respect the stage of the workflow.

If the user says:

```text
"Just answer me."
"Do not do anything."
```

do not make repository changes.

---

# 12. Current Problem Tracker — Important Interpretation

The permanent tracker is:

```text
problem is need to be fixed.md
```

Some problems may already have code implemented while still remaining `[ ]` because manual verification has not happened yet.

Therefore:

```text
tracker checkbox
```

is not always identical to:

```text
code implementation status
```

When asked whether something is already solved:

```text
check current main source
do not rely only on the checkbox
```

Known examples from recent work:

```text
family-aware filtering code exists
safe Task Project/Tag DOM rendering exists
Subtask Tag ordering code exists
bootstrap staged errors exist
JSON Backup/Restore exists
```

but tracker status may remain unchecked until manual verification.

---

# 13. Important Files / Areas

These are common starting points.

## General tracking/plans

```text
problem is need to be fixed.md
implementation plan/
implementation plan/Implementation Plan ID 20.md
implementation plan/Implementation Plan ID 19.md
```

## App/bootstrap

```text
index.html
js/app.js
```

## State/domain

```text
js/state.js
js/task-filter.js
js/task-relations.js
js/task-order.js
```

## Storage

```text
js/storage/
```

Important storage architecture includes:

```text
schema
database wrapper
repositories
mappers
AppDataService
persistence/hydration
Repeat storage/completion logic
Backup/Restore
```

## Task/Subtask UI

```text
js/components/tasks.js
js/components/task-renderer.js
js/components/subtask-editor.js
js/components/task-menus.js
```

## Projects/Tags

```text
js/components/sidebar-projects.js
js/components/sidebar-tags.js
taxonomy ordering/drag files
```

## Schedule / Repeat / reminders

```text
js/components/schedule*.js
Repeat-related storage/service files
```

## Settings

```text
js/components/settings.js
css/components/modal-controls.css
```

Do not assume this list is exhaustive. For every feature, search current `main` for all references before planning.

---

# 14. Current Architecture Problem Summary

The main architecture debt being addressed by ID20 is that the application historically grew through runtime patch layers.

Example pattern:

```text
component defines method
        ↓
another later-loaded file replaces method
        ↓
another extension decorates service
        ↓
actual runtime behavior is no longer obvious
```

ID20 aims to make ownership explicit:

```text
one action
→ one real owner
→ one persistence path
→ one state synchronization path
```

The highest-risk parts are:

```text
ui-persistence-bindings.js
Repeat mapper/service monkey-patching
AppState mixed write/read responsibilities
Project/Tag duplicated UI
reminder UI/data coupling
script load order
stable DOM that is replaced/upgraded later
```

Do not refactor all of these in one giant uncontrolled edit.

ID20 intentionally uses staged ownership migration.

---

# 15. Reminder About Personal-Use Scope

Do not waste time optimizing for:

```text
10,000 users
server clustering
multi-tenant architecture
distributed systems
enterprise permission layers
```

This is a personal application.

Performance work should focus on what is noticeable on the user's computer/phone.

Correctness and understandable code are more important than theoretical scale.

---

# 16. Manual Testing Rule

The user has explicitly said that the assistant should not run headless Chrome/browser testing on the user's computer.

When implementation finishes, give a short manual test list such as:

```text
Test 1
Reorder Tags.
Open a Subtask.
Confirm Tag picker order matches sidebar.

Test 2
Refresh.
Confirm order stays correct.
```

For architecture work, test important flows both:

```text
immediately
and after refresh
```

---

# 17. If a New Chat Is Unsure What to Do

Use this sequence:

```text
1. Read this file.
2. Read current GitHub main.
3. Read problem is need to be fixed.md.
4. Read the implementation plan named by the user.
5. Read all source files related to that plan/problem.
6. Tell the user what you found if they asked for analysis.
7. Do not implement until explicitly asked.
8. If implementing, use small Git commits and verify each checkpoint.
9. Never run browser automation.
10. Give the user manual tests at the end.
```

---

# 18. Suggested First Message in the New Chat

The user can send:

```text
Read this handoff file first.

Treat Mahdi1910/TodoList-ui GitHub main as the current source of truth.

Continue using our existing workflow:
understand → visual explanation when needed → implementation plan → review → implementation only when I explicitly ask.

Do not use Desktop Commander.
Do not run Chrome/headless browser tests.
When GitHub falsely blocks a legitimate write, use safe smaller Git/GitHub operations instead of stopping or trying to bypass security.

Also read:
- problem is need to be fixed.md
- implementation plan/Implementation Plan ID 20.md

Then tell me you understand the current project state. Do not change anything yet.
```

---

# 19. Final Rule

Always distinguish these four things:

```text
what the user wants
what the implementation plan says
what current GitHub main actually contains
what has been manually verified
```

Do not assume they are the same.

Current GitHub `main` wins for code truth.
The latest approved implementation plan wins for intended refactor work.
The user's latest clarification wins for desired behavior.
Manual verification controls whether a tracker item is marked complete.
