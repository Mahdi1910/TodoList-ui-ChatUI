# STOP — CHAT UI AGENT ONLY

**If you are not the Chat UI agent, do not read this document.**

**If you are the To-Do List UI agent, stop here and do not read further.**

The Chat UI agent and the To-Do List UI agent are intentionally creating two separate implementation plans independently. The user will compare those plans later and then create a new, better combined implementation plan. Reading this plan now would contaminate that independent comparison.

---

# Chat UI Agent — Independent Implementation Plan

## Join ChatUI + To-Do List into one routed application

**Status:** Independent planning draft only. This is not authorization to implement runtime changes yet.

**Repository:** `Mahdi1910/TodoList-ui-ChatUI`

**Source revision audited for this plan:**

```text
36fac471bcd4a7c0d5506749139e1dca92b475b5
```

**Canonical target URLs:**

```text
/                         -> canonicalize to /todo-list-ui
/todo-list-ui             -> To-Do List application
/chat-ui                  -> ChatUI home/new-chat surface
/chat-ui/chat/<chatId>    -> specific ChatUI conversation
```

This plan was created independently by the Chat UI agent. I intentionally did **not** read the To-Do List agent's implementation plan.

---

# 1. Goal

The goal is not merely to place two source folders in one repository. The goal is to turn the current two standalone browser applications into **one application experience** with:

1. one production root page;
2. one shared application launcher;
3. URL-based module navigation;
4. one active module mounted at a time;
5. preserved ChatUI behavior;
6. preserved To-Do behavior;
7. preserved existing local user data;
8. independent storage schemas;
9. safe browser Back/Forward and direct deep links;
10. a migration that can be tested and rolled back after every stage.

The desired experience is:

```text
Combined website
│
├── /todo-list-ui
│    └── To-Do module
│         ├── Inbox / Today / Completed
│         ├── Projects / Tags
│         ├── Tasks / Subtasks
│         ├── List / Kanban
│         ├── Drag hierarchy
│         ├── Schedule / Repeat / Reminders
│         └── To-Do settings / backup
│
└── /chat-ui
     └── ChatUI module
          ├── /chat-ui
          ├── /chat-ui/chat/<id>
          ├── Chat projects/search
          ├── Gemini generation/tools
          ├── Attachments / Files API
          ├── Workspace
          ├── Voice / Read Aloud
          └── Chat settings / backup
```

---

# 2. Core architectural decision

## 2.1 Neither current `index.html` becomes the final production root

Today both applications own a complete page:

```text
ChatUI/index.html
TodoList-ui/index.html
```

The safest final architecture is to create a **new repository-root `index.html`**.

Final ownership should become:

```text
/index.html                         <- production root shell
/shell/...                          <- shared app navigation/router/lifecycle
/ChatUI/...                         <- Chat module source
/TodoList-ui/...                    <- To-Do module source
```

The existing application index files should remain temporarily as **standalone verification harnesses** while migration is in progress. They should not be deleted early.

Why:

- ChatUI's index is intentionally a small Chat-specific loader shell.
- To-Do's index contains the entire To-Do DOM plus a launcher rail that looks suitable for a shared shell, but it is still tightly coupled to To-Do CSS, IDs, settings, and bootstrap.
- Making either existing page the parent of the other would force one application's assumptions onto the other.
- A new neutral root creates a clear ownership boundary.

## 2.2 Final shell structure

Recommended final DOM:

```html
<body>
  <div id="shell-app">
    <nav id="shell-primary-nav">
      <!-- To-Do, Chat, future modules, shared active state -->
    </nav>

    <main id="shell-module-host"></main>
  </div>

  <div id="shell-status-root"></div>
</body>
```

Desktop target:

```text
To-Do route:
[ Shared Rail ][ To-Do Secondary Sidebar ][ To-Do Workspace ]

Chat route:
[ Shared Rail ][ Chat Left Sidebar ][ Chat Main ][ Chat Right Sidebar optional ]
```

Mobile target:

```text
[ active module content ]
[ shared mobile application navigation ]
```

The existing To-Do primary rail/mobile app navigation is the best **visual starting point**, but it must become **root-shell-owned markup and CSS**, not remain owned by the To-Do module.

## 2.3 Only one application module mounted at a time

This is a hard safety requirement for the first combined version.

Do this:

```text
shell
  ↓
mount To-Do
  ↓ switch
unmount To-Do
  ↓
mount ChatUI
```

Do **not** do this:

```text
load To-Do + ChatUI together
hide one with display:none
```

The current applications have real collision risks:

- duplicate IDs such as `#project-list`;
- duplicate `#settings-modal`;
- generic classes such as `.modal-overlay`, `.modal-card`, `.header-left`, `.sidebar-header`, `.empty-state`;
- both define generic CSS variables such as `--bg-primary`, `--text-primary`, `--border-color`;
- both globally style `body`, `*`, buttons/inputs;
- both attach document/window listeners;
- both assume viewport-level overlays;
- To-Do exposes several component objects on `window`;
- ChatUI has multiple once-per-page `initialized` flags.

Mounting only one module at a time drastically reduces risk and makes DOM IDs internally reusable.

---

# 3. Source understanding and boundaries

## 3.1 ChatUI entry and bootstrap

Important current files:

```text
ChatUI/index.html
ChatUI/js/layout-loader.js
ChatUI/js/app.js
```

Current behavior:

```text
ChatUI/index.html
   ↓
loads root-absolute Chat CSS + CDN libraries
   ↓
#app-container + #overlay-root
   ↓
/js/layout-loader.js
   ↓
fetch /html/*.html fragments
   ↓
insert layout
   ↓
import ./app.js
   ↓
auto bootstrap every Chat subsystem
```

`ChatUI/js/app.js` currently auto-starts when imported. It does not expose a true `mount()` / `unmount()` contract.

The combined app must change that page lifecycle without changing Chat's domain behavior.

## 3.2 ChatUI routing

Current file:

```text
ChatUI/js/router/chat-router.js
```

Current routes:

```text
/               -> Chat home
/chat/<chatId>  -> chat
```

Current `initChatRouter()` adds `window.popstate` and returns a cleanup function, but `app.js` currently does not retain/use that cleanup.

Current route writes are called by:

```text
ChatUI/js/chat/conversation.js
```

The combined app needs a shared top-level router and Chat-specific route parsing under `/chat-ui`.

## 3.3 ChatUI layout fragments

Chat should keep its focused fragment architecture:

```text
ChatUI/html/left-sidebar.html
ChatUI/html/main-chat.html
ChatUI/html/workspace.html
ChatUI/html/right-sidebar.html
ChatUI/html/chat-modals.html
ChatUI/html/settings-modal.html
ChatUI/html/voice-overlay.html
ChatUI/html/read-aloud-player.html
ChatUI/html/global-ui.html
```

There is no reason to collapse those back into one giant HTML file.

## 3.4 ChatUI durable data

Current database:

```text
ChatUI_DB
```

Current stores include:

```text
projects
chats
messages
attachments
settings
readAudio
workspaceNodes
workspaceFiles
```

Important files:

```text
ChatUI/js/storage/database.js
ChatUI/js/storage/load.js
ChatUI/js/storage/records.js
ChatUI/js/storage/mutations.js
ChatUI/js/storage/backup-restore.js
ChatUI/js/storage/write-coordinator.js
```

