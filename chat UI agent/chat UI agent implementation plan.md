# STOP — CHAT UI AGENT WORKING DOCUMENT

**Primary owner: Chat UI agent.**

If you are the To-Do List UI agent, do not use this document as an implementation authority unless the user explicitly asks you to review it or compare it. The final integration plan will be created later from both agents' work.

---

# Chat UI Agent — Revised Implementation Plan

## Join ChatUI + To-Do List into one routed application

**Revision:** 2 — improved after cross-review with the To-Do List agent

**Status:** Planning only. Do not implement runtime integration merely because this document exists.

**Repository:** `Mahdi1910/TodoList-ui-ChatUI`

**Runtime source architecture originally audited at:**

```text
36fac471bcd4a7c0d5506749139e1dca92b475b5
```

**Cross-review inputs used for Revision 2:**

```text
implementation plan/Implementation Plan ID 1.md

to-do list agent/chat UI agent implementation plan review ID 1.md

chat UI agent/review of Implementation Plan ID 1.md
```

This revision intentionally incorporates the strongest verified ideas from both independent plans and both reviews while remaining the Chat UI agent's working plan.

---

# 1. Final target

The final product is one combined website with one neutral application shell and two independent application modules.

```text
Combined website
        |
        v
/index.html
        |
        v
Shared application shell
  |-- shared desktop application rail
  |-- shared mobile application navigation
  |-- one top-level router
  |-- one active-module host
  |-- one lifecycle manager
  `-- shell-level error/fallback UI
        |
        +--> /todo-list-ui
        |       |
        |       `--> To-Do module
        |             `--> TodoListDB
        |
        `--> /chat-ui...
                |
                `--> ChatUI module
                      `--> ChatUI_DB
```

Canonical public routes:

```text
/                         -> replace/canonicalize to /todo-list-ui
/todo-list-ui             -> To-Do application
/chat-ui                  -> ChatUI home/new-chat surface
/chat-ui/chat/<chatId>    -> exact ChatUI conversation
```

The physical source folders remain:

```text
/ChatUI
/TodoList-ui
```

Those folder names are source organization, not public navigation paths.

---

# 2. Core architecture decisions

## 2.1 A new root `index.html` is the main application

Neither current standalone page becomes the final production owner.

Do not choose:

```text
TodoList-ui/index.html as parent + paste ChatUI into it
```

and do not choose:

```text
ChatUI/index.html as parent + paste To-Do into it
```

Create:

```text
/index.html
```

as the canonical root document.

The current standalone indexes remain during migration as verification/rollback harnesses:

```text
ChatUI/index.html
TodoList-ui/index.html
```

Only after the shared modules are proven should those files become thin developer harnesses around the same module entry points used by the root shell.

## 2.2 Exactly one full application runtime is active at a time

Hard rule for the first combined architecture:

```text
shell
  |
  +--> mount To-Do
  |
  `--> OR mount ChatUI
```

Never:

```text
mount To-Do + ChatUI
hide inactive one with display:none
```

Why this rule exists:

```text
duplicate IDs such as #project-list
generic CSS classes
global CSS variables
document/window listeners
body/documentElement writes
full-screen overlays
module-level initialized flags
viewport drag layers
media/audio sessions
```

Only one module DOM/runtime should exist in the combined host at a time.

## 2.3 First combined release uses full-page app switching

Do not immediately attempt perfect single-page unmount/remount behavior.

Stage A:

```text
/todo-list-ui
  -> root shell loads
  -> only To-Do mounts

click Chat link
  -> normal browser navigation to /chat-ui
  -> new document
  -> only ChatUI mounts
```

This already gives:

```text
one website
one shared launcher
correct URLs
one app runtime at a time
safe listener destruction through page reload
```

Stage B comes later, only after explicit lifecycle cleanup is tested.

## 2.4 Databases stay independent

Preserve:

```text
TodoListDB
ChatUI_DB
```

Do not merge them.

Do not change either database version merely because the UI is joined.

Do not create shell logic that directly reads/writes either application's database.

---

# 3. Shell boundary — strict ownership rule

This revision makes the shell/application boundary stricter than Revision 1.

## 3.1 Shell may import only module entry points

Allowed conceptual imports:

```text
TodoList-ui/js/module.js
ChatUI/js/module.js
```

The shell must not directly import or call:

```text
AppDataService
AppState
RepeatEngine
TodoDb
Todo repositories
Chat state/store
Gemini generation lifecycle
MediaRecorder logic
Voice controller
Read Aloud services
Workspace internals
Chat storage internals
```

The shell knows lifecycle contracts, not application internals.

Correct relationship:

```text
shell
  -> todoModule.prepareDeactivate()
       -> Todo internally waits AppDataService.whenIdle()

shell
  -> chatModule.prepareDeactivate()
       -> Chat internally checks generation/recording/voice state
```

Incorrect relationship:

```text
shell -> AppDataService.whenIdle()
shell -> abortActiveGeneration()
shell -> stopLiveVoiceMode()
```

Those calls belong inside each module boundary.

## 3.2 Shell owns only cross-application concerns

Shell owns:

```text
root HTML document
html/body layout
shared desktop application rail
shared mobile app navigation
top-level route recognition
one popstate listener
active module selection
module mount/deactivate/unmount sequence
shell loading/error UI
shared page-title boundary
focus after app switches
shell-only CSS variables
root build/deployment
root local SPA server
```

Shell does not own:

```text
Tasks
Projects/Tags domain logic
Repeat/reminders
Chat messages/projects
Gemini
attachments
voice/audio
Workspace
application backup formats
application appearance persistence
```

---

# 4. Standard application module contract

Both applications should expose the same external lifecycle shape.

Recommended conceptual contract:

```js
export async function mount(context) {
  return {
    appId,
    handleRoute,
    prepareDeactivate,
    beforeLeave,
    unmount,
    openSettings,
    getAppearance
  };
}
```

Exact function names may change if implementation discovers a clearer API, but these responsibilities must remain explicit.

## 4.1 `mount(context)`

Receives only shell-level services:

```text
module host/root
module overlay root if required
initial parsed route
navigate(path, options)
setTitle(title)
reportFatalError(error)
notifyAppearance(optional)
```

It must not receive the other application's state/service.

## 4.2 `handleRoute(route)`

Used for route changes while the same module is already active.

Example:

```text
/chat-ui/chat/A
   -> /chat-ui/chat/B
