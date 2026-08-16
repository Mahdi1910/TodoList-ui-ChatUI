# Implementation Plan ID 1 — Persistent iFrame Integration for TodoList-ui + ChatUI

## Status

**Plan only. Do not implement until reviewed/approved.**

## Revision

This is the revised iframe plan after:

- reviewing the real current `ChatUI/` source;
- reviewing the real current `TodoList-ui/` source;
- validating `implementation plan/Review Implementation Plan ID 1 by Jack.md` against the source;
- validating `to-do list agent/Review implementation plan ID by BRAVE.md` against the source;
- applying the user's final product rules for background Chat/audio behavior;
- removing the future ChatUI → To-Do AI tool bridge from the current implementation scope.

The earlier mount/unmount integration architecture must **not** be brought back.

---

# 1. Goal

Join the existing `TodoList-ui` and `ChatUI` applications into **one browser-tab experience** while keeping both applications independent and alive.

The user must be able to:

- open one combined website;
- use one shared application rail/navigation;
- click To-Do and see TodoList-ui;
- click AI and see ChatUI;
- switch instantly without reloading either child application;
- keep ChatUI text generation running while TodoList-ui is visible;
- keep ChatUI normal voice-message recording running while TodoList-ui is visible;
- keep ChatUI Live Voice listening to the microphone while TodoList-ui is visible;
- keep Live Voice processing/generation/speech output working while TodoList-ui is visible;
- keep Read Aloud/audio playback running while TodoList-ui is visible;
- keep TodoList-ui's current in-memory UI/application state alive while ChatUI is visible;
- preserve `TodoListDB` and `ChatUI_DB` separately;
- preserve the standalone versions of both applications for testing and rollback.

The architecture is **two persistent same-origin iframes inside one parent shell**.

---

# 2. Non-negotiable product rules

These rules override older review suggestions where they conflict.

## Rule A — Both applications stay alive

After an iframe has successfully loaded during the browser-tab session, ordinary app switching must never:

- remove the iframe;
- replace its `src`;
- navigate it away;
- reload it;
- destroy its DOM;
- unload its JavaScript;
- intentionally stop its timers/network work.

## Rule B — Chat background generation continues

Switching ChatUI → TodoList-ui must not call any Chat stop/abort/unmount logic.

Normal Chat generation, tool calls, Workspace activity, and persistence must continue in the Chat iframe.

## Rule C — Chat microphone/audio also continues

Switching ChatUI → TodoList-ui must **not** automatically:

- stop normal composer audio recording;
- cancel normal composer audio recording;
- mute Live Voice;
- stop Live Voice;
- close Live Voice;
- stop microphone capture;
- pause or stop Live Voice speech output;
- pause or stop Read Aloud;
- require confirmation merely because the user switched applications.

The user explicitly wants ChatUI to continue hearing and answering while working in To-Do.

The shell may show a small visible microphone/audio status indicator later if useful, but it must not interfere with the running media session.

## Rule D — Future ChatUI → To-Do tools are NOT part of this plan

Do not implement:

- `todo:command` messages;
- a Todo command broker;
- Gemini Todo tool definitions;
- ChatUI calls into Todo `AppDataService`;
- direct ChatUI writes to `TodoListDB`;
- create/edit/delete task/project/tag commands.

A future plan can add this later.

For now, only keep the shell/child message design clean enough that adding new message types later will not require rebuilding the shell architecture.

## Rule E — Databases stay separate

Keep:

```text
TodoListDB
ChatUI_DB
```

Do not merge schemas or rename these databases as part of iframe integration.

---

# 3. Source facts verified before revising this plan

## 3.1 Current repository baseline

The current repository is again a clean two-application baseline:

```text
TodoList-ui-ChatUI/
├── ChatUI/
│   ├── index.html
│   ├── css/
│   ├── html/
│   ├── js/
│   └── ...
├── TodoList-ui/
│   ├── index.html
│   ├── css/
│   ├── js/
│   └── ...
└── implementation plan/
```

There is no old mount/unmount shell that needs to be preserved.

## 3.2 ChatUI has root-path assumptions

Current `ChatUI/index.html` uses root-absolute assets such as:

```text
/css/main.css
/css/sidebar.css
/js/layout-loader.js
```

Current `ChatUI/js/layout-loader.js` fetches fragments from:

```text
/html/left-sidebar.html
/html/main-chat.html
/html/workspace.html
...
```

This works for ChatUI's current standalone deployment at the website root, but not when the same file is directly served from `/ChatUI/` inside the combined site.

## 3.3 ChatUI standalone routing currently owns `/` and `/chat/<id>`

`ChatUI/js/router/chat-router.js` understands:

```text
/
/chat/<chatId>
```

`ChatUI/js/app.js` currently initializes that router and parses the iframe/page pathname during startup.

Therefore embedded mode must be detected **before standalone router initialization and route restoration**.

## 3.4 TodoList-ui is already more path-portable

TodoList-ui mostly loads CSS/JavaScript with folder-relative paths.

It currently owns both:

- the desktop `.primary-rail`;
- the mobile `.mobile-bottom-nav`.

Those application-navigation controls must become shell-owned in embedded mode.

## 3.5 Todo uses a generic origin-scoped localStorage key

`TodoList-ui/js/theme.js` currently uses:

```text
localStorage['theme']
```

The new shell must therefore use **prefixed shell keys** and must not create another generic `theme` key.

## 3.6 Todo reminder delivery is not implemented

The Todo problem tracker still has:

```text
[ ] Decide and implement real reminder delivery
```

Reminder definitions are stored, but there is no complete notification-delivery engine.

Therefore this iframe plan must not claim that it preserves a working reminder notification engine that does not currently exist.

## 3.7 Current Chat audio code supports persistent media state

Normal recording uses a `MediaRecorder` and keeps the stream/recorder in Chat runtime state.

Live Voice uses microphone recording, timers, audio playback, and generation state. It stops on actual `pagehide`, but ordinary iframe panel switching must not cause an iframe navigation/pagehide.

This supports the chosen rule: keep the Chat iframe loaded and do not call media stop methods on app switch.

---

# 4. Target architecture

```text
ONE BROWSER TAB

Root Shell Document
/index.html
│
├── Shared application navigation
│   ├── To-Do
│   ├── AI / ChatUI
│   ├── Habits placeholder
│   ├── Diary placeholder
│   └── Settings
│
└── Application stage
    │
    ├── TodoList-ui iframe
    │   /TodoList-ui/index.html?embedded=1
    │   LOADED ONCE
    │   STAYS ALIVE
    │
    └── ChatUI iframe
        /ChatUI/embedded.html?embedded=1
        LOADED ONCE
        STAYS ALIVE
```

Only one iframe panel is visually active at a time.

Both iframe documents remain loaded.

Each child keeps its own:

- `document`;
- `window`;
- DOM IDs;
- CSS cascade;
- `body`;
- overlays;
- global listeners;
- timers;
- runtime state;
- IndexedDB database.

This avoids the CSS/DOM/lifecycle problems from the old same-document mount/unmount approach.

### Important security wording

Same-origin iframes are **not a hostile-code security sandbox**.

Because both frames are same-origin and trusted first-party code, they could technically access the parent/sibling document if code deliberately does so.

The iframe boundary is being used for:

- CSS isolation;
- DOM isolation;
- listener/lifecycle isolation;
- preserving two standalone runtimes.

All designed communication should still go through the explicit message bridge for maintainability.

---

# 5. Canonical public URLs

The parent shell owns the browser address bar.

```text
/                       → replace with /todo-list-ui
/todo-list-ui           → To-Do visible
/chat-ui                → ChatUI visible without a specific requested chat
/chat-ui/chat/<chatId>  → ChatUI visible on the requested chat
```

The implementation URLs remain internal:

```text
/TodoList-ui/index.html?embedded=1
/ChatUI/embedded.html?embedded=1
```

## Truthful Chat route rule

The visible top URL must match the live Chat state.

The shell keeps an in-memory `lastChatRoute`, initially:

```text
/chat-ui
```

When Chat opens a conversation, Chat reports:

```text
/chat-ui/chat/<id>
```

The shell updates `lastChatRoute`.

### If ChatUI is active

A child route change may update the browser address bar.

### If ChatUI is inactive

A child route change updates only `lastChatRoute`; it must **not** replace `/todo-list-ui` in the address bar while To-Do is visible.

### When the user clicks the AI rail button

Use the current `lastChatRoute`, not blindly `/chat-ui`.

Example:

```text
Chat is on /chat-ui/chat/ABC
→ switch to Todo
→ URL becomes /todo-list-ui
→ Chat remains alive on ABC
→ click AI
→ URL becomes /chat-ui/chat/ABC
→ same Chat frame is shown
```

This keeps the URL truthful without resetting ChatUI.

---

# 6. Phase 0 — Safety checkpoint

Before runtime changes:

1. Record current `main` SHA.
2. Create an integration feature branch.
3. Confirm standalone Todo boots.
4. Confirm standalone ChatUI boots.
5. Confirm current `TodoListDB` data exists.
6. Confirm current `ChatUI_DB` data exists.
7. Export backups if the user's existing browser data matters.
8. Do not change either DB schema for iframe integration.

### Origin warning

IndexedDB is origin-specific.

If old Todo and ChatUI data are on different ports/domains/origins, moving both applications to a new combined origin will not magically move those databases.

Before final cutover, define the practical migration workflow:

```text
old Todo origin → export Todo backup
old Chat origin → export Chat backup
new combined origin → import Todo backup
new combined origin → import Chat backup
verify counts/content before retiring old origins
```

Do not tell the user data was deleted if the actual issue is origin separation.

---

# 7. Phase 1 — Create the root shell

Create approximately:

```text
/index.html
/shell/css/shell.css
/shell/js/app-shell.js
/shell/js/router.js
/shell/js/frame-manager.js
/shell/js/frame-bridge.js
```

The root page owns only shared application chrome and the iframe stage.

Conceptually:

```html
<div class="shell">
  <aside class="shell-app-rail">...</aside>
  <main class="shell-app-stage">
    <section id="todo-frame-panel">...</section>
    <section id="chat-frame-panel">...</section>
  </main>
  <nav class="shell-mobile-nav">...</nav>
</div>
```

### Frames

Todo:

```html
<iframe
  id="todo-frame"
  title="To-Do List"
  src="/TodoList-ui/index.html?embedded=1">
</iframe>
```

Chat:

```html
<iframe
  id="chat-frame"
  title="ChatUI"
  src="/ChatUI/embedded.html?embedded=1"
  allow="microphone; autoplay; clipboard-read; clipboard-write; fullscreen"
  allowfullscreen>
</iframe>
```

Do not add a restrictive iframe `sandbox` in this first-party same-origin design.

The two applications are trusted code and ChatUI needs microphone/audio/clipboard/download/fullscreen-related capabilities.

