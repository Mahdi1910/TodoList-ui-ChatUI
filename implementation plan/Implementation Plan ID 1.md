# Implementation Plan ID 1 — Unified To-Do + ChatUI Application Shell

> **Status:** Plan only. Do not implement runtime integration as part of creating this document.
>
> **Repository:** `Mahdi1910/TodoList-ui-ChatUI`
>
> **Planning source of truth:** GitHub `main` at `36fac471bcd4a7c0d5506749139e1dca92b475b5`.
>
> **Primary goal:** Turn the existing `TodoList-ui` and `ChatUI` applications into one unified website/application with one shared app launcher, while preserving both applications' current behavior and local data.
>
> **User-facing navigation requirement:** The existing To-Do application rail becomes the shared launcher. The To-Do button opens To-Do. The existing AI button opens ChatUI.
>
> **Canonical route requirement:** The URL must clearly show which application is active.

---

# 1. Executive Architecture Decision

The final application will use **one new root `index.html` as the canonical/main entry point**.

Neither existing application `index.html` will remain the production owner of the whole page.

Final conceptual architecture:

```text
One combined website
        |
        v
Root index.html
        |
        v
Shared Application Shell
  |-- shared desktop application rail
  |-- shared mobile application navigation
  |-- top-level router
  |-- active-module host
  `-- active-module lifecycle manager
        |
        +--> To-Do module
        |      `-- TodoListDB
        |
        `--> ChatUI module
               `-- ChatUI_DB
```

Only **one full application module is active at a time**.

Do **not** load the current complete To-Do DOM/runtime and current complete ChatUI DOM/runtime at the same time and merely hide one with CSS.

That shortcut is unsafe in the current source because both applications have:

```text
page-global CSS
same-name CSS variables
same/generic CSS classes
document/window event listeners
full-viewport assumptions
module-level initialized flags
body/documentElement writes
at least one confirmed duplicate DOM id: #project-list
```

The final design is therefore:

```text
Shared shell is always alive.
Exactly one application module is mounted/active.
Switching apps eventually unmounts/deactivates the old module and activates the new module.
```

---

# 2. User-Facing Final Behavior

## 2.1 Desktop

The narrow left rail that currently belongs to To-Do becomes **shared shell UI**.

Conceptual final desktop behavior:

```text
To-Do active

[ Shared Rail ][ To-Do Sidebar ][ To-Do Workspace ]
     [✓]
     [AI]
     [H]
     [D]


ChatUI active

[ Shared Rail ][ Chat Sidebar ][ Chat Main ][ Chat Right Sidebar ]
     [✓]
     [AI active]
     [H]
     [D]
```

The current To-Do visual rail is the design donor, but after integration the rail is no longer owned by To-Do.

## 2.2 Shared rail controls

Current To-Do rail controls map to final behavior as follows:

```text
Current To-Do button
  -> Shared To-Do button
  -> opens /todo-list-ui

Current AI placeholder button
  -> Shared ChatUI button
  -> opens /chat-ui (or the remembered active ChatUI route)

Habit placeholder
  -> remains placeholder / coming soon

Diary placeholder
  -> remains placeholder / coming soon

Settings button
  -> shared shell shortcut
  -> asks the active module to open its own Settings UI
```

The shell does not directly modify task settings or ChatUI settings data.

## 2.3 Mobile

The existing To-Do mobile bottom navigation is also a design donor for the shared mobile app switcher.

Final mobile app switch controls:

```text
Tasks  -> To-Do
AI     -> ChatUI
Habits -> placeholder
Diary  -> placeholder
Settings -> active module Settings
```

ChatUI keeps its own mobile Chat sidebar/drawer **inside the ChatUI module**.

To-Do keeps its own secondary To-Do sidebar/drawer **inside the To-Do module**.

The shared bottom navigation is outside both modules.

---

# 3. Canonical URL Contract

The user's requested naming is used directly in the final route design.

Use readable hyphenated paths rather than spaces:

```text
/                        -> canonicalize to /todo-list-ui
/todo-list-ui            -> To-Do module
/chat-ui                 -> ChatUI home/new-chat surface
/chat-ui/chat/<chatId>   -> specific ChatUI conversation
```

Examples:

```text
http://localhost:8000/todo-list-ui
http://localhost:8000/chat-ui
http://localhost:8000/chat-ui/chat/chat_abc123
```

## 3.1 Root route

`/` is not a separate application.

On startup:

```text
/
 -> history.replaceState(..., '/todo-list-ui')
 -> mount To-Do
```

Do not `pushState` the canonicalization because Back should not bounce through a meaningless `/` entry.

## 3.2 Unknown routes

Unknown top-level routes should not silently initialize the wrong application.

Recommended behavior:

```text
known To-Do route -> To-Do
known ChatUI route -> ChatUI
unknown route -> shell error/fallback -> replace to /todo-list-ui
```

Log the rejected route in the console for debugging.

## 3.3 ChatUI route ownership

The root shell owns **top-level application recognition**.

ChatUI owns the meaning of ChatUI subroutes.

Conceptually:

```text
Shell asks:
"Is this a To-Do path or a ChatUI path?"

ChatUI asks:
"If it is a ChatUI path, which chat does it represent?"
```

The shell must not know how Chat IDs are stored or loaded.

---

# 4. Which `index.html` Is Main?

## 4.1 New canonical main

Create:

```text
/index.html
```

This becomes the **only canonical production entry point**.

It owns:

```text
<html>
<head>
<body>
shared app rail
shared mobile navigation
module host
shell-level startup/error UI
shell bootstrap script
```

It does **not** contain the full To-Do application HTML.

It does **not** contain the full ChatUI application HTML.

## 4.2 Existing To-Do index

Current:

```text
TodoList-ui/index.html
```

This file currently owns:

```text
To-Do global styles
primary application rail
secondary To-Do sidebar
workspace
mobile bottom navigation
all To-Do dialogs/menus
js/bootstrap.js
```

During migration it must remain available as a rollback and standalone verification entry.

After the module extraction is proven, convert it into a **thin standalone harness** that mounts the exact same To-Do module used by the root shell.

Do not maintain two independent copies of the To-Do body markup long term.

## 4.3 Existing ChatUI index

Current:

```text
ChatUI/index.html
```

It is already small and mainly owns:

```text
ChatUI stylesheet links
ChatUI external libraries
#app-container
#overlay-root
/js/layout-loader.js
```

Keep it as a standalone verification harness during migration.

After ChatUI has a mount API, convert this file into a thin harness that calls the same ChatUI module mount used by the shared shell.

## 4.4 Do not delete old indexes early

Do not remove either standalone entry until:

```text
root shell works
To-Do works through root shell
ChatUI works through root shell
deep links work
mobile works
data is preserved
backup/restore works
```

The old entries are valuable rollback/test checkpoints during the integration.

---

# 5. Final Repository Shape

Do **not** perform a giant source move into new `/apps/todo` and `/apps/chat` directories.

The current folders already provide clear ownership.

Recommended final layout:

