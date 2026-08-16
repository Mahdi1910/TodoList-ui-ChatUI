# Review Implementation Plan ID by BRAVE

Reviewer: Jack

Reviewed plan: `implementation plan/Implementation Plan ID 1.md`

Review target: persistent same-origin iframe integration for `TodoList-ui` + `ChatUI`.

Status: Review only. No application code should be changed from this document alone.

---

## 1. Short verdict

The iframe direction is a good idea for the user's real requirement:

> one browser tab, one shared rail/sidebar, switch between To-Do and ChatUI, and keep ChatUI alive while it is generating.

The plan is better than the earlier mount/unmount micro-frontend approach for this requirement because it keeps each old standalone application inside its own browser document. That avoids many of the hardest problems we found earlier: CSS collisions, duplicate IDs, body-level overlays, stale module singletons, and incomplete lifecycle cleanup.

However, the plan is not ready to implement without adding more detail. The biggest missing areas are:

1. exact server/deployment routing rules;
2. browser Back/Forward behavior with iframe history;
3. focus and accessibility when hiding iframes;
4. hidden iframe throttling and generation tests;
5. ChatUI path portability details;
6. future ChatUI → To-Do tool bridge safety;
7. origin/data migration instructions;
8. mobile/iOS iframe behavior;
9. child-frame load failure and retry handling;
10. CI/manual test matrix strong enough for this architecture.

My recommendation: keep the iframe architecture, but upgrade the plan before implementation.

---

## 2. Evidence from the current repository

The current repository is still a container for two standalone apps plus planning docs:

```text
TodoList-ui-ChatUI/
├── ChatUI/
├── TodoList-ui/
└── implementation plan/
```

There is not yet a root shell at `/index.html`, and no `/shell/` folder exists yet.

### ChatUI is currently root-path dependent

`ChatUI/index.html` still loads assets using root-absolute paths:

```html
<link rel="stylesheet" href="/css/main.css" />
<link rel="stylesheet" href="/css/sidebar.css" />
...
<script type="module" src="/js/layout-loader.js"></script>
```

`ChatUI/js/layout-loader.js` also loads fragments from root-absolute paths:

```js
loadFragment('/html/left-sidebar.html')
loadFragment('/html/main-chat.html')
loadFragment('/html/workspace.html')
...
```

So the plan is correct that ChatUI must become path-portable before it can safely run as `/ChatUI/index.html?embedded=1` inside the combined shell.

### TodoList-ui is more path-portable already

`TodoList-ui/index.html` mostly uses folder-relative paths such as:

```html
<link rel="stylesheet" href="css/variables.css">
<script type="module" src="js/bootstrap.js"></script>
```

But it still owns the narrow `primary-rail` inside its own standalone HTML. The plan is correct that this rail must become shell-owned in the combined iframe version, while remaining available in standalone mode.

### Databases are already separate

ChatUI uses:

```js
DB_NAME = 'ChatUI_DB'
```

TodoList-ui uses:

```js
NAME = 'TodoListDB'
```

The plan is correct: do not merge these databases.

---

## 3. What the plan does well

### 3.1 It solves the user's main requirement

The plan keeps two iframes alive:

```text
Todo iframe stays loaded
Chat iframe stays loaded
Only visibility changes
```

This means ChatUI can continue generating while the user works in To-Do. This is the strongest reason to choose iframe architecture.

### 3.2 It avoids the old lifecycle trap

The earlier mount/unmount approach required:

```text
mount()
unmount()
cleanup listeners
cleanup timers
cleanup body portals
cleanup voice/read-aloud/workspace
destroy/recreate DOM
```

That is dangerous because both applications were originally standalone pages, not reusable modules.

Iframe architecture avoids much of this because each application gets its own:

```text
DOM document
window object
CSS cascade
event listeners
timers
body overlays
IndexedDB access
```

This is better for the current codebase.

### 3.3 It uses the correct communication boundary

The plan says not to let ChatUI click To-Do DOM or manipulate To-Do HTML. That is correct.

The right direction is:

```text
ChatUI
→ postMessage / shared bridge
→ To-Do command/data layer
→ TodoListDB
→ notify To-Do UI
```

This is important for future ChatUI tools such as `create_task`, `create_project`, and `create_tag`.

### 3.4 It protects standalone mode

The plan says embedded behavior must be activated by `?embedded=1` and must not destroy standalone To-Do or standalone ChatUI. That is correct.