```

should call Chat's route handler rather than remounting the whole Chat application.

## 4.3 `prepareDeactivate({ targetRoute })`

**New normative requirement from the cross-review.**

This runs before any destructive cleanup.

Its purpose is to decide whether leaving is safe.

Possible conceptual result:

```js
{ allow: true }
{ allow: false, reason: 'user-cancelled' }
{ allow: false, reason: 'restore-in-progress' }
```

It may:

```text
allow immediately
ask user to confirm discarding unsaved work
block while destructive restore is active
ask before aborting active generation
ask before discarding unsent recording
```

Nothing should be destroyed before this decision resolves.

## 4.4 `beforeLeave()`

Runs after leaving has been approved but before DOM removal.

It performs application-specific shutdown operations that may be asynchronous.

Examples:

```text
abort approved Chat generation
stop approved recording/Live Voice
stop Read Aloud
cancel drag sessions
wait for To-Do write queue
close transient UI
```

## 4.5 `unmount()`

Deterministic cleanup only.

Must:

```text
remove owned global listeners
cancel timers/RAF
remove app-owned overlays/portals
remove body/root classes owned by module
clear stale window globals owned by module
reset/remodel remount guards
remove module DOM
release detached DOM references
```

Do not put user confirmation logic here.

## 4.6 Hard-navigation fallback

If `beforeLeave()` or `unmount()` throws, times out, or cannot prove cleanup:

```text
DO NOT mount the next module over the uncertain old runtime.
```

Fallback:

```js
window.location.assign(targetRoute)
```

or equivalent hard navigation.

The new document guarantees old listeners/timers/runtime are gone.

This is a required safety escape hatch even after seamless switching is enabled.

---

# 5. Shared navigation semantics

## 5.1 Use real links for application routes

Application switches are navigation, so use anchors:

```html
<a href="/todo-list-ui">...</a>
<a href="/chat-ui">...</a>
```

Do not model primary app navigation as JavaScript-only buttons.

Benefits:

```text
normal browser semantics
open in new tab
copy link
keyboard accessibility
full-reload fallback without JavaScript interception
progressive enhancement
```

Settings remains a button because it is an action, not a route.

## 5.2 Shared rail design donor

Use the current To-Do primary rail/mobile bottom navigation as the visual donor.

After integration, ownership moves to shell-specific markup/classes:

```text
.shell-primary-rail
.shell-app-link
#shell-app-todo
#shell-app-chat
.shell-mobile-nav
#shell-open-settings
```

Do not leave root shell styling dependent on `.primary-rail` or To-Do variables.

## 5.3 Remember last Chat route

Improvement adopted from the To-Do plan/review.

If user leaves:

```text
/chat-ui/chat/A
```

for:

```text
/todo-list-ui
```

then clicking Chat later should preferably return to:

```text
/chat-ui/chat/A
```

unless that remembered route is invalid/deleted.

During full-reload Stage A, shell may store only the route string in namespaced `sessionStorage`, for example:

```text
combined-shell:last-chat-route
```

Do not store this in `ChatUI_DB` or `TodoListDB`.

ChatUI remains authoritative for whether the remembered chat exists.

---

# 6. Routing design

## 6.1 Top-level route parser

Create:

```text
shell/js/router.js
```

Pure conceptual helpers:

```js
parseShellRoute(pathname)
buildTodoPath()
buildChatHomePath()
buildChatPath(chatId)
```

Expected results:

```js
{ app: 'todo', type: 'todo-home' }
{ app: 'chat', type: 'chat-home', chatId: null }
{ app: 'chat', type: 'chat', chatId: '...' }
{ app: 'unknown' }
```

## 6.2 Root canonicalization

For `/`:

```text
history.replaceState(..., '/todo-list-ui')
```

not `pushState`.

Back should not bounce through a meaningless root entry.

## 6.3 Unknown route policy

Do not silently mount an arbitrary application.

Recommended:

```text
unknown route
 -> shell error/fallback state
 -> log rejected route
 -> replace/canonicalize to /todo-list-ui
```

## 6.4 One `popstate` owner

Final seamless mode:

```text
window.popstate
   -> shell router
   -> determine active application
   -> same app? delegate route
   -> different app? lifecycle switch