```text
TodoList-ui-ChatUI/
|
|-- index.html                         # canonical combined entry
|-- shell/
|   |-- css/
|   |   `-- shell.css
|   `-- js/
|       |-- app-shell.js
|       |-- router.js
|       |-- module-registry.js
|       |-- navigation.js
|       `-- style-loader.js             # if styles are loaded per active app
|
|-- ChatUI/
|   |-- index.html                     # standalone harness
|   |-- css/
|   |-- html/
|   `-- js/
|       `-- module.js                  # new mount/lifecycle boundary
|
|-- TodoList-ui/
|   |-- index.html                     # standalone harness
|   |-- css/
|   |-- html/
|   |   `-- todo-app.html              # extracted To-Do module DOM
|   `-- js/
|       `-- module.js                  # new mount/lifecycle boundary
|
|-- scripts/
|   `-- build-static.mjs               # combined build
|-- wrangler.jsonc                     # combined deployment owner
|-- server.py                          # combined local SPA server
|
|-- implementation plan/
|   `-- Implementation Plan ID 1.md
|
|-- to-do list agent/
`-- chat UI agent/
```

File names inside `shell/js/` can be adjusted during implementation if a clearer split emerges, but responsibilities must remain explicit.

---

# 6. Shell Ownership Rules

The shared shell owns only cross-application concerns.

## Shell owns

```text
root HTML document
root body layout
shared desktop app rail
shared mobile app navigation
top-level URL routing
browser popstate ownership
active-module selection
mount/unmount sequencing
shell-level loading/error state
shell-level page title fallback
root build/deployment
active-module Settings delegation
```

## Shell must NOT own

```text
TodoListDB
ChatUI_DB
Task CRUD
Project/Tag CRUD
Repeat logic
Task drag logic
Chat messages
Gemini requests
Chat projects
Chat attachments
Chat voice mode
Chat workspace files
app-specific backup schemas
```

The shell communicates through a narrow module interface instead of reaching into internal objects.

---

# 7. Standard Module Contract

Both applications should expose the same high-level lifecycle shape.

Recommended conceptual API:

```js
export async function mount(context) {
  // Return one mounted module instance.
}
```

Mounted instance concept:

```js
{
  appId,
  handleRoute(route),
  prepareDeactivate(reason),
  unmount(),
  openSettings(trigger),
  getAppearance()
}
```

Exact syntax can vary, but the responsibilities should not.

## 7.1 `mount(context)`

Context should provide only shell services, for example:

```text
root element
module overlay/root element if needed
route information
navigate(path, options)
setTitle(title)
notifyAppearance(...)
reportFatalError(...)
```

Do not pass one application's state/service into the other application.

## 7.2 `handleRoute(route)`

To-Do:

```text
/todo-list-ui
```

has no internal route in the first integration, so To-Do can simply validate that it is on its route.

ChatUI uses this method to handle:

```text
/chat-ui
/chat-ui/chat/<id>
```

## 7.3 `prepareDeactivate()`

Called before switching apps without a full page reload.

It may:

```text
allow switch
block switch because a destructive operation is active
ask for confirmation for unsaved/active work
stop safe-to-stop runtime activity
```

## 7.4 `unmount()`

Must:

```text
remove app-owned global event listeners
stop timers
stop/cleanup active drag state
stop media/audio resources
close/remove app-created overlays
clear stale app window globals where still used
clear module DOM
reset remount guards
```

This is mandatory before seamless no-reload switching is enabled.

## 7.5 `openSettings(trigger)`

The shared Settings rail button calls this.

To-Do opens its existing Settings dialog.

ChatUI opens its existing Settings dialog.

The shell never reads/writes application settings directly.

---

# 8. Routing Architecture

## 8.1 One `popstate` owner

Final long-term rule:

```text
window popstate
    -> root shell router
    -> determine app
    -> activate/switch app if needed
    -> delegate app-specific route to active module
```

Do not leave multiple independent application-level `popstate` owners reacting to every URL forever.

## 8.2 Shell router API

Recommended responsibilities:

```text
parseTopLevelRoute(pathname)
navigate(path, { replace })
activateRoute(pathname, { source })
rememberLastRoute(appId, path)
```

## 8.3 ChatUI router conversion

Current ChatUI router assumes:

```text
/              -> home
/chat/<id>     -> conversation
```

Make ChatUI routing **base-path aware**.

Recommended combined base:

```text
/chat-ui
```

Combined paths:

```text
/chat-ui
/chat-ui/chat/<id>
```

For the standalone ChatUI harness, the same router should be configurable with its standalone base rather than maintaining a second router implementation.

The ChatUI route helper should become primarily a **pure path parser/builder**, with history writes delegated through the supplied shell/navigation service when mounted in the combined app.

## 8.4 Conversation history behavior

Preserve existing ChatUI semantics:

```text
new chat
open chat
rename/delete chat
Back
Forward
refresh a chat deep link
missing/deleted chat handling
active chat persistence
```

`ChatUI/js/chat/conversation.js` currently writes route history and `document.title`; move those environment effects behind the new routing/title boundary rather than changing chat domain behavior.

## 8.5 Remembering the last app route

When switching from ChatUI to To-Do and back, returning to the last ChatUI conversation is desirable.

Shell may retain:

```text
lastTodoRoute = /todo-list-ui
lastChatRoute = /chat-ui or /chat-ui/chat/<id>
```

During the temporary full-reload switching phase, persist the last ChatUI path in **namespaced `sessionStorage`** if needed, for example:

```text
combined-shell:last-chat-route
```

Do not store it in either application database.

If the remembered chat no longer exists, ChatUI's existing missing-chat behavior remains authoritative.

---

# 9. Two-Stage Switching Strategy

This is an important risk-control decision.

## Stage A — Unified shell with safe full-page app switches

Before every application has a perfect unmount lifecycle, the root shell may use:

```text
click To-Do
 -> navigate browser to /todo-list-ui
 -> root page reloads
 -> root shell mounts only To-Do

click AI
 -> navigate browser to /chat-ui or remembered Chat route
 -> root page reloads
 -> root shell mounts only ChatUI
```

This already gives the user:

```text
one website
one root index
one shared rail
correct URLs
safe runtime isolation
```

The browser page reload naturally destroys all old app listeners/timers.

This is the safest first combined version.

## Stage B — Seamless switch without page reload

Only after both module lifecycles pass cleanup tests:

```text
click AI
 -> active To-Do prepareDeactivate()
 -> To-Do unmount()
 -> history.pushState('/chat-ui')
 -> ChatUI mount()

click To-Do
 -> ChatUI prepareDeactivate()
 -> ChatUI unmount()
 -> history.pushState('/todo-list-ui')
 -> To-Do mount()
```

Do not enable this until repeated To-Do -> ChatUI -> To-Do cycles produce no duplicate listeners, stale DOM, active microphone, active drag layers, or stale globals.

---

# 10. Current To-Do Architecture That Must Be Preserved

Current To-Do startup is already an explicit native ES-module architecture.

Current startup path:

```text
TodoList-ui/index.html
 -> js/bootstrap.js
 -> js/app-main.js
 -> storage initialize/hydrate/repair
 -> UI component initialization