This database must remain independent and keep the same database name/schema unless a future unrelated feature specifically requires migration.

## 3.5 ChatUI APIs and generation are not merge targets

The integration should not rewrite:

```text
ChatUI/js/api/gemini.js
ChatUI/js/api/gemini-files.js
ChatUI/js/api/gemini-live-audio.js
ChatUI/js/chat/attachment-transport.js
ChatUI/js/chat/generation-runner.js
ChatUI/js/chat/generation-lifecycle.js
ChatUI/js/tools/function-tool-registry.js
```

Those systems already implement important application behavior: High thinking, SSE streaming, tool rounds, Files API reuse, attachment Blob ownership, abort state, Workspace tools, and voice/audio behavior.

Integration changes should touch them only if a lifecycle hook is genuinely needed, not redesign their protocol.

## 3.6 To-Do entry and bootstrap

Important current files:

```text
TodoList-ui/index.html
TodoList-ui/js/bootstrap.js
TodoList-ui/js/app-main.js
```

The To-Do index currently owns:

- primary application rail;
- mobile application navigation;
- secondary To-Do sidebar;
- workspace;
- all task/schedule/project/tag/settings modal markup;
- the bootstrap script.

`bootstrap.js` already has useful staged startup failure categories. `app-main.js` already separates application startup steps. These are good foundations for a mountable module.

## 3.7 To-Do durable data

Current database:

```text
TodoListDB
```

Important files:

```text
TodoList-ui/js/storage/db-schema.js
TodoList-ui/js/storage/db.js
TodoList-ui/js/storage/repositories.js
TodoList-ui/js/storage/mappers.js
TodoList-ui/js/storage/persistence.js
TodoList-ui/js/storage/data-service.js
TodoList-ui/js/storage/data-service-*.js
TodoList-ui/js/storage/backup-service.js
```

The data/service layer is already well isolated from the Chat database. Keep it that way.

`AppDataService` serializes writes and exposes `whenIdle()`. The shell must use that before unmounting To-Do.

## 3.8 To-Do domain systems are not merge targets

Do not redesign during app integration:

```text
RepeatEngine
TaskModel
TaskFilter
TaskOrder
TaskRelations
TaxonomyOrder
AppDataService CRUD
hierarchy persistence
taxonomy drag persistence
reminder definitions
backup format
```

The goal is page/shell integration, not a simultaneous To-Do architecture rewrite.

---

# 4. Canonical routing design

## 4.1 Routes

Use these canonical public routes:

```text
/                         -> replace/canonicalize to /todo-list-ui
/todo-list-ui             -> To-Do
/chat-ui                  -> Chat home
/chat-ui/chat/<chatId>    -> specific Chat conversation
```

Do not expose physical source directories as user navigation routes.

These are source locations:

```text
/ChatUI/...
/TodoList-ui/...
```

These are user routes:

```text
/chat-ui
/todo-list-ui
```

## 4.2 Why `/todo-list-ui` is the default root target

The final main application is the **root shell**, not To-Do itself. However `/` should canonicalize to `/todo-list-ui` because:

- the current To-Do application already contains the intended multi-app launcher concept;
- Tasks is the current main productivity surface;
- the route remains explicit after canonicalization;
- users always know which application is active from the URL.

If the final merged plan later chooses Chat as default, changing one root-route constant is easy. The architecture must not depend on that choice.

## 4.3 Root router responsibility

Create one shell router, for example:

```text
shell/js/router.js
```

It should provide pure helpers similar to:

```js
parseShellRoute(pathname)
buildTodoPath()
buildChatHomePath()
buildChatPath(chatId)
```

Example parsed results:

```js
{ app: 'todo', type: 'todo-home' }
{ app: 'chat', type: 'chat-home', chatId: null }
{ app: 'chat', type: 'chat', chatId: '...' }
{ app: 'unknown' }
```

The root shell should own exactly one `window.popstate` listener.

## 4.4 Chat router refactor

`ChatUI/js/router/chat-router.js` should stop treating `/` as Chat home.

It can either:

A. become a pure Chat route helper using `/chat-ui`, or
B. receive route information from the root shell and stop parsing `window.location` itself.

Recommended: keep Chat route helpers but make the root shell authoritative.

Chat public helpers should build:

```text
/chat-ui
/chat-ui/chat/<encodedChatId>
```

`ChatUI/js/chat/conversation.js` should call a shell-provided navigation function rather than own top-level History independently.

## 4.5 Same-module route changes should not remount Chat

When user goes:

```text
/chat-ui/chat/A
→ /chat-ui/chat/B
```

root shell should call Chat's route handler, not tear down/reinitialize all ChatUI.

When user goes:

```text
/chat-ui/chat/A
→ /todo-list-ui
```

root shell should run Chat's leave/unmount lifecycle and then mount To-Do.

## 4.6 Legacy route compatibility

If the new combined deployment replaces an existing Chat deployment, optionally support:

```text
/chat/<id> -> replace /chat-ui/chat/<id>
```

Do not make this permanent internal routing logic. It is a cutover compatibility rule.

The old Chat `/` route is ambiguous after the shared root begins defaulting to To-Do. If old Chat `/` must be preserved for an existing production origin, handle that explicitly during deployment migration rather than silently guessing.

---

# 5. Root shared shell

## 5.1 New files

Recommended new root structure:

```text
/index.html
/shell/
  css/
    shell.css
  js/
    app-shell.js
    router.js
    module-registry.js
    dependency-loader.js
/scripts/
  build-static.mjs
/wrangler.jsonc
```

Do not move the existing source folders in the first integration. Keeping `/ChatUI` and `/TodoList-ui` stable avoids hundreds of unnecessary import/path changes.

## 5.2 Shell responsibilities

The root shell owns only cross-application behavior:

- desktop app rail;
- mobile app navigation;
- top-level URL parsing;
- active module selection;
- History/popstate;
- module host;
- module mount/unmount sequencing;
- shared route transitions;
- shell-level error UI;
- optional active-module Settings delegation;
- document title delegation;
- focus after app switch;
- shared safe-area/layout variables.

It should **not** own:

- Chat state;
- Todo state;
- either IndexedDB schema;
- task CRUD;
- Gemini networking;
- Repeat rules;
- Chat projects;
- Todo projects/tags.

## 5.3 Shared app launcher

Move the concept currently implemented by To-Do's:

```text
.primary-rail
.mobile-bottom-nav
```

into shell markup/styles.

Use shell-specific names to avoid inheriting old Todo CSS accidentally, for example:

```text
.shell-app-rail
.shell-app-nav-item
.shell-mobile-nav
```

Recommended buttons/links:

```text
Tasks -> /todo-list-ui
Chat  -> /chat-ui
Habit -> disabled/coming soon
Diary -> disabled/coming soon
Settings -> active-module Settings
```

Use real anchors (`href`) even after SPA switching is enabled so browser semantics and fallback navigation remain correct.

## 5.4 Shared Settings button behavior

Do not try to combine the two Settings systems yet.

Shell calls active module contract:

```js
activeModule.openSettings?.()
```

Expected behavior:

```text
Todo active -> To-Do Settings modal
Chat active -> ChatUI Settings modal
```

