# Implementation Review — Problems to Fix

## Combined To-Do + ChatUI application

**Document type:** implementation review / repair handoff  
**Purpose:** tell the next agent exactly what is wrong in the current implementation, why it matters, how it can fail, and the safest direction for fixing it.  
**Reviewed repository:** `Mahdi1910/TodoList-ui-ChatUI`  
**Reviewed branch:** `main`  
**Reviewed commit:** `b8c1281aea4d60b90ef2eca1c91c14e579852e8c`  
**Authoritative integration plan reviewed:** `chat UI agent/chat UI agent implementation plan.md`  
**Status:** REVIEW ONLY. This document does not mean any application-code fix has been implemented.

---

# 1. Important instruction to the repair agent

Do **not** treat this as a request to rewrite the two applications.

The integration has a good basic direction. The repair goal is:

```text
keep the working To-Do application
keep the working ChatUI application
keep both databases independent
keep the shared shell
repair the lifecycle / routing / CSS / remount boundaries
then manually verify the combined application repeatedly
```

Do not solve an integration defect by changing unrelated domain behavior.

Preserve these invariants unless a separate approved plan explicitly changes them:

```text
TodoListDB stays TodoListDB
ChatUI_DB stays ChatUI_DB
no integration-only database schema bump
no merging of the two databases
no rewriting To-Do task/repeat/taxonomy behavior
no rewriting Gemini transport merely for integration
no removal of HIGH-thinking behavior
no removal of Files API/local Blob behavior
no combined backup format in this repair
only one complete application should be active at a time
hard-navigation fallback must remain available
production build must remain allow-list based
internal planning/review files must not enter dist/
```

The user performs real browser/phone behavior testing for this project. Static checks are useful, but do not claim the repair is complete merely because syntax/CI passes.

---

# 2. Review conclusion

The integration is **not a bad implementation**. The top-level design is significantly better than simply putting two complete applications on one page.

The useful architecture already exists:

```text
Root shell
  -> /todo-list-ui
       -> To-Do module
       -> TodoListDB

  -> /chat-ui...
       -> ChatUI module
       -> ChatUI_DB
```

However, the current implementation is **not ready to be considered finished** because there are real lifecycle/remount problems that static CI does not detect.

Approximate review scores at this commit:

| Area | Rating |
|---|---:|
| Overall architecture | 8.5 / 10 |
| Database/data safety | 9 / 10 |
| Routing design | 8 / 10 |
| CSS isolation | 6 / 10 |
| Mount/unmount reliability | 5.5 / 10 |
| Failure recovery | 5.5 / 10 |
| Build/deployment structure | 8.5 / 10 |
| Current combined-app readiness | about 7 / 10 |

The most important defect family is:

```text
application code that used to assume it owned the whole document
    +
new module roots that no longer own document/body/:root
    +
body-level portals and module-level singleton state
    =
remount and style failures
```

---

# 3. Severity / confidence notation

## Severity

```text
P0 / Critical
    Can corrupt navigation/data state or make a main application path unusable.

P1 / High
    Real user-visible failure, remount/lifecycle failure, or major resource leak.

P2 / Medium
    Robustness, accessibility, maintainability, rollback, or edge-case failure.

P3 / Low
    Polish or defensive improvement that should follow the important fixes.
```

## Confidence

```text
CONFIRMED
    The problematic condition can be derived directly from current source.

HIGH CONFIDENCE
    Source strongly indicates a failure/risk, but final visible effect should still be manually reproduced.

AUDIT GAP
    The implementation lacks proof/coverage; do not automatically call it a runtime bug until reproduced.
```

---

# 4. Priority summary

Fix in approximately this order:

| ID | Priority | Problem |
|---|---|---|
| R-01 | P1 | Module CSS isolation is incomplete; many selectors are still global |
| R-02 | P1 | To-Do body-level UI no longer inherits To-Do theme variables |
| R-03 | P1 | To-Do body-level portals/nodes are not completely owned or removed on unmount |
| R-04 | P0/P1 | Repeat Ends keeps stale DOM references and is not remount-safe |
| R-05 | P0/P1 | Cancelling browser Back/Forward app switching can corrupt history entries |
| R-06 | P1 | ChatUI is suspended as a detached dormant DOM instead of truly unmounted |
| R-07 | P1 | Generic lifecycle capture is incomplete and can restore stale listeners |
| R-08 | P1/P2 | Workspace timers/listeners/state do not have a complete destroy/reset lifecycle |
| R-09 | P2 | Voice Mode adds late global work that lifecycle capture does not own |
| R-10 | P1 | Chat generation abort is not awaited before switching applications |
| R-11 | P1 | Attachment drag/drop portal, theme, drag state, and cleanup are incomplete |
| R-12 | P1 | Failed To-Do startup can leave stale singleton/global state and break retry |
| R-13 | P1 | Failed Chat startup can leave `initialized` flags pointing at destroyed DOM |
| R-14 | P1/P2 | Failed dependency/style loads are cached as rejected Promises and poison retries |
| R-15 | P1/P2 | Standalone ChatUI rollback/server/deployment path is no longer truly standalone |
| R-16 | P2 | To-Do DOM extraction was not completed; combined mount parses old index.html every time |
| R-17 | P2 | `/chat-ui` does not have deterministic home/new-chat semantics |
| R-18 | P2 | Live theme/accent changes are not propagated cleanly to the shell |
| R-19 | P2 | Document title ownership is still split between shell and Chat internals |
| R-20 | P2 | Target-app mount failure after successful leave has weak user recovery |
| R-21 | P1/P2 | LAN source server can expose non-runtime repository files |
| R-22 | P1 process gap | Current CI cannot detect the important lifecycle/remount bugs |
| R-23 | P2 | Cross-application focus handoff is not explicit |
| R-24 | P1 operational | Old-origin data migration is still a mandatory manual cutover step |

---

# 5. R-01 — CSS isolation is incomplete

**Severity:** P1  
**Confidence:** CONFIRMED  
**Area:** ChatUI + To-Do + shared shell

## The problem

The implementation correctly moved some root variables to `.chatui-app` and `.todo-app`, but much of the application CSS itself is still written as document-global selectors.

Examples:

`ChatUI/css/sidebar/shell.css` still contains selectors such as:

```css
.sidebar { ... }
.sidebar-header { ... }
.brand { ... }
.new-chat-btn { ... }
```

`ChatUI/css/components/modals.css` still contains:

```css
.modal-overlay { ... }
.modal-card { ... }
.modal-header { ... }
.modal-title { ... }
.form-group { ... }
```

To-Do CSS also still contains global selectors. A particularly clear example is `TodoList-ui/css/layout/workspace-layout.css`:

```css
button:focus-visible,
input:focus-visible,
[role="option"]:focus-visible { ... }

button,
.rail-item,
.nav-item-mobile,
.context-menu-item { ... }

@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after { ... }
}
```

This means application styles remain installed at document level whenever that application is active.

## Why this is a problem

The shared shell exists at the same time as the active module.

Therefore a selector like:

```css
button { ... }
```

can style shell buttons too.

A generic selector such as:

```css
.modal-card
.sidebar
.empty-state
.header-left
```

can also affect future shell UI or any integration element that happens to use the same class name.

Moving CSS variables to `.todo-app` / `.chatui-app` does **not** automatically scope selectors.

## Failure case

A future shell component adds:

```html
<button class="modal-close-btn">...</button>
```

or:

```html
<div class="empty-state">...</div>
```

While To-Do/Chat styles are loaded, that shell component can unexpectedly receive application styling.

This class of bug is especially difficult to diagnose because it changes according to which application is currently loaded.

## Best repair direction

Finish real CSS scoping.

Preferred rule:

```text
Chat-owned ordinary selectors -> descendant of .chatui-app
To-Do-owned ordinary selectors -> descendant of .todo-app
Shell selectors -> .shell-* / shell-owned roots
Body-level application portals -> explicit owner selector, discussed in R-02/R-03
```

Examples:

```css
.chatui-app .sidebar { ... }
.chatui-app .modal-card { ... }
.todo-app .task-card { ... }
.todo-app button:focus-visible { ... }
```

Do not mechanically prefix things that are not normal selectors without review. Be careful around:

```text
@keyframes
@font-face
:root replacement rules
body-owned drag state
media queries
pseudo-elements
portal roots
```

It is safer to repair the dangerous global selectors in a controlled pass than to run a blind text replacement over all CSS.

## Files to inspect

At minimum:

```text
ChatUI/css/main.css
ChatUI/css/sidebar/**
ChatUI/css/chat/**
ChatUI/css/components/**
ChatUI/css/animations/**
ChatUI/css/responsive.css
ChatUI/css/integration.css

TodoList-ui/css/variables.css
TodoList-ui/css/layout/**
TodoList-ui/css/components/**
TodoList-ui/css/integration.css

shell/css/shell.css
```

## Regression protection

Do not break body-level viewport drag layers while fixing selector scope. Those require the explicit ownership strategy described below.

## Verification

With To-Do active:

```text
inspect shell desktop rail
inspect shell mobile nav
inspect shell Settings button
inspect shell focus rings
verify no To-Do rules are changing shell geometry/typography
```

With Chat active, repeat the same checks.

Then switch applications repeatedly and verify shell appearance remains stable except for intentional shell theme/accent reporting.

## Definition of done

Application CSS is either:

```text
root-scoped to its application
or
explicitly documented as an owned body-level portal rule
```

There should be no accidental generic application selector styling shell DOM.

---

# 6. R-02 — To-Do body-level UI loses To-Do theme variables

**Severity:** P1  
**Confidence:** CONFIRMED  
**Area:** To-Do drag, hierarchy UI, Repeat Ends, parent picker

## The problem

To-Do variables are now defined on `.todo-app` / `#app`:

```css
.todo-app[data-theme="dark"],
#app[data-theme="dark"] {
  --bg-primary: ...;
  --bg-secondary: ...;
  --border-color: ...;
  --accent-color: ...;
  --shadow-lg: ...;
  ...
}
```

That is correct for normal To-Do descendants.

But several To-Do features create or move UI directly under `document.body`.

Examples:

### Task drag

`TodoList-ui/js/components/task-drag.js`:

```js
this.dragLayer = document.createElement('div');
this.dragLayer.className = 'task-drag-layer';
document.body.appendChild(this.dragLayer);
```

The dragged Task DOM is then moved inside this body-level layer.

### Task parent picker

`TodoList-ui/js/components/task-actions.js`:

```js
document.body.appendChild(picker);
```

### Repeat Ends modal

`TodoList-ui/js/components/schedule-repeat-end.js`:

```js
document.body.appendChild(modal);
```

### Project/Tag hierarchy drag

The taxonomy drag layer is also body-level and its CSS depends on To-Do variables.

## Why this is a problem

CSS custom properties inherit through the DOM tree.

A body child is **not** a descendant of `.todo-app`.

Therefore a body-level dragged Task/portal cannot automatically inherit:

```text
--bg-secondary
--bg-glass-card
--text-primary
--border-color
--accent-color
--shadow-lg
--radius-md
...
```

Many affected CSS rules depend on those variables.

Example from Task Card CSS:

```css
.task-card {
  background-color: var(--bg-glass-card);
  border: 1px solid var(--border-color);
  border-radius: var(--radius-md);
}
```

Once that Task DOM is moved under `body`, those values can become unresolved.

## Possible user-visible symptoms

```text
dragged Task becomes transparent or loses border/shadow
Project/Tag floating drag node has wrong colors
parent picker appears partially unstyled
Repeat Ends dialog looks wrong or transparent
light/dark theme does not match these portals
```

## Best repair direction

Introduce explicit To-Do portal ownership.

Preferred model:

```text
.todo-app
  normal application DOM
  todo overlay root
      ordinary modal/menu portals

body
  only viewport-level drag layers that truly require body ownership
```

For ordinary portal UI such as Repeat Ends and task parent picker, prefer a To-Do-owned overlay root inside `.todo-app` if clipping/positioning allows it.

For a drag layer that truly must stay under `body`, give it explicit module ownership and theme context, for example:

```html
<div data-todo-body-portal data-theme="dark" class="task-drag-layer">...</div>
```

and make variable rules cover the explicit portal owner as well as `.todo-app`.

Conceptually:

```css
.todo-app[data-theme="dark"],
[data-todo-body-portal][data-theme="dark"] {
  --bg-primary: ...;
  ...
}
```

Then ThemeManager must keep owned body portals synchronized with the active To-Do theme.

Do not put To-Do theme variables back on global `:root`; that would reintroduce cross-app theme pollution.

## Verification

Test both light and dark mode:

```text
Task pointer drag
Task touch drag
root/subtask hierarchy drag
Project pointer drag
Project touch drag
Tag pointer drag
Tag touch drag
Link-to-parent picker
Schedule -> Repeat -> Repeat Ends
```

Every floating/modal surface must have the correct To-Do theme.

---

# 7. R-03 — To-Do body-level nodes are not fully cleaned on unmount

**Severity:** P1  
**Confidence:** CONFIRMED  
**Area:** To-Do lifecycle

## The problem

`TodoList-ui/js/module.js` removes some owned body state:

```js
document.body.classList.remove(
  'task-drag-active',
  'sidebar-taxonomy-drag-active',
  'modal-open'
);

document.querySelectorAll(
  '.task-drag-layer, .sidebar-taxonomy-drag-layer'
).forEach(node => node.remove());
```

But other To-Do-created body nodes are not included.

Examples include:

```text
#task-parent-picker
#repeat-end-modal
```

The plan explicitly required that no anonymous/persistent module DOM remain behind after the module leaves.

## Why this is a problem

After To-Do is removed and ChatUI becomes active, hidden To-Do DOM can remain under `body`.

That causes several risks:

```text
memory retention
stale references
ID collisions on future remount
wrong focus restoration
old event handlers attached to old nodes
CSS/theme ownership confusion
future code finding old node through document.getElementById()
```

The Task parent picker happens to call:

```js
document.getElementById('task-parent-picker')?.remove();
```

when it is recreated, so it may self-repair later. But it still exists during the inactive-app period, and other portals do not necessarily self-repair.

## Best repair direction

Every body-level node must have explicit ownership.

For example:

```text
data-module-owner="todo"
```

or keep direct references in a To-Do portal registry.

Then To-Do unmount should remove **all** owned body nodes.

Better still, move non-viewport portals into a To-Do overlay root so removing `.todo-app` automatically removes them.

Do not use a broad selector that risks deleting ChatUI/shell DOM.

## Verification

Immediately after To-Do -> Chat switch, inspect document body.

There must be no leftover To-Do-owned node such as:

```text
#repeat-end-modal
#task-parent-picker
.task-drag-layer
.sidebar-taxonomy-drag-layer
To-Do modal overlays
To-Do context portal leftovers
```

Then switch back and make sure no duplicate IDs exist.

---

# 8. R-04 — Repeat Ends is not remount-safe

**Severity:** P0/P1  
**Confidence:** CONFIRMED  
**Area:** To-Do Schedule / Repeat / lifecycle

## The problem

`TodoList-ui/js/components/schedule-repeat-end.js` contains:

```js
initRepeatEndUi() {
  if (this.repeatEndsRow) return;
  ...
}
```

The dynamically created row/modal are stored on the singleton `ScheduleComponent` object.

On the first To-Do mount:

```text
ScheduleComponent.repeatEndsRow
    -> first To-Do DOM node
```

When To-Do unmounts, the main To-Do root is removed, but the `ScheduleComponent` JavaScript module remains cached by the browser.

The property `repeatEndsRow` is not reset.

The body-level Repeat Ends modal is also not reliably destroyed by the module lifecycle.

On the next To-Do mount, `ScheduleComponent.initRepeatEndUi()` sees that `this.repeatEndsRow` is truthy and returns even though the stored node belongs to the previous mount.

## Exact failure sequence

```text
1. Open To-Do.
2. Schedule -> Repeat.
3. Repeat Ends row is created.
4. Switch to ChatUI.
5. Old To-Do root is removed.
6. ScheduleComponent singleton remains cached.
7. repeatEndsRow still points to old/detached DOM.
8. Switch back to To-Do.
9. New To-Do DOM is created.
10. initRepeatEndUi() runs.
11. if (this.repeatEndsRow) return;
12. New To-Do receives no new Repeat Ends UI.
```