```

Startup already distinguishes:

```text
MODULE_LOAD
INTEGRATION
DATABASE_OPEN
DATABASE_REPAIR
HYDRATION
UI_INIT
```

Preserve this staged error classification inside the new module boundary.

To-Do behavior that integration must not change includes at least:

```text
Tasks/Subtasks
Task hierarchy
Projects/Sub-projects
Tags/Sub-tags
Project/Tag drag hierarchy
Task drag/reorder
List/Kanban
Sort/Group
Schedule
Repeat/Repeat Ends
Reminders configuration
Settings
Theme
JSON Backup/Restore
all persistence/hydration behavior
```

---

# 11. To-Do HTML Module Extraction

The current To-Do `index.html` is a large full-page document.

Split document ownership from module ownership.

## 11.1 Shared shell takes

Move/copy the design responsibility for these controls to root `index.html`:

```text
.primary-rail
rail-app-todo
rail-app-ai
rail-app-habit
rail-app-diary
shared Settings shortcut
.mobile-bottom-nav app switch controls
```

Use **shell-owned class/ID names** instead of leaving them as generic app-owned selectors.

Example naming direction:

```text
.shell-primary-rail
.shell-rail-item
#shell-app-todo
#shell-app-chat
#shell-open-settings
.shell-mobile-nav
```

Do not let the new shell rely on To-Do's app stylesheet to render its own rail.

## 11.2 To-Do module keeps

Extract the To-Do-specific DOM into a reusable fragment such as:

```text
TodoList-ui/html/todo-app.html
```

It should include:

```text
To-Do secondary sidebar/backdrop
To-Do workspace/header
List/Kanban containers
FAB
workspace menus/panels
task action menu
Task editor
Subtask editor
Schedule UI
Repeat dialogs
Project dialog
Tag dialog
To-Do Settings dialog
all other To-Do-owned overlays
```

It should **not** include shared app navigation.

## 11.3 One source of To-Do body markup

After extraction:

```text
root shell mount
and
standalone TodoList-ui/index.html
```

must both load the same To-Do fragment/module.

Do not maintain two manually synchronized copies.

---

# 12. To-Do Bootstrap -> Mount Boundary

Current `bootstrap.js` assumes page startup.

Refactor without losing its staged errors.

Recommended split:

```text
js/module.js
  -> mount To-Do in supplied root
  -> run existing application initialization
  -> return mounted lifecycle instance

js/bootstrap.js
  -> standalone harness only
  -> DOMContentLoaded
  -> mount into standalone root
```

`app-main.js` should remain the owner of actual To-Do component composition/startup rather than moving all startup logic into the shell.

The shell imports only `TodoList-ui/js/module.js`.

---

# 13. To-Do Global Listener / Cleanup Work

The current To-Do application was designed for page lifetime and does not yet have a destroy lifecycle.

Before seamless switching, audit and clean at least the following.

## 13.1 ModalFocusManager

Current behavior:

```text
module-level initialized flag
document keydown capture listener
registers modal DOM only once
```

This is a remount hazard.

Add lifecycle support conceptually:

```text
init(root)
destroy()
```

`destroy()` must remove the global key handler, clear the stack, and allow registration of new modal DOM after remount.

## 13.2 Task drag

Current Task drag installs:

```text
document pointermove
document pointerup
document pointercancel
document keydown
document contextmenu
window blur
touch document handlers
.task-drag-layer appended to document.body
body class mutations
```

Add explicit drag cleanup:

```text
cancel current/pending drag
stop auto-scroll
remove document/window handlers
remove drag layer
remove body drag class
reset pending/session references
```

## 13.3 Project/Tag taxonomy drag

Current taxonomy drag similarly installs document/window pointer/touch/key/contextmenu handlers and a body drag layer.

Add the same complete cleanup ownership.

## 13.4 Sidebar/Workspace/Tasks

Current components install document/window/visualViewport listeners.

Every listener that survives outside the To-Do module root must have a matching remove path.

Prefer this pattern:

```js
const cleanup = [];
cleanup.push(() => target.removeEventListener(...));
```

or an equivalent `AbortController`-based listener scope.

A module-level `AbortController` is recommended for most ordinary event listeners:

```text
mount -> new AbortController
addEventListener(..., { signal })
unmount -> controller.abort()
```

Do not force this pattern into APIs that do not support signals if a direct remove callback is clearer.

## 13.5 Temporary To-Do globals

Current integration exposes several component globals for internal compatibility:

```text
window.TasksComponent
window.SidebarComponent
window.WorkspaceControls
window.ScheduleComponent
window.SubtaskEditorComponent
```

Do not make the shared shell depend on these.

For first integration they may remain internal compatibility bridges while To-Do is mounted.

On unmount:

```text
clear/delete only the To-Do globals owned by the mounted instance
```

Do not leave stale references to removed DOM.

---

# 14. To-Do Theme Scoping

Current To-Do ThemeManager writes:

```text
document.documentElement[data-theme]
localStorage['theme']
```

The `localStorage` key can remain for compatibility in the first integration, but the DOM theme target cannot stay global.

Final behavior:

```text
.todo-app[data-theme="dark"]
.todo-app[data-theme="light"]
```

To-Do variables currently defined on `:root` / `[data-theme=...]` must move under the To-Do root.

Recommended:

```css
.todo-app {
  /* common To-Do variables */
}

.todo-app[data-theme="dark"] {
  /* dark variables */
}

.todo-app[data-theme="light"] {
  /* light variables */
}
```

ThemeManager should receive/know the mounted To-Do root and set the theme there.

Do not let changing To-Do theme overwrite ChatUI or shell variables on `<html>`.

---

# 15. To-Do CSS Namespace Work

The current To-Do CSS contains page-global rules such as:

```text
:root
*
body
#app
```

These must stop owning the shared document.

## 15.1 Shell styles extracted

Move only the shared launcher styles into:

```text
shell/css/shell.css
```

Use shell-prefixed selectors.

## 15.2 To-Do styles scoped

Scope To-Do rules to:

```text
.todo-app
```

Priority files:

```text
TodoList-ui/css/variables.css
TodoList-ui/css/layout/app-shell.css
TodoList-ui/css/layout/sidebar-layout.css
TodoList-ui/css/layout/workspace-layout.css
TodoList-ui/css/components/*.css
```

Audit especially generic names such as:

```text
.modal-overlay
.modal-card
.header-left
.empty-state
.active
.hidden
```

Because only one module is mounted at a time, it is not necessary to rename every internal class if proper root scoping is applied.

Do not mechanically rename every class and ID unless needed; that would increase regression risk.

---

# 16. To-Do Settings Integration

Current SettingsComponent binds directly to the current rail/mobile Settings buttons.

After navigation moves to the shell:

1. SettingsComponent still owns the To-Do settings dialog.
2. It should expose a stable `openModal(trigger)` / module-level `openSettings(trigger)` path.
3. The shell's Settings button calls `activeModule.openSettings(...)`.
4. To-Do should no longer require its own primary-rail Settings button to initialize.

Keep To-Do backup/restore entirely inside the To-Do module.

---

# 17. Current ChatUI Architecture That Must Be Preserved

ChatUI is already fragment-based.

Current path:

```text
ChatUI/index.html
 -> /js/layout-loader.js
 -> fetch /html/*.html
 -> inject #app-container + #overlay-root
 -> import ./app.js
 -> bootstrap ChatUI
```

ChatUI currently supports:

```text
projects/chats
conversation persistence
attachments
settings/API configuration
Markdown/highlighting
models/thinking
right sidebar
Workspace
Read Aloud
Voice Mode
audio recording
full backup/restore
route-aware chat loading
```

Integration must not rewrite those feature domains merely to combine the UI.

---

# 18. ChatUI Asset Base Refactor

ChatUI currently assumes it owns website root:

```text
/css/*
/js/*
/html/*
```

This conflicts with a combined root.

## 18.1 Index paths

Standalone ChatUI should use module-owned paths rather than website-root generic paths.

## 18.2 Fragment loader

Change fragment URLs from hard-coded:

```text
/html/left-sidebar.html
```

to URLs resolved from the ChatUI module's own location/base.

Recommended direction:

```js
new URL('../html/left-sidebar.html', import.meta.url)
```

or an explicit `assetBase` supplied by `ChatUI/js/module.js`.

The important invariant:

```text
ChatUI can live under /ChatUI/ without pretending /css /html /js belong to ChatUI.
```

## 18.3 Do not flatten assets

Keep:

```text
ChatUI/css
ChatUI/html
ChatUI/js
```

Do not merge them with To-Do assets into generic root folders.

---

# 19. ChatUI Layout Loader -> Mount Boundary

Current `layout-loader.js` auto-executes and then imports `app.js`.

Refactor it into explicit reusable responsibilities.

Recommended concept:

```text
loadChatUILayout({ appRoot, overlayRoot, assetBase })
  -> fetch fragments
  -> inject ChatUI layout
  -> run Lucide icon pass
```

It should not decide on its own that importing it means “start the entire app forever.”

ChatUI module entry:

```text
ChatUI/js/module.js
```

should coordinate:

```text
layout load
ChatUI startup
route handling
cleanup registration
return mounted lifecycle instance
```

Standalone `ChatUI/index.html` becomes a harness that calls this same module API.

---

# 20. ChatUI Bootstrap -> Explicit Lifecycle

Current `ChatUI/js/app.js` automatically starts based on DOM ready state.

Convert startup into exported lifecycle functions rather than import-time lifetime ownership.

Conceptual direction:

```js
export async function startChatUI(context) { ... }
export async function stopChatUI() { ... }
```

Preserve current startup sequence:

```text
Markdown
IndexedDB load
Action menu
Sidebar
Workspace
Router/route restoration
Composer
Attachments
Recorder
Settings
Read Aloud
Voice UI
Model/menu
Right sidebar
Modals
Smart-scroll
Composer state
```

Do not reorder functional startup casually.

The combined shell must not duplicate this initialization itself.

---

# 21. ChatUI Routing Refactor

Change ChatUI's route constants from globally hard-coded `/` and `/chat/` to a configurable ChatUI base.

Combined base:

```text
/chat-ui
```

Final paths:

```text
/chat-ui
/chat-ui/chat/<encoded-id>
```

Preserve validation such as rejecting malformed IDs/extra slash segments.

## 21.1 Root `popstate`

Long term remove independent ChatUI top-level `window.popstate` ownership.

The root shell should invoke ChatUI's route handler only when a ChatUI route is active.

## 21.2 Workspace navigation bridge

Current `workspace-navigation-bridge.js` installs document and window listeners at import time.

Convert it to explicit:

```text
initWorkspaceNavigationBridge()
 -> returns cleanup
```

Do the same for `workspace-mobile.js` import-time listeners.

---

# 22. ChatUI CSS Namespace Work

ChatUI currently has global rules in `css/main.css`:

```text
:root
*
body
button
focus selectors
```

and global mobile rules in `css/responsive.css`:

```text
:root
html, body
```

Move ownership under:

```text
.chatui-app
```

Recommended pattern:

```css
.chatui-app {
  /* ChatUI variables */
}