This keeps API keys/Chat backup settings separate from Todo theme/data controls.

---

# 6. Module lifecycle contract

Define one small shared contract.

Suggested shape:

```js
const instance = await mountModule({
  host,
  route,
  shell
});

instance.handleRoute?.(route);
instance.openSettings?.();
await instance.beforeLeave?.();
await instance.unmount?.();
```

The shell object may expose:

```js
shell.navigate(path, { replace })
shell.setDocumentTitle(title)
shell.getActiveRoute()
shell.reportError(error)
```

Do not expose application internals through the shell.

---

# 7. ChatUI conversion to a mountable module

## 7.1 Add Chat module entry

Recommended new file:

```text
ChatUI/js/module.js
```

Responsibilities:

1. create `.chatui-app` root;
2. create Chat app/overlay mount points;
3. load Chat HTML fragments;
4. start Chat bootstrap;
5. pass initial shell route;
6. retain cleanup functions;
7. return lifecycle API.

Recommended mounted DOM:

```html
<div class="chatui-app" id="chatui-module-root">
  <div class="chatui-app-container" id="chatui-app-container"></div>
  <div id="chatui-overlay-root"></div>
</div>
```

Avoid reusing shell IDs such as `#app-container` as global root ownership. Internal old code can be migrated gradually with root-scoped helpers.

## 7.2 Refactor `layout-loader.js`

Current `layout-loader.js` executes immediately and fetches `/html/...` absolute URLs.

Convert it into exported functions, e.g.:

```js
export async function loadChatUILayout({ appContainer, overlayRoot })
```

Use module-relative fragment URLs:

```js
new URL('../html/left-sidebar.html', import.meta.url)
```

Do the same for every fragment.

This guarantees direct route `/chat-ui/chat/<id>` does not accidentally request:

```text
/chat-ui/chat/html/...
```

## 7.3 Refactor `app.js`

Current `app.js` auto-runs on import.

Change to explicit lifecycle:

```js
export async function startChatUI(context)
```

It should return cleanup/instance state instead of being a one-shot page script.

Preserve current startup deadline and staged startup names.

Do not remove startup error handling; scope error overlays to Chat root/overlay instead of `document.body`.

## 7.4 Route restoration

Initial Chat mount should receive the already parsed shell route:

```text
/chat-ui
or
/chat-ui/chat/<id>
```

`app.js` should not attach another global `popstate` owner.

Root shell calls Chat's `handleRoute()` for later Chat-route changes.

## 7.5 Chat document title

Replace direct global title writes in:

```text
ChatUI/js/chat/conversation.js
ChatUI/js/workspace/workspace-ui.js
ChatUI/js/workspace/workspace-navigation-bridge.js
```

with shell title delegation.

Examples:

```text
ChatUI
<chat title> — ChatUI
Workspace — ChatUI
```

---

# 8. ChatUI global lifecycle cleanup

This is one of the most important phases. Hiding Chat is not enough.

## 8.1 Generation

Before leaving Chat:

- abort `runtime.activeAbortController` through existing generation lifecycle;
- ensure current generation becomes safely interrupted/persisted using existing semantics;
- do not leave a Gemini request running invisibly in first version.

Relevant:

```text
ChatUI/js/chat/generation-lifecycle.js
ChatUI/js/chat/generation-runner.js
```

## 8.2 Composer recording

Before leave:

- cancel active normal MediaRecorder;
- stop MediaStream tracks;
- clear recording runtime.

Relevant:

```text
ChatUI/js/composer/recorder.js
```

## 8.3 Live Voice

Call existing:

```js
stopLiveVoiceMode()
```

This must close detector/audio context/queue/timers/recording state.

Relevant:

```text
ChatUI/js/voice/live-voice-controller.js
ChatUI/js/voice/voice-ui.js
```

## 8.4 Read Aloud

Call:

```js
stopActiveReadAloud()
```

Then remove hourly cleanup interval and page-level listener during true module unmount.

Relevant:

```text
ChatUI/js/voice/read-aloud.js
ChatUI/js/voice/read-selection.js
```

## 8.5 Attachment drag/drop

Current attachment handling installs document-wide drag/drop and window blur listeners and creates a body overlay.

Refactor to:

- register through Chat lifecycle cleanup;
- scope drop reaction to active Chat module;
- put drag overlay in Chat overlay root;
- remove it on unmount;
- reset `dragDropInitialized` so remount can bind again.

Relevant:

```text
ChatUI/js/composer/attachments.js
```

## 8.6 Menus/modal global listeners

Lifecycle-manage document listeners in:

```text
ChatUI/js/chat/markdown.js
ChatUI/js/ui/action-menu.js
ChatUI/js/ui/modals.js
ChatUI/js/ui/model-thinking-menu.js
ChatUI/js/ui/chat-controls.js
ChatUI/js/composer/composer.js
ChatUI/js/sidebar/sidebar-layout.js
```

Do not leave Escape/click/pointer handlers alive while Todo is active.

## 8.7 Workspace lifecycle

Current `workspace-ui.js` has:

- cached directory state;
- search timer;
- document pagination timer;
- window event listeners;
- resize listener;
- `initialized` flag.

On unmount:

- cancel timers;
- detach window listeners;
- close active Workspace surface;
- reset `initialized` for later remount;
- caches may be retained if safe, but no detached DOM references may remain.

Relevant:

```text
ChatUI/js/workspace/workspace-ui.js
ChatUI/js/workspace/workspace-mobile.js
ChatUI/js/workspace/workspace-navigation-bridge.js
```

`workspace-navigation-bridge.js` and `workspace-mobile.js` currently install listeners as top-level module side effects. Convert them to explicit init/cleanup functions.

## 8.8 Recommended listener mechanism

Use one per-mount `AbortController` for global listeners wherever practical:

```js
const lifecycle = new AbortController();
const { signal } = lifecycle;

document.addEventListener('click', handler, { signal });
window.addEventListener('resize', handler, { signal });
```

Unmount:

```js
lifecycle.abort();
```

Preserve `capture`, `passive`, etc. alongside `signal` where needed.

For timers/RAF/WebSocket/MediaRecorder, explicit cleanup is still required.

## 8.9 Reset one-shot flags

Several Chat modules use module-level `initialized` booleans.

When the Chat DOM is removed and recreated, leaving these flags `true` would mean new DOM gets no listeners.

Every lifecycle-managed module must either:

- stop using permanent module-level initialized flags; or
- reset its flag during destroy.

This is mandatory for reliable repeated switching.

---

# 9. ChatUI CSS isolation

## 9.1 Shell owns page-level CSS

Move page-level ownership to shell:

```text
html
body
box sizing
viewport height
root overflow
safe areas
```

Chat module CSS must stop globally controlling the whole document.

## 9.2 Namespace Chat variables

Current `ChatUI/css/main.css` puts Chat variables on `:root`.

Move them to:

```css
.chatui-app {
  --bg-primary: ...;
  --text-primary: ...;
  --sidebar-width: ...;
  ...
}
```

## 9.3 Scope Chat selectors

Examples:

```css
.chatui-app button { ... }
.chatui-app input:focus { ... }
.chatui-app .sidebar { ... }
.chatui-app .modal-overlay { ... }
```

