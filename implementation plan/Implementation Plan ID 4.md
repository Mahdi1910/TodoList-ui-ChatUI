# Implementation Plan ID 4 — Workspace Routing, Backup, Tool Loop Controls, Navigation Semantics, Markdown UX, Sidebar/Menu Polish, and Search Context

## Status

**Plan only. Do not implement until explicitly approved.**

Baseline inspected for this plan: `main` at `0018d31954b8c316d86ad7c0cc7543fb2db022ec`.

This plan is based on direct inspection of the current combined application (`ChatUI/`, `shell/`, `worker.js`, build/integration scripts) plus standards/library research. It does **not** change runtime code by itself.

---

# 1. Goal

Implement the following user-facing improvements without breaking the current persistent Chat/Todo iframe architecture, existing Chat history routes, Workspace AI tools, Todo AI tools, Voice Mode, attachment handling, or standalone ChatUI behavior:

1. Real `/workspace/...` browser URLs for Workspace folders and files.
2. Workspace-only ZIP Backup & Restore using real folder structure and `.md` files.
3. A configurable Gemini custom-tool round limit in Settings; `-1` means unlimited.
4. Graceful custom-tool-limit handling instead of the current fatal `Gemini Workspace tool loop exceeded 12 rounds.` error.
5. Right sidebar becomes an overlay and never pushes/shrinks chat content.
6. Remove AI-tool descriptions from the right sidebar.
7. Real hyperlink semantics for chats, New Chat, Workspace folders/files, and other true navigation targets so browser right-click/middle-click/new-tab behavior works.
8. Render Markdown in sent user messages using the existing safe Markdown pipeline.
9. Add real-time Markdown preview while typing/pasting without replacing the reliable raw-text composer.
10. Fix Arabic/RTL ordered/unordered list marker placement while preserving correct LTR Markdown.
11. Redesign the chat three-dot/action menu into a consistent professional dark menu.
12. Redesign chat search so content matches show useful excerpts grouped by chat, can expand/collapse, highlight the query, and can open the matching chat/message.

---

# 2. Product decisions fixed by the request

These are requirements, not implementation-agent choices:

- Public Workspace root URL is `/workspace`.
- A Workspace path is reflected beneath that root, for example:

```text
/workspace
/workspace/University
/workspace/University/Research
/workspace/University/Research/thesis.md
```

- Workspace-only backup is separate from the existing full ChatUI backup.
- Preferred Workspace backup format is ZIP containing actual Markdown files and folders.
- The Gemini custom-tool round limit is user-configurable.
- Default new value: **24 rounds**.
- `-1` means **unlimited rounds**.
- Values such as `100`, `1000`, etc. are valid; do not silently clamp them to a small maximum.
- Right sidebar is overlay-only; opening it never changes chat width.
- Right-sidebar AI tool descriptions are removed.
- True navigation targets use real `<a href>` semantics; command/action controls remain buttons.
- User messages display rendered Markdown after send.
- Composer keeps raw Markdown as the editable/canonical value but shows a live formatted preview.
- Search must show message context, not only chat names/counts.
- No runtime implementation occurs until explicit approval after this plan review.

---

# 3. Research basis and design standards

The implementation should follow these researched standards instead of inventing custom behavior where browser semantics already solve the problem.

## 3.1 Navigation and browser history

- MDN `<a>`: an anchor with `href` is a real hyperlink; links are appropriate for navigation to a real URL, while buttons are appropriate for actions.
- MDN History API: `history.pushState()` adds same-origin SPA history entries; `replaceState()` updates the active entry; `popstate` restores state during Back/Forward.
- Public path segments must be encoded individually; Workspace virtual-path parsing remains owned by `workspace-paths.js`.

Sources:

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/a
- https://developer.mozilla.org/en-US/docs/Web/API/History/pushState
- https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API
- https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event

## 3.2 RTL and logical layout

- MDN recommends `dir="auto"` for user/external text whose direction is unknown.
- Direction is semantic, so use the HTML `dir` attribute where possible rather than forcing CSS `direction` globally.
- CSS logical properties such as `padding-inline-start` automatically map indentation to the correct side for RTL/LTR.

Sources:

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/dir
- https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/padding-inline-start

## 3.3 Composer editing

- `<textarea>` is a browser-provided multiline plain-text editor.
- Replacing it with a hand-built rich editor would make the application responsible for more selection, caret, IME, mobile keyboard, paste, undo, and composition behavior.
- `EditContext` demonstrates how much extra responsibility custom editors require and is not broadly baseline-supported.

Therefore v1 of this request uses a **live Markdown preview next to/above the textarea**, not a naive contenteditable replacement.

Sources:

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/textarea
- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Global_attributes/contenteditable
- https://developer.mozilla.org/en-US/docs/Web/API/EditContext_API

## 3.4 Search and accessible expand/collapse

- Use `<mark>` elements for portions of text relevant to a search match.
- Grouped expandable chat-result sections should follow the WAI-ARIA Accordion pattern: button header, `aria-expanded`, `aria-controls`, keyboard activation with Enter/Space.

Sources:

- https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Elements/mark
- https://www.w3.org/WAI/ARIA/apg/patterns/accordion/

## 3.5 Action menus

The existing action-menu primitive already uses `role="menu"`/`menuitem`; preserve that architecture and align it more closely with the WAI-ARIA Menu Button pattern rather than replacing it with a visually-only popup.

Sources:

- https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/
- https://www.w3.org/WAI/ARIA/apg/patterns/menubar/

## 3.6 Workspace ZIP format and restore safety

Use a pinned local ZIP library rather than a runtime CDN. `fflate` supports browser ZIP creation/extraction, nested paths, Unicode filenames, and asynchronous APIs. Pin the exact package version during implementation and vendor only the required browser module/license.

Archive restore must reject path traversal, unsafe entries and decompression abuse. OWASP specifically identifies archive directory traversal, symlink attacks and ZIP bombs; validate the archive **before** replacing Workspace data and bound decompressed data.

Sources:

- https://github.com/101arrowz/fflate
- https://owasp.org/www-project-web-security-testing-guide/latest/4-Web_Application_Security_Testing/10-Business_Logic_Testing/09-Test_Upload_of_Malicious_Files
- https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html

---

# 4. Current architecture findings

## 4.1 Workspace currently has no route