---

## 4. Problems and missing details to add to the plan

## Problem 1 — Server routing and static file rules are under-specified

### Why this is a real problem

The user-facing routes should be:

```text
/todo-list-ui
/chat-ui
/chat-ui/chat/<chatId>
```

But the actual iframe files are:

```text
/TodoList-ui/index.html?embedded=1
/ChatUI/index.html?embedded=1
```

Notice the difference:

```text
public route: /todo-list-ui       lowercase + hyphen
real folder:   /TodoList-ui       capital T + capital L

public route: /chat-ui            lowercase + hyphen
real folder:   /ChatUI            capital C
```

Local filesystems, Cloudflare, and server fallback rules can treat these differently. If the server is not configured carefully, a request for `/chat-ui/chat/abc` might incorrectly try to load a real file instead of returning the root shell.

### Case where it can fail

User opens:

```text
/chat-ui/chat/abc123
```

Expected:

```text
root shell loads
Chat iframe becomes visible
shell tells ChatUI to load chat abc123
```

Bad result if routing is wrong:

```text
404 Not Found
```

or:

```text
server tries to find /chat-ui/chat/abc123 as a real file
```

### Add to plan

Add a dedicated routing/deployment phase:

```text
Public app routes return /index.html:
/ → /index.html
/todo-list-ui → /index.html
/chat-ui → /index.html
/chat-ui/chat/* → /index.html

Static child app routes serve real files:
/TodoList-ui/* → files from TodoList-ui/
/ChatUI/* → files from ChatUI/
/shell/* → files from shell/
```

Also require a local dev server that supports this fallback. A plain `python -m http.server` will not handle deep-link fallback by itself.

---

## Problem 2 — ChatUI path portability needs stricter rules

### Why this is a real problem

Current ChatUI uses root-absolute URLs such as `/css/main.css` and `/html/main-chat.html`.

Inside the combined app, those paths point to the combined website root, not the `ChatUI/` folder.

### Case where it can fail

The iframe loads:

```text
/ChatUI/index.html?embedded=1
```

Then ChatUI requests:

```text
/css/main.css
/html/main-chat.html
```

But those files are actually at:

```text
/ChatUI/css/main.css
/ChatUI/html/main-chat.html
```

Result:

```text
ChatUI layout/CSS fails to load
```

### Add to plan

Add exact rules:

- change static links in `ChatUI/index.html` from `/css/...` to `./css/...`;
- change `/js/layout-loader.js` to `./js/layout-loader.js`;
- change layout fragment loads from `/html/...` to URLs resolved from `import.meta.url` or `new URL('../html/...', import.meta.url)` where practical;
- do not add a global `<base>` tag unless every link, dynamic import, fragment load, image, download, and router path is audited;
- verify standalone ChatUI still works after the change.

---

## Problem 3 — Parent history and iframe history can conflict

### Why this is a real problem

The plan says the parent shell owns public URLs. Good.

But ChatUI currently has its own router that calls `window.history.pushState()` with paths like:

```text
/
/chat/<chatId>
```

Inside an iframe, `window.history` belongs to the iframe document, not the parent shell. That means there can be two histories:

```text
parent history: /chat-ui/chat/123
iframe history: /chat/123
```

Browser Back/Forward behavior can become confusing, especially if focus is inside the iframe.

### Case where it can fail

User opens ChatUI, enters chat A, then chat B.

If ChatUI writes iframe history and the shell also writes parent history, Back may first navigate iframe history instead of the parent route, or parent/child routes may become unsynchronized.

### Add to plan

Add a strict embedded-router rule:

In embedded mode, ChatUI must not create public route entries inside iframe history as the source of truth.

Use one of these policies:

1. ChatUI embedded mode uses parent route only and writes no iframe history entries; or
2. ChatUI may replace iframe history for internal consistency, but every user-visible route change is sent to the parent shell and parent history remains canonical.

Add message-loop protection:

```text
Chat user click → child sends route-change → parent pushState → parent sends ack
Browser popstate → parent sends navigate-chat → child loads chat without route-change echo
```

Use `source: 'user' | 'popstate' | 'startup' | 'shell'` flags or a reentrancy guard.

---

## Problem 4 — Hidden iframe focus handling needs more detail

### Why this is a real problem

The plan says set `aria-hidden=true` on inactive panels and move focus before hiding. That is good but not complete.