.chatui-app,
.chatui-app *,
.chatui-app *::before,
.chatui-app *::after {
  box-sizing: border-box;
}

.chatui-app button { ... }
```

Responsive variables move from mobile `:root` to `.chatui-app` inside the media query.

Do not let ChatUI set page-wide `body` height/overflow after the shell owns body.

The ChatUI module root should itself fill the shell module host.

---

# 23. ChatUI Theme / Accent Scoping

Current ChatUI Settings writes theme/accent CSS variables directly to:

```text
document.documentElement.style
```

That would overwrite shell/To-Do appearance.

Change theme application to the mounted ChatUI root:

```text
chatRoot.style.setProperty(...)
```

or ChatUI root data attributes/classes with stylesheet-owned values.

Preserve ChatUI's existing persisted theme/accent values in `ChatUI_DB`.

Do not merge ChatUI appearance settings with To-Do's theme setting.

---

# 24. Shared Rail Appearance

The shell needs its own variables so it does not depend on either application's global variables.

Example ownership:

```text
--shell-bg
--shell-text
--shell-border
--shell-accent
```

For a polished experience, active modules can notify shell appearance:

```text
{ theme: dark/light, accent: ... }
```

The shell maps that to shell-owned variables.

Important boundary:

```text
module reports appearance
shell styles shell
```

The shell does not edit the module's persisted settings.

If this appearance bridge becomes too risky during first cutover, use a stable dark shell initially and add active-theme mirroring in a later phase, but do not reintroduce global variable sharing.

---

# 25. ChatUI External Dependencies

ChatUI currently depends on global browser libraries loaded from CDN:

```text
lucide
marked
hljs / Highlight.js
Highlight.js stylesheet
```

For the first integration:

1. Preserve the known working libraries.
2. Load them only as ChatUI dependencies through a shell/module dependency loader or ChatUI harness.
3. Ensure ChatUI mount waits until required globals exist.
4. Avoid loading ChatUI Highlight CSS as an unowned permanent shell stylesheet if it can affect other module content.

Do not rewrite Markdown/rendering libraries as part of this integration.

Pinning/vendorizing external versions is desirable for reproducibility but is a separate cleanup unless required by the build.

---

# 26. ChatUI Global Listener Cleanup Matrix

Before seamless switching, every global listener/timer must have an owner and cleanup.

The current source requires explicit work in at least these areas:

| Area | Current global/lifetime behavior | Required cleanup |
|---|---|---|
| Chat router | `window.popstate` | shell owns popstate / remove listener |
| Workspace bridge | document click/keydown + popstate at import time | explicit init/destroy |
| Workspace mobile | document click + window resize at import time | explicit init/destroy |
| Markdown | document click | cleanup listener |
| Action menu | document pointer/key listeners | cleanup listener |
| Modal system | document keydown | cleanup listener |
| Sidebar | document-level close behavior | cleanup listener |
| Composer menus | document click/keydown | cleanup listener |
| Model/thinking menu | document click | cleanup listener |
| Right sidebar | document keydown | cleanup listener |
| Attachment drag/drop | document drag events + window blur | cleanup + remove overlay |
| Read selection | document selectionchange | cleanup listener |
| Read Aloud | hourly interval + pagehide + Audio/AudioContext/session | stop audio, clear interval/listener |
| Voice Mode | microphone/recorder/audio/timers/pagehide | `stopLiveVoiceMode()` + remove lifetime handler |
| Normal recorder | MediaRecorder/MediaStream | cancel/stop and release track |
| Generation | AbortController/request state | abort or resolve before unmount |

Where a module has an `initialized` boolean, unmount must allow a later remount to initialize correctly.

---

# 27. ChatUI Active Runtime on App Switch

Safe first seamless-switch policy:

## Text generation

If an assistant generation is active when the user switches from ChatUI to To-Do:

```text
ask for confirmation if practical
if switch proceeds -> abortActiveGeneration()
```

Background generation across app switches is explicitly out of scope for Integration Plan ID 1.

## Voice Mode

On switch away:

```text
await stopLiveVoiceMode()
```

This already has substantial cleanup for microphone/audio/timers/session state and should be reused rather than reimplemented.

## Normal recording

If recording:

```text
cancel/stop recording safely
release MediaStream
```

If cancelling would discard an unsent recording, show a switch confirmation before doing so.

## Read Aloud

On ChatUI unmount:

```text
await stopActiveReadAloud()
clear module-owned hourly cleanup interval
remove module-owned pagehide listener
```

Do not leave ChatUI audio playing while To-Do is active in the first integration.

## Attachments

Unsent attachment runtime state must be consciously cleared or preserved according to current new-chat behavior.

At minimum remove the drag/drop overlay and prevent ChatUI from intercepting drops while To-Do is active.

---

# 28. To-Do Active Runtime on App Switch

To-Do has no microphone/generation equivalent, but it can have transient unsaved UI.

Before seamless deactivation:

```text
cancel pending Task drag
cancel pending taxonomy drag
stop drag auto-scroll
close context menus
close workspace menus
close secondary sidebar action menus
```

## Unsaved editors

If Task/Subtask/Project/Tag editor contains unsaved user input, do not silently discard it merely because the user touched the shared AI button.

Recommended first behavior:

```text
Switch apps?
Unsaved changes in the current To-Do editor will be discarded.
[Stay] [Switch]
```

If no unsaved editor/draft exists, switch normally.

## Backup/Restore

Never allow app switching in the middle of a destructive/transactional restore.

`prepareDeactivate()` should block until the operation finishes or is safely cancelled.

---

# 29. App Settings Delegation

Shared rail has one Settings shortcut.

Flow:

```text
shell Settings click
 -> activeModule.openSettings(shellSettingsButton)