This is exactly the kind of bug a syntax/static test cannot detect.

## Best repair direction

Give Schedule explicit mount/destroy semantics.

At minimum:

```text
ScheduleComponent.init(root)
ScheduleComponent.destroy()
```

`destroy()` should:

```text
close schedule/repeat dialogs
cancel wheel/scroll timers
remove any owned body portal
null every DOM reference
reset repeatEndsRow
reset repeatEndModal
reset repeatEndTypeWheel
reset repeatEndCountWheel
reset validation-message references
reset any per-mount state that points at DOM
```

`initRepeatEndUi()` should never accept a stale reference simply because it is truthy.

Defensive condition:

```js
if (this.repeatEndsRow?.isConnected && currentRoot.contains(this.repeatEndsRow)) {
  return;
}
```

can help, but an explicit `destroy()` is the cleaner primary fix.

An even cleaner long-term option is to keep permanent Repeat Ends markup in the reusable To-Do fragment and have `init()` reacquire it every mount.

## Manual verification

Required:

```text
To-Do
 -> open Task editor
 -> Date/Schedule
 -> Repeat
 -> confirm Ends exists
 -> open it and change value

switch to ChatUI
switch back to To-Do

repeat same flow
```

Repeat this at least 5 times.

Verify:

```text
row exists every time
modal opens every time
Never/On date/After works
no duplicate #repeat-end-modal
Escape/focus still works
no stale detached node in body
```

---

# 9. R-05 — Cancelling browser Back/Forward can corrupt history

**Severity:** P0/P1  
**Confidence:** CONFIRMED  
**Area:** shell routing

## The problem

In `shell/js/app-shell.js`, when a `popstate` transition is denied by `prepareDeactivate()`, the code does effectively:

```js
if (!allowed) {
  if (options.source === 'popstate') {
    writeHistory(previousPath, { replace: true });
  }
  return;
}
```

This is not a safe way to cancel browser Back/Forward navigation.

## Why this is wrong

By the time `popstate` fires, the browser has already moved to a different history entry.

Example history:

```text
entry 1 = /todo-list-ui
entry 2 = /chat-ui
```

Current position is entry 2.

The user presses Back.

Before JavaScript asks whether leaving is allowed, browser position has already moved to entry 1.

If the user clicks **Stay**, the current implementation replaces entry 1 with `/chat-ui`.

History can become:

```text
entry 1 = /chat-ui
entry 2 = /chat-ui
```

The original To-Do entry has been destroyed.

## User-visible symptoms

```text
Back button appears to stop working
Back/Forward routes duplicate
history unexpectedly loses To-Do or Chat entries
user needs multiple presses for strange results
route URL and mounted app can become confusing after repeated cancellations
```

## Best repair direction

Track shell history entry indices.

When the shell writes a route, put a stable index in `history.state`, for example:

```js
{
  shellEntry: true,
  shellIndex: 12
}
```

Keep the active index.

On `popstate`:

```text
previous active index = 12
target popped index = 11
```

If leaving is denied, restore browser position using:

```js
history.go(+1)
```

rather than overwriting entry 11.

Likewise, if Forward was denied, move back to the previous index.

Use a small restoration flag so the restoration `popstate` does not recursively prompt again.

If the target history entry has no usable shell index, use a safe hard-navigation fallback rather than silently mutating browser history.

## Do not solve it by

```text
blind replaceState of the popped entry
adding another pushState entry every time user clicks Stay
ignoring the URL mismatch
```

## Required manual tests

### Unsaved To-Do editor

```text
To-Do -> Chat -> To-Do
open unsaved Task editor
press browser Back
choose Stay
verify editor remains
verify URL remains To-Do
press Back later after closing editor
verify Chat route still exists
```

### Chat generation

```text
To-Do -> Chat
start generation
press browser Back
choose Stay
verify generation continues
verify history remains intact
then stop generation and Back
verify To-Do opens
Forward must return to Chat correctly
```

Repeat with multiple route entries and Chat conversation deep links.

---

# 10. R-06 — ChatUI is not really unmounted; the entire DOM is kept dormant

**Severity:** P1  
**Confidence:** CONFIRMED design deviation / HIGH CONFIDENCE resource risk  
**Area:** ChatUI lifecycle

## The problem

`ChatUI/js/module.js` keeps a module-level variable:

```js
let dormant = null;
```

On first mount, the full root/app/lifecycle object is stored in `dormant`.

On unmount, current code roughly does:

```js
record.lifecycle.suspend();
record.root.remove();
unloadModuleStyles('chat');
```

It does **not** dispose the ChatUI root.

On the next mount, it does:

```js
context.host.replaceChildren(dormant.root);
dormant.lifecycle.resume();
```

So ChatUI is detached and reattached, not destroyed and remounted.

## Why this matters

This behavior is very different from the intended contract:

```text
prepareDeactivate
beforeLeave
unmount
```

A large Chat conversation can keep a large detached DOM tree in memory while To-Do is active.

The dormant record can retain:

```text
conversation message DOM
Workspace DOM
settings DOM
sidebar DOM
closures
listener records
module state
references to child elements
```

On a phone, this can create real memory pressure.

More importantly, this shortcut hides missing lifecycle cleanup. Features may appear to work only because their old DOM is never recreated.

## Best repair direction

The preferred final architecture is real unmount/remount:

```text
beforeLeave
  -> stop active work
  -> close/transient cleanup
  -> wait persistence idle

unmount
  -> destroy module UI managers
  -> remove listeners
  -> cancel timers/RAF
  -> release media/session resources
  -> clear body portals
  -> clear DOM references
  -> remove root
```

A later mount should create a new root and initialize against it.

If true Chat unmount cannot yet be made safe, the safer intermediate solution is:

```text
keep cross-app switching as hard/full navigation
```

rather than claim seamless SPA switching while depending on a dormant full DOM.

## If dormant mode is intentionally kept temporarily

Then call it what it is: `suspend/resume`, not a true unmount.

It must prove:

```text
no inactive document/window listeners
no active timers
no active microphone/audio
no file-drop handler
no background generation callbacks
no Workspace delayed work
no stale body portals
bounded memory behavior
```

and the plan/documentation should explicitly say that inactive Chat DOM is retained.

## Verification

Use browser memory/devtools and repeated switching:

```text
open long Chat
switch Chat <-> To-Do 20+ times
check detached nodes
check listener counts
check memory trend
```

There should not be an increasing number of detached application trees.

---

# 11. R-07 — `lifecycle-scope.js` is an incomplete ownership mechanism

**Severity:** P1  
**Confidence:** CONFIRMED architectural limitation  
**Area:** shell lifecycle support

## The problem

`shell/js/lifecycle-scope.js` temporarily monkey-patches:

```text
EventTarget.prototype.addEventListener
EventTarget.prototype.removeEventListener
window.setInterval
window.clearInterval
```

while startup work is being captured.

This catches some first-mount listeners, but it is not a complete lifecycle system.

## What it does not automatically own

It does not generically capture:

```text
setTimeout
requestAnimationFrame
listeners added after startup capture ends
MediaStream
MediaRecorder
AudioContext
WebSocket/session objects
AbortControllers created later
DOM portals created later
Promises / asynchronous jobs
MutationObserver / ResizeObserver unless explicitly handled
```

These resources still require explicit cleanup.

## Another subtle problem: listener state can become stale

After capture finishes, the patched `removeEventListener` is restored.

If application code later removes an originally captured listener, lifecycle-scope may not learn that it was removed.

Likewise, a listener registered with:

```js
{ once: true }
```

can remove itself automatically when it fires. Lifecycle-scope does not receive a corresponding remove call.

Later `resume()` can potentially re-add a listener that the browser/application already considered finished.

## Another risk: global monkey patching

During `capture(async () => ...)`, `EventTarget.prototype.addEventListener` is changed for the entire page.

Any unrelated code that happens to register a listener during that async period can be recorded as belonging to the active application even if it really belongs to the shell or a dependency.

## Best repair direction

Move toward explicit lifecycle ownership.

Preferred pattern for module-owned event listeners:

```js
const controller = new AbortController();

node.addEventListener('click', onClick, {
  signal: controller.signal
});

window.addEventListener('resize', onResize, {
  signal: controller.signal
});

// destroy
controller.abort();
```

For timers/RAF:

```text
keep direct timer/RAF IDs in the owner
clear them in destroy()
```

For UI components:

```text
init(root) -> cleanup()
```

or:

```text
init(root)
destroy()
```

The generic lifecycle scope can remain temporarily as a safety net, but correctness should not depend on monkey-patching the platform during startup.

## Definition of done

Every long-lived application subsystem has explicit ownership and cleanup, especially:

```text
Workspace
attachments
voice
read aloud
composer
sidebar
settings
menus/modals
To-Do drag
To-Do taxonomy drag
Schedule
Task/Subtask editor
```

---

# 12. R-08 — Workspace UI does not have complete destroy/reset behavior

**Severity:** P1/P2  
**Confidence:** CONFIRMED  
**Area:** ChatUI Workspace

## The problem

`ChatUI/js/workspace/workspace-ui.js` owns module-level mutable state:

```js
const childrenCache = new Map();
const expandedDirectoryIds = new Set();
let workspaceOpenedOnce = false;
let selectedNode = ...;
let searchTimer = null;
let documentRenderTimer = null;
let initialized = false;
```

`initWorkspaceUI()` installs listeners including:

```text
workspace:changed
chat:view-opened
workspace:theme-changed
window resize
search input debounce
buttons
```

But there is no corresponding `destroyWorkspaceUI()`.

`closeWorkspaceView()` only hides the view. It does not clear timers/listeners/state.

## Real delayed-work case

The Workspace search and document repagination use `setTimeout`.

Those timeouts are scheduled later during user interaction, after the generic lifecycle startup capture has ended.

Possible sequence:

```text
1. Chat Workspace is open.
2. User types a search or triggers document repagination.
3. Timeout is scheduled.
4. User immediately switches to To-Do.
5. Chat root is detached.
6. Timeout fires after Chat is inactive.
7. Workspace code can still read storage/render/report errors against inactive DOM.
```

## Best repair direction

Add explicit Workspace lifecycle:

```text
initWorkspaceUI(root) -> cleanup
or
initWorkspaceUI(root)
destroyWorkspaceUI()
```

Destroy must at minimum:

```text
clear searchTimer
clear documentRenderTimer
remove window listeners
remove custom-event listeners
remove DOM listener bindings where needed
close action menu
clear transient search UI state
reset initialized=false if future true remount is supported
release DOM-dependent references
```

Decide separately whether Workspace navigation state such as selected path should persist across remount. Persisting logical state is okay; retaining dead DOM state is not.

`workspace-navigation-bridge.js` and `workspace-mobile.js` already have better explicit cleanup patterns. Use those as the style to move toward.

## Verification

```text
open Workspace
start search and immediately switch
resize while viewing page and immediately switch
switch back
open Workspace
repeat 10 times
```

Check:

```text
no delayed error alert after switching
no duplicate refresh
one click = one action
one resize = one repagination
```

---

# 13. R-09 — Voice Mode adds late global work outside startup capture

**Severity:** P2  
**Confidence:** CONFIRMED  
**Area:** ChatUI Voice

## The problem

`ChatUI/js/voice/live-voice-controller.js` adds this listener when Voice Mode is first started:

```js
if (!pagehideBound) {
  pagehideBound = true;
  window.addEventListener('pagehide', () => {
    void stopLiveVoiceMode();
  });
}
```

This happens during user interaction, not during initial Chat startup capture.

`stopLiveVoiceMode()` stops the voice session but does not remove the pagehide listener or reset `pagehideBound`.

Therefore the listener can remain installed while To-Do is active.

## Why this matters

Calling stop on an already closed controller may be mostly harmless, but it proves inactive-module global work survives.

The same subsystem also has requestAnimationFrame-driven voice-level UI in `voice-ui.js`. Those frames need explicit cancellation during true destroy/remount.

## Best repair direction

Use a named pagehide handler and explicit controller/UI destroy lifecycle.

For example conceptually:

```text
initVoiceControllerLifecycle()
destroyVoiceControllerLifecycle()
```

Destroy should:

```text
stop Live Voice
cancel recording
cancel pending retries
cancel pending turn timers
cancel voice UI RAF
remove pagehide listener
reset pagehideBound if remount needs rebinding
clear callbacks that point into current Chat UI
```

The important distinction is:

```text
stop current voice session
!=
destroy voice subsystem for application unmount
```

Both operations are needed.

---

# 14. R-10 — Chat generation abort is not awaited before To-Do mounts

**Severity:** P1  
**Confidence:** CONFIRMED  
**Area:** Chat generation / persistence / app switching

## The problem

In `ChatUI/js/module.js`, `beforeLeave()` does:

```js
if (runtime.isGenerating) abortActiveGeneration();
```

and then continues the leave sequence.

`abortActiveGeneration()` in generation lifecycle:

```text
aborts AbortController
clears activeAbortController
sets isGenerating=false
updates buttons
```

It does **not** return a Promise that resolves when the complete generation runner has handled the abort and finished its final persistence.

The generation runner catches `AbortError`, updates the assistant message to interrupted state, then performs final IndexedDB persistence in its `finally` path.

So this can happen:

```text
Chat beforeLeave aborts generation
Chat root is detached
To-Do mounts
old Chat generation catch/finally continues
old Chat writes/persistence/UI callbacks finish afterwards
```

## Why this is a problem

This violates the lifecycle boundary:

```text
old app should be quiet before new app is active
```

It can also produce late errors or old UI callback attempts after the module is inactive.

## Existing useful primitive

Chat already has a serialized write coordinator with:

```js
waitForCoreWrites()
```

but the module leave path does not currently use it as a final idle barrier.

## Best repair direction

Track active generation completion explicitly.

Preferred API shape:

```text
abortActiveGenerationAndWait()
```

or:

```text
abortActiveGeneration()
await waitForGenerationIdle()
await waitForCoreWrites()
```

The generation runner should publish a Promise/idle state that represents:

```text
network request settled
interrupted/completed state normalized
final assistant persistence complete
final generation lifecycle complete
```

Then Chat `beforeLeave()` should await it after the user has approved leaving.

Do not wait forever. Use a bounded timeout and hard-navigation fallback if cleanup cannot settle safely.

## Required test

```text
start a long streaming generation
click To-Do
approve stopping generation
verify interrupted Chat message persists
switch back to Chat
verify exactly one interrupted assistant message
no late console error
no duplicate message
no To-Do interference
```

Repeat with tools/files and with generation stopped very early and very late.

---

# 15. R-11 — Attachment drag/drop ownership is incomplete

**Severity:** P1  
**Confidence:** CONFIRMED  
**Area:** Chat composer attachments

## Problem A — body-level overlay does not inherit Chat theme

`ChatUI/js/composer/attachments.js` creates:

```js
overlay = document.createElement('div');
overlay.id = 'attachment-drop-overlay';
...
document.body.appendChild(overlay);
```

But Chat theme variables live on `.chatui-app`.

The overlay CSS uses variables such as:

```text
--accent-blue
--bg-primary
--bg-secondary
--border-color
--text-primary
```

A body child is not under `.chatui-app`, so it cannot inherit those variables.

## Problem B — integration CSS selector does not match the real overlay

`ChatUI/css/integration.css` contains:

```css
.chatui-app .attachment-drop-overlay {
  position: absolute;
}
```

But the real overlay is appended to `body`, outside `.chatui-app`.

Therefore that integration rule cannot match it.

## Problem C — drag depth is not explicitly reset when leaving

The attachment module tracks:

```text
fileDragDepth
dragDropInitialized
```

`clearTransientBodyUi()` removes the body overlay when Chat leaves, but it does not reset `fileDragDepth`.

A switch during an active drag can therefore leave logical drag state inconsistent when Chat resumes.

## Problem D — drag listeners are global and initialization is singleton-based

`initAttachmentDragDrop()` installs document/window listeners once and protects itself with a module-level initialization flag.

This is compatible with the current dormant-DOM shortcut, but it is not ready for true destroy/remount unless a cleanup resets the listeners and initialization state.

## Best repair direction

Prefer putting the attachment overlay in the Chat-owned overlay root:

```text
#chatui-module-root
  #overlay-root[data-chatui-overlay-root]
      #attachment-drop-overlay
```

Then:

```text
Chat variables inherit normally
.chatui-app .attachment-drop-overlay selector works
removing Chat root removes overlay
```

Add explicit attachment drag lifecycle:

```text
initAttachmentDragDrop()
destroyAttachmentDragDrop()
```

Destroy should:

```text
remove document dragenter/dragover/dragleave/drop/dragend handlers
remove window blur handler
remove overlay
fileDragDepth = 0
dragDropInitialized = false if true remount will initialize again
```

## Verification

```text
drag file over Chat
leave before drop
return to Chat
drag another file
```

Overlay must show/hide correctly.

Also test dark/light Chat theme and ensure overlay colors are correct.

---

# 16. R-12 — Failed To-Do startup can leave stale singleton/global state

**Severity:** P1  
**Confidence:** CONFIRMED  
**Area:** To-Do startup recovery

## The problem

`TodoList-ui/js/app-main.js` initializes integration state before database open:

```text
ThemeManager.init()
ModalFocusManager.init()
assert integrations
then DATABASE_OPEN
```

`ModalFocusManager.init()` sets a module-level:

```js
initialized = true;
```

and installs a global keydown listener.

If a later startup step fails, `TodoList-ui/js/module.js` catches the error and disposes the generic lifecycle/root, but the failed-mount catch does **not** call the same `ModalFocusManager.destroy()` used by successful unmount.

The generic lifecycle can remove the captured event listener, while `ModalFocusManager.initialized` remains `true`.

On retry:

```js
ModalFocusManager.init();
```

can return early, believing it is still initialized even though its listener was removed and its old DOM was destroyed.

## Additional stale global problem

Before startup completes, `module.js` calls `installWindowBridges(refs)` and assigns:

```text
window.TasksComponent
window.SidebarComponent
window.WorkspaceControls
window.ScheduleComponent
window.SubtaskEditorComponent
```

The failed-mount catch does not clear those bridges.

So a failed To-Do start can leave global references pointing to partially initialized singleton modules after the To-Do root has been removed.

## Possible failure sequence

```text
1. Open To-Do.
2. DB open/hydration fails temporarily.
3. module catch removes root/listeners.
4. ModalFocusManager.initialized stays true.
5. window.* bridges remain.
6. User retries without page reload.
7. New To-Do DOM appears.
8. ModalFocusManager.init() returns early.
9. modal focus behavior is partly dead.
```

## Best repair direction

Create one shared cleanup routine for **both**:

```text
successful unmount
failed first mount
```

It should safely call, when initialized:

```text
ModalFocusManager.destroy()
component destroy/reset functions
clear window bridges owned by this attempted mount
remove body-owned portals/state
ThemeManager.clearRoot(root)
lifecycle.dispose()
root.remove()
```

Do not rely on generic event-listener disposal to reset module-level flags.

A component that has `initialized` state must own both init and destroy/reset.

## Verification

Deliberately simulate a recoverable startup failure during:

```text
DATABASE_OPEN
HYDRATION
UI_INIT
```

Then retry **without refreshing the page**.

Verify:

```text
modals trap focus normally
Escape works once
no duplicate handler
no stale window bridge
Tasks/Sidebar/Schedule all initialize
```

---

# 17. R-13 — Failed Chat startup can leave `initialized` flags attached to destroyed DOM

**Severity:** P1  
**Confidence:** CONFIRMED pattern  
**Area:** Chat startup recovery

## The problem

Many Chat subsystems use module-level one-time flags.

Examples:

`ChatUI/js/ui/action-menu.js`:

```js
let initialized = false;

export function initActionMenu() {
  if (initialized) return;
  initialized = true;
  document.addEventListener(...);
}
```

`ChatUI/js/settings/backup-restore-ui.js`:

```js
let initialized = false;
```

`ChatUI/js/workspace/workspace-ui.js`:

```js
let initialized = false;
```

and similar patterns exist elsewhere.

If first Chat startup initializes some of these components and a later startup stage fails, `ChatUI/js/module.js` does:

```text
lifecycle.dispose()
root.remove()
unload styles
```

but does not systematically reset all component-level `initialized` flags.

## Why this is a problem

A retry creates **new DOM**.

A module singleton can still say:

```text
initialized = true
```

and skip attaching listeners to that new DOM.

Result: the application can mount visually but have controls that do nothing.

## Example

```text
Action menu initializes successfully.
Later startup stage fails.
Root is destroyed.
User retries.
New #action-menu DOM exists.
initActionMenu() sees initialized=true and returns.
New menu has no correct global keyboard/outside-click behavior.
```

## Best repair direction

Every singleton subsystem must support:

```text
init(currentRoot)
destroy()
```

or return a cleanup function.

The failed first-mount catch must invoke all cleanup for the subsystems that were successfully started before the failure.

Use a startup cleanup stack:

```text
initialize subsystem A -> push cleanup A
initialize subsystem B -> push cleanup B
initialize subsystem C fails
run cleanup B
run cleanup A
```

This avoids guessing which steps completed.

## Required tests

Inject startup failure after multiple different stages, then retry in the same page lifetime.

Check:

```text
Action menu
Sidebar
Workspace
Settings
Backup/Restore
Composer
Attachments
Recorder
Read Aloud
Voice
model/thinking menus
right sidebar
modal listeners
smart scroll
```

One action must produce one response after recovery.

---

# 18. R-14 — Dependency loader caches failed Promises and can poison retry

**Severity:** P1/P2  
**Confidence:** CONFIRMED  
**Area:** shell dependency/style loading

## The problem

`shell/js/dependency-loader.js` caches load Promises in:

```js
const scriptPromises = new Map();
const stylePromises = new Map();
```

When a load is requested again, it returns the existing Promise.

If that Promise rejected because of a temporary network/CDN/style failure, the rejected Promise remains cached.

## Failure sequence

```text
1. User opens ChatUI.
2. CDN/style request temporarily fails.
3. loadScriptOnce/loadStylesheetOnce Promise rejects.
4. shell catches Chat mount failure.
5. user tries Chat again.
6. loader finds cached Promise.
7. same already-rejected Promise is returned immediately.
8. Chat cannot recover until full page reload.
```

`resetModuleImport(appId)` only clears the module import cache owned by `module-registry.js`. It does not clear dependency-loader Promise maps.

## Best repair direction

A failed load must remove its own cache entry.

Conceptually:

```js
const promise = actuallyLoad().catch(error => {
  scriptPromises.delete(src);
  failedScriptNode?.remove();
  throw error;
});
```

and similarly for styles.

Also remove failed link/script elements so the next attempt gets a clean DOM request.

For module-owned styles, make sure `ownedStyles` cannot retain a failed/removed link.

## Verification

Temporarily block one dependency/style request, open Chat, observe failure, unblock it, then retry **without full page refresh**.

The second attempt should start normally.

Repeat for:

```text
Chat external script
Chat external highlight CSS
Chat application CSS
To-Do application CSS
```

---

# 19. R-15 — Standalone ChatUI rollback path is no longer truly standalone

**Severity:** P1/P2  
**Confidence:** CONFIRMED  
**Area:** rollback / local server / old deployment

## The problem

`ChatUI/index.html` now imports:

```js
./js/module.js
```

But `ChatUI/js/module.js` imports shared root utilities:

```js
../../shell/js/lifecycle-scope.js
../../shell/js/dependency-loader.js
```

The old standalone ChatUI build script still copies only:

```text
index.html
css/
html/
js/
```

It does not copy `/shell`.

Therefore a standalone ChatUI deployment built from `ChatUI/scripts/build-static.mjs` does not contain dependencies that the new Chat module imports.

## Local standalone server problem

`ChatUI/start-server.bat` still uses a plain:

```text
python -m http.server 8000
```

The new standalone base path is `/ChatUI` and conversation routes can be:

```text
/ChatUI/chat/<id>
```

A plain static server will treat that deep route as a physical path and cannot provide SPA fallback on direct refresh.

## Why this matters

The integration plan intentionally retained old standalone paths as a rollback/safety mechanism until the combined deployment was verified.

A rollback path that looks present but cannot actually load is dangerous.