Do not mechanically rename every class. Namespace through the module root first.

## 9.4 Height behavior

Replace module assumptions such as:

```css
height: 100vh;
height: 100dvh;
```

for main module layout with:

```css
height: 100%;
min-height: 0;
```

The shell module host owns viewport height.

Full-screen Chat modal/voice overlays may still use `position: fixed` because only Chat is active, but they must be Chat-owned and removed on unmount.

## 9.5 Mobile Chat + shared bottom nav

Chat mobile composer must not sit underneath shared app navigation.

Shell should expose a variable such as:

```css
--shell-mobile-nav-height
```

Chat mobile composer should include the shell bottom inset when the shared mobile nav is present.

---

# 10. ChatUI theme isolation

Current Chat Settings applies theme/accent CSS variables to `document.documentElement.style`.

That would recolor Todo and shell.

Refactor `ChatUI/js/settings/settings.js` so:

```text
Chat theme variables -> #chatui-module-root / .chatui-app
not -> document.documentElement
```

Also change broad queries such as `.tab-pane` to query inside the Chat root/settings modal.

Keep Chat's persisted settings exactly where they are now.

When Chat unmounts, its CSS variables disappear with the module root automatically.

---

# 11. To-Do conversion to a mountable module

## 11.1 Do not keep giant production ownership in `TodoList-ui/index.html`

Extract the To-Do-owned DOM to a reusable fragment, for example:

```text
TodoList-ui/html/todo-app.html
```

This fragment should contain:

- To-Do secondary sidebar;
- To-Do workspace;
- task/subtask UI;
- schedule UI;
- project/tag modals;
- Todo settings/backup UI;
- Todo dynamic overlay host.

It should **not** contain the shared primary application rail/mobile app launcher after those are moved to shell.

## 11.2 Add To-Do module entry

Recommended:

```text
TodoList-ui/js/module.js
```

Responsibilities:

- create `.todo-app` root;
- load Todo fragment;
- initialize Todo application using existing `app-main.js` stages;
- return lifecycle methods.

## 11.3 Preserve standalone Todo harness

Refactor `TodoList-ui/index.html` to use the same `module.js` in standalone mode during migration.

This avoids having separate integration code and standalone code drift apart.

---

# 12. To-Do lifecycle cleanup

## 12.1 Wait for persistent writes

Before leaving Todo:

```js
await AppDataService.whenIdle();
```

This protects its serialized write queue.

Do not simply remove Todo DOM while a task/project/tag drag commit or CRUD write is pending.

## 12.2 Cancel drag sessions

Before unmount:

- cancel active task drag safely;
- cancel pending touch drag timers;
- stop drag RAF auto-scroll;
- remove task drag floating/placeholder DOM;
- cancel taxonomy drag;
- remove taxonomy drag layer;
- clear body/module drag classes;
- remove global pointer/touch listeners.

Relevant:

```text
TodoList-ui/js/components/task-drag.js
TodoList-ui/js/components/task-drag-touch.js
TodoList-ui/js/components/task-drag-hierarchy.js
TodoList-ui/js/components/task-drag-commit.js
TodoList-ui/js/components/sidebar-taxonomy-drag.js
TodoList-ui/js/components/sidebar-taxonomy-drag-touch.js
TodoList-ui/js/components/sidebar-taxonomy-drag-hierarchy.js
TodoList-ui/js/components/sidebar-taxonomy-drag-commit.js
```

Do not commit an unfinished preview automatically when switching modules. Cancel it.

## 12.3 Global To-Do listeners

Lifecycle-manage listeners installed by:

```text
SidebarComponent
WorkspaceControls
TasksComponent
SubtaskEditorComponent
ModalFocusManager
Task action/menu systems
visualViewport resize/scroll hooks
window resize/blur hooks
document click/keydown/touch/pointer hooks
```

The same per-mount `AbortController`/cleanup-bag strategy should be used.

## 12.4 `window.*` component bridges

Current To-Do code uses globals such as:

```text
window.SidebarComponent
window.WorkspaceControls
window.TasksComponent
window.SubtaskEditorComponent
```

For the first integration, they may temporarily remain because many existing modules use them.

Rules:

1. assign them only while Todo is mounted;
2. clear them on unmount if they point to the Todo instance;
3. do not create similarly named Chat globals;
4. later replacement by direct ES imports can be a separate maintainability task.

Do not combine this integration with a giant global-removal rewrite.

## 12.5 Dynamic Todo body portals

Current code appends several things to `document.body`, including:

- taxonomy drag layer;
- task parent picker;
- dynamic Repeat Ends modal;
- storage error banner;
- temporary backup download anchor.

Create a Todo overlay/portal root and move persistent UI portals there:

```html
<div data-todo-overlay-root></div>
```

Transient download anchors may still use `document.body` if removed immediately, but no persistent Todo UI should survive Todo unmount.

---

# 13. To-Do CSS isolation

## 13.1 Move To-Do variables from root

Current:

```text
TodoList-ui/css/variables.css
```

uses `:root`, `[data-theme="dark"]`, `[data-theme="light"]` with names that collide with Chat.

Change to module namespace, e.g.:

```css
.todo-app {
  --font-family: ...;
  --spacing-xs: ...;
}

.todo-app[data-theme="dark"] { ... }
.todo-app[data-theme="light"] { ... }
```

## 13.2 Remove global body ownership

`TodoList-ui/css/layout/app-shell.css` currently styles:

```text
*
body
#app
```

Move resets/styles into `.todo-app` or shell as appropriate.

## 13.3 Shared rail no longer belongs to Todo

Remove `.primary-rail` and `.mobile-bottom-nav` production ownership from Todo CSS after their shell equivalents exist.

Todo secondary sidebar should no longer offset itself using the old internal rail width because shell already takes that space.

For example, its desktop module coordinate should start at module-host left `0`, not `left: var(--primary-rail-width)`.

## 13.4 `body.modal-open`

Current quick-task CSS uses:

```css
body.modal-open ...
```

Move this state to the Todo root:

```css
.todo-app.modal-open ...
```

Todo code should add/remove `modal-open` on Todo root, not body.

## 13.5 Generic component selectors

Namespace generic Todo selectors:

```text
.modal-overlay
.modal-card
.modal-title
.setting-row
.btn-primary
.context-menu
.calendar-day
.empty-state
.header-left
```

under `.todo-app`.

---

# 14. To-Do theme isolation

Current `TodoList-ui/js/theme.js` writes:

```js
document.documentElement.setAttribute('data-theme', ...)
```

and uses localStorage key:

```text
theme
```

Change theme rendering to the Todo root:

```js
todoRoot.dataset.theme = themeName;
```

Keep the existing `localStorage` key during this integration to avoid unnecessary preference migration.

The shell should use its own neutral theme or a separate shell setting; it must not depend on Todo's generic `theme` variable.

---

# 15. DOM ID strategy

Because only one application is mounted at a time, we do **not** need a dangerous mass rename of every internal ID.

However new shell/module-owned IDs must be unique and clearly prefixed.

Recommended:

```text
#shell-app
#shell-primary-nav
#shell-module-host
#shell-status-root

#chatui-module-root
#chatui-app-container
#chatui-overlay-root

#todo-module-root
```