```

## To-Do active

Open existing To-Do Settings dialog.

## ChatUI active

Open existing ChatUI Settings modal.

ChatUI's own Settings entry inside its left sidebar may remain as another entry point.

Do not merge both settings screens into one giant shared settings database/UI during this integration.

---

# 30. DOM ID Collision Strategy

Confirmed collision today:

```text
ChatUI: #project-list
To-Do:  #project-list
```

The final architecture prevents this because only one module DOM is mounted.

Therefore:

```text
Do not rename every internal ID immediately.
```

That would create a large risky refactor with little benefit.

Instead:

1. Ensure only one module DOM exists.
2. Namespace module roots.
3. Namespace all **shell** IDs/classes.
4. Gradually replace document-wide queries with root-scoped queries when already touching an area for lifecycle work.
5. Rename only especially exposed integration IDs where needed.

Examples of new integration roots:

```text
#shell-app
#shell-module-host
#todo-module-root
#chatui-module-root
#chatui-app-container
#chatui-overlay-root
```

---

# 31. Root-Scoped DOM Lookup Direction

Both applications contain many `document.getElementById()` calls.

Do not require an all-at-once rewrite.

Recommended migration:

```text
module stores its root
new/refactored integration code uses root.querySelector(...)
existing stable internal IDs can remain temporarily
```

For elements intentionally outside module root (for example shared shell button passed as a trigger), pass the element through the module API rather than search globally for it.

This gradually reduces collision risk without a giant mechanical patch.

---

# 32. Overlay / Body Ownership

Both applications currently create some UI directly under `document.body`.

Examples:

```text
To-Do storage error banner
To-Do drag layers
ChatUI startup/layout errors
ChatUI attachment drop overlay
```

Integration rule:

```text
Every dynamically created node must be tagged/owned by a module and removed on unmount.
```

Prefer app-specific overlay roots where practical.

If a drag layer must remain body-level because it uses viewport pointer coordinates, keep it body-level but:

```text
namespace class/id
record node reference
remove it on unmount
remove related body classes
```

Do not leave anonymous app DOM behind after switching.

---

# 33. Database Architecture — Keep Separate

This integration must **not merge databases**.

Preserve exactly:

```text
TodoListDB
ChatUI_DB
```

## To-Do

Current durable stores include:

```text
projects
tags
tasks
task_tags
reminder_definitions
task_reminders
task_repeat_rules
app_settings
app_meta
```

## ChatUI

Current durable stores include:

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

Same store names such as `projects` are harmless because they live in different IndexedDB databases.

Do not create a combined giant database merely because the UI becomes one application.

---

# 34. Very Important: Browser Origin and Existing Data

IndexedDB/localStorage are scoped by **origin**:

```text
scheme + hostname + port
```

Current local development origins are different:

```text
To-Do server: localhost:6846
ChatUI server: localhost:8000
```

If the combined application runs at one new origin, simply keeping database names does **not** move data from the other origin.

## 34.1 Mandatory pre-cutover backups

Before changing the user's normal launch URL:

```text
1. Open old To-Do origin.
2. Create full To-Do JSON backup.
3. Open old ChatUI origin.
4. Create full ChatUI backup.
5. Confirm both backup files exist and are readable.
```

ChatUI backups may contain API keys. Keep them private.

## 34.2 Combined origin

For local development, a reasonable default is port `8000` because ChatUI already uses it, but the root server should allow configuring the port.

If final combined local origin is:

```text
http://localhost:8000
```

then existing `ChatUI_DB` on that exact origin may remain automatically available, while old To-Do data from `localhost:6846` requires restore into `TodoListDB` on the new origin.

Do not assume this automatically; verify database presence after cutover.

## 34.3 Production origin

The same rule applies to deployed domains.

If the combined app moves to a different hostname/domain, both databases need backup/restore migration because browser storage cannot be read cross-origin.

---

# 35. Backup / Restore Preservation

Both applications already have backup/restore behavior.

Integration must not replace them with one unreviewed combined format.

First combined release:

```text
To-Do backup remains To-Do backup.
ChatUI backup remains ChatUI backup.
```

Restore is initiated from the Settings UI of the active application.

A future “Back up entire combined app” feature can be designed separately after integration is stable.

---

# 36. Root Build Architecture

Current ChatUI build assumes ChatUI owns the deployment root.

Replace final deployment ownership with a root build.

Create:

```text
/scripts/build-static.mjs
```

Expected output:

```text
dist/
|-- index.html
|-- shell/
|-- ChatUI/
`-- TodoList-ui/
```

The build should:

1. verify required root/shell/app files exist;
2. clear `dist/`;
3. copy root `index.html`;
4. copy `shell/`;
5. copy runtime ChatUI assets preserving `ChatUI/...` paths;
6. copy runtime To-Do assets preserving `TodoList-ui/...` paths;
7. exclude development-only docs/server/history files if desired;
8. fail loudly when a required fragment/module is missing.

Do not flatten both applications into:

```text
/dist/css
/dist/js
/dist/html
```

because that recreates ownership/collision problems.

---

# 37. Root Cloudflare Deployment

Create root:

```text
/wrangler.jsonc
```

The combined root becomes the deployment owner.

Preserve SPA fallback:

```json
"not_found_handling": "single-page-application"
```

This is required so direct requests to these routes return root `index.html`:

```text
/todo-list-ui
/chat-ui
/chat-ui/chat/<id>
```

ChatUI's standalone `wrangler.jsonc` can remain during migration but should no longer be the production owner after combined deployment cutover.

Do not remove it until root deployment is verified.

---

# 38. Root Local Server

Current standalone servers are not sufficient for final combined deep links.

Create root:

```text
/server.py
```

Requirements:

```text
serve repository/build root
serve real files normally
for extensionless known SPA paths, return root index.html
support LAN access when desired
configurable port
clear startup URL output
```

Direct local tests must work:

```text
GET /todo-list-ui
GET /chat-ui
GET /chat-ui/chat/<id>
```

A plain `python -m http.server` without fallback will 404 on direct deep-link refreshes.

---

# 39. Page Title Ownership

Shell owns the baseline title contract.

Recommended:

```text
To-Do active -> To-Do
ChatUI home -> ChatUI
Chat conversation -> <chat title> — ChatUI
```

ChatUI can still determine conversation titles, but should call a supplied `setTitle()` shell service rather than assuming it owns the entire document forever.

On switching back to To-Do, ChatUI's old conversation title must not remain.

---

# 40. Focus and Accessibility During App Switching

Shared rail buttons are real buttons and must expose active state.

Recommended:

```text
aria-current="page" on active app button
or aria-pressed where semantically appropriate
```

When switching by clicking a rail button:

```text
keep focus on the clicked shared rail button unless the new module must focus an error/dialog
```