---

# 8. Phase 2 — Persistent frame switching

Both iframe elements remain in the DOM.

Use panel stacking rather than DOM removal.

Recommended shell model:

```text
active panel
- position: absolute
- inset: 0
- opacity: 1
- pointer-events: auto
- z-index: 2
- inert: false
- aria-hidden: false

inactive panel
- position: absolute
- inset: 0
- opacity: 0
- pointer-events: none
- z-index: 1
- inert: true
- aria-hidden: true
```

Do **not** use these as the ordinary switch mechanism:

```text
display: none
hidden attribute
content-visibility: hidden
iframe.remove()
iframe.src = ''
iframe.src = another URL
location.reload()
```

The product requirement is not merely to remember state; it is to keep background Chat/network/audio work running.

`inert` is used only to prevent keyboard/pointer interaction with the inactive browsing context. It must not be connected to any Chat pause/stop logic.

---

# 9. Phase 3 — Focus and accessibility switching

Opacity and `pointer-events` are not enough because an iframe is a focusable browsing context.

Use this order:

```text
1. User activates a shell app button.
2. Focus that shell button/safe shell target.
3. If document.activeElement is the old iframe, ensure parent focus has moved away.
4. Mark old panel inert.
5. Set old panel aria-hidden=true and pointer-events:none.
6. Activate destination panel.
7. Remove inert from destination.
8. Set destination aria-hidden=false and pointer-events:auto.
9. Do not automatically reopen the mobile keyboard unless explicitly desired.
```

Rail/navigation controls must have:

- real `<button>` elements;
- accessible names (`To-Do`, `ChatUI`, etc.);
- visible focus states;
- keyboard activation;
- `aria-current="page"` or equivalent selected-state semantics.

The user interface state inside the hidden iframe remains intact even though parent focus moves away.

---

# 10. Phase 4 — Move application navigation ownership to the shell

The current Todo application owns:

- desktop `.primary-rail`;
- mobile `.mobile-bottom-nav`.

In **embedded Todo mode**, both must be hidden/disabled as app-navigation controls.

The root shell owns:

```text
Desktop
[To-Do]
[AI]
[Habit]
[Diary]
[Settings]

Mobile
To-Do | AI | Habit | Diary | Settings
```

Standalone Todo keeps its existing desktop/mobile navigation when `embedded=1` is absent.

### Embedded mode detection

Use an explicit query:

```js
const isEmbedded = new URLSearchParams(location.search).get('embedded') === '1';
```

Do not rely only on `window.self !== window.top`.

### Layout cleanup

When the internal Todo app rail/mobile nav is hidden in embedded mode, remove/recalculate any widths, left offsets, bottom padding, or reserved mobile-nav space that existed only for those controls.

Do not leave a blank rail-width gap or double mobile bottom padding.

---

# 11. Phase 5 — Fix ChatUI path portability safely

The original plan's simple conversion from root paths to `./...` paths is **not safe** for standalone Chat deep links.

Example problem:

```text
standalone hard refresh: /chat/ABC
index contains ./css/main.css
browser may request /chat/css/main.css
```

That would break standalone ChatUI.

## Correct design: separate thin embedded entry

Keep existing:

```text
ChatUI/index.html
```

as the standalone entry with its existing root behavior.

Add:

```text
ChatUI/embedded.html
```

for the combined shell.

The embedded entry references Chat assets explicitly under the combined app namespace, for example:

```text
/ChatUI/css/main.css
/ChatUI/css/sidebar.css
...
/ChatUI/js/layout-loader.js
```

Do not duplicate the application layout in `embedded.html`; it should remain a thin entry that uses the same layout loader and application modules.

## Make fragment loading module-relative

Update `ChatUI/js/layout-loader.js` so fragment locations are based on `import.meta.url`, not the current document pathname.

Conceptually:

```js
new URL('../html/left-sidebar.html', import.meta.url)
new URL('../html/main-chat.html', import.meta.url)
```

This works when the same module lives at either:

```text
/js/layout-loader.js                  standalone deployment
/ChatUI/js/layout-loader.js           combined deployment
```

Do not add a global `<base>` tag unless every link/download/router path is audited. The preferred plan does not need a `<base>` tag.

### Required path tests

Standalone:

```text
/
/chat/<real-id> hard refresh
```

Combined:

```text
/ChatUI/embedded.html?embedded=1
/chat-ui
/chat-ui/chat/<real-id>
```

Missing child fragments/assets must return real errors/404s, not the root shell HTML.

---

# 12. Phase 6 — Add explicit embedded mode to ChatUI before routing

Current Chat startup unconditionally initializes `initChatRouter()` and calls `parseChatRoute()`.

That must change for embedded mode.

## Standalone Chat startup

Keep current behavior:

```text
load layout
→ bootstrap app
→ init standalone Chat router
→ parse / or /chat/<id>
→ restore route
```

## Embedded Chat startup

Required order:

```text
load embedded.html
→ detect embedded=1
→ load layout
→ load state/database metadata
→ initialize required Chat UI/services
→ install shell message listener
→ DO NOT install standalone popstate ownership
→ DO NOT parse /ChatUI/embedded.html as a Chat route
→ become ready to accept shell:navigate-chat
→ post app:ready
→ shell sends/replays current Chat route if needed
```

`app:ready` means the bridge listener, state needed for chat lookup, and minimum UI needed to accept a route command are actually ready.

An iframe `load` event alone does **not** mean ChatUI is ready.

---

# 13. Phase 7 — Parent/child frame state machine