`ChatUI/js/workspace/workspace-navigation-bridge.js` explicitly treats Workspace as a non-route app mode and closes Workspace on `popstate`.

`ChatUI/js/workspace/workspace-ui.js` already maintains a canonical selected node:

```text
{ id, type, path }
```

and the Workspace service already returns canonical paths. That state should become the route source rather than introducing a second path model.

## 4.2 Combined-shell routing is currently Chat/Todo only

`shell/js/router.js` currently understands:

```text
/todo-list-ui
/chat-ui
/chat-ui/chat/<chatId>
```

Unknown paths fall back to Todo.

`worker.js` similarly shell-routes only root/Todo/Chat public paths. `/workspace/...` therefore needs explicit routing support in both places.

The shell must continue owning the top-level browser URL because Chat runs inside a persistent iframe in the combined application.

## 4.3 Workspace DOM currently uses non-link navigation controls

Examples in `workspace-ui.js`:

- tree row is a `div` with click logic;
- folder-card primary area is a `button`;
- Workspace search results are `button`s.

These need real route `href`s while keeping separate three-dot/action buttons as buttons.

## 4.4 Chat list items are not links

`ChatUI/js/sidebar/sidebar-render.js` builds each chat as a clickable `<li>`, so native browser link actions do not exist.

New-chat controls in `ChatUI/html/left-sidebar.html` are also div/button actions rather than real navigation links.

## 4.5 Embedded external-link policy would currently interfere

`ChatUI/js/embedded/shell-bridge.js` currently intercepts HTTP(S) anchors broadly. Same-origin app links must be exempted so the new real chat/Workspace links retain browser behavior.

## 4.6 Existing full backup already includes Workspace, but it is the wrong product for this request

`ChatUI/js/storage/backup-restore.js` snapshots all ChatUI object stores and generates `.chatui.json`, including chats/settings/attachments/Workspace.

The new feature must not replace this. It is a second, **Workspace-only**, human-readable ZIP workflow.

## 4.7 Workspace storage already has everything needed for ZIP export

`ChatUI/js/workspace/workspace-storage.js` exposes all Workspace nodes/files.

Database version 3 already has:

```text
workspaceNodes
workspaceFiles
```

No new store is required.

## 4.8 Custom tool loop has two hard limits

`ChatUI/js/api/gemini.js` currently has:

```text
MAX_CUSTOM_TOOL_ROUNDS = 12
MAX_CUSTOM_FUNCTION_CALLS = 32
```

and throws Workspace-specific fatal errors when either budget is exhausted.

A round setting alone would be misleading if the hidden 32-function total remained, so both pieces must be redesigned together.

## 4.9 Right sidebar is currently part of flex layout

`ChatUI/css/components/right-sidebar.css` gives the sidebar a fixed width and `flex-shrink: 0`; collapse is negative `margin-right`. Therefore opening it consumes layout width and pushes content.

`ChatUI/js/ui/chat-controls.js` already has good `inert`, `aria-hidden`, focus and transition handling; preserve it and change the geometry to transform-based overlay behavior.

## 4.10 User messages bypass Markdown rendering

`ChatUI/js/chat/message-renderer.js` currently:

```text
assistant → renderMarkdown(...)
user      → textContent = content
```

`ChatUI/js/chat/markdown.js` already uses `marked` + DOMPurify and is the correct shared rendering path.

Raw Markdown remains stored in `message.content`; HTML should never become the canonical persisted message.

## 4.11 RTL list bug has a concrete cause candidate

`markdown.js` applies `dir="auto"` to paragraphs/headings/list items/cells/etc., but not the `ol`/`ul` container itself.

Current CSS also has wrapper-direction-specific list margins. Ordered-list marker placement can therefore be governed by a list container whose direction does not match its Arabic list items.

## 4.12 Search already scans message content but throws the useful data away

`ChatUI/js/storage/load.js::searchMessageChatIds()` reads messages and identifies matching chat IDs/counts.

`ChatUI/js/sidebar/search.js` then renders only chat title + count. The storage/search layer must return message IDs and bounded excerpts/ranges so UI can show the context the user actually searched for.

---

# 5. Workspace public route grammar

## 5.1 Combined-app routes

Add:

```text
/workspace
/workspace/<segment>
/workspace/<segment>/<segment>/...
```

A route maps to Chat app + Workspace surface.

Shell route shape should become conceptually:

```js
{
  app: 'chat',
  surface: 'workspace',
  workspacePath: '/University/Research/thesis.md',
  path: '/workspace/University/Research/thesis.md'
}
```

Chat routes remain:

```js
{
  app: 'chat',
  surface: 'chat',
  chatId
}
```

Todo remains unchanged.

## 5.2 Path encoding

Do not encode the entire Workspace path in one `encodeURIComponent()` call because `/` is the hierarchy separator.

Use helpers:

```text
Workspace path /Mahdi Notes/AI #1/file name.md
→ split validated canonical Workspace segments
→ encodeURIComponent(segment) for each segment
→ /workspace/Mahdi%20Notes/AI%20%231/file%20name.md
```

On parse:

1. take route segments after `/workspace`;
2. decode each segment exactly once;
3. reject malformed percent encoding;
4. rebuild a Workspace virtual path;
5. pass it to existing `parseWorkspacePath()` / `resolveWorkspacePath()` for canonical validation.

Do not duplicate filename/path legality rules in the shell.

## 5.3 Root/trailing slash/canonicalization

Canonical route:

```text
/workspace
```

not `/workspace/`.

For nested paths, preserve canonical Workspace case/name returned by `resolveWorkspacePath()` and replace the URL if user entered equivalent non-canonical encoding/case where applicable.

## 5.4 Back/Forward

Selecting a different folder/file by a normal user navigation should `pushState` through the route owner.

Programmatic reconciliation caused by rename/move/refresh should use `replaceState` when it represents the same selected logical node rather than creating a misleading extra Back entry.

`popstate` must open the exact routed Workspace path rather than automatically closing Workspace.

## 5.5 Refresh/direct opening/new tab

Opening `/workspace/...` in a new tab or refreshing must:

1. load the shell;
2. activate the persistent Chat iframe;
3. wait until Chat is ready;
4. command Chat to open Workspace at the public path;
5. resolve Workspace IndexedDB data;
6. render the folder/file;
7. if path does not exist, show a Workspace-specific “not found” state and offer/open `/workspace`, rather than silently switching to Todo.

---