Do not automatically throw keyboard focus deep into the newly mounted application on every switch.

After mount, update:

```text
active visual state
accessible active state
document title
```

When an application is unmounted, ensure focus is not left inside removed DOM.

---

# 41. Mobile / Safe Area Rules

The shell owns viewport and safe-area page behavior.

Only root `index.html` should own the final viewport meta tag.

The shell owns shared mobile navigation padding for:

```text
env(safe-area-inset-bottom)
```

To-Do and ChatUI module roots should fill the remaining module host.

Audit current uses of:

```text
100vh
100dvh
position: fixed
inset: 0
visualViewport
keyboard resize behavior
```

Do not break the existing To-Do mobile keyboard/date transition work.

Do not break ChatUI composer/voice/mobile sidebar behavior.

Treat mobile integration as a dedicated verification phase after desktop structure is correct.

---

# 42. External App Switching vs Modal State

Application switch controls should not silently destroy important modal work.

Recommended `prepareDeactivate()` rules:

```text
Destructive restore in progress -> block switch
Unsaved To-Do editor -> confirm
Active ChatUI audio recording -> confirm
Active ChatUI generation -> confirm then abort if proceeding
Active Voice Mode -> stop when proceeding
Read Aloud -> stop when proceeding
Simple open non-dirty menu -> close automatically
```

The exact confirmation text should be short and app-specific.

---

# 43. Agent Ownership / Coordination

This plan intentionally separates responsibilities for the two-agent workflow.

## 43.1 Shared shell / integration owner

The To-Do/integration agent may own:

```text
/index.html
/shell/**
/root scripts/build-static.mjs
/root server.py
/root wrangler.jsonc
shared rail/mobile navigation extraction
root route contract
module registry
integration verification
```

## 43.2 To-Do agent owns

```text
TodoList-ui/index.html
TodoList-ui/html/todo-app.html
TodoList-ui/js/module.js
TodoList-ui/js/bootstrap.js
TodoList-ui/js/app-main.js
TodoList-ui/css/**
To-Do lifecycle cleanup
To-Do theme scoping
To-Do Settings bridge
To-Do drag/listener cleanup
TodoListDB preservation
```

## 43.3 ChatUI agent owns

```text
ChatUI/index.html
ChatUI/js/module.js
ChatUI/js/layout-loader.js
ChatUI/js/app.js
ChatUI/js/router/**
ChatUI/js/chat/conversation.js
ChatUI/css/**
ChatUI lifecycle cleanup
ChatUI voice/audio/generation cleanup
ChatUI theme scoping
ChatUI Settings bridge
ChatUI path/base fixes
ChatUI_DB preservation
```

## 43.4 Coordination rule

Neither agent should directly edit the other application's persistence/domain internals as part of shell integration.

Shared contracts should be agreed through this implementation plan and collaboration files.

---

# 44. Implementation Phases

Do not implement this plan as one giant unreviewed commit.

Each phase has a verification gate.

---

# Phase 0 — Baseline, Rollback, and Data Safety

## Goal

Create a known-good integration baseline without changing behavior.

## Actions

1. Confirm current combined `main` commit.
2. Confirm both standalone apps start from current source.
3. Record current database names/versions.
4. Create/export current To-Do backup.
5. Create/export current ChatUI backup.
6. Record current launch origins/ports.
7. Create an integration branch from current main for implementation work.
8. Do not modify DB schema/version.

## Verification

Standalone:

```text
TodoList-ui works
ChatUI works
backups created
```

Stop if either existing application is already broken.

---

# Phase 1 — Add Root Shell Infrastructure Without Cutover

## Goal

Create root architecture files while leaving standalone apps canonical for the moment.

## New files

```text
/index.html
/shell/css/shell.css
/shell/js/app-shell.js
/shell/js/router.js
/shell/js/module-registry.js
```

## Root shell initially contains

```text
shared rail skeleton
shared module host
shared mobile nav skeleton
shell startup/error state
```

Do not yet remove navigation from To-Do index.

Do not yet make users launch root shell as normal entry.

## Verification

Root shell parses as a native ES module application and recognizes the planned routes without starting two apps.

---

# Phase 2 — Make ChatUI Asset Paths Relocatable

## Goal

ChatUI must stop assuming `/css`, `/html`, `/js` belong to it.

## Primary files

```text
ChatUI/index.html
ChatUI/js/layout-loader.js
```

## Changes

```text
module-relative/configurable fragment URLs
module-owned CSS URLs
preserve current fragment set
preserve external dependencies
```

## Verification

Standalone ChatUI must still pass:

```text
layout fragments load
new chat
open chat
settings
Workspace
attachments
voice/read UI basic smoke
```

No root shell cutover yet.

---

# Phase 3 — Make ChatUI Routing Base-Path Aware

## Goal

One router implementation supports combined `/chat-ui` routes.

## Primary files

```text
ChatUI/js/router/chat-router.js
ChatUI/js/chat/conversation.js
ChatUI/js/app.js
ChatUI/js/workspace/workspace-navigation-bridge.js
```

## Required combined paths

```text
/chat-ui
/chat-ui/chat/<id>
```

## Verification

Test:

```text
new ChatUI home
open persisted chat
Back
Forward
refresh direct chat URL
missing/deleted chat
start new chat from deep route
```

Standalone ChatUI harness must still function using configured standalone routing.

---

# Phase 4 — Extract To-Do Module DOM

## Goal

Separate To-Do app UI from shared launcher UI.

## New

```text
TodoList-ui/html/todo-app.html
```

## Move into module fragment

```text
secondary sidebar
workspace
To-Do menus
To-Do dialogs
To-Do settings
```

## Do not include

```text
primary app rail
shared mobile app navigation
```

At this phase preserve standalone `TodoList-ui/index.html` behavior by loading the same fragment through a temporary/standalone loader.

## Verification

All To-Do UI and dialogs appear exactly as before.

---

# Phase 5 — Create To-Do Mount Entry

## Goal

Expose To-Do startup as a reusable module.

## New

```text
TodoList-ui/js/module.js
```

## Refactor

```text
bootstrap.js -> standalone wrapper
app-main.js -> reusable application startup owner
```

Preserve staged bootstrap errors.

Do not add unmount/seamless behavior yet beyond what is necessary to mount once.

## Verification

Standalone harness mounts To-Do through `module.js` and all existing behavior still works.

---

# Phase 6 — Create ChatUI Mount Entry

## Goal

Expose ChatUI layout/startup as a reusable module.

## New

```text
ChatUI/js/module.js
```

## Refactor

```text
layout-loader.js -> explicit layout function
app.js -> explicit startup function
index.html -> standalone harness
```

Do not change Chat domain/storage behavior.

## Verification

Standalone ChatUI mounts through `module.js` with no functional loss.

---

# Phase 7 — Namespace CSS and Scope Themes

## Goal

Both app style trees can exist in a root-shell project without taking ownership of the whole document.

## To-Do

```text
.todo-app root
To-Do theme variables on root
remove body/:root ownership from module CSS
```

## ChatUI

```text
.chatui-app root
ChatUI variables on root
remove body/:root/html ownership from module CSS
```

## Shell

```text
shell owns body/html
shell owns rail/mobile nav CSS
shell uses shell-prefixed classes/variables
```

## Verification

1. Standalone To-Do appearance unchanged.
2. Standalone ChatUI appearance unchanged.
3. Load shell CSS + To-Do CSS: shell unaffected.
4. Load shell CSS + ChatUI CSS: shell unaffected.
5. Theme toggle in one module does not modify other module/shell global variables.

---