Internal existing IDs like Chat's `#project-list` and Todo's `#project-list` can coexist safely in source because their DOM trees are never mounted together.

Prefer root-scoped lookup helpers over `document.getElementById` for newly refactored module code.

Example:

```js
function chatById(id) {
  return chatRoot.querySelector(`#${CSS.escape(id)}`);
}
```

Do not rewrite every lookup in a single phase; migrate the lifecycle-sensitive/common ones first.

---

# 16. External/global dependency handling

ChatUI currently depends on global CDN resources from its standalone `index.html`:

```text
Lucide
marked
highlight.js
highlight.js CSS
```

Todo mostly uses inline SVG and does not require the same globals.

Recommended root design:

```js
await loadChatDependencies();
await mountChatUI(...);
```

Requirements:

- load Chat-only dependencies only when Chat is first needed;
- cache dependency Promise so switching back does not duplicate scripts;
- pin Lucide to an exact tested version instead of `@latest`;
- pin marked/highlight versions;
- preferably vendor or scope Highlight's stylesheet so it does not unexpectedly affect Todo;
- keep `lucide.createIcons()` behavior for Chat.

Do not introduce React/Vite/Webpack/etc. merely to combine these vanilla applications.

---

# 17. Data ownership and persistence

## 17.1 Keep databases separate

Final combined application should still have:

```text
ChatUI_DB
TodoListDB
```

No merge.

Benefits:

- no destructive schema migration;
- each app's backup stays understandable;
- rollback remains simple;
- app changes stay isolated;
- less chance of losing existing data.

## 17.2 Do not bump DB versions for shell integration

Routing/CSS/mounting changes do not require a database version bump.

Only change a database schema if a separate data requirement demands it.

## 17.3 localStorage ownership

Known Chat keys include legacy migration/temporary diagnostics such as:

```text
chat_app_data
chat_app_data_indexeddb_migrated
chatui_temp_performance_diagnostics_v1
```

Todo uses:

```text
theme
```

Do not reuse those names in shell.

Shell keys, if any, should use a namespace, e.g.:

```text
combined_app_...
```

Avoid creating a shell preference unless it is actually needed.

---

# 18. Origin migration — critical data warning

IndexedDB and localStorage are **origin-scoped**.

This means:

```text
same database name + different website origin
≠ same data
```

If the new combined app is deployed at a new hostname/domain, it cannot directly read the old application's IndexedDB from another origin.

Therefore production cutover must include backup/restore.

## 18.1 Before cutover

On old Chat deployment:

```text
Create ChatUI full backup
```

On old Todo deployment:

```text
Create Todo backup
```

## 18.2 New combined origin

Deploy combined app, then restore:

```text
Chat backup -> ChatUI_DB on new origin
Todo backup -> TodoListDB on new origin
```

## 18.3 If combined app reuses one existing origin

Only data belonging to that exact origin will already be visible.

Example:

```text
Combined app replaces old Chat origin
→ ChatUI_DB may already be there
→ TodoListDB from a different old origin will not be there
```

Todo still needs backup/restore.

## 18.4 Rollback

Keep old deployments available until:

- data counts verified;
- messages/attachments verified;
- Todo tasks/projects/tags verified;
- backup/restore verified;
- combined app stable for rollback window.

Do not delete the old deployments immediately after first successful load.

---

# 19. Build and Cloudflare deployment

## 19.1 Current Chat build is standalone-specific

Current:

```text
ChatUI/scripts/build-static.mjs
ChatUI/wrangler.jsonc
```

The Chat build copies standalone `index.html`, `css`, `html`, `js` into Chat's own `dist/`.

Final production needs a root build instead.

## 19.2 New root build

Add:

```text
/scripts/build-static.mjs
```

It should create:

```text
dist/
  index.html
  shell/
  ChatUI/
    css/
    html/
    js/
  TodoList-ui/
    css/
    html/
    js/
```

Include only runtime assets actually needed.

## 19.3 Do not deploy internal agent/planning files

The root build must **not** copy the repository blindly.

Do not publish:

```text
chat UI agent/
to-do list agent/
implementation plans
handoff/internal notes
unneeded local server scripts
secrets
```

Use an allow-list build.

## 19.4 Root Wrangler

Create root:

```text
/wrangler.jsonc
```

with static assets pointing to root `dist/` and:

```json
"not_found_handling": "single-page-application"
```

This is necessary so a direct browser request to:

```text
/chat-ui/chat/<id>
```

returns root `index.html`, then client router mounts ChatUI and opens that conversation.

---

# 20. Migration implementation phases

Every phase should be independently reviewable and reversible. Do not combine these into one giant commit.

---

## Phase 0 — Freeze baseline, route contract, and acceptance baseline

### Purpose

Create a known-good reference before structural work.

### Actions

1. Record source commit being migrated.
2. Confirm standalone Chat works from `ChatUI/index.html`.
3. Confirm standalone Todo works from `TodoList-ui/index.html`.
4. Record database names/versions.
5. Confirm backups can be created before structural changes.
6. Approve canonical route contract:

```text
/ -> /todo-list-ui
/todo-list-ui
/chat-ui
/chat-ui/chat/<id>
```

7. Decide production combined origin before final cutover.

### Runtime files changed

None unless a baseline diagnostic is strictly needed.

### Acceptance

Both current apps remain unchanged and independently usable.

---

## Phase 1 — Add neutral root shell skeleton

### Add

```text
/index.html
/shell/css/shell.css
/shell/js/router.js
/shell/js/module-registry.js
/shell/js/app-shell.js
```

### Requirements

- shell has no Chat/Todo business logic;
- shell CSS uses only `--shell-*` variables;
- root `/` canonicalizes to `/todo-list-ui`;
- root router recognizes all target routes;
- shared nav exists but may initially use ordinary page navigation/fallback;
- no current module code needs to be destroyed in this phase.

### Acceptance

Route parser tests/manual checks correctly identify Todo/Chat/deep Chat route/unknown.

---

## Phase 2 — Make ChatUI asset loading base-path safe

### Change

```text
ChatUI/index.html
ChatUI/js/layout-loader.js
```

### Requirements

- remove reliance on root `/css`, `/js`, `/html` for Chat's standalone loader;
- fragments resolve relative to module source, not browser route;
- expose reusable layout loading function;
- preserve current fragment order;
- preserve `#app-container`/overlay semantics in standalone harness until module mount is ready.

### Acceptance

Chat standalone still starts and all fragments load.

Test from paths that prove route depth cannot break fragment resolution.

---

## Phase 3 — Prefix Chat routes

### Change

```text
ChatUI/js/router/chat-router.js
ChatUI/js/chat/conversation.js
ChatUI/js/app.js
ChatUI/js/workspace/workspace-navigation-bridge.js
```

### Requirements

- Chat canonical home becomes `/chat-ui`;
- conversations become `/chat-ui/chat/<id>`;
- parsing/building works with encoded IDs;
- Chat internal operations no longer reset top-level route to `/`;
- prepare shell navigation injection;
- preserve Back/Forward behavior in standalone test harness.

### Acceptance

Direct Chat home, open chat, new chat, Back, Forward all use new paths.

---

## Phase 4 — Isolate Chat CSS and theme

### Change