```

ChatUI and To-Do must not retain independent permanent top-level `popstate` ownership.

## 6.5 Chat route base

ChatUI's current route assumptions must become base-path aware.

Combined routes:

```text
/chat-ui
/chat-ui/chat/<encodedChatId>
```

Keep strict malformed route rejection.

For standalone harness testing, use the same router helpers with an explicitly configured standalone base rather than maintaining a separate router implementation.

---

# 7. Final repository shape

Keep current application folders stable.

Recommended final structure:

```text
TodoList-ui-ChatUI/
|
|-- index.html
|-- shell/
|   |-- css/
|   |   `-- shell.css
|   `-- js/
|       |-- app-shell.js
|       |-- router.js
|       |-- module-registry.js
|       |-- navigation.js
|       `-- dependency-loader.js
|
|-- ChatUI/
|   |-- index.html
|   |-- css/
|   |-- html/
|   `-- js/
|       `-- module.js
|
|-- TodoList-ui/
|   |-- index.html
|   |-- css/
|   |-- html/
|   |   `-- todo-app.html
|   `-- js/
|       `-- module.js
|
|-- scripts/
|   `-- build-static.mjs
|-- server.py
|-- wrangler.jsonc
|
|-- implementation plan/
|-- to-do list agent/
`-- chat UI agent/
```

Do not move everything into `/apps/chat` and `/apps/todo` during this integration. That would create import/path churn with no user benefit.

---

# 8. ChatUI current architecture to preserve

Current Chat entry/lifecycle is centered on:

```text
ChatUI/index.html
ChatUI/js/layout-loader.js
ChatUI/js/app.js
```

Current data remains in:

```text
ChatUI_DB
```

Important current feature invariants that shell integration must not redesign:

```text
chat/project persistence
lazy message hydration
search
pinned chats
message editing/deletion/regeneration
streamGenerateContent/SSE behavior
HIGH thinking behavior
model response parts/thought signatures
Google Search
URL Context
Code Execution
custom Workspace tool rounds
Gemini Files API attachment reuse
local attachment Blob durability
attachment File URI reuse/expiry repair
normal audio recording
Live Voice
Read Aloud
selected-text Read Aloud
Workspace manual UI
right sidebar
Chat backup/restore
API settings/base URLs
```

Integration may add lifecycle hooks around these systems, but must not rewrite their protocol/domain behavior.

---

# 9. ChatUI asset-path refactor

ChatUI currently assumes it owns website-root paths in several places.

The combined app must make assets module-relative.

## 9.1 Fragment loader

Refactor `ChatUI/js/layout-loader.js` into an explicit function such as:

```js
loadChatUILayout({ appContainer, overlayRoot, assetBase })
```

Use module-relative URL resolution where practical:

```js
new URL('../html/left-sidebar.html', import.meta.url)
```

or one explicit module asset base.

Never derive fragment URLs from `window.location.pathname`, because deep route:

```text
/chat-ui/chat/A
```

must not cause requests such as:

```text
/chat-ui/chat/html/left-sidebar.html
```

## 9.2 Standalone index

`ChatUI/index.html` should eventually become a thin harness that loads the same `ChatUI/js/module.js` used by root shell.

Do not maintain separate standalone and combined Chat bootstraps long term.

---

# 10. ChatUI module boundary

Create:

```text
ChatUI/js/module.js
```

Recommended root DOM:

```html
<div class="chatui-app" id="chatui-module-root">
  <div id="chatui-app-container"></div>
  <div id="chatui-overlay-root"></div>
</div>
```

Responsibilities:

```text
create module root
load Chat fragments
load/verify Chat dependencies
start Chat application explicitly
accept initial shell route
return lifecycle instance
own cleanup registrations
```

Refactor `ChatUI/js/app.js` away from import-time auto-start toward explicit startup.

Preserve the current startup ordering unless a reviewed reason requires change.

---

# 11. ChatUI lifecycle inventory — formal checklist

Every item below must have a named mount owner and named cleanup/remount path before seamless switching.

## 11.1 Router/history

Current Chat router global listener must be removed/delegated.

Final shell owns top-level `popstate`.

## 11.2 Markdown

Document-level Markdown interaction handlers need cleanup.

## 11.3 Action menu/modals

Global pointer/click/keydown/Escape handlers must be per-mount owned.

## 11.4 Sidebar

Document/window close behavior and mobile listeners must not survive unmount.

## 11.5 Composer

Document click/keydown/menu listeners must clean up.

## 11.6 Attachment drag/drop

Must clean:

```text
document dragenter/dragover/dragleave/drop
window blur
drag depth/state
Chat drop overlay
```

A file dragged over To-Do must never trigger Chat's drop overlay after Chat unmount.

## 11.7 Normal recorder

On approved leave:

```text
stop/cancel MediaRecorder
stop every MediaStream track
clear recorder timers/state
release detached references
```

Unsent recording requires `prepareDeactivate()` confirmation before discard.

## 11.8 Active Gemini generation

`prepareDeactivate()` determines policy first.

If user confirms leaving:

```text
abort active generation through existing lifecycle
persist interrupted state according to current semantics
wait for cleanup boundary
```

No invisible background generation in v1.

## 11.9 Live Voice

After leave is approved:

```text
stopLiveVoiceMode()
```

and verify microphone/audio/session/timers are closed.

## 11.10 Read Aloud

After leave is approved, stop active playback/generation and clean:

```text
Audio/AudioContext/session
hourly cleanup interval
pagehide listener
selection listeners
```

Read Aloud may be safe to stop automatically after switch is approved; it does not normally require the same discard warning as an unsent recording.

## 11.11 Workspace

Audit:

```text
workspace-ui
workspace-mobile
workspace-navigation-bridge
search timers
document pagination timers
window resize listeners
cached DOM references
module initialized flags
```

Import-time listeners must become explicit init/cleanup functions.

## 11.12 Model/thinking/right sidebar/settings controls

All global listeners need cleanup/remount ownership.

## 11.13 Timers/RAF/WebSocket/media

Every:

```text
setInterval
long-lived setTimeout
requestAnimationFrame loop
WebSocket/Live session
AudioContext
Audio
MediaRecorder
MediaStream
AbortController
```

must have a named cleanup path.

## 11.14 `initialized` flags

Do not make `initialized = false` resetting the preferred architecture.

Preferred order:

```text
1. per-mount state
2. init() returns cleanup()
3. per-mount AbortController/cleanup bag
4. reset legacy flag only as a focused transition when a larger refactor is unnecessary
```

No module may remain permanently “initialized” while its DOM has been destroyed.

---

# 12. Exact Chat leave sequence

After `prepareDeactivate()` returns allow:

```text
1. mark Chat as leaving / block new Chat actions
2. abort active Gemini generation if approved/needed
3. cancel approved normal audio recording
4. stop Live Voice
5. stop Read Aloud
6. close Workspace transient UI
7. close menus/modals/sidebars
8. clear attachment drag/drop state + overlay
9. cancel timers/RAF and pending delayed work
10. detach document/window/visualViewport listeners
11. clear module-owned page/body state
12. remove Chat-created body-level portals
13. release detached DOM references
14. remove Chat module root
```

If any step cannot complete safely, use hard-navigation fallback rather than mounting To-Do over it.

---

# 13. ChatUI CSS/theme isolation

Do CSS isolation **after the real `.chatui-app` module root exists**.

This is a Revision 2 phase-order correction.

## 13.1 Shell owns document-level layout

Final module CSS must not own:

```text
html
body
:root
root viewport overflow
shared safe areas
```

Those belong to shell.

## 13.2 Chat variables move to module root

Example:

```css
.chatui-app {
  --bg-primary: ...;
  --text-primary: ...;
  --sidebar-width: ...;
}
```

## 13.3 Generic selectors are root-scoped

Examples:

```css
.chatui-app button { ... }
.chatui-app .modal-overlay { ... }
.chatui-app .sidebar { ... }
.chatui-app .empty-state { ... }
```

Do not mass-rename every internal class/ID unless needed.

## 13.4 Theme/accent

Current Chat appearance logic must stop writing app values to `document.documentElement`.

Apply them to `.chatui-app` or module-owned data attributes.

Persisted Chat settings remain in `ChatUI_DB` unchanged.

## 13.5 Mobile height

Main module layout should generally fill shell host:

```text
height: 100%
min-height: 0
```

rather than owning page `100vh/100dvh` globally.

True full-screen Chat overlays may remain `position: fixed` if lifecycle ownership is explicit.

---

# 14. Chat external dependencies

Current working Chat libraries must remain functionally the same.

Create/centralize a dependency loader, e.g.:

```text
shell/js/dependency-loader.js
```

or Chat-owned equivalent.

Requirements:

```text
load Chat-only dependencies only when Chat is first needed
cache dependency Promise
mount waits until required globals/styles are ready
pin currently used unpinned dependency versions to tested versions
keep Highlight.js behavior stable
do not replace Markdown/highlighting libraries during integration
```

Pinning is a reproducibility improvement, not permission for a dependency rewrite.

---

# 15. To-Do current architecture to preserve

Current To-Do startup:

```text
TodoList-ui/index.html
 -> js/bootstrap.js
 -> js/app-main.js
 -> IndexedDB initialize/hydrate/repair
 -> components initialize