Each iframe needs an explicit shell state:

```text
LOADING
READY
FAILED
```

Optional initial state if the element is not created yet:

```text
NOT_CREATED
```

For this plan both frames may be created during shell startup, so ordinary operation quickly becomes LOADING/READY.

## Shell rules

- queue commands until child sends `app:ready`;
- never assume iframe `load` means application success;
- when iframe navigates/reloads, clear READY and return it to LOADING;
- use a bounded startup timeout longer than the child application's own startup deadline;
- display a frame-specific loading state;
- display a frame-specific error state;
- retry only the failed iframe;
- do not reload the other healthy iframe;
- after every fresh `app:ready`, replay necessary state:
  - current active/inactive status;
  - current requested Chat route if it is Chat;
  - appearance request if needed;
  - queued Settings request if still relevant.

## `app:ready` payload

Include app identity and bridge compatibility information, for example:

```js
{
  channel: 'mahdi-app-shell',
  version: 1,
  type: 'app:ready',
  app: 'chat',
  capabilities: ['navigate-chat', 'open-settings', 'appearance']
}
```

The shell must reject messages from an unexpected protocol/app identity.

---

# 14. Phase 8 — Shell router and history

The **parent** history is the source of truth for public routes.

Required route parser:

```text
/                     → todo
/todo-list-ui         → todo
/chat-ui              → chat
/chat-ui/chat/<id>    → chat + id
unknown               → replace with /todo-list-ui
```

## Embedded Chat must not create competing iframe history

In embedded mode, Chat conversation navigation must not create a second user-facing history stack using `/chat/<id>` inside the iframe.

The child should load chats with a no-history/internal mode and report user route changes to the parent.

## User Chat navigation

```text
user opens Chat ABC inside Chat iframe
→ child reports chatui:route-change ABC
→ shell records lastChatRoute
→ if Chat is active, parent pushState /chat-ui/chat/ABC
```

## Browser Back/Forward

```text
parent popstate
→ shell parses destination
→ switches active frame if necessary
→ if destination is Chat, shell sends shell:navigate-chat
→ child loads requested state WITHOUT reporting it back as a new user navigation
```

## Echo-loop protection

Every route command/report must have enough context to no-op duplicates.

Use one clear mechanism such as:

- route source (`user`, `shell`, `popstate`, `startup`);
- sequence/request ID;
- last acknowledged route;
- reentrancy/suppression guard.

A shell-originated route load must not cause a child report that creates another parent history entry.

---

# 15. Phase 9 — Define the minimal frame bridge

Use `postMessage` as the designed boundary even though frames are same-origin.

## Sender rule

Every normal message must use an exact `targetOrigin`:

```js
window.location.origin
```

Do not use `'*'` for normal shell protocol messages.

## Receiver rules

Validate:

```text
event.origin === window.location.origin
expected event.source
channel
version
message type
payload shape
reasonable payload size
```

Do not send:

- functions;
- DOM nodes;
- giant database dumps;
- arbitrary Blobs through this control channel.

## Current allowed child → shell messages

```text
app:ready
app:error
app:title
app:appearance
app:settings-opened
chatui:route-change
app:media-state          optional/recommended status only
```

## Current allowed shell → child messages

```text
shell:active
shell:inactive
shell:navigate-chat
shell:open-settings
shell:request-appearance
```

### Critical rule

`shell:inactive` is **informational only**.

ChatUI must not interpret it as:

- abort generation;
- stop recording;
- stop Live Voice;
- mute microphone;
- pause Read Aloud;
- stop audio playback.

## Explicitly excluded from this plan

Do not add:

```text
todo:command
todo:result
createTask
createProject
createTag
```

Those belong to a future implementation plan.

---

# 16. Phase 10 — Preserve ALL Chat background text/audio behavior

This phase is a primary acceptance gate.

## 16.1 Normal text generation

While ChatUI is inactive:

- network streaming continues;
- tool execution continues;
- Workspace operations can continue;
- persistence continues;
- generation is not aborted.

## 16.2 Normal composer voice-message recording

If the user presses Record Voice Message in ChatUI and then switches to To-Do:

- `MediaRecorder` must keep recording;
- microphone stream must remain active;
- accumulated chunks must remain intact;
- switching apps must not call `stopAudioRecording()` or `cancelAudioRecording()`;
- when the user returns to ChatUI, the same recording state/button must still be correct;
- the user can stop the recording normally and attach/send it.

## 16.3 Live Voice

If Live Voice is active and the user switches to To-Do:

- microphone listening must continue;
- silence/speech detection must continue;
- the user can speak while looking at To-Do;
- ChatUI can finish the voice turn;
- Chat generation can run;
- speech generation/playback can run;
- the user must still hear ChatUI's spoken answer while To-Do is visible;
- Live Voice may begin listening for the next turn while To-Do remains visible;
- switching back to ChatUI must show the correct current Live Voice state.

The existing Live Voice `pagehide` cleanup is for a real page lifecycle exit. Ordinary shell app switching must not cause iframe navigation/pagehide.

## 16.4 Read Aloud

If Read Aloud is playing and the user switches to To-Do:

- playback continues;
- audio remains audible;
- progress continues;
- returning to ChatUI shows correct playback state.

## 16.5 Permissions Policy

The Chat iframe must be configured and tested for:

```text
microphone
autoplay
clipboard-read
clipboard-write
fullscreen
```

Only include permissions actually needed by the current app; do not casually broaden them later.

## 16.6 Hidden-frame/browser limitation

