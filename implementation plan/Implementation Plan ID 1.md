# Implementation Plan ID 1 — Persistent iFrame Integration for TodoList-ui + ChatUI

## Status

Plan only. Do not implement until reviewed/approved.

## Goal

Join the existing `TodoList-ui` and `ChatUI` applications into one browser-tab experience while keeping each application independent and alive.

The user must be able to:

- open one combined website;
- use one shared application rail/sidebar;
- click the To-Do icon and see TodoList-ui;
- click the AI icon and see ChatUI;
- switch instantly without reloading either application;
- keep ChatUI text generation running while TodoList-ui is visible;
- keep TodoList-ui state, open UI, timers, reminders, and in-memory state alive while ChatUI is visible;
- preserve the existing `TodoListDB` and `ChatUI_DB` databases separately;
- later allow ChatUI tools to create/edit Tasks, Projects, and Tags through an explicit bridge to TodoList-ui business logic.

This plan intentionally replaces the more complicated mount/unmount micro-frontend approach with **two persistent same-origin iframes**.

---

# 1. Current repository state

The current repository root contains two independent applications:

```text
TodoList-ui-ChatUI/
├── ChatUI/
│   ├── index.html
│   ├── css/
│   ├── html/
│   ├── js/
│   └── ...
└── TodoList-ui/
    ├── index.html
    ├── css/
    ├── js/
    └── ...
```

This is a good starting point for the iframe architecture because both applications are already real standalone documents.

### TodoList-ui

TodoList-ui already uses mostly folder-relative asset paths and boots through:

```text
TodoList-ui/index.html
→ TodoList-ui/js/bootstrap.js
→ TodoList-ui/js/app-main.js
```

Its current `index.html` also owns the narrow application rail containing:

- To-Do;
- AI placeholder;
- Habits placeholder;
- Diary placeholder;
- Settings.

That rail should stop being TodoList-ui-owned in the combined application and become **root-shell-owned**.

### ChatUI

ChatUI currently starts from:

```text
ChatUI/index.html
→ /js/layout-loader.js
→ /js/app.js
```

Its standalone page currently uses root-absolute paths such as:

```text
/css/main.css
/html/left-sidebar.html
/js/layout-loader.js
```

Those assumptions must be made portable before the application is loaded from `/ChatUI/index.html` inside the combined shell.

ChatUI also has its own conversation router using paths such as:

```text
/
/chat/<chatId>
```

That router must gain an **embedded mode** so it does not try to own the parent shell URL when running inside an iframe.

---

# 2. Target architecture

Final architecture:

```text
ONE BROWSER TAB

Root Shell Document
/index.html
│
├── Shared application rail
│   ├── To-Do button
│   ├── AI / ChatUI button
│   ├── Habits placeholder
│   ├── Diary placeholder
│   └── Settings button
│
└── Application viewport
    │
    ├── TodoList-ui iframe
    │   src="/TodoList-ui/index.html?embedded=1"
    │   ALWAYS ALIVE AFTER LOAD
    │
    └── ChatUI iframe
        src="/ChatUI/index.html?embedded=1"
        ALWAYS ALIVE AFTER LOAD
```

The shell switches which frame is visible. It must **never remove the iframe, replace its `src`, or reload it during ordinary application switching**.

Example:

```text
ChatUI visible
→ send message
→ Gemini begins streaming
→ click To-Do
→ ChatUI frame remains loaded and generation continues
→ Todo frame becomes visible
→ click AI again
→ same ChatUI DOM/runtime appears with the generated answer
```

The two child applications stay independent:

- separate HTML documents;
- separate CSS cascades;
- separate DOM IDs;
- separate global `window` objects;
- separate event listeners;
- separate timers;
- separate overlays;
- separate application state;
- separate IndexedDB databases.

This is the main reason to use iframes here.

---

# 3. Canonical top-level URLs

The **parent shell** owns the browser address bar.

Canonical routes:

```text
/                       → redirect/replace to /todo-list-ui
/todo-list-ui           → TodoList-ui visible
/chat-ui                → ChatUI visible, Chat home/current state
/chat-ui/chat/<chatId>  → ChatUI visible, requested conversation
```