An iframe is a focusable browsing context. If focus is inside ChatUI and the user clicks To-Do, the shell must not leave keyboard focus inside a hidden iframe.

### Case where it can fail

User is typing in ChatUI composer.

They press a keyboard shortcut or use the rail to switch to To-Do.

The Chat iframe becomes visually hidden, but focus remains inside the hidden frame. Keyboard input may go to the hidden ChatUI instead of To-Do or the shell.

### Add to plan

Require this exact sequence when switching apps:

```text
1. Detect whether activeElement is the old iframe or inside the old iframe.
2. Move focus to the selected rail button or the new iframe container.
3. Mark old panel inactive.
4. Set inert/aria-hidden on old panel if supported safely.
5. Show new panel.
6. Optionally focus the new iframe only after it is visible.
```

Also add tests with:

- Chat composer focused → switch To-Do;
- To-Do title input focused → switch Chat;
- keyboard-only rail navigation;
- screen-reader labels for active app.

---

## Problem 5 — Hidden iframe behavior can still be throttled by the browser

### Why this is a real problem

Keeping the iframe in the DOM usually keeps fetch/streaming alive, but browsers can throttle hidden frame work, timers, rendering, audio/video, and background tasks.

The plan says avoid `display:none` and `content-visibility:hidden`. Good. But more must be tested.

### Case where it can fail

ChatUI is streaming a long answer.

User switches to To-Do. The Chat iframe is hidden with opacity and pointer-events.

Possible browser behavior:

```text
network stream continues but rendering pauses
or timers slow down
or request continues but UI does not update until visible
```

That may still be acceptable, but it must be verified.

### Add to plan

Add explicit browser tests:

- Chrome desktop;
- Brave desktop;
- Android Chrome/Brave if the user tests on phone;
- long streaming answer while hidden;
- tool-call/search answer while hidden;
- attachment-backed answer while hidden.

Acceptance should be:

```text
The request must not be aborted.
When the user returns to ChatUI, the final answer must be present and saved.
```

It is acceptable if visual token-by-token rendering catches up when shown, as long as the generation is not lost.

---

## Problem 6 — Media and voice behavior while hidden needs a product rule

### Why this is a real problem

Text generation should continue while hidden. But microphone, voice mode, read aloud, and audio playback have privacy/UX implications.

### Case where it can fail

User starts Voice Mode in ChatUI and switches to To-Do.

Questions:

```text
Should microphone keep listening?
Should audio keep playing?
Should the shell show a red mic indicator?
Should switching ask for confirmation?
Should voice stop automatically?
```

The plan begins to mention media privacy, but it needs a final rule before implementation.

### Add to plan

Add a clear media policy, for example:

```text
Text generation: continue while hidden.
Read Aloud audio: continue only if user explicitly started it; shell shows active audio indicator.
Voice/microphone mode: either stop/pause on app switch, or keep running only with visible shell mic indicator and a one-click stop control.
Recording: stop or confirm before switching away.
```

Do not leave this implicit.

---

## Problem 7 — Settings button delegation is under-specified

### Why this is a real problem

The shared rail has a Settings button, but each app has its own settings UI and storage.

### Case where it can fail

User is on To-Do and clicks Settings:

Expected:

```text
To-Do settings opens inside Todo iframe
```

User is on ChatUI and clicks Settings:

Expected:

```text
ChatUI settings opens inside Chat iframe
```

But if the child frame is not ready, or the bridge message is lost, the button may do nothing.

### Add to plan

Add:

- `shell:open-settings` message;
- child must reply with `app:settings-opened` or `app:error`;
- shell should show a small error if no response after timeout;
- disabled state until active child reports `app:ready`.

---

## Problem 8 — The future ChatUI → To-Do tool bridge needs stronger data rules

### Why this is a real problem

The plan correctly says future ChatUI tools should use a bridge, not DOM clicks.

But there are two possible implementations:

1. ChatUI sends command to Todo iframe, and Todo iframe uses its own `AppDataService`.
2. ChatUI imports/copies shared Todo service code and writes directly to `TodoListDB`.

Option 2 is dangerous if it duplicates Todo validation/normalization incorrectly.

### Case where it can fail

ChatUI tool creates a task by writing directly into `TodoListDB`, but forgets to add related rows such as tags, reminders, repeat rules, or sort order in the exact expected shape.

To-Do later opens and finds corrupted/partial data.

### Add to plan