# Phase 8 — First Canonical Combined Shell (Reload Switching)

## Goal

Deliver the first truly unified application safely.

Make root `index.html` canonical.

## Behavior

```text
/todo-list-ui
 -> root shell
 -> shared rail visible
 -> only To-Do module mounted

/chat-ui...
 -> root shell
 -> shared rail visible
 -> only ChatUI module mounted
```

Cross-app rail clicks use full page route navigation in this phase.

## Shared rail

Use current To-Do rail design.

Map:

```text
To-Do -> /todo-list-ui
AI -> /chat-ui / remembered Chat path
```

## Verification

Repeatedly switch:

```text
To-Do -> ChatUI -> To-Do -> ChatUI
```

Verify URLs, data, styling, page title, and no two module DOM trees are present.

This phase is a valid shippable safety checkpoint even before seamless switching.

---

# Phase 9 — Add Complete To-Do Unmount Lifecycle

## Goal

Prepare To-Do for no-reload switching.

Implement cleanup for:

```text
ModalFocusManager
Sidebar
WorkspaceControls
Tasks
Task drag
Task touch drag
Taxonomy drag
Taxonomy touch drag
Schedule document listeners
Subtask global/visualViewport listeners
body drag layers/classes
window globals
app-created banners/overlays
```

## Remount test

Within one document/runtime:

```text
mount To-Do
unmount To-Do
mount To-Do again
```

Do this repeatedly in a small development/static harness if useful.

No browser automation required.

Manual UI verification still required.

---

# Phase 10 — Add Complete ChatUI Unmount Lifecycle

## Goal

Prepare ChatUI for no-reload switching.

Convert init-time/global side effects to owned cleanup.

Must cover:

```text
router
Workspace bridge/mobile
Markdown
Action menu
Modals
Sidebar
Composer
Attachment drag/drop
Recorder
Model menus
Right sidebar
Read selection
Read Aloud interval/audio/session
Voice Mode
active generation
pagehide handlers
created overlays
initialized flags
```

## Remount test

```text
mount ChatUI
unmount ChatUI
mount ChatUI again
```

Repeat and verify exactly one listener behavior per action.

---

# Phase 11 — Enable Seamless No-Reload Switching

## Goal

Replace full reload cross-app navigation with lifecycle navigation.

Flow:

```text
shared rail click
 -> prepareDeactivate old module
 -> if blocked/cancelled, remain
 -> unmount old module
 -> history push/replace route
 -> mount new module
 -> sync rail state/title/appearance
```

Back/Forward uses the same route activation pipeline.

## Verification

Run at least 20 switches in one page lifetime:

```text
To-Do <-> ChatUI
```

Watch for:

```text
duplicate click behavior
duplicate key handling
multiple API sends
multiple drag responses
stale overlays
stale sidebars
microphone still active
Read Aloud still active
wrong page title
wrong route
wrong active rail state
```

---

# Phase 12 — Settings Delegation and Switch Guards

## Goal

Finish cross-app shell UX.

Implement:

```text
shell Settings -> active module Settings
unsaved To-Do confirmation
ChatUI generation/recording confirmation
restore-operation blocking
clean focus after switch
```

Do not merge settings databases.

---

# Phase 13 — Mobile Integration

## Goal

Make the shared bottom app navigation the mobile launcher.

Test:

```text
To-Do mobile sidebar
To-Do task keyboard behavior
To-Do Schedule Date keyboard close/restore
ChatUI mobile sidebar
ChatUI composer keyboard
ChatUI attachment UI
Voice overlay
Settings
safe-area bottom spacing
orientation/resize
pinch zoom remains allowed
```

The shared desktop rail remains hidden at the current mobile breakpoint unless a later design changes that explicitly.

---

# Phase 14 — Root Build / Local Server / Cloudflare Cutover

## Goal

Make root combined project the only production deployment owner.

Implement:

```text
root scripts/build-static.mjs
root server.py
root wrangler.jsonc
```

Verify direct deep-link refresh for every canonical route.

Do not remove old standalone build/server files until this passes.

---

# Phase 15 — Data-Origin Cutover

## Goal

Safely move normal usage to the combined origin.

Steps:

1. Confirm both old backups again.
2. Open combined origin `/todo-list-ui`.
3. Verify whether `TodoListDB` data already exists.
4. Restore To-Do backup if needed.
5. Hard refresh and verify tasks/projects/tags/repeat/settings.
6. Open `/chat-ui`.
7. Verify whether `ChatUI_DB` data already exists.
8. Restore ChatUI backup if needed.
9. Hard refresh and verify chats/projects/messages/settings/API settings/Workspace.
10. Keep old backups until combined app has been used successfully for a meaningful period.

Never delete old browser data as part of automatic cutover.

---

# Phase 16 — Retire Transitional Standalone Plumbing

Only after all combined behavior is verified:

```text
convert old indexes to documented thin harnesses
or keep them explicitly as developer standalone harnesses
retire old standalone deployment ownership
remove obsolete duplicate navigation markup
remove temporary reload-switch compatibility code
```

Do not remove application source folders or merge their internals.

---

# 45. Expected File Scope by Area

This is a planning map, not a guarantee that every file must change.

## New shared integration files

```text
index.html
shell/css/shell.css
shell/js/app-shell.js
shell/js/router.js
shell/js/module-registry.js
shell/js/navigation.js
scripts/build-static.mjs
server.py
wrangler.jsonc
```

## To-Do primary integration files

```text
TodoList-ui/index.html
TodoList-ui/html/todo-app.html          (new)
TodoList-ui/js/module.js                (new)
TodoList-ui/js/bootstrap.js
TodoList-ui/js/app-main.js
TodoList-ui/js/theme.js
TodoList-ui/js/components/modal-focus.js
TodoList-ui/js/components/sidebar.js
TodoList-ui/js/components/workspace-controls.js
TodoList-ui/js/components/tasks.js
TodoList-ui/js/components/task-drag.js
TodoList-ui/js/components/task-drag-touch.js
TodoList-ui/js/components/sidebar-taxonomy-drag*.js
TodoList-ui/js/components/schedule*.js
TodoList-ui/js/components/subtask-editor.js
TodoList-ui/js/components/settings.js
TodoList-ui/css/variables.css
TodoList-ui/css/layout/*.css
TodoList-ui/css/components/*.css
```

Do not change To-Do storage/schema files unless an integration-specific issue is proven.

## ChatUI primary integration files

```text
ChatUI/index.html
ChatUI/js/module.js                     (new)
ChatUI/js/layout-loader.js
ChatUI/js/app.js
ChatUI/js/router/chat-router.js
ChatUI/js/chat/conversation.js
ChatUI/js/workspace/workspace-navigation-bridge.js
ChatUI/js/workspace/workspace-mobile.js
ChatUI/js/chat/markdown.js
ChatUI/js/ui/action-menu.js
ChatUI/js/ui/modals.js
ChatUI/js/sidebar/**
ChatUI/js/composer/composer.js
ChatUI/js/composer/attachments.js
ChatUI/js/composer/recorder.js
ChatUI/js/ui/model-thinking-menu.js
ChatUI/js/ui/chat-controls.js
ChatUI/js/settings/settings.js
ChatUI/js/voice/read-selection.js
ChatUI/js/voice/read-aloud.js
ChatUI/js/voice/live-voice-controller.js
ChatUI/js/chat/generation-lifecycle.js
ChatUI/css/main.css
ChatUI/css/responsive.css
ChatUI/css/sidebar.css + imported sidebar files
ChatUI/css/chat.css + imported chat files
ChatUI/css/components.css + imported component files
ChatUI/css/animations.css
ChatUI/scripts/build-static.mjs
ChatUI/wrangler.jsonc
```