The child iframe URLs remain implementation details:

```text
/TodoList-ui/index.html?embedded=1
/ChatUI/index.html?embedded=1
```

Do not expose iframe implementation URLs as the normal user-facing route.

---

# 4. Important architectural rules

## Rule 1 — Never mount both apps into the same DOM document

Do not copy Todo markup into the root shell.
Do not copy Chat markup into the root shell.
Do not load their CSS into the parent document.

Each application remains inside its own iframe document.

This avoids:

- duplicate IDs;
- global `body` collisions;
- `:root` variable collisions;
- fixed-overlay conflicts;
- query-selector collisions;
- drag layer collisions;
- modal ownership problems;
- lifecycle/unmount cleanup problems.

## Rule 2 — Frames persist

Once a frame is loaded successfully during a tab session:

- do not remove it;
- do not reset `src`;
- do not call `location.reload()` during ordinary switching;
- do not destroy its DOM;
- do not abort Chat generation merely because ChatUI becomes inactive.

## Rule 3 — Parent shell owns application navigation

The shared rail is not part of either iframe.

TodoList-ui must not own the AI launcher in embedded mode.
ChatUI must not create a second application rail.

## Rule 4 — Communicate through a bridge

Do not make ChatUI reach into TodoList-ui DOM.
Do not make the parent shell call random internals in child windows.

Use a small documented same-origin `postMessage` protocol.

## Rule 5 — Keep databases separate

Keep:

```text
TodoListDB
ChatUI_DB
```

Do not merge schemas.

Path changes do not change IndexedDB ownership when the origin is the same.

---

# 5. Phase 0 — Safety checkpoint and inventory

Before changing runtime code:

1. Record current `main` SHA.
2. Create an integration feature branch.
3. Confirm both standalone apps boot independently.
4. Confirm current TodoListDB data exists.
5. Confirm current ChatUI_DB data exists.
6. Export/create application backups if the user has important live data.
7. Do not alter either DB schema merely for iframe integration.

Important data warning:

If the user previously used TodoList-ui and ChatUI on **different origins/domains/ports**, their browser IndexedDB data is origin-specific. Moving both to one new combined origin will not automatically move old browser data.

Therefore deployment cutover must include backup/restore instructions where required.

---

# 6. Phase 1 — Create the root shell

Create root files such as:

```text
/index.html
/shell/css/shell.css
/shell/js/app-shell.js
/shell/js/router.js
/shell/js/frame-manager.js
/shell/js/frame-bridge.js
```

The root page must contain only shell-owned UI:

```html
<div class="shell">
  <aside class="app-rail">...</aside>
  <main class="app-stage">
    <section id="todo-frame-panel">...</section>
    <section id="chat-frame-panel">...</section>
  </main>
</div>
```

Create two iframe elements.

Recommended attributes:

```html
<iframe
  id="todo-frame"
  title="To-Do List"
  src="/TodoList-ui/index.html?embedded=1">
</iframe>

<iframe
  id="chat-frame"
  title="ChatUI"
  src="/ChatUI/index.html?embedded=1"
  allow="microphone; clipboard-read; clipboard-write; fullscreen">
</iframe>
```

Do not use a restrictive `sandbox` initially. These are trusted same-origin applications and ChatUI needs capabilities such as scripts, downloads, clipboard, microphone/voice and potentially popups. A sandbox with `allow-scripts` + `allow-same-origin` would add complexity without meaningful isolation for trusted same-origin code.

---

# 7. Phase 2 — Persistent frame visibility switching

Both frames must remain alive.

Do not switch with DOM removal.

Recommended panel model:

```text
active panel:
- opacity: 1
- pointer-events: auto
- z-index: 2
- aria-hidden=false

inactive panel:
- opacity: 0
- pointer-events: none
- z-index: 1
- aria-hidden=true
```

Avoid depending on `display: none` as the core mechanism because the product requirement is specifically to keep the inactive application continuously alive.

Do not use `content-visibility: hidden` for the inactive Chat frame because browser rendering suspension can interfere with the goal of keeping background behavior predictable.