Main Chat CSS aggregators/subfiles as required, especially:

```text
ChatUI/css/main.css
ChatUI/css/responsive.css
ChatUI/css/sidebar/shell.css
ChatUI/css/chat/layout.css
ChatUI/css/components/modals.css
ChatUI/css/components/right-sidebar.css
ChatUI/js/settings/settings.js
```

### Requirements

- `.chatui-app` owns Chat vars;
- no Chat global body/reset/theme ownership;
- global button/input rules scoped;
- Chat theme/accent writes to module root;
- mobile layout uses module host;
- Chat standalone harness applies `.chatui-app` root so appearance remains equivalent.

### Acceptance

Chat looks and behaves the same standalone.

A neutral element outside `.chatui-app` must not receive Chat button/modal/theme styling.

---

## Phase 5 — Create explicit Chat mount/bootstrap

### Add/change

```text
ChatUI/js/module.js
ChatUI/js/app.js
ChatUI/js/layout-loader.js
ChatUI/index.html
```

### Requirements

- importing module does not auto-bootstrap page;
- `mountChatUI()` creates/loads Chat DOM;
- startup receives route/shell interface;
- returns module instance;
- standalone Chat index simply mounts the same module;
- preserve staged startup deadline/error UI.

### Acceptance

Mount Chat into arbitrary host div without Chat owning complete body.

---

## Phase 6 — Extract To-Do-owned markup

### Add/change

```text
TodoList-ui/html/todo-app.html
TodoList-ui/index.html
TodoList-ui/js/module.js
TodoList-ui/js/bootstrap.js
TodoList-ui/js/app-main.js
```

### Requirements

- remove shared app rail/mobile launcher from Todo-owned fragment;
- keep all Todo task/sidebar/modal markup intact;
- standalone Todo index mounts same Todo module;
- preserve staged bootstrap categories;
- no CRUD/repeat/storage rewrite.

### Acceptance

Standalone Todo remains behaviorally equivalent without depending on duplicated markup.

---

## Phase 7 — Isolate To-Do CSS and theme

### Change

At minimum:

```text
TodoList-ui/css/variables.css
TodoList-ui/css/layout/app-shell.css
TodoList-ui/css/layout/sidebar-layout.css
TodoList-ui/css/layout/workspace-layout.css
TodoList-ui/css/components/modal-controls.css
TodoList-ui/css/components/quick-task.css
TodoList-ui/js/theme.js
```

plus other CSS files containing generic selectors as discovered during implementation.

### Requirements

- `.todo-app` owns Todo vars;
- Todo theme on module root;
- body/modal state moved to module root;
- secondary sidebar no longer assumes Todo owns primary rail;
- shell owns desktop rail/mobile nav space;
- generic CSS scoped under `.todo-app`.

### Acceptance

Todo standalone appearance/behavior preserved.

Neutral elements outside `.todo-app` remain unaffected by Todo CSS.

---

## Phase 8 — Move app launcher ownership into shell

### Move/recreate from Todo design

- desktop primary rail;
- mobile app bottom nav;
- app active states;
- shared app Settings trigger.

### Requirements

- Tasks navigates `/todo-list-ui`;
- Chat navigates `/chat-ui`;
- Chat replaces current placeholder AI app role;
- Habit/Diary can remain disabled placeholders;
- shell app nav is available regardless of active module;
- shell nav CSS is independent from Todo theme variables.

### Acceptance

Both routes show same persistent launcher but correct module-specific secondary layout.

---

## Phase 9 — Root shell mounts one module by URL

### Change

```text
shell/js/app-shell.js
shell/js/module-registry.js
```

### First safe version

It is acceptable initially for app launcher anchors to perform a **full page reload** between `/todo-list-ui` and `/chat-ui`.

Why this intermediate step is valuable:

- immediately proves root routing/build/deep links;
- guarantees only one module initialization;
- avoids pretending unmount lifecycle is ready before it is;
- provides a safe combined website early.

### Acceptance

- `/todo-list-ui` loads Todo through root shell;
- `/chat-ui` loads Chat through root shell;
- `/chat-ui/chat/<id>` direct reload works;
- both data stores are visible on same origin;
- shared navigation remains present.

---

## Phase 10 — Complete Chat `beforeLeave()` / `unmount()`

### Refactor lifecycle-sensitive Chat files

Including at least:

```text
ChatUI/js/app.js
ChatUI/js/chat/markdown.js
ChatUI/js/ui/action-menu.js
ChatUI/js/ui/modals.js
ChatUI/js/ui/model-thinking-menu.js
ChatUI/js/ui/chat-controls.js
ChatUI/js/sidebar/sidebar-layout.js
ChatUI/js/composer/composer.js
ChatUI/js/composer/attachments.js
ChatUI/js/composer/recorder.js
ChatUI/js/voice/read-selection.js
ChatUI/js/voice/read-aloud.js
ChatUI/js/voice/live-voice-controller.js
ChatUI/js/workspace/workspace-ui.js
ChatUI/js/workspace/workspace-mobile.js
ChatUI/js/workspace/workspace-navigation-bridge.js
```

### `beforeLeave()` sequence

Recommended:

```text
1. block new Chat actions
2. abort active Gemini generation safely
3. cancel normal audio recording
4. stop Live Voice
5. stop Read Aloud
6. close Workspace transient UI
7. close menus/modals
8. clear attachment drag state/overlay
9. cancel timers/RAF
10. detach document/window listeners
11. remove Chat root
```

### Acceptance

Mount -> unmount -> mount Chat repeatedly and every action fires once.

---

## Phase 11 — Complete Todo `beforeLeave()` / `unmount()`

### Relevant components

- Sidebar
- WorkspaceControls
- Tasks
- Task/subtask menu/drag
- taxonomy drag
- Schedule
- ModalFocusManager
- Settings
- dynamic portals

### `beforeLeave()` sequence

```text
1. block new Todo actions
2. cancel pending/active task drag
3. cancel pending/active taxonomy drag
4. close task/taxonomy/context menus
5. close modals without committing draft changes
6. await AppDataService.whenIdle()
7. cancel timers/RAF/viewport hooks
8. detach global listeners
9. clear window Todo component references
10. remove Todo root
```

### Acceptance

Mount -> unmount -> mount Todo repeatedly with no duplicate click/touch/keyboard behavior and no lost writes.

---

## Phase 12 — Enable soft SPA application switching

Only after Phases 10 and 11 pass.

### Shell behavior

Intercept same-origin shell nav anchors.

Switch algorithm:

```text
user clicks Chat
  ↓
active Todo.beforeLeave()
  ↓
active Todo.unmount()
  ↓
history.pushState(/chat-ui)
  ↓
mount Chat
```

Back button uses root shell's one popstate path.

### Important

If lifecycle cleanup fails in testing, retain full-page navigation. Full reload is preferable to hidden duplicate listeners/data corruption.

### Acceptance

Switch Todo ↔ Chat at least 20 times without duplicate handlers, stale overlays, or CSS bleed.

---

## Phase 13 — Shared settings delegation, focus, accessibility, title

### Shell responsibilities

- update app nav `aria-current`;
- focus active module heading/host after module switch;
- keep browser Back/Forward predictable;
- delegate Settings;
- update page title via module callback;
- ensure inactive module DOM is absent;
- ensure mobile nav is keyboard/touch accessible.