# 6. Route ownership and bridge changes

## 6.1 Shell remains top-level route owner

Do not call top-level `history.pushState` directly from inside the embedded Chat iframe.

Extend child route communication from chat-only:

```text
chatui:route-change { chatId }
```

to a typed payload capable of:

```text
{ surface:'chat', chatId }
{ surface:'workspace', workspacePath }
```

Keep exact-origin and registered-source checks already used by the shell bridge.

## 6.2 Shell → Chat navigation

Add an explicit navigation command capable of:

```text
open chat home
open chat by ID
open Workspace root
open Workspace path
```

Do not overload Todo RPC or unrelated message channels.

## 6.3 Last Chat route

Do not let Workspace permanently replace the shell’s remembered last **chat conversation** route.

Recommended split:

```text
lastChatConversationPath
lastChatSurfacePath (optional)
```

Shell rail “Chat” should follow the intended existing product behavior. Since Workspace has its own left-sidebar navigation entry, opening Workspace should not destroy knowledge of the last conversation.

## 6.4 Worker

Update `worker.js` shell-route allowlist to include:

```regex
^/workspace(?:/.*)?$
```

while keeping `not_found_handling: none` and avoiding a broad catch-all SPA fallback.

---

# 7. Real-link navigation semantics

## 7.1 Shared internal-route helper

Add a small route helper module rather than constructing URL strings in many components, e.g.:

```text
ChatUI/js/router/app-links.js
```

Responsibilities:

```text
buildChatHref(chatId, embedded)
buildNewChatHref(embedded)
buildWorkspaceHref(workspacePath)
isUnmodifiedPrimaryNavigation(event)
```

Combined/public values:

```text
chat home: /chat-ui
chat:      /chat-ui/chat/<id>
workspace: /workspace/...
```

Standalone ChatUI values:

```text
chat home: /
chat:      /chat/<id>
workspace: /workspace/...
```

If standalone deployment cannot serve `/workspace` directly today, update its route/static-host behavior consistently rather than generating dead hrefs.

## 7.2 Chat list rows

Refactor each chat row:

```text
<li class="chat-item">
  <a class="chat-item-link" href="...">
    icon/title/generation indicator
  </a>
  <button pin>...</button>
  <button more>...</button>
</li>
```

Do **not** nest buttons inside the anchor.

Behavior:

- plain primary left click → prevent default, call existing fast `loadChat()`, update route through existing route system;
- Ctrl/Cmd-click → browser handles new tab;
- Shift-click → browser handles new window where supported;
- middle-click → browser handles new tab;
- right-click → browser native context menu includes link actions;
- Enter on focused anchor → link navigation semantics.

## 7.3 New Chat links

Convert true New Chat navigation controls (`brand-new-chat`, main New Chat action) to anchors with a valid new-chat URL.

Important startup behavior: opening `/chat-ui` or standalone `/` specifically through a New Chat link in a new tab must create/show a blank New Chat surface, not silently restore the last active persisted chat.

This requires separating:

```text
“startup restore last active chat”
```

from:

```text
“explicit public New Chat route”
```

Use route intent/history state or make `/chat-ui` unambiguously mean New Chat in the combined shell and preserve last-chat behavior only for the shell rail’s remembered route.

## 7.4 Workspace links

Convert navigation portions of:

- Workspace nav item;
- tree node label/primary hit target;
- folder-card primary hit target;
- Workspace search-result primary target;
- breadcrumb segments (recommended);

to anchors with real `/workspace/...` hrefs.

Expand/collapse toggles, refresh, rename, move, delete, create folder/page remain buttons because they are actions.

## 7.5 Embedded external-link policy

In `ChatUI/js/embedded/shell-bridge.js`:

- do not treat same-origin Chat/Workspace app routes as external links;
- preserve download links;
- external-origin HTTP(S) links can keep the external-opening policy;
- do not override modifier-click/middle-click browser behavior for internal links.

---

# 8. Workspace-only ZIP Backup & Restore

## 8.1 Keep existing full backup unchanged

Existing “Full backup” and “Restore backup” remain exactly available.

Add a second visual group in the same Settings Backup & Restore pane:

```text
Workspace backup
[Create Workspace Backup]

Restore Workspace
[Restore Workspace Backup]
```

Explain that this affects Workspace only and contains real Markdown files.

## 8.2 New modules

Recommended:

```text
ChatUI/js/workspace/workspace-backup.js
ChatUI/js/settings/workspace-backup-ui.js
ChatUI/js/vendor/fflate/...   # exact pinned browser module + license
```

Do not put ZIP logic into the existing full ChatUI backup module.

## 8.3 ZIP structure

Example:

```text
Workspace-Backup-2026-08-17-0529.zip
├── workspace-manifest.json
├── University/
│   ├── Research/
│   │   └── thesis.md
│   └── notes.md
└── Personal/
    └── ideas.md
```

Actual Workspace Markdown remains directly readable without ChatUI.

## 8.4 Manifest v1

Recommended schema:

```json
{
  "format": "chatui-workspace-backup",
  "formatVersion": 1,
  "createdAt": 1786944540000,
  "directories": [
    "University",
    "University/Research",
    "Personal"
  ],
  "files": [
    "University/Research/thesis.md",
    "University/notes.md",
    "Personal/ideas.md"
  ]
}
```

Why explicit directories matter: ZIPs can otherwise lose empty Workspace folders.

Do not use current IndexedDB node IDs as portable identity. Restore generates fresh IDs and rebuilds parent links from validated paths.

## 8.5 Export process

1. Wait for pending core/Workspace writes to settle.
2. Read all Workspace nodes/files from IndexedDB.
3. Validate internal hierarchy before exporting; fail clearly if a node has a missing/cyclic parent.
4. Build canonical paths using existing Workspace semantics.
5. Encode UTF-8 Markdown.
6. Add manifest.
7. Create ZIP asynchronously so larger Workspace backups do not freeze the UI unnecessarily.
8. Download via Blob/Object URL.
9. Display item count and archive size.

## 8.6 Restore behavior

Restore is **replace Workspace only**:

```text
replace workspaceNodes + workspaceFiles
leave chats/projects/settings/API/audio/attachments untouched
```

Use a confirmation that explicitly says current Workspace data will be replaced.

## 8.7 Validate first, mutate second

Nothing in IndexedDB is changed until the entire selected ZIP passes validation.