Before marking a frame `aria-hidden`, move focus to the parent shell rail or the newly active frame so focus is never trapped inside hidden content.

### Required behavior

```text
Todo active
→ Chat frame still exists
→ Chat fetch/SSE continues
→ Chat timers/state remain alive

Chat active
→ Todo frame still exists
→ Todo in-memory state remains alive
→ open editor state can remain alive unless product policy says otherwise
```

---

# 8. Phase 3 — Move the application rail to the root shell

Use the existing TodoList-ui narrow rail visual design as the starting design, but create a new shell-owned version.

Parent rail buttons:

```text
To-Do → /todo-list-ui
AI    → /chat-ui
Habit → disabled/planned
Diary → disabled/planned
Settings → delegate to active application
```

The existing TodoList-ui `primary-rail` must be hidden/removed **only in embedded mode**.

Do not delete standalone functionality.

Recommended embedded-mode detection:

```js
const embedded = new URLSearchParams(location.search).get('embedded') === '1';
```

Then TodoList-ui can add a document/body class:

```text
embedded-app
```

and embedded CSS can hide its internal `.primary-rail` and reclaim that width.

Standalone `TodoList-ui/index.html` must continue showing its own rail when `embedded=1` is absent.

---

# 9. Phase 4 — Make ChatUI path-portable

This is required before iframe loading.

Current ChatUI root-absolute paths such as:

```text
/css/main.css
/html/main-chat.html
/js/layout-loader.js
```

would resolve against the combined website root rather than `/ChatUI/`.

Convert ChatUI application assets to app-relative URLs.

Examples:

```html
./css/main.css
./css/sidebar.css
./js/layout-loader.js
```

and in `layout-loader.js` use document-relative fragment URLs compatible with both modes:

```text
./html/left-sidebar.html
./html/main-chat.html
...
```

Verify two modes after this change:

```text
Combined:
/ChatUI/index.html?embedded=1

Standalone ChatUI deployment:
/index.html
```

Both must still resolve their own `css/`, `html/`, and `js/` directories correctly.

Do not break dynamic module-relative imports such as `import('./app.js')`.

---

# 10. Phase 5 — Add explicit embedded mode to both apps

Each child app should know whether it is running standalone or inside the combined shell.

Recommended shared concept:

```js
const isEmbedded = new URLSearchParams(location.search).get('embedded') === '1';
```

Do not infer embedded mode only from `window.self !== window.top`; explicit mode is easier to test and safer for future embeds.

### Todo embedded mode responsibilities

- hide internal primary app rail;
- preserve Todo sidebar/workspace normally;
- keep its own modals and drag layers inside its document;
- expose a small message bridge;
- report ready state;
- respond to `shell:open-settings`;
- later respond to Todo tool commands.

### Chat embedded mode responsibilities

- preserve Chat sidebar, chat workspace, overlays and normal Chat behavior;
- do not try to own the top-level browser pathname directly;
- report current chat/home route to the shell;
- accept route commands from shell;
- report ready state;
- respond to `shell:open-settings`;
- keep active text generation running when shell changes active app.

---

# 11. Phase 6 — Chat routing bridge

ChatUI currently has an internal router for:

```text
/
/chat/<chatId>
```

Do not allow embedded ChatUI to call `history.pushState('/chat/...')` against its iframe browsing context and treat that as the public route.

Create a dual-mode route adapter.

## Standalone mode

Keep existing behavior:

```text
/
/chat/<chatId>
```

## Embedded mode

The parent shell owns:

```text
/chat-ui
/chat-ui/chat/<chatId>
```

When ChatUI opens a chat:

```text
ChatUI
→ postMessage({ type: 'chatui:route-change', chatId })
→ shell validates message
→ shell history.pushState('/chat-ui/chat/<id>')
```

When ChatUI returns home:

```text
ChatUI
→ postMessage({ type: 'chatui:route-change', chatId: null })
→ shell history.pushState('/chat-ui')
```

When browser Back/Forward changes parent URL:

```text
shell popstate
→ parse route
→ ensure Chat frame visible
→ postMessage({ type: 'shell:navigate-chat', chatId })
→ ChatUI loads requested chat without creating another parent history entry
```