For the first version, prefer:

```text
ChatUI → parent shell → Todo iframe → Todo AppDataService → TodoListDB
```

This keeps To-Do business logic as the owner.

Only later consider a shared `todo-service` module after it has been extracted from To-Do and tested independently.

Add command response structure:

```js
{
  requestId,
  type: 'todo:create-task',
  payload: {...}
}

{
  requestId,
  type: 'todo:result',
  ok: true,
  payload: { taskId }
}
```

Add validation and user-confirmation rules for destructive commands.

---

## Problem 9 — Data origin migration needs a practical user workflow

### Why this is a real problem

IndexedDB is origin-specific. If the user previously used:

```text
http://localhost:8000
http://localhost:5173
https://old-chat-domain.example
https://old-todo-domain.example
```

then moving both apps to a new combined domain does not automatically move old browser data.

The plan warns about this, but the implementation needs a specific workflow.

### Case where it can fail

User deploys combined app to a new Cloudflare URL and opens it.

The app shows empty To-Do and empty ChatUI, even though old data exists on the old origin.

User thinks data was deleted.

### Add to plan

Add a migration checklist:

1. Open old To-Do origin.
2. Export To-Do backup.
3. Open old ChatUI origin.
4. Export ChatUI backup.
5. Open new combined origin.
6. Import To-Do backup inside To-Do iframe.
7. Import ChatUI backup inside ChatUI iframe.
8. Verify counts/chats/tasks.

If backup UI inside iframe has download/upload issues, open standalone child page on the new origin and import there.

---

## Problem 10 — Mobile iframe behavior is a major risk and needs its own phase

### Why this is a real problem

Mobile browsers can be difficult with iframes:

- keyboard resizing;
- fixed-position modals;
- drag and drop;
- nested scrolling;
- viewport units;
- safe area insets;
- focus transfer between parent and iframe.

### Case where it can fail

On phone:

```text
open To-Do editor
keyboard appears
switch to ChatUI
switch back
editor/keyboard/viewport is half hidden
```

or:

```text
open Chat composer
switch To-Do
scroll inside To-Do sidebar
page/iframe scroll locks conflict
```

### Add to plan

Add a mobile iframe verification phase:

- To-Do new task modal with keyboard;
- To-Do Date/Schedule modal;
- To-Do context menus;
- To-Do drag/reorder if used on phone;
- Chat composer keyboard;
- Chat sidebar drawer;
- Chat attachment picker;
- Voice/Read Aloud overlays;
- switching while keyboard is open.

Do not mark integration complete until phone testing passes.

---

## Problem 11 — Shell load failure and retry handling is missing

### Why this is a real problem

Iframe loading can fail because of bad paths, CDN issues inside ChatUI, or local server fallback mistakes.

### Case where it can fail

Shell creates Chat iframe:

```text
/ChatUI/index.html?embedded=1
```

But ChatUI still requests `/css/main.css`, which 404s.

ChatUI may show its own startup error inside the frame, but the parent shell may still think Chat is ready or may show a blank panel.

### Add to plan

Add:

- parent iframe `load` timeout;
- child must send `app:ready`;
- if no `app:ready`, shell shows app-specific error;
- retry reloads only the failed iframe, not both apps;
- retry must not reload the other already-running app;
- if ChatUI fails while To-Do is active, show an unobtrusive badge/error on AI button.

---

## Problem 12 — Preload strategy needs to be deliberate

### Why this is a real problem

Loading both applications immediately gives instant switching, but it also starts two large JavaScript apps at once, two IndexedDB connections, many listeners, and possibly expensive startup work.

### Case where it can fail

On a weaker phone, opening the combined app loads To-Do and ChatUI at the same time. Startup feels slow or memory usage spikes.

### Add to plan

Choose one explicit policy:

Option A — eager load both:

```text
best switching speed
more startup cost
```

Option B — load active app first, then preload inactive app after idle:

```text
faster first screen
slightly slower first switch
```

Option C — load on first click and then keep alive:

```text
lowest startup cost
first switch slower
```

For this project I recommend:

```text
Load active route first.
Preload the other iframe after the active app sends app:ready or after requestIdleCallback/setTimeout.
Once loaded, keep both alive.
```

---

## Problem 13 — Accessibility for the root shell needs more detail

### Why this is a real problem

The parent shell will become the real application chrome. It needs proper labels and active-state semantics.

### Add to plan

Require:

- iframe `title` attributes;
- rail buttons are real `<button>` or `<a>` controls;
- active app uses `aria-current="page"` or `aria-pressed="true"` consistently;
- inactive app panel is not keyboard-focusable;
- keyboard shortcut or visible focus for app switching;
- screen-reader text says `To-Do` and `ChatUI`, not only icons;
- Settings button name changes depending on active app if needed, e.g. `Open To-Do settings`.

---

## Problem 14 — Shell styling should use prefixed variables only

### Why this is a real problem

Iframe isolates child CSS, but the parent shell still has its own CSS. Do not use generic names like `--bg-primary` in the shell because they are easy to confuse with child app variables and future non-iframe code.

### Add to plan

Use shell-prefixed variables:

```css
--shell-bg
--shell-surface
--shell-text
--shell-accent
--shell-border
```

Do not import ChatUI CSS or To-Do CSS into the shell.

---

## Problem 15 — Standalone harness support needs acceptance tests

### Why this is a real problem

The plan says standalone mode must survive. This is important for rollback.

### Add to plan

After changes, test:

```text
/TodoList-ui/index.html
/TodoList-ui/index.html?embedded=1
/ChatUI/index.html
/ChatUI/index.html?embedded=1
```

Expected:

- standalone To-Do shows its own rail;
- embedded To-Do hides internal rail;
- standalone ChatUI owns its normal `/` and `/chat/<id>` routes;
- embedded ChatUI reports route changes to parent and does not depend on root `/css` paths.

---

## Problem 16 — File drag/drop boundary needs explicit behavior

### Why this is a real problem

When ChatUI is visible, file drag/drop should work inside the Chat iframe.

When To-Do is visible, the hidden Chat iframe should not steal drag/drop events.

### Add to plan

Require tests:

- drag file into visible ChatUI;
- drag file over shell rail and then into ChatUI;
- drag file while To-Do is active;
- switch apps during a drag and ensure overlay does not stick.

Parent shell should not intercept file drops unless it intentionally forwards them to the active child.

---

## Problem 17 — Browser permission behavior must be checked

### Why this is a real problem

ChatUI may need microphone and clipboard permissions while inside an iframe. Same-origin helps, but iframe `allow` still matters.

### Add to plan

Current suggested iframe allow is good:

```html
allow="microphone; clipboard-read; clipboard-write; fullscreen"
```

But also test:

- microphone request from iframe;
- clipboard copy button inside ChatUI;
- file input attachment;
- downloads/export backups;
- opening external links.

If downloads/popups are needed, add them deliberately, not blindly.

---

## Problem 18 — Do not use sandbox initially, but document why

### Why this is a real problem

The plan correctly says not to use restrictive sandbox initially. But this should be defended clearly so another agent does not add `sandbox` casually.

### Add to plan

Document:

- both apps are trusted same-origin code;
- sandbox with `allow-scripts` but without `allow-same-origin` breaks IndexedDB/localStorage/origin behavior;
- sandbox with both `allow-scripts` and `allow-same-origin` gives weak isolation and creates complexity;
- revisit sandbox only if apps become untrusted or cross-origin.

---

## Problem 19 — CI must test more than HTTP status

### Why this is a real problem

A static HTTP check can say `/chat-ui` returns 200 even when iframe content fails internally.

### Add to plan

Add a real browser smoke test later. It does not have to be heavy, but it should check:

- parent route `/todo-list-ui` loads shell;
- Todo iframe sends `app:ready`;
- parent route `/chat-ui` loads shell;
- Chat iframe sends `app:ready`;
- parent route `/chat-ui/chat/test-id` sends `shell:navigate-chat`;
- switching does not change iframe `src`;
- if Chat frame is generating, switching to To-Do does not call abort.

If browser automation is forbidden for this project, add these as a manual checklist instead.

---

## Problem 20 — App title and favicon ownership should be decided

### Why this is a real problem

In iframe mode, child app `document.title` changes only the iframe document, not the parent browser tab title.

### Case where it can fail

ChatUI opens a chat named `Database Project`, but the browser tab still says `TodoList-ui + ChatUI` or `To-Do`.

### Add to plan

Use bridge messages:

```text
child → shell: app:title
```

Parent decides final title:

```text
To-Do — Mahdi Workspace
ChatUI — <chat title>
```

Similarly, decide whether the root favicon is fixed or changes by active app.

---