```

Current database:

```text
TodoListDB
```

Do not redesign during integration:

```text
TaskModel
Task CRUD
Subtask hierarchy
RepeatEngine
Repeat Ends
Projects/Sub-projects
Tags/Sub-tags
TaxonomyOrder
TaskOrder/Filter/Relations
AppDataService serialized writes
custom ordering
reminder definitions
backup format
persistence schema
```

Keep existing staged bootstrap error categories.

---

# 16. To-Do DOM extraction and module boundary

First create the real To-Do module root, then scope CSS around it.

## 16.1 Extract reusable To-Do fragment

Create:

```text
TodoList-ui/html/todo-app.html
```

It keeps:

```text
secondary To-Do sidebar/backdrop
workspace/header
List/Kanban hosts
FAB
workspace/task menus
Task editor
Subtask editor
Schedule UI
Repeat UI
Project/Tag dialogs
To-Do Settings/backup UI
To-Do-owned overlays
```

It does not keep:

```text
primary cross-app rail
shared mobile app navigation
```

## 16.2 Create module entry

Create:

```text
TodoList-ui/js/module.js
```

Responsibilities:

```text
create .todo-app root
load todo-app.html
run current startup stages
retain module root
return lifecycle contract
```

`TodoList-ui/index.html` later becomes a thin standalone harness around this same module.

---

# 17. To-Do `prepareDeactivate()` policy

This is mandatory before seamless switching.

## 17.1 Unsaved editors

If Task/Subtask/Project/Tag editor has unsaved user input:

```text
Switch applications?
Unsaved changes will be discarded.
[Stay] [Switch]
```

Do not destroy user input merely because Chat was clicked.

## 17.2 Destructive restore

If To-Do backup restore is actively replacing data:

```text
block app switch
```

Do not interrupt a destructive transaction halfway.

## 17.3 Pending writes

The shell does not know `AppDataService`.

Inside To-Do `beforeLeave()`:

```js
await AppDataService.whenIdle();
```

after drag/editor transitions are made safe.

---

# 18. To-Do lifecycle inventory

## 18.1 Task drag

On approved leave:

```text
cancel active drag
cancel pending long-press/touch timers
cancel pointer/touch session
stop drag RAF/auto-scroll
remove floating drag unit
remove placeholder
remove task drag layer
clear body/module drag classes
remove document pointer/touch/key/contextmenu handlers
remove window blur handler
```

Do not auto-commit an unfinished preview simply because app switching started.

## 18.2 Taxonomy drag

Clean the equivalent Project/Tag hierarchy drag state:

```text
active/pending session
touch timers
RAF/auto-scroll
floating node
placeholder
body drag layer/classes
document/window handlers
drag-reveal attributes
```

## 18.3 ModalFocusManager

Make modal registration/remount safe.

Preferred explicit lifecycle:

```text
init(root)
destroy()
```

Destroy must clear focus stack and remove global key handler.

## 18.4 Sidebar/Workspace/Tasks/Subtask/Schedule

Audit every:

```text
document listener
window listener
visualViewport listener
resize/scroll callback
long-lived timer
```

and give it a cleanup path.

## 18.5 `window.*` compatibility bridges

Current temporary bridges may remain during first integration if removing them would expand scope.

Examples:

```text
window.TasksComponent
window.SidebarComponent
window.WorkspaceControls
window.ScheduleComponent
window.SubtaskEditorComponent
```

Rules:

```text
assign only while To-Do is mounted
shell never uses them
clear only references owned by that mounted instance on unmount
no stale detached DOM references
```

---

# 19. To-Do portals and viewport drag layers

Revision 2 adds an important nuance.

Prefer a To-Do-owned overlay root for ordinary persistent module UI.

However, do **not** blindly force every drag layer into the module root.

Some drag layers use viewport coordinates and may require body-level positioning to avoid clipping.

For body-level nodes that are technically necessary:

```text
namespace class/id
tag ownership as To-Do
retain direct node reference
remove on unmount
remove related body classes/attributes
never leave anonymous persistent To-Do DOM behind
```

Same principle applies to ChatUI body-level portals if any are truly required.

---

# 20. To-Do CSS/theme isolation

Do this after `.todo-app` and the reusable To-Do fragment/module exist.

## 20.1 Variables

Move:

```text
:root
[data-theme="dark"]
[data-theme="light"]
```

ownership to:

```css
.todo-app { ... }
.todo-app[data-theme="dark"] { ... }
.todo-app[data-theme="light"] { ... }
```

## 20.2 Global resets/layout

Move page-global To-Do rules from:

```text
*
body
#app
```

into module scope or shell, depending on true ownership.

## 20.3 Shared rail extraction

Once shell launcher exists, To-Do CSS must no longer own shared app-rail/mobile-nav layout.

Its secondary sidebar coordinates start from the module host, not from an internally-owned primary rail.

## 20.4 `body.modal-open`

Move module-specific modal state toward:

```text
.todo-app.modal-open
```

where technically practical.

If a body-level state remains temporarily necessary, it must be owned/removed by lifecycle cleanup.

## 20.5 Generic classes

Namespace through `.todo-app` rather than a giant rename.

Examples:

```text
.modal-overlay
.modal-card
.btn-primary
.context-menu
.calendar-day
.empty-state
.header-left
```

---

# 21. Optional appearance bridge

First safe combined release may use a stable neutral shell theme.

Later, modules may report appearance:

```js
getAppearance() -> { theme, accent }
```

or notify shell on changes.

Boundary:

```text
module reports appearance
shell maps it to --shell-* variables
```

Never:

```text
shell directly reads application settings database
module writes its CSS variables onto shell/html root
```

This is polish, not a blocker for first combined release.

---

# 22. DOM ID collision strategy

Confirmed overlapping names are safe only because one module is mounted at a time.

Do not mass-rename every existing internal ID.

New integration IDs must be prefixed:

```text
#shell-app
#shell-module-host
#shell-status-root
#chatui-module-root
#chatui-app-container
#chatui-overlay-root
#todo-module-root
```

For newly refactored lifecycle-sensitive code, prefer root-scoped query methods over global lookups where reasonable.

Do not create a giant mechanical `document.getElementById` rewrite solely for aesthetics.

---

# 23. Data/origin migration — critical

Browser storage is origin-scoped:

```text
scheme + hostname + port
```

Current local development origins are different:

```text
To-Do:  http://localhost:6846
ChatUI: http://localhost:8000
```

Therefore:

```text
TodoListDB at localhost:6846
!=
TodoListDB at localhost:8000
```

Same database name does not move data across origins.

## 23.1 Before cutover

Create and verify:

```text
To-Do backup from old To-Do origin
ChatUI backup from old Chat origin
```

Chat backups may contain API credentials and must remain private.

## 23.2 Combined local origin

If combined local development uses:

```text
http://localhost:8000
```

then Chat data on that exact origin may already exist, but old To-Do data from `6846` must be restored into the new origin.

Verify; do not assume.

## 23.3 Production origin

If deployment hostname changes, both applications require backup/restore migration.

Do not create cross-origin browser hacks to read old IndexedDB.

## 23.4 Rollback

Keep old deployments/origins and backups available until:

```text
counts verified
messages/attachments verified
tasks/projects/tags verified
settings verified
backup/restore re-tested
combined application stable
```

Never automatically delete old browser data during cutover.

---

# 24. Backup architecture

First combined release keeps backups separate:

```text
To-Do Settings -> To-Do backup/restore
Chat Settings  -> ChatUI backup/restore
```

Do not create a new combined backup schema in this integration plan.

A combined backup can be a separate future project after shell integration stabilizes.

---

# 25. Root local SPA server

**New required area in Revision 2.**

Create root:

```text
/server.py
```

Requirements:

```text
serve root/runtime files normally
serve extensionless known SPA routes with root index.html
support /todo-list-ui
support /chat-ui
support /chat-ui/chat/<id>
configurable port
clear startup URL output
LAN binding option for real-phone testing
safe static path handling
```

A plain server that treats `/chat-ui/chat/A` as a physical file path will fail direct refresh.

This local server is required independently of Cloudflare's production SPA fallback.

---

# 26. Root build and deployment

Create root:

```text
/scripts/build-static.mjs
/wrangler.jsonc
```

## 26.1 Build is a strict allow-list

Do not copy repository root wholesale and try to subtract internal files later.

Explicitly include only runtime assets:

```text
index.html
shell runtime assets
ChatUI runtime css/html/js/assets
TodoList-ui runtime css/html/js/assets
required runtime metadata
```

Explicitly do not deploy:

```text
chat UI agent/
to-do list agent/
implementation plan/
implementation-plan review docs
internal handoff notes
local-only diagnostics not required at runtime
source-control metadata
secrets
backup files
```

## 26.2 Output shape

Recommended:

```text
dist/
|-- index.html
|-- shell/
|-- ChatUI/
`-- TodoList-ui/
```