Avoid nested/duplicate history loops.

Message handlers must distinguish:

```text
user navigation → pushState
browser popstate → no new history write
startup/deep link → replace/no duplicate entry
```

---

# 12. Phase 7 — Shell router

Create a tiny framework-free top router.

Required parsing:

```text
/                     → todo
/todo-list-ui         → todo
/chat-ui              → chat home
/chat-ui/chat/<id>    → chat + requested ID
unknown route         → safe fallback to /todo-list-ui
```

On startup:

1. parse current parent route;
2. show matching frame;
3. load both frames or load active immediately and preload the other immediately after shell startup;
4. if route is a Chat deep link, send desired chat ID once ChatUI reports ready.

The router controls only application visibility and top-level public URL.

It does not own Todo filters, Todo project routes, Chat internal UI state, or either database.

---

# 13. Phase 8 — Define the frame bridge

Use `window.postMessage` even though the apps are same-origin. This keeps the boundary explicit and makes future refactoring safer than direct DOM/window poking.

Every receiver must validate:

```js
event.origin === window.location.origin
```

The parent should also validate `event.source` against the expected iframe `contentWindow`.

Define a small protocol.

### Child → shell

```text
app:ready
app:title
app:appearance
chatui:route-change
app:request-navigation
app:error
```

### Shell → child

```text
shell:active
shell:inactive
shell:open-settings
shell:navigate-chat
shell:request-appearance
```

Messages should be versionable, for example:

```js
{
  channel: 'mahdi-app-shell',
  version: 1,
  type: 'chatui:route-change',
  payload: {...}
}
```

Do not pass arbitrary executable functions or raw DOM nodes.

---

# 14. Phase 9 — Keep background Chat generation alive

This is a primary acceptance criterion.

Switching to TodoList-ui must **not call**:

- AbortController.abort() for active generation;
- Chat stop-generation methods;
- Chat module destroy/unmount;
- frame reload;
- iframe removal.

The Chat iframe remains loaded and keeps its request/stream active.

Manual test:

```text
1. Open ChatUI.
2. Send a prompt that generates for at least 20–30 seconds.
3. Wait until streaming starts.
4. Click To-Do.
5. Work inside Todo for several seconds.
6. Click AI.
7. Verify the same generation continued and answer state is intact.
```

Also test while ChatUI uses:

- normal text stream;
- Google Search/tool calls;
- Workspace tool;
- attachment-backed prompt.

### Media privacy policy

Text generation should continue while hidden.

For microphone/voice/audio features, use a conservative policy unless the user explicitly chooses otherwise:

- active voice recording should stop or require confirmation before hiding ChatUI;
- live microphone capture should not silently continue while the UI is hidden;
- Read Aloud may pause on app switch or continue according to a documented user setting.

Do not confuse “keep Chat generation alive” with “keep microphone recording invisibly.”

---

# 15. Phase 10 — Focus and accessibility

When switching apps:

1. focus the clicked shell rail button first;
2. mark previous frame panel inactive/non-interactive;
3. mark new frame panel active;
4. optionally focus the new iframe or allow the user’s next click to enter it.

Inactive frame:

```text
pointer-events: none
aria-hidden: true
```

Active frame:

```text
pointer-events: auto
aria-hidden: false
```

Do not leave browser keyboard focus inside a frame immediately before making it `aria-hidden`.

Rail buttons need:

- real `<button>` elements;
- `aria-current` or equivalent active state;
- accessible labels;
- keyboard activation;
- visible focus state.

---

# 16. Phase 11 — Shared Settings button

The root rail currently visually includes a Settings button concept.

The shell should delegate Settings to whichever application is active:

```text
Todo active
→ shell:open-settings → Todo iframe

Chat active
→ shell:open-settings → Chat iframe
```

Each app owns its own settings UI and data.

Do not create one giant shared settings modal during this integration.

Future shared settings can be extracted separately if needed.

---

# 17. Phase 12 — Theme/accent and title coordination

Iframe CSS is isolated, which is good, but the shared shell rail still needs an appearance.

Recommended first version:

- shell has its own neutral dark/light variables;
- active child reports theme/accent after startup and when changed;
- shell may mirror the active app’s appearance.