## Best repair direction

Choose one explicit policy.

### Option A — Preserve a real standalone ChatUI harness

Then its complete runtime dependencies must be part of that standalone deployment/server layout.

The server must support deep-route fallback for:

```text
/ChatUI
/ChatUI/chat/<id>
```

and the standalone build must include every imported runtime file at the expected URL.

### Option B — Explicitly retire standalone deployment

Only do this after combined deployment and rollback strategy have been approved and verified.

Then remove/rename obsolete standalone build/server files so nobody mistakenly relies on them.

Do not leave a known-broken rollback entrypoint presented as working.

## Verification

If standalone remains supported:

```text
open ChatUI standalone home
create/open chat
refresh deep chat URL
Back/Forward
Settings
attachments
Voice
Read Aloud
Workspace
```

and verify the built standalone output, not only repository-source mode.

---

# 20. R-16 — To-Do DOM extraction was not actually completed

**Severity:** P2  
**Confidence:** CONFIRMED  
**Area:** To-Do module boundary / maintainability

## The problem

`TodoList-ui/html/todo-app.html` currently contains only:

```html
<div id="app" class="todo-app" data-todo-module-root></div>
```

The combined To-Do module then fetches **both**:

```text
todo-app.html
TodoList-ui/index.html
```

It parses the old standalone index with `DOMParser`, finds `#app`, clones its children into the new root, and removes old rail/mobile-nav markup.

So the effective architecture is:

```text
combined To-Do mount
  -> download old standalone HTML document
  -> parse full document
  -> find #app
  -> clone application children
  -> strip old shared launcher
  -> mount result
```

This is a migration shim, not the intended reusable fragment architecture.

## Why this matters

```text
combined app stays coupled to old standalone document structure
extra request/parsing work on mount
future edits can accidentally update index.html but not intended module boundary
standalone and combined startup remain separate systems
harder lifecycle reasoning
harder testing
```

`TodoList-ui/js/bootstrap.js` still starts `app-main.js` directly rather than using the same module entry as the combined application.

## Best repair direction

Make `todo-app.html` the actual reusable To-Do application fragment.

It should contain the To-Do-owned DOM that currently lives inside standalone `#app`, excluding only the cross-application rail/mobile launcher.

Then:

```text
combined module -> load todo-app.html -> initialize
standalone index -> host + import same Todo module
```

Do not maintain two different To-Do bootstraps once the module lifecycle is stable.

## Important sequencing

Do this **after** critical lifecycle/portal bugs are understood, not as a blind large markup move mixed into every other repair.

## Verification

Diff the actual rendered To-Do DOM before/after extraction and manually test the full To-Do regression matrix.

---

# 21. R-17 — `/chat-ui` has non-deterministic home behavior

**Severity:** P2  
**Confidence:** CONFIRMED  
**Area:** Chat routing

## The problem

The shell router defines:

```text
/chat-ui = Chat home
```

but Chat startup contains behavior that, when `startup === true`, can restore `state.activeChatId` and replace the route with the previously active conversation.

Therefore explicitly visiting:

```text
/chat-ui
```

can turn into:

```text
/chat-ui/chat/<previous-chat-id>
```

## Why this is confusing

The shell already has a separate feature for remembering the last Chat route for the AI launcher.

Those are two different concepts:

```text
canonical Chat home URL
last Chat route remembered by launcher
```

If both try to restore the previous chat, URL semantics become less predictable.

## Best repair direction

Recommended policy:

```text
/chat-ui
    = Chat home/new chat

/chat-ui/chat/<id>
    = exact conversation

shell Chat/AI launcher while user is in To-Do
    = remembered last Chat route if desired
```

This keeps direct URL meaning deterministic while preserving the useful remembered-route launcher.

## Verification

```text
open deep chat
switch to To-Do
manually type /chat-ui
verify Chat home opens
switch to To-Do
click remembered Chat launcher
verify last deep chat opens if that is desired policy
```

---

# 22. R-18 — Shell appearance does not update immediately when module theme/accent changes

**Severity:** P2  
**Confidence:** CONFIRMED  
**Area:** shell appearance bridge

## The problem

The shell supports:

```text
module -> notifyAppearance({ theme, accent }) -> shell CSS variables
```

and calls module `getAppearance()` during mount/route handling.

However, Chat theme/accent setters primarily update `.chatui-app`, and To-Do ThemeManager primarily updates `.todo-app`.

They do not consistently notify the shell immediately when the user changes appearance inside Settings.

## Visible result

Example:

```text
Chat + shell are dark
user changes Chat to light
Chat becomes light immediately
shared shell rail can remain dark until another route/mount update
```

The same can happen with accent color.

## Additional accent detail

The shell updates:

```text
--shell-accent
```

but its soft active background variable:

```text
--shell-accent-soft
```

is not recalculated from a changed accent.

So an active green/purple Chat accent can still sit on a blue soft background.

## Best repair direction

Do not let modules write shell variables directly.

Instead, module Settings should call an application-owned callback that ultimately invokes:

```js
shell.notifyAppearance({
  theme,
  accent
});
```

The shell should own mapping accent/theme to all shell variables, including soft accent.

For To-Do:

```text
ThemeManager change
 -> module appearance callback
 -> shell notifyAppearance
```

For Chat:

```text
applyTheme/applyAccentColor
 -> module appearance callback
 -> shell notifyAppearance
```

Standalone mode can provide a no-op appearance callback.

## Verification

While remaining on the same route, change:

```text
Chat dark/light
Chat accent blue/green/purple
To-Do dark/light
```

Shared desktop rail and mobile nav should update immediately and consistently.

---

# 23. R-19 — Document title ownership remains split

**Severity:** P2  
**Confidence:** CONFIRMED  
**Area:** shell / Chat routing / Workspace

## The problem

The integration introduced a shell title adapter, but Chat internals still write `document.title` directly.

Examples include conversation navigation and Workspace:

```js
document.title = ...
```

Workspace sets:

```text
Workspace — ChatUI
```

while shell also exposes:

```text
shell.setTitle()
```

## Why this matters

Two owners can race or leave stale titles during:

```text
Workspace -> app switch
Chat deep route -> Back/Forward
startup failure
switch to To-Do
return from Workspace
```

It also makes standalone/combined behavior harder to reason about.

## Best repair direction

Keep one Chat title abstraction:

```text
setChatDocumentTitle(title)
```

which uses shell title adapter in combined mode and `document.title` only in standalone mode.

All Chat/Workspace title updates should go through that bridge.

When Workspace closes, restore the title for the active chat/home route explicitly.

To-Do should continue using shell title through the module boundary.

---

# 24. R-20 — Weak recovery if target application fails after old application already left

**Severity:** P2  
**Confidence:** CONFIRMED behavior / robustness issue  
**Area:** shell switching

## The problem

Cross-app switch does:

```text
prepareDeactivate old app
beforeLeave old app
unmount old app
write target history
mount target app
```

If target mount fails after the old app has already unmounted, shell shows an error/status but can leave the module host empty with no active application.

Combined with rejected dependency caches or stale singleton state, a simple click retry may not work.

## Best repair direction

Define explicit post-leave mount failure behavior.

Recommended:

```text
1. show failure with Retry and Return buttons
2. clear target module/dependency failed caches that are safe to retry
3. Retry attempts target cleanly
4. Return performs safe hard navigation to previous canonical route
```

If state is uncertain, prefer full hard navigation rather than layering another soft mount over failed partial state.

Do not automatically remount the previous application in the same damaged lifecycle unless cleanup state is known safe.

## Verification

Simulate target module/style failure after leaving the old app and verify the user can recover without manually editing URL/devtools.

---

# 25. R-21 — Local LAN source server can expose repository files

**Severity:** P1/P2  
**Confidence:** CONFIRMED  
**Area:** local development security/privacy

## The problem

`server.py` defaults to:

```text
host = 0.0.0.0
root = .
```

It uses `SimpleHTTPRequestHandler` and serves any existing file under the selected root normally.

When run from repository root for phone/LAN testing, this means other devices that can reach the server can request non-runtime repository files if they know the path.

Potential examples:

```text
implementation plans
agent review documents
handoff notes
source-control files
backup files accidentally placed in repo
other internal documentation
```