### Acceptance

Keyboard-only module switching works and focus never lands in removed DOM.

---

## Phase 14 — Root production build and deep-link deployment

### Add/change

```text
/scripts/build-static.mjs
/wrangler.jsonc
```

### Requirements

- allow-list runtime assets;
- no agent/internal docs in dist;
- SPA fallback enabled;
- Chat CDN dependencies pinned or vendored as decided;
- `/chat-ui/chat/<id>` direct request works after deploy;
- cache behavior does not break fresh HTML/module version transitions.

### Acceptance

Test deployment from clean browser session and direct deep links.

---

## Phase 15 — Production data migration/cutover

### Before switch

- backup old Chat;
- backup old Todo;
- record expected counts;
- keep old origins available.

### New origin

- restore needed Chat/Todo data;
- verify chats/messages/projects/attachments/Workspace;
- verify tasks/subtasks/projects/tags/repeats/reminders;
- verify both backups can be re-created from combined origin.

### Rollback

If any data issue occurs, revert deployment and keep old-origin data untouched.

---

## Phase 16 — Regression and cleanup

Only after full pass:

- decide whether standalone production entry points are still needed;
- keep dev harnesses if useful;
- remove obsolete root-absolute Chat assumptions;
- remove temporary compatibility redirects after migration window;
- remove any duplicated old shell nav markup/styles from Todo;
- document final architecture.

Do not remove old source boundaries just for cosmetic folder organization.

---

# 21. Detailed test matrix

## 21.1 Shell/routing

Test:

```text
/
/todo-list-ui
/chat-ui
/chat-ui/chat/<valid id>
/chat-ui/chat/<invalid id>
unknown path
```

Verify:

- direct address load;
- reload;
- Back;
- Forward;
- module nav click;
- URL always describes active app;
- only one module root exists.

## 21.2 Chat regression

Verify all current behaviors:

- Chat home/new chat;
- open existing chat;
- lazy conversation load;
- search chats/messages;
- pinned chats;
- Chat projects;
- rename/move/delete chats;
- new/send streaming;
- stop generation;
- regenerate;
- edit/delete message;
- High thinking preservation;
- Google Search/URL Context/Code Execution;
- Workspace tool rounds;
- Chat Workspace manual UI;
- attachment picker;
- attachment drag/drop;
- Files API first upload;
- File URI reuse on later requests;
- attachment local Blob persistence;
- image/audio/video/text/PDF paths;
- right sidebar;
- left sidebar desktop/mobile;
- Chat Settings;
- API key/base URL settings;
- Chat theme/accent isolation;
- Chat backup/restore;
- voice message recorder;
- Live Voice;
- Read Aloud cached/live;
- selected-text Read Aloud;
- mobile composer/safe area;
- modal focus/Escape.

## 21.3 Todo regression

Verify:

- Inbox/Today/Completed;
- create/edit/delete task;
- complete/uncomplete;
- subtasks;
- link/unlink hierarchy;
- projects/sub-projects;
- tags/sub-tags;
- taxonomy ordering;
- project/tag delete repairs;
- list view;
- Kanban;
- sort/group;
- custom sort activation;
- pointer task drag;
- touch task drag;
- root/subtask hierarchy drag;
- taxonomy pointer drag;
- taxonomy touch drag;
- quick task modal;
- full task edit;
- priority;
- due date/time;
- reminders/custom reminders;
- repeat presets;
- custom weekly/monthly/yearly repeat;
- repeat end Never/On date/After count;
- repeat next occurrence generation;
- Todo Settings;
- theme isolation;
- backup/restore;
- mobile sidebar;
- mobile FAB;
- mobile keyboard/visual viewport behavior;
- focus traps/Escape.

## 21.4 Cross-module isolation

Repeated switching tests:

```text
Todo -> Chat -> Todo -> Chat ... 20+ cycles
```

Verify:

- one click causes one action;
- one Escape event causes one active-module response;
- no duplicate popstate handling;
- no inactive drag handlers;
- dragging a file over Todo does not open Chat drop overlay;
- To-Do touch drag listeners absent while Chat active;
- no detached modal receives focus;
- inactive module root removed;
- no duplicate IDs across mounted DOM;
- no stale portal elements in body;
- no stale body classes;
- Chat theme does not recolor Todo;
- Todo theme does not recolor Chat;
- shell rail does not inherit module variable values.

## 21.5 Active-work switch tests

### Switch away during Chat generation

Expected first-version behavior:

```text
active generation safely aborted/interrupted
state persisted
then Chat unmounts
```

No invisible background generation.

### Switch away during normal recording

Expected:

```text
recording cancelled
microphone tracks stop
Todo mounts
```

### Switch away during Live Voice

Expected:

```text
Live Voice closes
speech queue/audio context/mic stop
Todo mounts
```

### Switch away during Read Aloud

Expected:

```text
playback/generation stop safely
```

### Switch away during Todo drag

Expected:

```text
drag cancelled
no hierarchy mutation unless already committed
```

### Switch away immediately after Todo mutation

Expected:

```text
await data-service write queue
then unmount
```

## 21.6 Persistence

After switching and refresh:

- ChatUI_DB intact;
- TodoListDB intact;
- no shell-created accidental DB;
- no schema bump merely from integration;
- backups still validate;
- settings stay app-specific.

---

# 22. Performance considerations

Do not preload the entire inactive application unnecessarily.

Recommended:

```text
shell HTML/CSS/JS first
       ↓
load only route's module
       ↓
load Chat CDN deps only if Chat route
```

Once loaded, browser module/cache can make later switching fast.

Do not keep both application DOMs active for perceived speed. Listener/CSS correctness matters more.

Chat's current long-history/API performance work and Files API should remain untouched by shell integration.

---

# 23. Error handling requirements

## Shell failure

Root shell shows neutral error with retry/navigation options.

## Chat mount failure

Preserve Chat's staged startup error concept and 15-second deadline, but render error inside Chat/shell-owned status surface.

## Todo mount failure

Preserve Todo's current staged categories:

```text
MODULE_LOAD
INTEGRATION
DATABASE_OPEN
DATABASE_REPAIR
HYDRATION
UI_INIT
```

A Todo mount failure must not corrupt Chat or shell.

## Unmount failure

Shell should not mount the next module over an incompletely cleaned previous module.

Safer fallback:

```text
cleanup failure
→ hard navigate/reload target URL
```

This provides a robust escape hatch during migration.

---

# 24. Accessibility requirements

- shared nav uses anchors/buttons with labels;
- active module uses `aria-current`;
- module host gets focus after cross-app switch when appropriate;
- do not leave focus inside removed module;
- each module's own modal focus trap remains scoped to active module;
- Escape handling only comes from active module;
- disabled future app icons communicate unavailable state;
- mobile app nav respects safe-area insets;
- shared Settings announces active module context if needed.

---

# 25. Security/privacy invariants

Integration must not accidentally expose:

- Chat API keys;
- Chat backups;
- Todo backups;
- local database data;
- agent planning documents.

Root build must remain an explicit runtime allow-list.

Do not copy repository internals wholesale into static deployment.

Chat API credentials remain in Chat settings/database exactly as current architecture intends.