Validation must include:

- correct `workspace-manifest.json` format/version;
- exactly one manifest;
- valid UTF-8 JSON manifest;
- entry count within limit;
- total decompressed byte budget within limit;
- every file path relative, not absolute;
- reject `.` / `..` traversal segments;
- reject backslash path confusion and normalize/reject before path validation;
- reject malformed percent-like tricks only insofar as actual names violate Workspace naming rules; archive paths are literal names, not URL decoded;
- only expected directory entries, `.md` files and manifest;
- reject duplicate archive paths;
- reject duplicate sibling names according to Workspace’s existing case/name-key rules;
- each `.md` file respects existing `WORKSPACE_MAX_FILE_BYTES`;
- manifest entries exactly correspond to archive content;
- no missing parent directory relationships;
- no impossible hierarchy;
- reject symlink/special entries if library metadata exposes them;
- reject nested archives as ordinary Workspace files because only `.md` is accepted;
- cumulative decompressed bytes checked while decoding to protect against ZIP bombs.

Recommended v1 bounds:

```text
maximum entries: 10,000
maximum total uncompressed Workspace backup: 100 MiB
per Markdown file: existing WORKSPACE_MAX_FILE_BYTES
```

If real existing Workspace limits make 100 MiB inappropriate during implementation, use the lower safe bound and document it in the UI; do not leave extraction unbounded.

## 8.8 Atomic Workspace replacement

Add one narrow low-level storage primitive, e.g.:

```text
replaceWorkspaceSnapshot(nodes, files)
```

It opens a single readwrite transaction over:

```text
workspaceNodes
workspaceFiles
```

and:

1. clears both stores;
2. writes fully validated newly generated node/file records parent-first;
3. commits once.

Transaction failure leaves the old Workspace intact.

After success:

- clear Workspace UI caches;
- dispatch a dedicated restore/change event;
- if current `/workspace/...` route no longer exists, replace route with `/workspace`;
- otherwise reopen the restored current path.

No IndexedDB version bump.

---

# 9. Configurable custom-tool round limit

## 9.1 New setting

Add to application state/settings:

```text
customToolRoundLimit: 24
```

Validation:

```text
-1 → unlimited
1 or greater safe integer → finite round cap
0, decimals, NaN, empty invalid → do not save; show validation
```

Do not impose an arbitrary small upper bound that prevents 100/1000.

## 9.2 Settings UI

Place under Settings → Gemini after the Text Base URL configuration:

```text
Custom tool round limit
[ 24 ]
Maximum client-tool rounds per answer. Use -1 for unlimited.
```

Use `type="number"`, `step="1"`, `min="-1"`, but JavaScript remains authoritative because HTML attributes alone are not enough validation.

Changes apply to the **next generation**. An already-running generation keeps its start-time snapshot so changing Settings cannot mutate loop rules halfway through an answer.

## 9.3 Persistence

Modify:

```text
ChatUI/js/state/store.js
ChatUI/js/storage/load.js
ChatUI/js/storage/records.js
ChatUI/js/settings/settings.js
ChatUI/html/settings-modal.html
```

No database migration/store change: it is another field on the existing `settings` record.

Older DB/settings with no field normalize to `24`.

## 9.4 Remove hidden contradictory total cap

The existing `MAX_CUSTOM_FUNCTION_CALLS = 32` cannot remain as a second small total cap, because setting rounds to 100/1000 would still fail around 32 calls.

Recommended architecture:

- configured setting controls total **round count**;
- remove the fixed 32 total-function-call budget;
- retain a defensive **per-response/per-round** sanity cap for an absurd single Gemini response, e.g. max 16 custom function calls returned in one round;
- sequentially execute valid calls using existing tool executors;
- for `-1`, there is no total round cap and therefore user Stop/Abort is the intentional escape mechanism.

This preserves the meaning the setting presents to the user.

## 9.5 Finite-limit graceful finish

Do not throw a network-looking fatal exception merely because the configured finite tool round budget was reached.

When the last permitted round still returns custom `functionCall`s:

1. Do **not** execute calls beyond the configured budget.
2. Preserve the model content/thought signatures exactly like current tool-round history handling.
3. Return a functionResponse for each unexecuted custom call with a stable structured result:

```json
{
  "ok": false,
  "error": {
    "code": "CUSTOM_TOOL_ROUND_LIMIT_REACHED",
    "message": "The configured custom tool round limit was reached before this call could run."
  }
}
```

4. Run one final model turn with **custom Workspace/Todo declarations disabled** and an explicit instruction to summarize completed work and explain that more work can continue in the next user turn.
5. Native server-side tools may remain available if they do not re-enter the client custom-tool loop.
6. Do not count this final narration pass as another custom-tool round because custom functions are disabled.

If even final narration fails at the API/network level, surface the real API error rather than confusing it with the tool limit.

## 9.6 Generic naming

Replace stale text such as:

```text
Gemini Workspace tool loop exceeded...
```

with generic “custom tool” language, because the same loop now runs Workspace and To-Do functions.

---

# 10. Right sidebar overlay

## 10.1 Geometry

Change `.right-sidebar` from flex participant to overlay:

```text
position: absolute (inside .app-container)
top: 0
right: 0
bottom: 0
width: var(--right-sidebar-width)
z-index above chat
```

Open:

```text
transform: translateX(0)
```

Closed:

```text
transform: translateX(100%)
pointer-events: none
```

Remove layout-affecting negative `margin-right` behavior.

Add an elevated shadow/border so it reads as an overlay panel.

## 10.2 Mobile

Use a responsive width such as:

```text
min(var(--right-sidebar-width), calc(100vw - 24px))
```

or a dedicated mobile value after visual testing.

Add/repurpose a backdrop/scrim behind the right panel on narrow screens so tapping outside closes it, matching the left-sidebar interaction model.

## 10.3 Existing JavaScript

Preserve:

- `inert` when closed;
- `aria-hidden`;
- `aria-expanded` on trigger;
- focus close button on open;
- restore focus on close;
- Escape handling.

Update close-transition listener to rely on `transform`, not `margin-right`.

Opening/closing must not change `.main-content` width or composer width.

---

# 11. Remove right-sidebar tool descriptions

In `ChatUI/html/right-sidebar.html`, remove `.tool-desc` lines beneath:

- Google Search;
- URL Context;
- Code Execution;
- Workspace;
- To-Do, including the second disclosure line in this **right-sidebar card**.