A persistent iframe greatly improves continuity during normal shell switching, but no browser-only design can guarantee survival if the browser/OS kills or reloads the iframe process under severe memory pressure.

Acceptance promise:

> Ordinary app switching performed by our shell must not stop Chat generation or media.

Do not promise:

> The browser/OS can never discard a frame.

If an unexpected frame reload happens, the shell should recover persisted state and replay the current route; an in-flight generation/recording may not be recoverable after actual process destruction.

---

# 17. Phase 11 — Embedded external-link policy

Current rendered Markdown can contain ordinary safe `<a href="https://...">` links.

Inside an iframe, a normal link can navigate the iframe itself away from ChatUI.

That would destroy the live ChatUI document.

## Embedded policy

For ordinary external `http:`/`https:` links in embedded ChatUI:

```text
open in a new browser tab/window
use target=_blank
use rel="noopener noreferrer"
```

Do not navigate the Chat iframe away from its application URL.

Internal Chat conversation navigation must use the Chat route bridge.

Audit separately:

- Markdown links;
- generated-file/download links;
- Workspace links;
- any code-execution result links.

Downloads may stay downloads; do not accidentally turn application routes into external links.

## Health check

When the Chat iframe fires `load`, the shell should verify it still belongs to the expected Chat application origin/path before declaring it healthy.

If it unexpectedly navigated away, show a recovery action rather than treating that page as ChatUI READY.

---

# 18. Phase 12 — Settings delegation

The shell Settings button opens Settings in the active application only.

```text
Todo active
→ shell:open-settings → Todo

Chat active
→ shell:open-settings → Chat
```

Do not send Settings to both children.

## Reliability

- disable or queue Settings while the active frame is LOADING;
- child replies `app:settings-opened` or `app:error`;
- use a bounded response timeout;
- if the active app cannot open Settings, show a small shell-level error rather than silently doing nothing.

Each application continues owning its own Settings UI and data.

Do not create a giant shared Settings modal in this integration.

---

# 19. Phase 13 — Title, appearance, and origin-storage ownership

## 19.1 Shell CSS variables

Use shell-prefixed variables only, for example:

```text
--shell-bg
--shell-surface
--shell-text
--shell-border
--shell-accent
```

Do not use generic shell variables such as `--bg-primary` that resemble child app variables.

Never import Todo or Chat CSS into the parent shell.

## 19.2 Title ownership

Only the parent sets the browser-tab title.

Children may report `app:title`.

If the reporting child is active, apply it.

If the reporting child is inactive, cache it but do not replace the title of the visible application.

## 19.3 Appearance ownership

Children may report theme/accent.

Apply appearance to the shell only from the active app.

Inactive app updates are cached for the next switch.

## 19.4 localStorage/sessionStorage namespace audit

Because both child apps and shell share one origin, audit origin-scoped storage before implementation.

Current Todo already uses generic key:

```text
theme
```

Do not collide with it.

New shell keys must be prefixed, for example:

```text
mahdi-shell:active-app
mahdi-shell:last-chat-route
mahdi-shell:appearance
```

Also audit existing:

- localStorage keys;
- sessionStorage keys;
- cookies if any;
- Service Worker registrations if any;
- Cache Storage usage if any.

Do not rename existing child keys unless there is a proven collision; renaming existing keys creates migration work.

---

# 20. Phase 14 — Mobile shell and keyboard behavior

This is a major acceptance area, not a small polish step.

## Root viewport

Use a mobile viewport compatible with the existing To-Do keyboard work, for example:

```html
<meta
  name="viewport"
  content="width=device-width, initial-scale=1.0, viewport-fit=cover, interactive-widget=resizes-content">
```

Do not reintroduce pinch-zoom blocking.

## Shell mobile navigation

The parent shell owns the mobile application bottom navigation.

Todo's internal `.mobile-bottom-nav` is hidden in embedded mode.

The shell must reserve its own bottom-navigation space so the iframe stage does not sit underneath it accidentally.

Embedded Todo layout must remove any now-unnecessary internal bottom-nav spacing to avoid double gaps.

## Safe areas

Handle:

```text
env(safe-area-inset-top)
env(safe-area-inset-bottom)
```

at the correct shell/navigation layer.

Avoid double-applying safe-area padding in both shell and embedded child for the same physical navigation area.

## Keyboard tests

On the user's real phone, test:

- Chat composer open keyboard → switch To-Do;
- Todo title input open keyboard → switch Chat;
- Todo description input;
- Schedule window;
- Chat attachment picker;
- Chat voice recording;
- Live Voice;
- portrait;
- landscape;
- software keyboard opening/closing;
- safe-area devices.

Do not mark mobile integration complete based only on desktop behavior.

---

# 21. Phase 15 — Drag/drop and iframe boundaries

Test all drag-heavy features inside their own frame:

Todo:

- Task reorder;
- Project hierarchy drag;
- Tag hierarchy drag.

Chat:

- attachment file drop;
- any Workspace drag behavior that exists.

The shell's inactive iframe must have `pointer-events:none` so it cannot intercept drags.

The active iframe must not have an invisible shell overlay above it.

Dragging near the shell rail must not accidentally activate another application unless there is a real click/activation event.

---

# 22. Phase 16 — Frame loading, failure, and retry behavior

## Startup

Loading both frames during shell startup is acceptable and simplest for the persistent-alive requirement.

This is a deliberate trade-off:

- higher initial CPU/network/memory;
- fastest switching once ready;
- both applications become live as early as possible.