The production build correctly avoids this by using an allow-list. The source-mode LAN server does not have the same boundary.

## Best repair direction

Preferred workflow:

```text
node scripts/build-static.mjs
python server.py --root dist
```

Make serving `dist/` the default/safe LAN path.

If source serving is still useful for development, either:

```text
bind source mode to 127.0.0.1 by default
```

or implement a strict runtime allow-list for source mode.

Do not use a weak deny-list as the primary protection because new internal files can be added later.

## Verification

From another LAN device:

```text
runtime routes/assets work
internal planning paths return 404
.git paths return 404
backup/internal notes cannot be fetched
```

---

# 26. R-22 — Current CI does not test the dangerous integration behavior

**Severity:** P1 process gap  
**Confidence:** CONFIRMED  
**Area:** verification

## The problem

The current GitHub Actions workflow successfully checks useful things:

```text
JavaScript syntax
basic route parser behavior
source architecture string assertions
allow-list build
built-output presence
Python syntax
HTTP deep-link fallback with curl
```

This is good, but it does **not** test the failures found in this review.

It does not prove:

```text
To-Do -> Chat -> To-Do remount
Repeat Ends on second mount
20 repeated switches
body portal cleanup
CSS variables on dragged nodes
browser Back/Forward cancellation
attachment drag state
Voice cleanup
Workspace delayed timers
generation abort settlement
startup failure -> retry
light/dark portal styling
real IndexedDB behavior
mobile keyboard / visualViewport
focus after switching
```

## Why this matters

A green CI run currently gives stronger psychological confidence than the test actually provides.

The current merge has green CI and still contains source-derivable remount defects.

## Best repair direction

Keep existing static checks and add more targeted tests where pure testing is possible.

Good candidates for automated non-browser tests:

```text
route parsing/building
history entry state/index reducer
appearance mapping
portal ownership helper logic
dependency-cache failure/retry logic
lifecycle cleanup registries
```

Also add source/static assertions that directly protect critical integration invariants, for example:

```text
no known To-Do body portal without owner marker
no app-specific generic body root ownership
failed load cache is removed
To-Do failed-mount cleanup clears bridges
```

But do **not** replace the required manual browser/phone regression matrix with synthetic static checks.

## Manual acceptance gate

Before declaring complete, perform at least:

```text
20+ To-Do <-> ChatUI switches in one document lifetime
```

Then verify:

```text
one click -> one action
one key -> one response
one task creation -> one task
one Chat send -> one generation
one popstate -> one route reaction
no inactive Chat drop handler behavior
no inactive To-Do drag behavior
no stale portal DOM
no stale body class
no microphone/read-aloud after Chat leave
no stale drag layer after To-Do leave
no CSS/theme bleed
only one active application root
```

---

# 27. R-23 — Cross-application focus handoff is not explicit

**Severity:** P2  
**Confidence:** HIGH CONFIDENCE accessibility risk  
**Area:** shell focus lifecycle

## The problem

When switching applications, the old root can be removed while focus was inside that root.

Some component close methods try to restore focus before unmount, but there is no single shell rule that says:

```text
after successful application switch, focus goes to a valid target
```

For browser Back/Forward, focus may have been in application content that disappears.

When a focused node is removed, browsers usually fall back to body/document behavior, which is not a good keyboard-navigation experience.

## Best repair direction

Add explicit focus policy in shell transition.

Recommended:

```text
If switch came from shell app link:
    keep/restore focus on that active shell link when appropriate,
    or move into new app heading only if UX intentionally requires it.

If switch came from popstate/route:
    focus a stable new-app landmark/header/main region with tabindex=-1.

Before removing old root:
    ensure focus is not left trapped inside an aria-hidden/inert/detached modal.
```

Do not create aggressive focus jumps on every same-app Chat route; this is mainly a cross-application lifecycle concern.

## Verification

Keyboard-only:

```text
Tab to Chat launcher -> Enter
Tab through Chat
switch to To-Do
Back/Forward
open/close modal then switch
```

At no point should keyboard focus disappear into removed DOM.

---

# 28. R-24 — Origin/data migration remains a mandatory manual cutover step

**Severity:** P1 operational  
**Confidence:** CONFIRMED by browser storage model / integration design  
**Area:** user data migration

## This is not a code regression, but it can look like data loss

The old development origins were different:

```text
To-Do:  http://localhost:6846
ChatUI: http://localhost:8000
```

Browser storage is origin-scoped.

Therefore:

```text
TodoListDB at localhost:6846
```

will not automatically appear at:

```text
localhost:8000
```

or at a new production hostname.

The integration plan correctly chose **not** to build a cross-origin browser-storage hack.

## The risk

A technically correct combined app can be opened and appear to have no old To-Do data.

A user can mistake this for deletion and start creating new data on the new origin before migration is verified.

## Required cutover process

Before normal use moves to the new combined origin:

```text
1. Create/verify old To-Do backup.
2. Create/verify old Chat backup.
3. Record expected counts.
4. Open combined To-Do.
5. Restore To-Do if the origin changed.
6. Refresh and verify tasks/projects/tags/settings.
7. Open combined Chat.
8. Restore Chat only if required for that origin.
9. Verify chats/messages/attachments/Workspace/settings.
10. Create fresh backups from the combined origin.
11. Keep old origin/deployment/backups during stabilization.
```

Do not delete old browser data automatically.

---

# 29. Additional cross-cutting lifecycle observations

These are not separate root issues, but the repair agent must keep them in mind while addressing the findings above.

## A. `window.*` compatibility bridges must be mount-owned

Current To-Do temporary bridges include:

```text
window.TasksComponent
window.SidebarComponent
window.WorkspaceControls
window.ScheduleComponent
window.SubtaskEditorComponent
```

Successful unmount clears them conditionally, which is good.

Failed mount must clear them too.

No shell code should start depending on them.

## B. Body classes need owner cleanup

To-Do uses body classes such as:

```text
task-drag-active
sidebar-taxonomy-drag-active
modal-open
```

If any body-level state remains necessary, it must always be cleared on:

```text
normal close
cancel
approved app switch
failed startup cleanup
unmount
```

## C. A component being hidden is not the same as being destroyed

Examples:

```text
closeWorkspaceView()
closeVoiceMode()
closeActionMenu()
```

may be session-level close operations.

True app unmount additionally needs subsystem destroy/reset behavior.

## D. Module-level singleton state must distinguish logical state from DOM state

Safe to retain when intentional:

```text
selected settings
loaded data state
cached immutable configuration
```

Dangerous to retain across destroyed root:

```text
DOM node reference
old modal reference
old button reference
old overlay reference
old timer ID
old focus target
old AbortController
old event handler bound to old DOM
```

---

# 30. What was implemented well and should be preserved

The repair agent should not accidentally destroy the parts that are already good.

## A. Root shell/module direction

The root shell is the correct integration boundary.

The shell module registry imports only the application module entries rather than reaching directly into To-Do state/services or Chat voice/storage internals.

Keep this separation.

## B. Route model

The canonical route family is sensible:

```text
/todo-list-ui
/chat-ui
/chat-ui/chat/<id>
```

Legacy Chat route canonicalization is also useful.

Do not replace this with hash routing unless there is a separate reason.

## C. Database separation

The implementation correctly keeps:

```text
TodoListDB
ChatUI_DB
```

separate and at their existing versions.

Do not merge them to simplify the shell.

## D. Production allow-list build

`scripts/build-static.mjs` explicitly selects runtime files instead of copying the entire repository.

Keep that architecture.

## E. Root SPA server and Cloudflare fallback concept

The root local server understands canonical extensionless routes and the root Wrangler config uses SPA not-found handling.

That is the correct direction for deep-link refresh.

## F. To-Do waits for its own data queue

The To-Do module correctly calls its own persistence idle mechanism before leaving.

Keep app-specific persistence knowledge inside the application rather than teaching the shell about AppDataService.

## G. Chat actively stops important media surfaces

The Chat leave path explicitly attempts to stop:

```text
generation
normal recording
Live Voice
Read Aloud
Workspace/transient UI
```

That is the correct ownership direction. The repair is to make it fully settled/destroyable, not to remove those steps.

---