Card becomes:

```text
icon + name                         toggle
```

Do not remove descriptions from the composer Tools popup unless separately requested.

Remove unused right-sidebar `.tool-desc` CSS after confirming no other component relies on that selector.

---

# 12. Render Markdown in user messages

## 12.1 Use one renderer

Change `ChatUI/js/chat/message-renderer.js` so both completed user and assistant textual content go through the existing:

```text
renderMarkdown(content)
```

pipeline.

Do not duplicate `marked`, DOMPurify or syntax highlighting logic.

## 12.2 Persistence remains raw

Keep:

```text
message.content = original Markdown source
```

The rendered DOM is presentation only.

This preserves:

- edit/regenerate behavior;
- copy raw/source behavior where currently expected;
- search over original content;
- portable backups;
- safe re-render after theme/layout changes.

## 12.3 User-bubble Markdown styling

Audit Markdown spacing inside `.message.user .message-bubble`:

- first/last block margins collapse visually to bubble padding;
- lists fit within 85% max user width;
- pre/code overflow horizontally rather than widening page;
- tables scroll in bubble when needed;
- headings do not become comically large relative to message bubble;
- RTL uses same list fix in section 14.

---

# 13. Real-time Markdown preview in composer

## 13.1 Do not replace textarea in v1

Keep `#composer-textarea` as the canonical editable control.

Reason: it already owns working Enter/Shift+Enter, auto-resize, mobile input, paste, IME, selection, undo and send behavior. Re-rendering a contenteditable DOM on each keystroke would create unnecessary caret/selection/IME risk.

## 13.2 Preview DOM

Inside `composer-container`, add a preview region immediately above the composer bar, for example:

```html
<div id="composer-markdown-preview" class="composer-markdown-preview hidden" aria-hidden="true"></div>
```

Optional subtle `Preview` label may be used, but no large extra toolbar is needed.

Preview:

- appears only when textarea contains non-whitespace Markdown/text;
- renders through the exact same `renderMarkdown()` function used for messages;
- updates after `input`, including paste, delete, undo and programmatic draft changes;
- clears/hides immediately after send/reset;
- never changes textarea `.value`;
- never gets persisted;
- no network requests.

## 13.3 Performance

For normal input, schedule preview rendering with `requestAnimationFrame` or a small ~50–100 ms debounce so rapid typing does not rebuild DOM multiple times per frame.

Cancel stale scheduled renders.

If input becomes extremely large, render at the same maximum/source limits already accepted by the composer; do not invent a different text sent to Gemini.

## 13.4 Mobile behavior

Preview maximum height should be bounded, approximately 30–35dvh, with its own overflow scroll, so a long preview cannot cover the whole phone screen.

Keep textarea accessible and visible for editing.

`aria-hidden="true"` avoids screen readers reading duplicate preview text while the textarea already exposes the same source; if later an explicit preview-reading feature is desired, design it separately.

## 13.5 Direction

Set textarea `dir="auto"` and use the same direction-aware Markdown renderer for preview.

---

# 14. Fix RTL/Arabic Markdown lists

## 14.1 Renderer changes

In `ChatUI/js/chat/markdown.js`, include list containers in auto-direction processing:

```text
ol
ul
```

Continue applying `dir="auto"` to block/list-item content.

Keep:

```text
pre/code → dir=ltr
```

so code remains readable.

## 14.2 CSS changes

Replace wrapper-direction physical/special list margins with logical properties:

```css
.markdown-content ul,
.markdown-content ol {
  margin-block: ...;
  margin-inline: 0;
  padding-inline-start: 1.5rem;
}

.markdown-content li {
  text-align: start;
}
```

Use logical indentation for nested lists as well.

Avoid a rule that assumes the entire `.markdown-content` wrapper has the same direction as every list.

## 14.3 Required test cases

1. Pure Arabic ordered list.
2. Pure Arabic unordered list.
3. Pure English list.
4. Arabic paragraph followed by English list.
5. English paragraph followed by Arabic list.
6. Arabic list items containing Latin numbers/URLs.
7. Nested Arabic ordered + unordered lists.
8. Numbering with bold/inline code.
9. User-message Markdown.
10. Assistant Markdown.
11. Composer preview.

Markers must stay adjacent to the list text on the correct logical start side.

---

# 15. Chat action-menu redesign

## 15.1 Keep shared primitive

Retain `ChatUI/js/ui/action-menu.js` as the single popup implementation.

Do not create a sidebar-specific second menu engine.

## 15.2 Add item grouping/separators

Extend the menu item descriptor in a small generic way, preferably one of:

```js
{ type: 'separator' }
```

or:

```js
{ separatorBefore: true, ... }
```

The first is clearer for generic menus.

Action menus continue accepting command items and disabled/danger states.

## 15.3 Visual design

Update action-menu styling to the requested professional dark-gray style:

```text
surface: elevated dark gray, not pure page black
width: ~210–240 px depending labels
panel radius: ~12 px
panel padding: 6–8 px
row min height: ~40 px
icon column: fixed ~20 px
icon/text gap: 10–12 px
normal labels: white/primary text
destructive Delete: red
hover: subtle lighter dark surface
separators: thin muted line
```

Use grid/flex alignment so Pin, Move, Delete and every icon share one vertical baseline.

Do not allow the global blue focus outline to look like an oversized selected-row border; provide a deliberate accessible `:focus-visible` treatment inside the menu with sufficient contrast.

## 15.4 Menu order

Recommended chat menu:

```text
Pin Chat / Unpin Chat
────────────
Move to Project    >
────────────
Delete Chat
```

If Rename/Archive are added in the future, shared menu design supports them without another redesign.

## 15.5 Accessibility

Preserve/add:

- trigger `aria-haspopup="menu"`;
- trigger `aria-expanded`;
- popup `role="menu"`;
- actionable rows `role="menuitem"`;
- Enter/Space activation;
- Escape closes/restores focus;
- ArrowUp/ArrowDown navigation;
- add Home/End navigation if straightforward, matching WAI menu behavior.

Separators use `role="separator"` and are never focusable.

---

# 16. Search redesign: contextual message results

## 16.1 New search data contract

Move content-search logic out of generic `load.js` into a focused module, recommended:

```text
ChatUI/js/storage/search.js
```

New function concept:

```js
searchConversationMatches(query, { signal, maxChats, maxExcerpts })
```