## Problem 21 — App settings and theme sync need policy

### Why this is a real problem

Each iframe has its own theme/settings. The root shell also has a rail that should not look disconnected.

### Add to plan

Each child should report appearance:

```text
app:appearance { theme, accentColor }
```

Parent shell can either:

1. keep its own fixed theme; or
2. follow the active child app theme.

Pick one. I recommend: shell follows active app theme where possible, but uses shell-prefixed CSS variables.

---

## Problem 22 — Notifications/reminders while hidden need testing

### Why this is a real problem

To-Do reminders/timers might fire while To-Do is hidden behind ChatUI. That may be desirable, but should be expected and tested.

### Add to plan

Test:

- To-Do reminder scheduled soon;
- switch to ChatUI;
- confirm reminder still fires or intentionally does not fire based on product decision;
- verify notification/alert appears in a way the user can understand even when To-Do is hidden.

---

## Problem 23 — Local development server should not expose private files

### Why this is a real problem

If the root dev server serves the entire repository, internal planning files and agent docs may be exposed on the local network.

### Add to plan

For LAN testing:

- serve only runtime files, or
- serve a generated `dist/` directory, or
- block internal folders such as `implementation plan/`, `to-do list agent/`, `chat UI agent/`, `.git/`, backups, and private notes.

---

## Problem 24 — Naming and casing should be consistent

### Why this is a real problem

The plan uses:

```text
/todo-list-ui
/chat-ui
/TodoList-ui/index.html
/ChatUI/index.html
```

This is fine if intentional, but it must be documented because casing mistakes cause 404s on many servers.

### Add to plan

Add a naming table:

```text
Public route: /todo-list-ui
Source folder: /TodoList-ui/
Iframe URL: /TodoList-ui/index.html?embedded=1

Public route: /chat-ui
Source folder: /ChatUI/
Iframe URL: /ChatUI/index.html?embedded=1
```

---

## 5. Recommended changes to the plan before implementation

Add these sections before coding:

1. Route/server fallback table.
2. ChatUI path portability exact patch plan.
3. Embedded mode acceptance tests for both apps.
4. Parent/child route protocol with reentrancy prevention.
5. Focus and accessibility switching sequence.
6. Media behavior policy while iframe is hidden.
7. Frame load failure and retry handling.
8. Preload strategy decision.
9. Future Todo tool command protocol.
10. Data origin migration checklist.
11. Mobile iframe test matrix.
12. CI/manual verification matrix.
13. Local dev server privacy rules.
14. Naming/casing table.

---

## 6. Suggested implementation order

I recommend this order:

### Phase A — Prepare child apps safely

1. Make ChatUI path-portable.
2. Add explicit `embedded=1` detection to both apps.
3. Hide To-Do internal rail only in embedded mode.
4. Add minimal child bridge messages: `app:ready`, `app:error`, `app:title`, `app:appearance`.
5. Keep standalone pages working.

### Phase B — Create root shell

1. Add root `/index.html`.
2. Add `/shell/css/shell.css`.
3. Add `/shell/js/router.js`.
4. Add `/shell/js/frame-manager.js`.
5. Add two persistent iframes.
6. Add shared rail buttons.

### Phase C — Routing bridge

1. Parent owns `/todo-list-ui`, `/chat-ui`, `/chat-ui/chat/<id>`.
2. ChatUI embedded mode sends route changes to parent.
3. Parent sends `shell:navigate-chat` to Chat iframe for deep links.
4. Add route-loop protection.

### Phase D — Settings/theme/title polish

1. Shell settings button delegates to active frame.
2. Children report title/theme/accent.
3. Shell updates active rail state and browser title.

### Phase E — Future To-Do tool bridge

1. Add command protocol but keep it disabled until tested.
2. Implement non-destructive commands first: list projects/tags/tasks.
3. Add create commands through To-Do `AppDataService`, not direct DB writes from ChatUI.
4. Add destructive commands only with confirmation policy.

---

## 7. Final rating

Current iframe plan quality: **8.5/10**.

The main idea is strong and better aligned with the user's requirement than the previous mount/unmount design.

It becomes **9.5/10** if the missing areas above are added before implementation.

The most important warning:

> Do not treat iframe integration as only a layout change. The hard parts are routing, focus, permissions, hidden-frame behavior, data origin migration, and future cross-app command safety.

If those are handled carefully, this iframe architecture is probably the best practical choice for this repository.