Do not flatten both apps into generic `dist/css`, `dist/js`, `dist/html` folders.

## 26.3 Cloudflare

Root deployment becomes production owner.

Preserve SPA fallback:

```json
"not_found_handling": "single-page-application"
```

Direct requests must return root shell for:

```text
/todo-list-ui
/chat-ui
/chat-ui/chat/<id>
```

Keep old standalone deployment configs during migration until root deployment is verified.

---

# 27. Agent/file ownership during implementation

Revision 2 makes coordination explicit.

This is not a permission model enforced by code; it is a workflow boundary to reduce accidental cross-domain edits.

## 27.1 Shared integration owner

Owns/co-ordinates:

```text
/index.html
/shell/**
/scripts/build-static.mjs
/server.py
/wrangler.jsonc
shared route contract
shared navigation
module registry
cross-module verification
```

Changes to these files should be coordinated because both applications depend on them.

## 27.2 Chat UI agent primary ownership

```text
ChatUI/index.html
ChatUI/js/module.js
ChatUI/js/layout-loader.js
ChatUI/js/app.js
ChatUI/js/router/**
ChatUI/js/chat/conversation.js
ChatUI lifecycle cleanup
ChatUI CSS/theme scoping
Chat dependencies
Chat Settings bridge
Chat route/base path changes
Chat generation/voice/audio leave handling
ChatUI_DB preservation
```

## 27.3 To-Do agent primary ownership