---

# 26. Things implementation must NOT do

1. Do not merge `ChatUI_DB` and `TodoListDB`.
2. Do not change DB versions just because the apps are joined.
3. Do not rewrite Chat Gemini transport/generation/tool protocol.
4. Do not remove Chat Files API/local Blob behavior.
5. Do not reduce High thinking behavior.
6. Do not rewrite Todo RepeatEngine/task CRUD/hierarchy algorithms.
7. Do not remove `AppDataService` serialized writes.
8. Do not load both complete app DOMs and only hide one.
9. Do not use iframe as final architecture.
10. Do not introduce Shadow DOM for this migration.
11. Do not introduce a framework/build ecosystem solely for integration.
12. Do not mass-rename every internal ID/class in one giant commit.
13. Do not make Chat or Todo theme write global root variables after isolation.
14. Do not leave inactive document/window listeners alive.
15. Do not leave microphones/audio/WebSockets running after leaving Chat.
16. Do not auto-commit incomplete Todo drag previews during module switch.
17. Do not delete old standalone harnesses before the combined app is proven.
18. Do not deploy `chat UI agent/` or `to-do list agent/` documents.
19. Do not assume same DB name means data moves across origins.
20. Do not perform production origin cutover without backups.

---

# 27. Expected important file changes

This list is intentionally broader than a final diff because exact scoping will be refined phase by phase.

## New shared root

```text
index.html
shell/css/shell.css
shell/js/app-shell.js
shell/js/router.js
shell/js/module-registry.js
shell/js/dependency-loader.js
scripts/build-static.mjs
wrangler.jsonc
```

## Chat primary integration files

```text
ChatUI/index.html
ChatUI/js/module.js                       (new)
ChatUI/js/layout-loader.js
ChatUI/js/app.js
ChatUI/js/router/chat-router.js
ChatUI/js/chat/conversation.js
ChatUI/js/settings/settings.js
ChatUI/js/composer/attachments.js
ChatUI/js/composer/recorder.js
ChatUI/js/ui/action-menu.js
ChatUI/js/ui/modals.js
ChatUI/js/ui/model-thinking-menu.js
ChatUI/js/ui/chat-controls.js
ChatUI/js/sidebar/sidebar-layout.js
ChatUI/js/chat/markdown.js
ChatUI/js/voice/read-selection.js
ChatUI/js/voice/read-aloud.js
ChatUI/js/voice/live-voice-controller.js
ChatUI/js/workspace/workspace-ui.js
ChatUI/js/workspace/workspace-mobile.js
ChatUI/js/workspace/workspace-navigation-bridge.js
```

Chat CSS files will require namespace edits across the aggregators/subfiles, especially page/global selectors.

## Todo primary integration files

```text
TodoList-ui/index.html
TodoList-ui/html/todo-app.html             (new)
TodoList-ui/js/module.js                   (new)
TodoList-ui/js/bootstrap.js
TodoList-ui/js/app-main.js
TodoList-ui/js/theme.js
TodoList-ui/js/components/sidebar.js
TodoList-ui/js/components/workspace-controls.js
TodoList-ui/js/components/tasks.js
TodoList-ui/js/components/subtask-editor.js
TodoList-ui/js/components/modal-focus.js
TodoList-ui/js/components/task-drag*.js
TodoList-ui/js/components/sidebar-taxonomy-drag*.js
TodoList-ui/js/components/task-actions.js
TodoList-ui/js/components/task-menus.js
TodoList-ui/js/components/schedule*.js
TodoList-ui/js/components/settings.js
TodoList-ui/js/storage/persistence.js
```

Todo CSS files require namespace and shared-nav extraction, particularly:

```text
TodoList-ui/css/variables.css
TodoList-ui/css/layout/app-shell.css
TodoList-ui/css/layout/sidebar-layout.css
TodoList-ui/css/layout/workspace-layout.css
TodoList-ui/css/components/modal-controls.css
TodoList-ui/css/components/quick-task.css
```

Domain/service files should generally remain unchanged.

---

# 28. Rollback strategy

Every implementation phase should be its own coherent branch/commit set.

Before enabling soft switching:

```text
full-page shell route switching
```

is a safe fallback.

If soft switching produces lifecycle problems, revert only that phase and retain the combined URL/root deployment with full reloads.

If CSS isolation causes regressions, revert that module's namespace phase without touching databases.

If production origin migration has data problems, revert deployment and use old origins/backups. Never attempt emergency schema merging.

---

# 29. Definition of done

The integration is complete only when all of the following are true:

```text
[ ] root /index.html is production owner
[ ] / redirects/canonicalizes to /todo-list-ui
[ ] /todo-list-ui directly loads Todo
[ ] /chat-ui directly loads Chat
[ ] /chat-ui/chat/<id> directly loads exact chat
[ ] browser Back/Forward works across and within modules
[ ] shared desktop rail works
[ ] shared mobile nav works
[ ] only one module DOM exists at a time
[ ] Chat can unmount/remount repeatedly
[ ] Todo can unmount/remount repeatedly
[ ] no duplicate global listener behavior after repeated switching
[ ] Chat generation/voice/audio stop safely on leave
[ ] Todo pending writes complete before leave
[ ] Todo drag state cancels safely on leave
[ ] Chat CSS/theme does not affect Todo
[ ] Todo CSS/theme does not affect Chat
[ ] ChatUI_DB preserved
[ ] TodoListDB preserved
[ ] both backup/restore systems still work
[ ] Chat Files API behavior unchanged
[ ] Todo Repeat/task hierarchy behavior unchanged
[ ] Cloudflare deep-link fallback works
[ ] root dist excludes agent/internal planning documents
[ ] production data migration is verified
[ ] rollback path remains available through stabilization window
```

---

# 30. Final recommendation from Chat UI agent

The recommended end state is:

```text
                    ROOT APPLICATION
                         /index.html
                             │
               ┌─────────────┴─────────────┐
               │       Shared Shell        │
               │ route + app launcher      │
               └─────────────┬─────────────┘
                             │
                    one module at a time
                  ┌──────────┴──────────┐
                  │                     │
          /todo-list-ui              /chat-ui
                  │                     │
            Todo module              Chat module
                  │                     │
            TodoListDB                ChatUI_DB
                  │                     │
       task/repeat system       Gemini/Workspace/Voice

Chat conversation deep route:
/chat-ui/chat/<chatId>
```

The safest migration is **not** to immediately create a sophisticated single-page mount/unmount system in one shot. First establish the shared root, canonical URLs, CSS namespaces, module entry points, and one-module-per-page behavior. Then add complete cleanup lifecycles. Only after repeated unmount/remount tests pass should the shell intercept navigation and switch applications without a full reload.

This approach gives the user the requested unified website early while preserving a reliable fallback at every stage.

---

# 31. Independence note

This document is intentionally the Chat UI agent's independent plan. It should be compared with the independently-created To-Do List UI agent plan **only after both agents have finished**.

At that point, the user can identify:

- ideas both agents independently agree on;
- conflicts that need a deliberate choice;
- gaps found by only one agent;
- duplicated work;
- the best phase ordering.

Then this document and the other independent plan should be treated as inputs to a new final combined implementation plan rather than either one being implemented blindly as-is.