Do not alter Gemini request semantics, ChatUI DB schema, or workspace domain operations simply to mount the UI.

---

# 46. Static Verification Gates

No browser automation is requested.

Use source/diff inspection and small pure-JS checks where useful.

After each phase verify:

## Routes

```text
one top-level popstate owner in final mode
canonical path parser accepts expected routes
malformed chat paths rejected
root / canonicalizes without extra history entry
```

## Module ownership

```text
shell imports module entry, not app internals
To-Do module does not import ChatUI internals
ChatUI module does not import To-Do internals
```

## DOM

```text
only one app module root mounted
no app DOM remains after unmount
shared rail remains mounted
```

## CSS

Search final active styles for unintended application ownership of:

```text
html
body
:root
```

Module CSS may use these only in standalone-harness-specific files, not combined module styles.

## Storage

```text
TodoListDB name/version unchanged
ChatUI_DB name/version unchanged
no cross-database imports
backup schemas unchanged unless separately reviewed
```

## Global listeners

For every final document/window/visualViewport listener added during app mount, identify the exact cleanup path.

## Timers/media

Identify cleanup for every:

```text
setInterval
long-lived setTimeout
MediaRecorder
MediaStream
AudioContext
Audio
WebSocket/Live session
AbortController generation
```

---

# 47. Manual Acceptance Test Matrix

## 47.1 Root and URLs

1. Open `/`.
2. Confirm URL becomes `/todo-list-ui`.
3. Confirm To-Do is shown.
4. Click AI.
5. Confirm URL becomes `/chat-ui` or remembered `/chat-ui/chat/<id>`.
6. Confirm ChatUI is shown.
7. Click To-Do.
8. Confirm URL is `/todo-list-ui`.
9. Use Back/Forward across app switches.
10. Refresh every route directly.

## 47.2 Shared rail

Verify:

```text
correct active item
To-Do button
AI/ChatUI button
Habits placeholder remains harmless
Diary placeholder remains harmless
Settings opens active app settings
keyboard focus/Enter/Space
```

## 47.3 To-Do regression smoke

Verify at minimum:

```text
Inbox/Today/Completed
Project/Tag selection
Project/Tag hierarchy
Task create/edit/delete
Subtask create/edit
Task drag
Subtask hierarchy drag
Project/Tag drag
List/Kanban
Sort/Group/Custom order
Date/Time
Repeat/Repeat Ends
reminder configuration
Settings/theme
Backup creation
Backup validation/restore test using disposable backup
hard refresh persistence
```

## 47.4 ChatUI regression smoke

Verify at minimum:

```text
new chat
send message
streaming generation
stop generation
open persisted chat
Back/Forward
rename/delete
Projects
attachments file picker
attachments drag/drop
Markdown/code highlighting
model/thinking menus
right sidebar
Settings/API configuration
Workspace
Read Aloud
normal audio recording
Voice Mode
Backup creation/restore validation
hard refresh persistence
```

## 47.5 Cross-app resource cleanup

Start ChatUI activity and then switch according to allowed guard behavior:

```text
active text generation
Read Aloud
Voice Mode
normal recording
open menu
open Settings
```

Confirm no ChatUI interaction continues inside To-Do after switching.

Start To-Do transient UI:

```text
pending drag
open Project/Tag menu
open Schedule
unsaved Task editor
```

Confirm switch either cleanly closes it or prompts according to plan.

## 47.6 Repeated seamless switching

After Phase 11:

Perform at least:

```text
20 app switches
```

Then create a Task and send one Chat message.

Each action must happen exactly once.

This catches duplicate event listener accumulation.

## 47.7 Mobile

Use a real phone.

Verify:

```text
bottom app navigation
ChatUI mobile drawer
To-Do mobile sidebar
keyboard open/close
Schedule Date keyboard restore
pinch zoom
safe areas
attachment picker
Voice Mode
rotation/viewport changes
```

---

# 48. Failure / Rollback Rules

Every implementation phase should be separately reviewable/rollbackable.

If a phase breaks unrelated app behavior:

```text
stop
revert that phase
fix the architecture boundary
retest standalone app
then continue
```

Do not continue layering integration code over a known broken phase.

Keep standalone harnesses working as long as possible because they help identify whether a bug belongs to:

```text
application itself
or
combined shell integration
```

---

# 49. Explicit Non-Goals / Do-Not-Do List

Do **not** do the following as part of Integration Plan ID 1:

```text
Do not merge TodoListDB and ChatUI_DB.
Do not initialize both legacy apps and simply hide one.
Do not use an iframe as the final architecture.
Do not introduce React/Vue/Angular/another framework.
Do not use Shadow DOM as the first solution.
Do not flatten both apps into one generic css/js/html folder.
Do not physically move every source file just for aesthetics.
Do not rename every internal DOM ID in one giant refactor.
Do not rewrite Task persistence.
Do not rewrite Gemini request logic.
Do not redesign ChatUI Workspace.
Do not redesign To-Do Repeat/drag behavior.
Do not add background AI generation across app switches in v1.
Do not create one combined backup format in this plan.
Do not silently discard unsaved user work when switching apps.
Do not change IndexedDB versions without a separately proven need.
Do not use browser automation/headless Chrome for verification.
```

---

# 50. Definition of Done

Integration Plan ID 1 is fully complete only when all of the following are true:

```text
One root index.html is the canonical app entry.

/todo-list-ui opens To-Do.
/chat-ui opens ChatUI.
/chat-ui/chat/<id> opens the correct persisted ChatUI conversation.

The shared To-Do-style rail is visible on desktop.
The To-Do rail button switches to To-Do.
The AI rail button switches to ChatUI.
The shared mobile navigation switches the same applications.

Only one app module runtime is active at a time.

To-Do and ChatUI can each mount, unmount, and remount safely.

Back/Forward works across applications and inside ChatUI conversations.
Direct route refresh works locally and in Cloudflare deployment.

TodoListDB remains intact and persistent.
ChatUI_DB remains intact and persistent.
Both backup/restore systems still work independently.

To-Do theme does not overwrite ChatUI/shell globals.
ChatUI theme does not overwrite To-Do/shell globals.

Switching away from ChatUI leaves no microphone, audio, generation, drag/drop, timer, or global listener acting on To-Do.
Switching away from To-Do leaves no drag, menu, modal, or stale global acting on ChatUI.

Settings shortcut opens the settings UI of the active module.

Desktop and real-phone manual testing passes.

The original standalone indexes remain available as thin developer/rollback harnesses or are retired only after explicit verification.
```

---

# 51. Final Architecture Summary

The target is **not**:

```text
TodoList-ui is the main app and ChatUI is pasted inside it.
```

It is also **not**:

```text
ChatUI is the main app and To-Do is pasted inside it.
```

The correct model is:

```text
                 ROOT SHARED SHELL
                        |
       +----------------+----------------+
       |                                 |
   /todo-list-ui                     /chat-ui...
       |                                 |
       v                                 v
   To-Do module                      ChatUI module
   TodoListDB                        ChatUI_DB
```

The root shell is the **main application**.

To-Do is the default module when the user enters `/`.

The existing To-Do rail design becomes the shared launcher.

The existing **AI** position becomes the **ChatUI launcher**.

The two applications remain internally independent enough that future work on Tasks does not risk Chat messages, and future work on Chat/Voice does not risk TodoListDB.

That is the architecture this implementation plan should preserve throughout implementation.