Return grouped, bounded data:

```json
{
  "query": "235",
  "totalMatchingMessages": 7,
  "truncated": false,
  "chats": {
    "chat-id": {
      "messageMatchCount": 3,
      "excerpts": [
        {
          "messageId": "msg-id",
          "role": "user",
          "sequence": 12,
          "createdAt": 123,
          "text": "...nearby context containing 235...",
          "matchRanges": [{ "start": 30, "end": 33 }]
        }
      ],
      "truncated": false
    }
  }
}
```

Do not return rendered HTML from storage.

## 16.2 Scan strategy

There is no full-text index in IndexedDB today. Avoid a schema migration only for this UI improvement.

Use a read-only IndexedDB cursor over `messages` instead of `getAll()` so search does not allocate every full message into one giant array before filtering.

For each message:

1. compare `content` case-insensitively;
2. if no match, discard immediately;
3. if match, build only bounded excerpt metadata;
4. stop collecting extra excerpts after limits, while optionally continue counting only if inexpensive;
5. respect stale-search cancellation/sequence so old results never replace newer input.

Keep existing ~200 ms UI debounce.

## 16.3 Context/snippet algorithm

For each matching message:

1. Find query occurrences case-insensitively in raw text.
2. Prefer the paragraph (blank-line-delimited block) containing the first relevant occurrence.
3. If the paragraph is short enough, show it whole.
4. If long, crop around the match with approximately 140–180 characters before and after, respecting Unicode string boundaries as safely as practical.
5. For strongly line-oriented text, include at most one nearby line before and one after when that fits the same character budget.
6. Prefix/suffix `…` when cropped.
7. Merge overlapping snippets from multiple close occurrences in the same message.
8. Keep multiple distant matches as separate excerpt rows only up to per-chat cap.

Suggested bounds:

```text
max excerpt length: ~360 characters
max initial excerpts per chat: 8
max displayed chat groups: 50
max total excerpt rows retained: 100
```

If truncated, UI explicitly says more matches exist.

## 16.4 Search ranking

Deterministic recommendation:

1. exact chat-title match;
2. title starts with query;
3. title contains query;
4. message-content match count/relevance;
5. chat `updatedAt` newest first as tie-breaker.

A title-only result still appears with “Title match” and no fabricated message excerpt.

## 16.5 Result UI

Replace flat `.search-result-item` with grouped result cards.

Collapsed chat group header:

```text
[chevron] Chat Title                 3 matches   [Open]
          first short matching preview (optional)
```

Expanded:

```text
You
...two/three lines with <mark>235</mark>...

Assistant
...another paragraph containing <mark>235</mark>...
```

Each group header toggle follows accordion semantics (`aria-expanded`, `aria-controls`).

“Open Chat” is a real anchor using the shared chat route helper, so right-click/middle-click also work.

## 16.6 Safe highlighting

Do not build excerpt HTML by concatenating query/raw message text.

Construct DOM with:

```text
Text node before match
<mark>matching text</mark>
Text node after match
```

from computed ranges.

This avoids introducing a second sanitization problem.

## 16.7 Open exact message

`message-renderer.js` already gives messages stable IDs/data attributes. Add a shared helper:

```text
openChatAtMessage(chatId, messageId)
```

Same-tab excerpt click:

1. load the chat;
2. wait until its messages render;
3. find exact message by stable ID;
4. `scrollIntoView({ block:'center', behavior:'smooth' })`;
5. apply a subtle temporary `search-target-highlight` class for ~1.5–2 seconds;
6. remove highlight timer safely if navigation changes.

Recommended public deep link for share/new-tab behavior:

```text
/chat-ui/chat/<chatId>#message=<messageId>
```

or an equivalent deterministic fragment helper.

Route parser continues using pathname for chat identity and separately reads/validates the fragment. On direct refresh/new tab, load chat first then scroll to the requested stable message ID.

If message was deleted, simply open the chat and show no highlight; do not error the entire route.

## 16.8 Search modal layout

Current modal result area is only ~250 px tall. Add a search-specific layout:

- wider card on desktop, bounded to viewport;
- results max-height around 60–70dvh;
- sticky search input/header optional;
- clear empty state;
- cards with comfortable spacing;
- responsive phone width `calc(100vw - 24px)`;
- no horizontal overflow for long URLs/code excerpts;
- role/status announcement gives match counts but does not announce every live excerpt character.

---

# 17. File-by-file implementation map

## 17.1 Routing / links

Modify:

```text
shell/js/router.js
shell/js/app-shell.js
shell/js/frame-bridge.js
worker.js
ChatUI/js/router/chat-router.js
ChatUI/js/embedded/shell-bridge.js
ChatUI/js/workspace/workspace-navigation-bridge.js
ChatUI/js/workspace/workspace-ui.js
ChatUI/js/sidebar/sidebar-render.js
ChatUI/js/sidebar/sidebar-layout.js
ChatUI/html/left-sidebar.html
ChatUI/html/workspace.html
```

Add recommended:

```text
ChatUI/js/router/app-links.js
```

Possibly add a focused Workspace route adapter rather than overloading `workspace-ui.js` if file size/complexity grows:

```text
ChatUI/js/workspace/workspace-routing.js
```

## 17.2 Workspace backup

Modify:

```text
ChatUI/html/settings-modal.html
ChatUI/js/settings/settings.js           # initialize UI module if needed
ChatUI/js/workspace/workspace-storage.js # narrow atomic replace helper
ChatUI/css/components/backup-restore.css
```

Add:

```text
ChatUI/js/workspace/workspace-backup.js
ChatUI/js/settings/workspace-backup-ui.js
ChatUI/js/vendor/fflate/... + LICENSE
```

Do not rewrite existing:

```text
ChatUI/js/storage/backup-restore.js
ChatUI/js/storage/backup-restore-transaction.js
```

except a tiny shared helper extraction only if genuinely reusable without coupling formats.

## 17.3 Custom-tool loop setting

Modify:

```text
ChatUI/js/api/gemini.js
ChatUI/js/state/store.js
ChatUI/js/storage/load.js
ChatUI/js/storage/records.js
ChatUI/js/settings/settings.js
ChatUI/html/settings-modal.html
ChatUI/css/components/settings.css
```

## 17.4 Right sidebar/tool descriptions

Modify:

```text
ChatUI/html/right-sidebar.html
ChatUI/css/components/right-sidebar.css
ChatUI/js/ui/chat-controls.js
ChatUI/css/responsive.css          # only if mobile override needed
ChatUI/html/global-ui.html         # only if a reusable right-sidebar backdrop is added here
```

## 17.5 Markdown + preview + RTL

Modify:

```text
ChatUI/js/chat/message-renderer.js
ChatUI/js/chat/markdown.js
ChatUI/js/composer/composer.js
ChatUI/html/main-chat.html
ChatUI/css/chat/markdown.css
ChatUI/css/chat/messages.css
ChatUI/css/chat/composer.css
```

## 17.6 Action menu

Modify:

```text
ChatUI/js/ui/action-menu.js
ChatUI/js/sidebar/sidebar-actions.js
ChatUI/css/sidebar/items.css
```

Potentially no HTML change because menu is generated dynamically.

## 17.7 Search

Modify:

```text
ChatUI/js/sidebar/search.js
ChatUI/html/chat-modals.html
ChatUI/css/components/modals.css
ChatUI/js/chat/message-renderer.js      # only for target helper/data hooks if needed
ChatUI/js/chat/chat.js / load path      # only for open-at-message helper integration
```

Add recommended:

```text
ChatUI/js/storage/search.js
ChatUI/js/chat/message-navigation.js
```

Retire `searchMessageChatIds()` from `storage/load.js` after no caller remains.

## 17.8 Verification/build

Modify as needed:

```text
scripts/verify-integration.mjs
.github/workflows/iframe-integration-check.yml
scripts/build-static.mjs               # likely no code change if it already recursively copies trees
```

Add a focused pure-JS verifier if route/path/search/backup helpers benefit from deterministic tests, e.g.:

```text
scripts/verify-chatui-navigation-ux.mjs
```

---

# 18. Detailed implementation sequence

## Phase 1 — Shared route/link contracts

1. Add public route builders/parsers.
2. Add Workspace route grammar in shell.
3. Add Chat child/shell surface-aware route messages.
4. Add worker `/workspace` shell routing.
5. Add direct route restoration + Back/Forward behavior.
6. Verify persistent iframes are never reloaded simply because route changes.

## Phase 2 — Real anchors

1. Chat rows become anchors + sibling action buttons.
2. New Chat navigation becomes real links.
3. Workspace nav/tree/cards/search/breadcrumb destinations become links.
4. Preserve unmodified left-click SPA behavior.
5. Fix embedded external-link policy.
6. Add optional message-fragment route support used later by search.

## Phase 3 — Workspace ZIP backup

1. Vendor pinned fflate/browser module + license.
2. Build export snapshot/manifest/ZIP.
3. Build strict ZIP validation.
4. Build fresh-ID hierarchy reconstruction.
5. Add atomic Workspace-only storage replace.
6. Add Settings UI/status/confirmation.
7. Reconcile active Workspace route after restore.

## Phase 4 — Custom-tool setting/loop finish

1. Add normalized setting + persistence/UI.
2. Snapshot setting at generation start.
3. Remove hidden conflicting 32-total cap.
4. Add per-round defensive call count.
5. Implement finite-limit structured stop + final narration pass.
6. Rename Workspace-specific loop wording generic.
7. Confirm `-1` truly has no round total cap and Stop still aborts.

## Phase 5 — Sidebar and action-menu visual fixes

1. Right sidebar transform overlay.
2. Mobile scrim/outside-close.
3. Remove right-side tool descriptions.
4. Action-menu separators/layout/colors/alignment/focus.
5. Regression-test menu positioning near viewport edges.

## Phase 6 — Markdown presentation

1. User messages use shared Markdown renderer.
2. Add live composer preview.
3. Add `ol/ul dir=auto` and logical list CSS.
4. Test Arabic/LTR/mixed lists in assistant, user and preview.

## Phase 7 — Search context

1. Add cursor-based message search API.
2. Add paragraph/line excerpt/range algorithm.
3. Build grouped accordion UI + real Open Chat links.
4. Safe `<mark>` highlight nodes.
5. Add open-at-message scrolling/temporary highlight.
6. Add bounded result/truncation handling.

## Phase 8 — Static/build verification

1. Syntax-check all changed/new JS.
2. Run existing integration verifier.
3. Extend verifier for Workspace routes/anchors/persistent iframe invariants.
4. Add pure tests for route encoding, ZIP validation helpers, loop-limit normalization, excerpt generation and RTL-render hooks where feasible without a browser.
5. Run safe static build.
6. Run existing local route checks and extend for `/workspace/...`.

## Phase 9 — Feature branch + PR workflow when implementation is authorized

At implementation time:

1. fetch exact latest `main`;
2. create a clean feature branch from that exact SHA;
3. implement this plan only;
4. run all automated static/build checks;
5. open PR;
6. user performs browser/mobile/manual behavior tests;
7. fix findings;
8. merge only after approval/verification according to current project workflow.

---

# 19. Required automated/static test cases

## Routes

- `/workspace` parses as Chat/Workspace root.
- Unicode/spaces/#/?/% names encode/decode segment-by-segment.
- malformed encoding rejected/falls back to Workspace not-found handling.
- `/chat-ui/chat/<id>` unchanged.
- `/todo-list-ui` unchanged.
- unknown public route does not accidentally masquerade as Workspace.
- worker recognizes Workspace deep links.

## Link semantics

Static markup verifies chat/New Chat/Workspace navigation targets use anchors with hrefs.
Action buttons are not nested inside anchors.
Same-origin links are excluded from embedded external-link forced-new-tab policy.

## Workspace ZIP

- root-only empty Workspace exports/restores.
- nested folders/files round-trip.
- empty folders round-trip.
- Unicode/Arabic folder/file names round-trip.
- duplicate/case-conflicting sibling rejected.
- traversal `../` rejected.
- absolute path rejected.
- backslash path confusion rejected.
- undeclared archive entry rejected.
- missing declared entry rejected.
- wrong manifest version rejected.
- non-Markdown payload rejected.
- file too large rejected.
- total uncompressed budget rejected.
- failed restore validation leaves existing Workspace unchanged.
- simulated transaction failure leaves old Workspace intact.

## Tool round setting