If startup contention becomes a measured problem, an optimization may load the routed app first and the other immediately after the first shell paint/ready event. Once the second frame is loaded, it must remain alive.

Do not optimize this before correctness testing.

## Child failure

If Chat fails:

- Todo must remain usable;
- mark AI app state as failed;
- show a retry control/badge;
- retry Chat only.

If Todo fails:

- Chat must remain usable;
- retry Todo only.

Retry is one of the few times assigning/reloading a frame `src` is allowed.

It is not allowed during ordinary application switching.

## Unexpected child reload

If a child reloads unexpectedly:

```text
load event
→ mark LOADING
→ wait for app:ready
→ replay route/active state
→ return READY
```

Do not recreate/reload the healthy sibling frame.

---

# 23. Phase 17 — Combined build and server routing

Create one **root combined build** without destroying the existing standalone ChatUI build.

Expected combined runtime output:

```text
dist/
├── index.html
├── shell/
├── ChatUI/
│   ├── embedded.html
│   ├── css/
│   ├── html/
│   └── js/
└── TodoList-ui/
    ├── index.html
    ├── css/
    └── js/
```

If preserving the standalone Chat entry inside the combined bundle is useful, include `ChatUI/index.html` too, but do not confuse it with the shell route.

## Explicit allow-list

Do not deploy:

- implementation plans;
- review docs;
- agent collaboration files;
- `.git`;
- local secrets/config;
- unrelated internal documentation.

## Critical fallback routing

The shell SPA fallback applies only to public shell routes:

```text
/
/todo-list-ui
/chat-ui
/chat-ui/chat/*
```

Static namespaces must serve actual files or real 404s:

```text
/ChatUI/**
/TodoList-ui/**
/shell/**
```

### Required failure behavior

Requesting:

```text
/ChatUI/js/this-file-does-not-exist.js
```

must return a real 404, **not** root `index.html` with HTTP 200.

Otherwise browsers produce confusing JS MIME/parse errors.

The same rule applies to missing CSS and HTML fragments.

## Standalone Chat deployment

Do not break the existing standalone Chat Cloudflare build/routing that supports:

```text
/
/chat/<id>
```

The new combined build is a separate root packaging concern.

---

# 24. Phase 18 — Local development and HTTPS testing

Use one origin for combined development/testing.

Do not use separate Todo/Chat ports for the normal combined test because that changes:

- iframe origin behavior;
- postMessage origin checks;
- IndexedDB origin;
- storage behavior.

Local shell routes should look like:

```text
https://<combined-host>/todo-list-ui
https://<combined-host>/chat-ui
```

## Phone/microphone requirement

For microphone-sensitive testing on another device/phone, plain LAN HTTP such as:

```text
http://192.168.x.x:<port>
```

may not provide the secure context required for `getUserMedia()`.

Use an HTTPS-capable test route, such as an HTTPS preview/tunnel/local certificate setup, for real phone tests of:

- normal voice recording;
- Live Voice;
- Read Aloud/autoplay behavior where relevant;
- iframe microphone Permission Policy.

`localhost` secure-context exceptions on the development computer do not automatically solve phone access through a LAN IP.

## LAN safety

When exposed to LAN, serve the runtime build/allow-list rather than the entire repository root.

Do not expose planning/review/internal files to other devices.

---

# 25. Pre-existing issues that are NOT iframe integration scope

Do not accidentally expand this integration into unrelated application cleanup.

Examples:

## Todo reminder delivery

Real notification delivery is still a separate Todo problem.

The iframe work must preserve existing reminder data/configuration but must not pretend to implement reminder notifications.

## Chat temporary performance diagnostics

Current Chat layout loader has a temporary performance diagnostics import.

Do not build additional shell dependence on that diagnostics layer.

If it is to be removed, do so in a separate cleanup unless it is proven to block iframe integration.

## Future ChatUI → To-Do tools

Completely deferred to a future implementation plan.

---

# 26. Expected files to create/change

## New root/shared shell

Approximately:

```text
index.html
shell/css/shell.css
shell/js/app-shell.js
shell/js/router.js
shell/js/frame-manager.js
shell/js/frame-bridge.js
scripts/build-static.mjs
wrangler.jsonc or equivalent combined deployment config
```

## ChatUI

Likely:

```text
ChatUI/embedded.html                       NEW
ChatUI/js/layout-loader.js                 make fragments module-relative
ChatUI/js/app.js                           embedded startup branch
ChatUI/js/router/chat-router.js            standalone remains; embedded bypass/adapter
ChatUI/js/... small embedded bridge helper
ChatUI/js/chat/markdown.js or link owner    embedded external-link policy
ChatUI/settings owner                       settings bridge
ChatUI/theme/title owners                   report state as needed
```

Do not rewrite Chat generation/storage/audio architecture merely to use iframes.

## TodoList-ui

Likely:

```text
TodoList-ui/index.html                     embedded marker/support if needed
TodoList-ui/css/layout/app-shell.css       hide/reflow internal app navigation in embedded mode
TodoList-ui/js/bootstrap.js or small embedded helper
Todo settings/theme owner                  minimal shell bridge/reporting
```

Do not refactor Todo business logic for this integration.

---

# 27. Things explicitly NOT to do

Do not:

- restore the old mount/unmount micro-frontend architecture;
- inject both apps into one DOM;
- import Chat CSS into Todo/root shell;
- import Todo CSS into Chat/root shell;
- remove/reload iframe during ordinary switching;
- abort Chat text generation on app switch;
- stop or mute normal Chat audio recording on app switch;
- stop or mute Live Voice on app switch;
- stop microphone capture on app switch;
- pause/stop Read Aloud on app switch;
- use `display:none`, `hidden`, or `content-visibility:hidden` as the core inactive-frame mechanism;
- let embedded external links navigate the Chat iframe away;
- let embedded Chat own competing `/chat/<id>` iframe history;
- use `postMessage(..., '*')` for normal protocol traffic;
- claim same-origin iframes are a security sandbox;
- merge `TodoListDB` and `ChatUI_DB`;
- build Todo AI tools/commands now;
- directly write Todo data from ChatUI;
- create generic shell storage keys such as `theme`;
- serve missing child JS/CSS as root shell HTML;
- expose repository planning files in production/LAN runtime.

---

# 28. Static verification gates

No headless browser automation is required for this project. Use static/code-level verification plus manual browser testing.

Before merge verify:

1. Root `index.html` contains the intended two persistent iframe panels.
2. Shell switching code never removes frames.
3. Shell switching code never rewrites frame `src`.
4. Chat uses `embedded.html` in combined mode.
5. Standalone `ChatUI/index.html` remains compatible with `/chat/<id>` deep links.
6. Chat layout fragments resolve relative to the loader module, not the current deep-link document path.
7. Embedded Chat detects embedded mode before standalone router initialization.
8. Embedded Chat does not parse `/ChatUI/embedded.html` as a Chat route.
9. Parent route is canonical in embedded mode.
10. Route echo-loop protection exists.
11. Frame states include LOADING/READY/FAILED.
12. Commands are queued until READY.
13. A child retry does not reload the healthy sibling.
14. Inactive panel uses focus-safe `inert`/`aria-hidden` handling.
15. Shell does not send any media stop/pause command on app switch.
16. No future Todo command/tool protocol was implemented.
17. Every normal bridge sender uses exact same-origin `targetOrigin`.
18. Every receiver validates origin/source/channel/version/type/payload.
19. Shell storage keys are prefixed `mahdi-shell:*` or equivalent.
20. `TodoListDB` name is unchanged.
21. `ChatUI_DB` name is unchanged.
22. Combined build contains only required runtime files.
23. `/todo-list-ui`, `/chat-ui`, `/chat-ui/chat/<id>` return root shell.
24. `/ChatUI/**`, `/TodoList-ui/**`, `/shell/**` return actual files.
25. Missing child JS/CSS/fragment returns 404, not shell HTML.
26. Standalone Todo still parses/boots.
27. Standalone Chat build still parses and preserves `/chat/<id>` fallback.
28. Shell CSS uses `--shell-*` variables rather than child-style generic variable names.
29. Todo's embedded desktop rail and mobile bottom nav are not duplicated with shell navigation.
30. No code added claims Todo reminder delivery is implemented.

---

# 29. Manual acceptance test matrix

## A. Basic startup

- open `/todo-list-ui`;
- root shell loads;
- Todo visible;
- Chat frame loads in background;
- no duplicate Todo rail/mobile navigation;
- switch AI;
- Chat appears without reload;
- switch back;
- Todo exact state remains.

## B. Repeated switching

Perform at least 20 cycles:

```text
Todo → Chat → Todo → Chat
```

Verify:

- no iframe reload;
- no duplicated UI;
- no lost app state;
- no growing visible error state;
- no route corruption.

## C. Chat text generation while hidden

1. Start a long text generation.
2. Wait for streaming.
3. Switch to Todo.
4. Work in Todo.
5. Return to Chat.
6. Generation continued or completed.
7. Final answer is present and persisted.

Repeat with:

- normal generation;
- Google Search/tool call;
- Workspace tool;
- attachment-backed prompt.

## D. Normal voice-message recording while hidden

1. Start recording with the normal Chat microphone button.
2. Speak.
3. Switch to Todo without stopping recording.
4. Continue speaking while Todo is visible.
5. Wait several seconds.
6. Return to Chat.
7. Recording still exists/is active unless it naturally hit its existing size limit.
8. Stop normally.
9. Verify resulting audio attachment contains the complete expected recording.

## E. Live Voice while hidden — REQUIRED

1. Open Live Voice.
2. Confirm it is listening.
3. Switch to Todo.
4. Speak while Todo is visible.
5. Confirm ChatUI hears the turn.
6. Confirm generation occurs.
7. Confirm spoken answer is audible while Todo remains visible.
8. Continue another Live Voice turn without reopening Chat.
9. Switch back to Chat.
10. Verify Live Voice UI/state matches the live session.

Also test:

- mute/unmute performed from Chat before/after switching;
- speech interruption;
- auto-detect turn ending;
- manual turn ending if supported;
- existing generation + Live Voice interaction.

## F. Read Aloud while hidden

1. Start Read Aloud.
2. Switch to Todo.
3. Audio continues audibly.
4. Wait.
5. Return to Chat.
6. Player progress/state is correct.

## G. Chat external links

- click normal external Markdown link in embedded Chat;
- external page opens in new tab/window;
- Chat iframe stays on ChatUI;
- active Chat session is not destroyed.

## H. Deep links

Hard refresh:

```text
/todo-list-ui
/chat-ui
/chat-ui/chat/<real-id>
```

Verify correct shell/app state.

Also verify standalone Chat hard refresh:

```text
/chat/<real-id>
```

on its standalone deployment.

## I. Browser Back/Forward

Example:

```text
/todo-list-ui
→ /chat-ui
→ /chat-ui/chat/A
→ /chat-ui/chat/B
→ /todo-list-ui
```

Walk Back/Forward through the sequence.

Verify:

- only parent public history controls user-facing navigation;
- no duplicate entries from route echo;
- Chat child shows the matching chat;
- switching does not reload child frames.

## J. Route changes while Chat hidden

If Chat changes its active route/state while hidden because of an ongoing operation:

- parent remains `/todo-list-ui` while Todo visible;
- shell updates cached `lastChatRoute`;
- clicking AI returns to that truthful Chat route.

## K. Settings

- Todo active → shell Settings opens Todo Settings only;
- Chat active → shell Settings opens Chat Settings only;
- click Settings before child READY → command queues or shows controlled loading;
- forced child error → shell reports failure rather than silently doing nothing.

## L. Theme/title

- change Chat theme while Chat active → shell follows if designed;
- change Todo theme while Todo active → shell follows if designed;
- inactive child updates must not overwrite visible app title/appearance;
- no localStorage key collision with Todo `theme`.

## M. Mobile/phone

On the user's real phone over HTTPS:

- To-Do input keyboard;
- Chat composer keyboard;
- switch while keyboard open;
- normal voice recording while hidden;
- Live Voice while hidden;
- Read Aloud while hidden;
- portrait;
- landscape;
- safe areas;
- shell bottom navigation;
- no duplicate Todo bottom navigation;
- attachment picker;
- Schedule window;
- no content hidden under bottom nav.

## N. Drag/drop

Todo:

- Task reorder;
- Project drag;
- Tag drag.

Chat:

- attachment drag/drop.

Verify inactive iframe cannot intercept interaction.

## O. Failure/retry

Simulate or manually cause one child startup failure.

Verify:

- healthy other app remains usable;
- failed app shows shell status;
- retry reloads only failed frame;
- after `app:ready`, current route/state is replayed.

## P. Memory/long-session test

Create a realistic heavy state:

- long Chat conversation;
- Chat sidebars/Workspace used;
- many Todo tasks/projects/tags;
- switch repeatedly for an extended session.

Watch for:

- browser tab reload;
- obvious memory pressure;
- frame loss;
- audio interruption;
- generation interruption.

If the browser/OS genuinely discards a frame, verify shell recovery behavior and document that in-flight work cannot be guaranteed across process destruction.

---

# 30. Review decisions incorporated into this revision

## Accepted from the reviews because source inspection confirmed them

- persistent same-origin iframe architecture remains the correct direction;
- do not reuse old mount/unmount lifecycle architecture;
- simple `./...` ChatUI path conversion is unsafe for standalone deep links;
- use a separate thin Chat embedded entry;
- use module-relative fragment URLs;
- detect embedded Chat before standalone router startup;
- add a real frame READY/FAILED/queue state machine;
- use `inert` in addition to `aria-hidden`/pointer blocking;
- prevent external links from navigating the Chat iframe away;
- distinguish shell SPA fallbacks from real child static assets/404s;
- document that same-origin iframe is not a security sandbox;
- use exact `postMessage` targetOrigin and strict receive validation;
- audit shared-origin localStorage/sessionStorage and namespace shell keys;
- test hidden-frame throttling/background behavior instead of assuming it;
- correct inaccurate Todo reminder-delivery wording;
- keep one truthful cached Chat route while Chat is hidden;
- prevent route-message echo loops;
- ignore/cache inactive child title/appearance updates;
- give Settings READY/ack/error behavior;
- require HTTPS for real phone microphone iframe testing;
- explicitly review iframe Permission Policy/fullscreen behavior;
- make shell own both desktop and mobile application navigation;
- design root mobile viewport/keyboard behavior;
- define focus behavior when switching;
- test drag/drop at iframe boundaries;
- recover one failed/reloaded iframe without rebuilding the sibling;
- test realistic memory pressure;
- preserve standalone modes with explicit compatibility tests.

## Modified/rejected review recommendations because they conflict with the user's final requirement

### Do NOT stop microphone/voice/audio on app switch

Some review text recommended stopping or asking before hiding ChatUI.

That is rejected.

Final rule:

```text
normal recording continues
Live Voice continues listening
Live Voice continues answering/speaking
Read Aloud continues
text generation continues
```

The shell switch is visual/navigation only.

### Do NOT implement the future Todo AI command bridge now

Some review text expanded the future command request/response protocol.

That is deferred.

The current plan contains only the generic shell bridge needed for routing/settings/status.

Todo AI tools will get their own future implementation plan.

---

# 31. Completion definition

The iframe integration is complete only when all of these are true:

1. One root website contains one shared desktop/mobile app navigation.
2. TodoList-ui and ChatUI remain independent iframe documents.
3. Both frames remain alive after loading.
4. Switching applications does not reload either frame.
5. Chat text generation continues while Todo is visible.
6. Normal Chat voice recording continues while Todo is visible.
7. Live Voice continues listening and speaking while Todo is visible.
8. Read Aloud continues while Todo is visible.
9. Public URLs and Back/Forward remain correct.
10. Standalone Chat and Todo still work.
11. Child assets resolve correctly and missing assets produce real 404s.
12. Parent/child READY/error/retry behavior is reliable.
13. Desktop and mobile focus/navigation work correctly.
14. Mobile HTTPS microphone testing passes.
15. Databases remain separate and existing data is protected/migrated deliberately.
16. No future Todo AI tools/command broker were added as part of this implementation.
17. Manual acceptance tests pass before calling the integration finished.