Example:

```text
Chat changes to light
→ ChatUI posts app:appearance
→ shell rail switches to light

Todo changes accent
→ Todo posts app:appearance
→ shell updates rail accent
```

Only the parent shell sets the **top document title**.

Children can send:

```text
app:title
```

The shell applies title only from the currently active frame.

An inactive Chat generation changing a chat title should not unexpectedly replace the visible To-Do document title.

---

# 18. Phase 13 — Preserve standalone applications

The iframe integration should not require destroying standalone modes.

Keep:

```text
ChatUI/index.html
TodoList-ui/index.html
```

working independently.

Todo standalone:

- keeps its original rail;
- starts normally;
- no parent bridge required.

Chat standalone:

- keeps `/chat/<id>` behavior;
- assets resolve correctly;
- no shell required.

Embedded behavior should activate only with `?embedded=1`.

This provides a simple rollback/debug path.

---

# 19. Phase 14 — Future ChatUI → Todo tools bridge foundation

Do **not** implement AI Todo tools as DOM automation.

Wrong design:

```text
ChatUI tool
→ reach inside Todo iframe
→ click + button
→ type in modal
```

Correct future design:

```text
ChatUI tool
→ todo command message
→ shell command broker
→ Todo iframe
→ Todo AppDataService
→ TodoListDB
→ AppState/render
→ response to ChatUI
```

Prepare the bridge so a future command can look like:

```js
{
  channel: 'mahdi-app-shell',
  version: 1,
  type: 'todo:command',
  requestId: '...',
  payload: {
    command: 'createTask',
    args: {...}
  }
}
```

TodoList-ui should execute through its **real owning data service**, not direct IndexedDB writes from ChatUI.

Future command categories may include:

```text
createTask
updateTask
completeTask
deleteTask
listTasks
createProject
updateProject
deleteProject
createTag
updateTag
deleteTag
```

The current iframe integration only needs the bridge foundation and message ownership rules; actual Gemini tool definitions are a later plan.

---

# 20. Phase 15 — Build and deployment

Create one root build pipeline for the combined application.

Expected runtime output:

```text
dist/
├── index.html
├── shell/
├── ChatUI/
│   ├── index.html
│   ├── css/
│   ├── html/
│   └── js/
└── TodoList-ui/
    ├── index.html
    ├── css/
    └── js/
```

The build must use an explicit allow-list.

Do not deploy:

- implementation plans;
- review documents;
- agent collaboration files;
- `.git` data;
- local scripts that are not runtime-required;
- secrets/config files not required by the browser.

Top-level SPA fallback must support:

```text
/todo-list-ui
/chat-ui
/chat-ui/chat/<id>
```

and return the **root shell `index.html`**.

At the same time, real iframe assets such as:

```text
/ChatUI/index.html
/ChatUI/css/main.css
/TodoList-ui/index.html
/TodoList-ui/js/bootstrap.js
```

must be served as actual files, not rewritten to the parent shell.

Update Cloudflare/Wrangler configuration accordingly.

---

# 21. Phase 16 — Local development server

Use one root server/origin for combined testing.

Do not run Todo and Chat on separate ports for the normal combined test because then IndexedDB, messaging and iframe origin behavior differ from production.

The combined dev server should:

- serve repository runtime files from one origin;
- SPA-fallback only public shell routes;
- serve `/ChatUI/*` and `/TodoList-ui/*` directly;
- use an allow-list or runtime build folder when exposed to LAN;
- not expose planning/review/internal files to other LAN devices.

Preferred local test shape:

```text
http://localhost:<port>/todo-list-ui
http://localhost:<port>/chat-ui
```

both served by the same process.

---

# 22. Browser history behavior

The parent shell owns Back/Forward.

Examples:

```text
/todo-list-ui
→ click AI
/chat-ui
→ open chat A
/chat-ui/chat/A
→ click To-Do
/todo-list-ui
```

Back should move through those parent routes predictably without reloading the iframes.

Do not let both child history and parent history create duplicate entries for one user action.

Chat embedded route writes must go through the parent bridge.