- missing setting → 24.
- `24`, `100`, `1000` accepted.
- `-1` accepted.
- `0`, `< -1`, decimal, NaN rejected/normalized safely.
- finite last tool round returns `CUSTOM_TOOL_ROUND_LIMIT_REACHED` for unexecuted calls and final narration rather than API connection error.
- `-1` loop does not hit a hidden 32-call total.
- Abort stops unlimited loop.

## Search helper

- case-insensitive query.
- exact paragraph excerpt.
- long paragraph cropped with ellipses.
- line-oriented surrounding context bounded.
- overlapping match ranges merged.
- matches at beginning/end safe.
- Unicode/Arabic query highlighting preserves text.
- bounds/truncation respected.
- no raw HTML generated by storage search helper.

---

# 20. User manual browser/mobile checklist

## Workspace routes/links

- Click Workspace → address bar `/workspace`.
- Click nested folder/file → exact encoded path in address bar.
- Back/Forward moves between Workspace locations.
- refresh keeps same item.
- direct-paste Workspace deep URL opens correct item.
- right-click folder/file offers normal browser link actions.
- middle-click folder/file opens new tab.
- rename selected item updates route without unwanted duplicate history step.
- move selected item updates route.

## Chat links/New Chat

- normal chat click remains fast SPA load.
- right-click chat exposes Open link in new tab/window.
- Ctrl/Cmd-click works.
- middle-click works.
- New Chat middle-click opens an actually blank new Chat tab, not previous active chat.
- three-dot and Pin buttons still act as buttons and do not trigger chat navigation.

## Workspace backup

- ZIP is downloadable.
- manually opening ZIP reveals real folder tree + Markdown files.
- empty folders survive restore.
- restore replaces Workspace only.
- chats/settings/API configuration remain unchanged.
- restored Workspace visible immediately.

## Tool limit

- set 1/24/100/-1 and start a tool-heavy request.
- current answer uses setting snapshot.
- finite cap ends gracefully with summary, not connection error.
- -1 keeps working until model finishes or user presses Stop.

## Sidebar/menu

- desktop right sidebar overlays, no chat width shift.
- phone right sidebar overlays, no squeezed conversation.
- tap backdrop/Escape/close button works.
- tool cards show names only.
- three-dot menu dark-gray, aligned, normal items white, Delete red, separators clean.

## Markdown

- sent user Markdown renders headings/bold/lists/code.
- live preview updates while typing and pasting.
- raw source remains editable.
- Shift+Enter/Enter behavior unchanged.
- Arabic numbered list marker sits beside Arabic text on right/start side.
- English lists remain normal.
- mixed RTL/LTR/code is readable.

## Search

- search title-only chat.
- search a number such as `235` contained only in message body.
- result shows relevant paragraph/context.
- several matching messages group under one chat.
- expand/collapse works by click + keyboard.
- highlighted match is accurate.
- Open Chat is a real link/new-tab capable.
- click specific excerpt loads and scrolls to exact message.
- deleted target message degrades to opening chat without crash.

---

# 21. Regression checklist

Must remain working:

- Todo app routing and persistent iframe behavior.
- Chat home/chat-ID routes.
- Workspace AI read/write tools.
- Todo AI tools and auto-wake bridge.
- Workspace and Todo function-call activity timeline.
- Google Search, URL Context, Code Execution.
- normal Gemini streaming/thought signatures.
- Stop/Abort.
- Regenerate.
- Voice Mode and Read Aloud.
- attachment sending/upload recovery.
- chat edit/delete/copy actions.
- chat project grouping/pin.
- Workspace manual create/rename/move/delete/search.
- existing full ChatUI JSON Backup & Restore.
- standalone ChatUI startup.
- static combined Worker deployment/deep links.

---

# 22. Non-goals

This plan does **not**:

- replace the composer textarea with a full WYSIWYG rich-text editor;
- change raw message persistence from Markdown source to HTML;
- add a full-text IndexedDB/search-engine index or schema migration;
- merge Workspace ZIP format with full ChatUI backup;
- export chats into the Workspace ZIP;
- use runtime CDN ZIP dependencies;
- add archive formats other than ZIP;
- allow arbitrary non-Markdown files in Workspace restore;
- redesign Todo;
- change Todo routes;
- unload/reload persistent Chat/Todo iframes on normal navigation;
- add new chat actions such as Archive unless separately requested;
- remove the user’s ability to set `-1` unlimited custom-tool rounds;
- add a hidden small total-function-call cap that contradicts the visible setting.

---

# 23. Definition of done

Implementation is complete only when all are true:

1. Workspace root uses `/workspace`.
2. Every selected Workspace folder/file has a canonical public deep URL.
3. refresh and Back/Forward restore Workspace state.
4. Workspace, chats and New Chat expose real browser-link behavior including right/middle click.
5. New Chat opened in a new tab is actually blank/new.
6. Same-origin internal links are not hijacked by embedded external-link policy.
7. Workspace-only ZIP backup contains a real folder tree, `.md` files and versioned manifest.
8. Workspace-only restore validates fully before change and replaces only Workspace atomically.
9. ZIP traversal/symlink/special-entry/decompression/size cases are bounded/rejected.
10. custom tool round limit is stored in Settings, defaults to 24, supports 100/1000 and `-1` unlimited.
11. no hidden 32-total-call cap defeats the visible round setting.
12. finite tool-limit exhaustion produces a structured graceful final response rather than `Error connecting to Gemini API`.
13. right sidebar overlays content on desktop/mobile and never changes chat width.
14. right-sidebar AI cards contain no descriptions.
15. sent user messages render through the same sanitized Markdown pipeline as assistant messages.
16. composer shows safe real-time Markdown preview while raw textarea remains canonical/editor source.
17. Arabic/RTL ordered/unordered list markers render on the correct logical side in assistant/user/preview content.
18. chat action menu uses aligned professional dark styling and keeps accessible keyboard/menu semantics.
19. search finds message content and shows bounded contextual excerpts grouped by chat.
20. search uses safe `<mark>` DOM highlighting and never injects unsanitized raw excerpt HTML.
21. search groups expand/collapse accessibly and can open the chat.
22. a specific search match can navigate/scroll to its stable message when present.
23. existing full backup remains functional and unchanged in purpose.
24. current Chat/Todo tool integrations and persistent iframe behavior regressions are avoided.
25. static verification/build checks pass.
26. user completes the manual browser/mobile verification checklist.
27. runtime code is not merged until explicit implementation approval and the normal branch/PR review workflow are followed.