```text
TodoList-ui/index.html
TodoList-ui/html/todo-app.html
TodoList-ui/js/module.js
TodoList-ui/js/bootstrap.js
TodoList-ui/js/app-main.js
TodoList-ui lifecycle cleanup
TodoList-ui CSS/theme scoping
To-Do Settings bridge
To-Do drag/taxonomy drag cleanup
TodoListDB preservation
```

## 27.4 Coordination rule

Neither agent should modify the other's domain/persistence internals merely because an integration file references them.

If a shared contract requires change, coordinate through agreed integration docs/questions first.

---

# 28. Revised implementation phase order

This phase order supersedes Revision 1 where it conflicts.

The critical improvement is:

```text
create real module roots first
THEN scope CSS/themes around those actual roots
```

Do not create broad CSS namespaces around a wrapper that does not yet exist as the real module boundary.

---

# Phase 0 — Baseline, data safety, and branch

## Goal

Freeze a known-good starting point.

## Actions

```text
confirm latest main
create dedicated integration branch
confirm standalone ChatUI works
confirm standalone To-Do works
record DB names/versions
record local origins/ports
create To-Do backup
create ChatUI backup
approve route contract
do not change DB schema
```

## Gate

Stop if either standalone app is already broken.

---

# Phase 1 — Root shell skeleton/router only

Create:

```text
/index.html
/shell/css/shell.css
/shell/js/app-shell.js
/shell/js/router.js
/shell/js/module-registry.js
/shell/js/navigation.js
```

At this phase:

```text
no module cutover
no DB changes
no lifecycle rewrite
```

Verify route parser/canonicalization and neutral shell structure.

---

# Phase 2 — Make ChatUI assets relocatable

Primary files:

```text
ChatUI/index.html
ChatUI/js/layout-loader.js
```

Requirements:

```text
module-relative/configurable CSS/fragment paths
no browser-route-relative fragment fetches
standalone Chat still works
```

Gate:

```text
Chat fragments load
new/open chat
settings
attachments
Workspace basic UI
voice/read surfaces open
```

---

# Phase 3 — Make Chat routing base-path aware

Primary files:

```text
ChatUI/js/router/chat-router.js
ChatUI/js/chat/conversation.js
related route bridge code
```

Support:

```text
/chat-ui
/chat-ui/chat/<id>
```

Preserve:

```text
new chat
open chat
Back/Forward
missing/deleted chat behavior
deep-link refresh semantics
```

Do not yet require seamless cross-app switching.

---

# Phase 4 — Extract To-Do module DOM

Create:

```text
TodoList-ui/html/todo-app.html
```

Separate:

```text
shared app navigation -> shell future ownership
To-Do application DOM -> reusable fragment
```

Standalone To-Do must remain visually/functionally equivalent.

---

# Phase 5 — Create To-Do mount entry

Create:

```text
TodoList-ui/js/module.js
```

Refactor:

```text
bootstrap.js -> standalone harness wrapper
app-main.js -> reusable To-Do startup owner
```

Establish real:

```text
.todo-app
#todo-module-root
```

before broad CSS namespace work.

---

# Phase 6 — Create ChatUI mount entry

Create:

```text
ChatUI/js/module.js
```

Refactor:

```text
layout-loader -> explicit loader
app.js -> explicit start function
index.html -> standalone harness
```

Establish real:

```text
.chatui-app
#chatui-module-root
```

before broad CSS namespace work.

---

# Phase 7 — Isolate ChatUI CSS/theme

Scope Chat styling to `.chatui-app`.

Move Chat theme/accent away from `document.documentElement`.

Keep shell/neutral elements unaffected.

Verify standalone Chat behavior including mobile.

This is a separate rollback checkpoint from To-Do CSS work.

---

# Phase 8 — Isolate To-Do CSS/theme

Scope To-Do styling to `.todo-app`.

Move To-Do theme away from `document.documentElement`.

Remove To-Do ownership assumptions for primary rail/mobile app nav.

Keep shell/neutral elements unaffected.

This is a separate rollback checkpoint from Chat CSS work.

---

# Phase 9 — Move shared launcher ownership to shell

Create the real shared desktop/mobile launcher using To-Do design as donor.

Use real links:

```text
Tasks -> /todo-list-ui
Chat -> remembered Chat route or /chat-ui
```

Keep Habit/Diary as disabled placeholders if still desired.

Settings delegates to active module.

---

# Phase 10 — First canonical combined release with full reload switching

Root `index.html` becomes canonical.

Behavior:

```text
/todo-list-ui -> root shell + only To-Do
/chat-ui... -> root shell + only ChatUI
```

Cross-app links perform full browser navigation.

This phase is intentionally shippable even if true `unmount()` does not yet exist.

Verify:

```text
URLs
deep links
shared rail
styles
data visibility on combined origin
no two module DOMs
```

---

# Phase 11 — To-Do `prepareDeactivate()` + lifecycle cleanup

Add:

```text
unsaved-editor guard
restore-operation blocker
pending-write handling
full drag/taxonomy cleanup
listener/timer cleanup
window-global cleanup
portal cleanup
remount safety
```

Required test in one page lifetime:

```text
mount To-Do
unmount To-Do
mount To-Do
repeat
```

Every action must fire once.

---

# Phase 12 — Chat `prepareDeactivate()` + lifecycle cleanup

Add:

```text
generation leave policy
recording confirmation
Live Voice stop
Read Aloud stop
Workspace cleanup
attachment drag cleanup
all global listener cleanup
timer/RAF/media cleanup
remount-safe initialized state
```

Use exact Chat leave sequence from this plan.

Required test:

```text
mount Chat
unmount Chat
mount Chat
repeat
```

Every send/click/key action must fire once.

---

# Phase 13 — Enable seamless SPA app switching

Only after Phases 11 and 12 pass.

Algorithm:

```text
user activates target app link
        |
        v
activeModule.prepareDeactivate({ targetRoute })
        |
        +--> denied -> stay
        |
        `--> allowed
               |
               v
        activeModule.beforeLeave()
               |
               v
        activeModule.unmount()
               |
               v
        history.pushState/replaceState
               |
               v
        mount target module