Standalone Chat routing remains independent.

---

# 23. Frame loading policy

Recommended simplest first version:

- create/load both iframes during shell startup;
- display only the routed frame;
- wait for `app:ready` from each child;
- never recreate them during normal switching.

This maximizes predictability for the “both remain alive” requirement.

If startup cost becomes noticeable later, optimize only after correctness:

- load routed app immediately;
- preload second frame after idle or on first switch;
- once second frame loads, keep it permanently alive.

Do not optimize this before manual correctness testing.

---

# 24. Expected iframe trade-offs and how the plan handles them

## Memory

Both complete applications remain loaded.
This consumes more memory than mount/unmount.

Accepted trade-off because persistent state/background generation is a product requirement.

## Hidden-frame CPU/timer behavior

Browsers may throttle some timers in non-visible frames.
Network fetch/SSE should be manually verified.

Use opacity/pointer-event panel switching rather than destroying/suspending the iframe.

## Mobile soft keyboard

Nested browsing contexts can behave differently with virtual keyboards.
Test:

- Todo task title/description;
- Todo Schedule window;
- Chat composer;
- attachment picker;
- mobile sidebars;
- focus when switching app while keyboard is open.

## Drag/drop

Test drag/drop entirely inside each iframe:

- Todo Task reorder;
- Todo Project/Tag hierarchy drag;
- Chat attachment file drop.

The shell must not overlay an invisible clickable layer above the active iframe.

## Fullscreen/voice

Chat Voice Mode and other overlays remain bounded to ChatUI iframe unless true browser fullscreen APIs are used.
This is acceptable initially but must be visually tested.

---

# 25. Files expected to change/create

## Root/shared shell

Create approximately:

```text
index.html
shell/css/shell.css
shell/js/app-shell.js
shell/js/router.js
shell/js/frame-manager.js
shell/js/frame-bridge.js
scripts/build-static.mjs
wrangler.jsonc
```

Exact names may vary, but responsibilities must remain separated.

## TodoList-ui

Likely changes:

```text
TodoList-ui/index.html
TodoList-ui/css/layout/app-shell.css
TodoList-ui/js/bootstrap.js or a small embedded-mode helper
TodoList-ui/js/components/sidebar.js / settings owner only if bridge handlers are needed
```

Do not refactor Todo business logic merely for iframe integration.

## ChatUI

Likely changes:

```text
ChatUI/index.html
ChatUI/js/layout-loader.js
ChatUI/js/router/chat-router.js
ChatUI/js/app.js or small embedded bridge module
ChatUI/settings owner for open-settings bridge
ChatUI/theme owner for appearance events
```

Do not rewrite Chat generation/storage architecture merely for iframe integration.

---

# 26. Things explicitly NOT to do

Do not:

- bring back the previous complex mount/unmount integration;
- inject both app CSS files into the root document;
- copy both app DOM trees into one document;
- use Todo DOM automation for future Chat tools;
- merge `TodoListDB` and `ChatUI_DB`;
- reset iframe `src` when switching;
- abort text generation when switching to Todo;
- rely on cross-origin iframe behavior;
- expose internal repo documents in production build;
- remove standalone entrypoints before combined mode is proven.

---

# 27. Static verification gates

Before merge:

1. Root `index.html` has exactly the intended persistent frame elements.
2. No shell code removes iframe elements during ordinary navigation.
3. No shell code rewrites iframe `src` during ordinary navigation.
4. ChatUI has no combined-mode dependency on root `/css`, `/html`, or `/js` assets.
5. Todo standalone boot still parses.
6. Chat standalone boot still parses.
7. Embedded bridge message types are centralized/documented.
8. Every `message` handler validates same origin.
9. Parent validates expected frame `contentWindow` for child messages.
10. Chat embedded routing does not directly own top-level route paths.
11. Combined build includes child runtime assets.
12. Combined build excludes internal docs/plans.
13. Public shell routes resolve to root shell.
14. Child iframe asset routes resolve to actual child files.
15. `TodoListDB` and `ChatUI_DB` names remain unchanged.

---

# 28. Manual acceptance test matrix

## Basic switching