# 31. Recommended repair sequence

Do not fix these in random order.

## Phase A — Immediate correctness

### A1. Repair To-Do portal ownership + Repeat Ends

Fix together:

```text
R-02 body portal theme context
R-03 body portal cleanup
R-04 Repeat Ends remount
```

Why together: they are the same root problem — DOM that lives outside or longer than the current To-Do mount.

### A2. Repair browser history cancellation

Fix R-05 before relying on unsaved/generation switch confirmations.

### A3. Repair failure retry caches

Fix:

```text
R-12 To-Do failed startup cleanup
R-13 Chat failed startup cleanup
R-14 dependency rejected Promise cache
```

After these, a temporary failure should not require mysterious full-page recovery.

---

## Phase B — Real lifecycle ownership

### B1. Chat active-work settlement

Fix:

```text
R-10 generation idle barrier
R-11 attachment cleanup
R-08 Workspace cleanup
R-09 Voice late cleanup
```

### B2. Reduce/remove lifecycle monkey-patch dependency

Fix R-07 by adding explicit component destroy/AbortController ownership.

### B3. Decide dormant Chat versus true unmount

Then address R-06.

Preferred final state is true unmount/remount. If that cannot be guaranteed yet, temporarily retain hard-navigation cross-app switching.

---

## Phase C — Boundary cleanup

Fix:

```text
R-01 full CSS scoping
R-16 real To-Do fragment/module extraction
R-17 deterministic Chat home route
R-18 appearance bridge
R-19 title ownership
R-23 focus handoff
```

Do not mix these cosmetic/structural edits into a giant patch with lifecycle fixes unless necessary.

---

## Phase D — deployment and verification

Fix/verify:

```text
R-15 standalone rollback decision
R-20 target mount failure UX
R-21 safe LAN server
R-22 stronger test coverage
R-24 origin/data cutover
```

---

# 32. Mandatory manual regression matrix after repairs

Do not mark the integration complete without this pass.

## Shared shell/routes

```text
/ -> /todo-list-ui canonicalization
/todo-list-ui
/chat-ui
/chat-ui/chat/<existing-id>
missing/deleted chat deep link
legacy /chat and /chat/<id>
Back
Forward
Back/Forward cancellation with Stay
unknown route fallback
shared Settings delegation
remembered Chat launcher
```

## Repeated switching

Perform at least:

```text
20+ To-Do <-> ChatUI switches in one document lifetime
```

After the 20 switches verify:

```text
one click -> one action
one key event -> one response
one task creation -> one task
one Chat send -> one generation
no duplicate menus
no duplicate modal handlers
no stale body portal
no detached focus trap
no microphone
no Read Aloud
no To-Do drag layer
no attachment overlay
no CSS theme bleed
```

## To-Do

```text
Inbox/Today/Completed
create/edit/delete task
complete/uncomplete
subtasks
link/unlink hierarchy
projects/sub-projects
tags/sub-tags
taxonomy order
project/tag deletion repair
List
Kanban
sort/group/custom order
pointer Task drag
touch Task drag
root/subtask hierarchy drag
Project/Tag pointer drag
Project/Tag touch drag
quick task
full Task editor
priority
Project picker hierarchy
Tag picker
Date/Time
reminders/custom reminders
repeat presets
custom repeat
Repeat Ends Never/Date/Count
next occurrence generation
Settings/theme
backup/restore
mobile sidebar/FAB
keyboard/visualViewport behavior
focus traps/Escape
hard-refresh persistence
```

### Special To-Do integration checks

```text
Repeat Ends after every remount
Task drag floating style in light and dark
Project/Tag drag floating style in light and dark
parent picker style in light and dark
no To-Do portal left while Chat is active
```

## ChatUI

```text
Chat home/new chat
open existing chat
lazy conversation load
search
pinned chats
projects
rename/move/delete chat
streaming send
stop generation
regenerate
edit/delete message
HIGH thinking
thought/model response metadata
Google Search
URL Context
Code Execution
Workspace custom-function rounds
Workspace manual UI
attachments picker
attachments drag/drop
Gemini Files API first upload
Gemini file URI reuse
local Blob durability
after-refresh attachment reuse
image/audio/video/text/PDF attachments
right sidebar
left sidebar desktop/mobile
Settings/API config
theme/accent
backup creation/restore
normal recording
Live Voice
Read Aloud cached/live
selected-text Read Aloud
mobile composer/safe area
modal focus/Escape
```

### Special Chat integration checks

```text
start generation -> switch -> approve -> return -> interrupted message persisted exactly once
start recording -> switch -> Stay
start recording -> switch -> approve
start Voice -> switch -> verify mic/audio completely stop
start Read Aloud -> switch -> verify playback completely stops
start Workspace search debounce -> immediately switch
start Workspace page repagination -> immediately switch
drag attachment -> switch before drop -> return -> drag again
```

## Mobile

Real phone verification is required for:

```text
shared bottom navigation
To-Do secondary sidebar
To-Do FAB
To-Do keyboard/visualViewport Date transition
Schedule
Chat mobile drawer
Chat composer keyboard
attachment picker/drop where applicable
Voice Mode
Read Aloud
Settings
safe areas
orientation/resize
pinch zoom
```

---

# 33. Static checks to add after the fixes

Static checks should make recurrence harder.

Useful checks:

```text
one root popstate owner in combined mode
shell imports module entry points only
TodoListDB name/version unchanged
ChatUI_DB name/version unchanged
no cross-database import
no integration-only schema bump
known body portals have explicit module ownership
body portal registry is empty after destroy in pure lifecycle tests
failed dependency load clears its Promise cache
failed To-Do mount clears window bridges
component destroy resets initialized flag
build excludes planning/review/agent directories
standalone deployment includes every import if standalone is still supported
```

Do not write a meaningless source check such as only searching for the text `destroy()` and assuming cleanup is correct. Test state transitions where possible.

---

# 34. Definition of done for the repair agent

The repair should not be considered finished until all relevant items are true:

```text
[ ] To-Do ordinary CSS is scoped to .todo-app
[ ] Chat ordinary CSS is scoped to .chatui-app
[ ] shell styling is unaffected by active application CSS
[ ] body-level portals have explicit application ownership
[ ] To-Do body portals inherit correct theme
[ ] no To-Do body portal remains after unmount
[ ] Repeat Ends survives repeated To-Do remounts
[ ] browser Back/Forward Stay does not mutate/destroy history entries
[ ] Chat generation fully settles before old Chat runtime is considered left
[ ] Workspace delayed work is canceled on destroy
[ ] Voice late listeners/RAF are destroyed
[ ] attachment drag overlay lives in correct ownership boundary
[ ] attachment drag depth/listeners reset correctly
[ ] failed To-Do startup can retry in same page
[ ] failed Chat startup can retry in same page
[ ] rejected dependency loads can retry without full reload
[ ] window.* To-Do bridges never survive a failed/unmounted To-Do instance
[ ] target mount failure has an explicit safe recovery path
[ ] standalone Chat is either truly supported or explicitly retired
[ ] To-Do reusable fragment/module boundary is completed
[ ] /chat-ui behavior is deterministic
[ ] live theme/accent changes update shell immediately
[ ] document title has one clear ownership bridge
[ ] cross-app focus remains valid
[ ] LAN runtime serving does not expose internal repository files
[ ] old-origin data migration/backups have been verified
[ ] 20+ seamless switches pass
[ ] real phone checks pass
[ ] production allow-list build still excludes this review and other internal docs
```

---

# 35. Final recommendation

Do **not** throw away the current integration.

The root shell, independent databases, canonical routes, allow-list deployment, and module-entry boundaries are useful and should be preserved.

The main mistake was enabling a seamless single-page lifecycle before every old document-level assumption had been converted into explicit module ownership.

The safest repair philosophy is:

```text
DOM belongs to one module root or an explicitly owned portal
listeners/timers/media belong to a destroyable subsystem
history belongs to the shell
application data belongs to its original database/service
shell never reaches into application internals
old app must be quiet before new app becomes active
```

If a seamless switch cannot guarantee those rules at any intermediate stage, use the existing hard-navigation fallback until the lifecycle is safe.

That is much safer than hiding a half-alive old runtime behind the newly mounted application.