```

If cleanup fails:

```text
hard navigate target URL
```

Never mount over uncertain old runtime.

Intercept only appropriate normal same-origin left-click navigation. Preserve browser behaviors such as modified-click/open-in-new-tab.

---

# Phase 14 — Settings, focus, accessibility, title, last-route, appearance

Finish shell UX:

```text
Settings -> activeModule.openSettings()
aria-current on active app link
focus not left in removed DOM
page title reset/delegation
last Chat route remembered
optional shell appearance bridge
unknown-route fallback UI
```

---

# Phase 15 — Dedicated mobile/safe-area pass

Use real phone testing.

Verify:

```text
shared mobile app navigation
To-Do mobile sidebar
To-Do FAB
To-Do keyboard/visualViewport behavior
Schedule keyboard transitions
Chat mobile drawer
Chat composer keyboard
attachment picker/drop behavior
Voice Mode
Read Aloud
settings
safe-area bottom spacing
orientation/resize
pinch zoom
```

Do not treat desktop success as proof of mobile success.

---

# Phase 16 — Root local server + root build + Cloudflare

Implement:

```text
/server.py
/scripts/build-static.mjs
/wrangler.jsonc
```

Verify direct request/refresh for every canonical path locally and in deployment.

Build must be allow-list based.

Keep old standalone deployment files until root deployment passes.

---

# Phase 17 — Origin/data cutover

Before normal usage moves:

```text
re-confirm old backups
record expected counts
open combined To-Do route
restore To-Do if origin changed
refresh and verify
open combined Chat route
restore Chat if needed
refresh and verify
re-create backups from combined origin
```

Keep old origins/backups during stabilization.

---

# Phase 18 — Transitional cleanup

Only after complete verification:

```text
remove duplicate old shared-nav markup/styles
retire obsolete root-absolute Chat assumptions
remove temporary reload-switch compatibility code if no longer needed
convert standalone indexes to documented thin harnesses
retire old production deployment ownership
update final architecture docs
```

Do not collapse application source boundaries for cosmetics.

---

# 29. Chat-specific regression matrix

The combined application is not accepted unless current Chat behavior survives.

Test:

```text
Chat home/new chat
open existing chat
lazy conversation load
message/chat search
pinned chats
Chat projects
rename/move/delete chat
send streaming message
stop generation
regenerate
edit/delete message
HIGH thinking preservation
thought/model response metadata preservation
Google Search
URL Context
Code Execution
Workspace custom-function rounds
Workspace manual UI
attachment file picker
attachment drag/drop
Gemini Files API first upload
Gemini File URI reuse on later messages
local Blob remains durable
after-refresh attachment reuse
image attachment path
audio attachment path
video attachment path
text/data attachment path
PDF attachment path
right sidebar
left sidebar desktop/mobile
Chat Settings/API config
Chat theme/accent isolation
backup creation/restore validation
normal audio recording
Live Voice
Read Aloud cached/live
selected-text Read Aloud
mobile composer/safe areas
modal focus/Escape
```

The shell integration must not change Gemini transport behavior merely to make mounting easier.

---

# 30. To-Do regression matrix

Test:

```text
Inbox/Today/Completed
create/edit/delete task
complete/uncomplete
subtasks
link/unlink hierarchy
projects/sub-projects
tags/sub-tags
taxonomy ordering
project/tag delete repair
List view
Kanban
sort/group
custom order
pointer task drag
touch task drag
root/subtask hierarchy drag
project/tag pointer drag
project/tag touch drag
quick task
full task editor
priority
due date/time
reminders/custom reminders
repeat presets
custom repeat
Repeat Ends Never/Date/Count
next occurrence generation
To-Do Settings/theme
backup/restore
mobile sidebar/FAB
keyboard/visualViewport behavior
focus traps/Escape
hard refresh persistence
```

---

# 31. Cross-module isolation tests

After seamless switching is enabled, perform at least:

```text
20+ To-Do <-> ChatUI switches in one document lifetime
```

Then verify:

```text
one click -> one action
one key event -> one response
one task creation -> one task
one Chat send -> one network/send action
one popstate -> one route reaction
inactive Chat file-drop handler absent
inactive To-Do touch-drag handler absent
no stale portal DOM
no stale body classes
no detached modal focus
no microphone after Chat leave
no Read Aloud after Chat leave
no stale drag layer after To-Do leave
no CSS/theme bleed
only one application root mounted
```

---

# 32. Active-work switch tests

## 32.1 Unsaved To-Do editor

Expected:

```text
prepareDeactivate warns
Stay -> editor/data untouched
Switch -> cleanup begins only after confirmation
```

## 32.2 To-Do restore in progress

Expected:

```text
switch blocked until restore reaches safe completion/failure
```

## 32.3 Chat generation

Expected:

```text
prepareDeactivate applies agreed confirmation policy
if leaving approved -> abort/persist interrupted state
then cleanup
```

## 32.4 Unsent recording

Expected:

```text
warn before discard
if approved -> stop MediaRecorder + tracks
```

## 32.5 Live Voice

Expected:

```text
once switch approved -> stop mic/session/audio before unmount
```

## 32.6 Read Aloud

Expected:

```text
stop playback/session before unmount
```

## 32.7 To-Do drag

Expected:

```text
cancel preview/session
no accidental hierarchy mutation merely because switch started
```

## 32.8 Cleanup failure

Expected:

```text
no next module mount
hard navigation fallback
```

---

# 33. Static verification gates

Before manual acceptance for each phase, inspect source/diff for:

```text
one top-level popstate owner in final mode
shell imports only module entry points
no shell imports of app service/domain internals
one active module root
no unintended app ownership of html/body/:root
TodoListDB name/version preserved
ChatUI_DB name/version preserved
no cross-database imports
no integration-only schema bump
every added document/window/visualViewport listener has cleanup
every long-lived timer/media/session has cleanup
root build excludes internal planning/agent files
```

Small pure route/parser tests are allowed where helpful.

The user will perform real browser/phone behavior testing; do not depend on headless Chrome for this project.

---

# 34. Performance/resource-loading rules

Do not preload an entire inactive application merely to make switching look instant.

Preferred:

```text
shell first
 -> load only route's application module
 -> if Chat, load Chat-only dependencies