- open `/todo-list-ui`;
- Todo visible;
- Chat frame loaded but inactive;
- click AI;
- Chat visible instantly;
- click To-Do;
- same Todo state returns;
- repeat 20+ times.

## Chat generation persistence

- start long Chat generation;
- switch to Todo during streaming;
- wait;
- switch back;
- generation continued/no lost message/no duplicated answer.

## Todo state persistence in memory

- open a Task editor;
- switch to Chat;
- switch back;
- verify expected editor state remains according to product policy.

## Routing

- direct `/todo-list-ui`;
- direct `/chat-ui`;
- direct `/chat-ui/chat/<valid-id>`;
- browser Back/Forward across Todo and multiple chats;
- hard refresh on every public route.

## Chat

- send;
- edit;
- regenerate;
- delete;
- attachments;
- Google Search;
- URL Context;
- Code Execution;
- Workspace;
- Read Aloud;
- Voice Mode;
- settings;
- theme;
- chat/project sidebar.

## Todo

- create/edit/delete Task;
- Subtask;
- Project/Tag CRUD;
- Project/Tag hierarchy drag;
- Task drag;
- Custom sort behavior;
- Schedule Date/Time/Repeat;
- reminders;
- Repeat Ends;
- backup/restore;
- settings;
- keyboard/focus behavior;
- mobile Schedule keyboard restore behavior.

## iFrame-specific

- Chat file drag/drop;
- Todo drag visuals;
- mobile keyboard in each frame;
- shell rail remains clickable but does not cover frame content;
- inactive frame cannot receive accidental clicks/tab focus;
- switching while keyboard is open;
- switching during Chat streaming;
- switching during tool execution;
- microphone privacy behavior.

## Persistence

- hard refresh combined shell;
- Todo data remains;
- Chat data remains;
- no database recreation;
- no cross-database writes.

---

# 29. Rollback strategy

Keep both standalone pages working throughout implementation.

If combined iframe shell has a serious problem:

```text
TodoList-ui/index.html
ChatUI/index.html
```

remain independently usable.

Do not migrate data into a new DB solely for the shell.

Each implementation phase should be a clean Git commit or feature-branch checkpoint so shell work can be reverted without reverting unrelated Todo/Chat product work.

---

# 30. Recommended implementation order

Use this order exactly unless a discovered dependency requires adjustment:

1. Safety checkpoint/backups.
2. Create root shell skeleton.
3. Make ChatUI assets folder-relative.
4. Verify both standalone apps still work.
5. Add explicit embedded mode to Todo and Chat.
6. Hide Todo internal app rail only in embedded mode.
7. Add persistent iframe panels.
8. Implement shared shell rail switching.
9. Implement parent top router.
10. Implement Chat embedded route bridge.
11. Implement Back/Forward synchronization.
12. Add Settings/title/theme bridge.
13. Add future Todo command bridge foundation.
14. Create combined allow-listed build.
15. Create one-origin local/deployment routing.
16. Run static verification.
17. User manually runs full switching/generation/mobile test matrix.
18. Only after successful testing, treat root shell as the normal entrypoint.

---

# 31. Definition of done

This integration is complete only when all of the following are true:

- one browser tab is used;
- one shared app rail controls Todo vs Chat;
- Todo and Chat remain independent iframe documents;
- both remain alive after loading;
- switching does not reload or destroy either frame;
- Chat text generation continues while Todo is visible;
- Todo state remains intact while Chat is visible;
- top URL correctly represents `/todo-list-ui`, `/chat-ui`, and Chat deep links;
- browser Back/Forward works without duplicate route entries;
- ChatUI and TodoList-ui still work independently outside the shell;
- no CSS/DOM collision exists between apps;
- databases remain separate and safe;
- same-origin bridge is validated and documented;
- production build excludes internal documents;
- mobile keyboard, drag/drop, attachments, voice and settings are manually tested;
- 20+ repeated app switches do not cause duplicate listeners, duplicate UI, reloads, or lost state.

This plan intentionally chooses **persistent iframe isolation** because the product requirement values keeping both applications alive more than minimizing memory usage. It is a simpler and safer fit for two applications that were originally designed as complete standalone pages.