```

Once loaded, browser module/cache may make later switches fast.

Do not keep inactive DOM/listeners alive for perceived speed.

Do not mix this integration with Chat context-performance redesign, Files API redesign, or To-Do architecture cleanup unrelated to mounting.

---

# 35. Security/privacy invariants

Do not expose through root build:

```text
Chat API keys
backup files
browser database exports
agent working documents
implementation plans/reviews
internal handoff files
local secrets
```

Keep Chat credential behavior inside Chat settings/storage as currently designed.

The shared shell must never copy an API key into shell state merely for integration.

---

# 36. Explicit non-goals

Do not:

```text
merge ChatUI_DB and TodoListDB
bump DB versions for shell integration
mount both complete apps and hide one
use iframe as final architecture
use Shadow DOM as first solution
introduce React/Vue/Angular solely for integration
mass-rename every internal ID/class
flatten app assets into one generic css/js/html tree
rewrite Gemini transport
disable HIGH thinking
remove Files API/local Blob behavior
rewrite Workspace domain logic
rewrite To-Do RepeatEngine/task CRUD
auto-commit unfinished drag previews
silently discard unsaved editor/recording work
create combined backup format in this plan
preload inactive full app runtime
publish planning/agent docs in dist
perform production origin cutover without verified backups
```

---

# 37. Rollback rules

Every phase should be separately reviewable.

If a phase breaks unrelated behavior:

```text
stop
revert that phase
restore standalone behavior
fix boundary
retest
continue only after green gate
```

Key fallbacks:

```text
soft-switch bug -> keep full-page switching
unmount failure -> hard navigate
CSS regression -> revert only that app's CSS isolation phase
root deployment issue -> keep old deployment
origin/data issue -> restore old deployment/backups
```

Never layer later integration phases on top of a known broken earlier phase.

---

# 38. Definition of done

Complete only when all are true:

```text
[ ] root /index.html is canonical production entry
[ ] / canonicalizes to /todo-list-ui using replace behavior
[ ] /todo-list-ui opens To-Do
[ ] /chat-ui opens ChatUI
[ ] /chat-ui/chat/<id> opens exact persisted chat
[ ] shared desktop rail works
[ ] shared mobile app navigation works
[ ] app route controls are real links
[ ] shared Settings delegates to active module
[ ] only one full application module is mounted at a time
[ ] To-Do can mount/unmount/remount repeatedly
[ ] Chat can mount/unmount/remount repeatedly
[ ] prepareDeactivate protects unsaved/destructive work
[ ] shell never imports application domain/service internals
[ ] Back/Forward works across apps and Chat conversations
[ ] direct deep-link refresh works locally
[ ] direct deep-link refresh works in Cloudflare deployment
[ ] local root SPA server works
[ ] ChatUI_DB preserved
[ ] TodoListDB preserved
[ ] no integration-only DB schema bump
[ ] both app backup/restore systems still work
[ ] old-origin data migration verified
[ ] Chat theme does not overwrite shell/To-Do
[ ] To-Do theme does not overwrite shell/Chat
[ ] Chat generation/voice/audio/drag/timers do not survive leave
[ ] To-Do drag/menu/modal/listeners do not survive leave
[ ] Chat Files API behavior remains correct
[ ] HIGH thinking behavior remains correct
[ ] Workspace/tool behavior remains correct
[ ] To-Do Repeat/hierarchy/order behavior remains correct
[ ] 20+ seamless switches pass exact-once checks
[ ] real phone mobile tests pass
[ ] build is runtime allow-list only
[ ] planning/agent docs are absent from dist
[ ] hard-navigation fallback exists for cleanup failure
[ ] standalone indexes remain useful until explicit retirement
```

---

# 39. Final architecture summary

The final model is:

```text
                         ROOT APPLICATION
                           /index.html
                               |
                    Shared Application Shell
                               |
             +-----------------+-----------------+
             |                                   |
      /todo-list-ui                         /chat-ui...
             |                                   |
        To-Do module                         ChatUI module
             |                                   |
        TodoListDB                           ChatUI_DB
```

The root shell is the main website.

To-Do is the default application for `/` unless the later canonical merged plan explicitly chooses otherwise.

The current To-Do rail/mobile navigation is the visual donor for shared navigation, but the shell owns it after integration.

The AI position becomes the ChatUI launcher.

The applications stay internally independent.

The first combined version uses full reloads between applications for safety.

Only after both apps can safely `prepareDeactivate()`, leave, unmount, and remount should navigation be intercepted for seamless switching.

If seamless cleanup is ever uncertain, hard navigation is the safety fallback.

---

# 40. Revision 2 cross-review decisions

The following points are specifically changed or strengthened because of the To-Do agent implementation plan and its review of this plan:

```text
ADOPTED
- separate prepareDeactivate() from cleanup/unmount
- protect unsaved To-Do drafts and unsent Chat recordings
- block destructive restore transitions
- shell imports only module entry points, never AppDataService/Chat internals
- create real module roots before broad CSS/theme namespace work
- add root SPA-capable local server.py
- explicitly account for localhost:6846 vs localhost:8000 origin data
- remember last Chat route through shell-owned sessionStorage
- define explicit shared/Chat/To-Do agent ownership boundaries
- allow body-level viewport drag layers when technically necessary, with explicit ownership/cleanup
- keep optional module -> shell appearance reporting

RETAINED FROM CHAT UI PLAN
- real <a href> application navigation
- exact Chat lifecycle inventory
- exact Chat leave order
- detailed To-Do drag cleanup inventory
- per-mount AbortController/cleanup-bag preference
- hard-navigation fallback after cleanup failure
- strict allow-list production build
- pin currently unpinned Chat dependencies without replacing libraries
- lazy-load inactive application/dependencies
- detailed Chat Files API/HIGH-thinking/Workspace regression coverage
- 20+ exact-once switch test
- separate Chat and To-Do CSS isolation checkpoints for easier rollback
```

Revision 2 should now be treated as the authoritative Chat UI agent plan. Earlier wording in Revision 1 is superseded where it conflicts with this document.
