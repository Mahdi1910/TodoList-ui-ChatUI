# ChatUI Cleanup Audit — Category 8

This is a documentation-only continuation of `CHATUI_CLEANUP_AUDIT.md`. It records audit findings and does **not** authorize application-code changes.

# Category 8 — Repeated DOM rendering/state synchronization, event-listener lifecycle, and avoidable runtime work

Status: **Audit complete. No fixes performed.**

Category 8 was audited against current `main` at `2caf0577f97325e5797bb7b3906c55bb5ed0d893`. The audit distinguishes necessary rendering/lifecycle work from repeated full-surface work inside hot paths. Existing throttling, cancellation, stale-result guards, and lazy-loading protections are preserved where they are useful.

## 1. Streaming rebuilds the complete assistant activity DOM up to once per animation frame

**Priority:** Very High

**Locations:**
- `ChatUI/js/chat/streaming.js` — `createFrameScheduler()` and `renderCurrent()`.
- `ChatUI/js/chat/activity-renderer.js` — `renderActivityTimeline()`.
- `ChatUI/js/chat/markdown.js` — Markdown parse/sanitize/direction handling.

**Finding:**

Streaming correctly coalesces multiple Gemini callbacks into at most one scheduled render per animation frame. However, each scheduled render calls `renderActivityTimeline()`, which starts with `container.replaceChildren()` and rebuilds every thinking/text/tool activity from scratch. Text and Thinking entries re-run Markdown parsing/sanitization over accumulated text, toggle-card listeners are recreated, and Lucide initialization runs again. As a response grows, work per frame grows with the entire timeline rather than only the new delta.

**Recommendation:**

Keep the existing frame scheduler, but make timeline rendering keyed/incremental. Preserve stable DOM nodes by activity ID, append newly created activities, and update only the currently running text/thinking/tool node. Defer expensive final-only Markdown/highlighting work until an activity closes or generation completes where possible.

**Action type:** Very-high-value streaming-render optimization; preserve chronological activity semantics and partial-response behavior.

---

## 2. Smart-scroll synchronization performs repeated geometry work for one programmatic scroll

**Priority:** High

**Location:** `ChatUI/js/chat/ui.js` — `scrollToBottom()`, `updateScrollToBottomButton()`, and `initSmartScrollControls()`.

**Finding:**

`scrollToBottom()` writes `scrollTop`, immediately recalculates scroll-button state, schedules another `requestAnimationFrame()` recalculation, and the programmatic scroll can also trigger the viewport's `scroll` listener, which recalculates the same distance again. During streaming this helper is called after every scheduled assistant render, so one stream frame can cause several DOM lookups and `scrollHeight` / `scrollTop` / `clientHeight` reads.

The same module also installs a capturing `document`-level `pointerdown` listener that calls `getBoundingClientRect()` on the scroll button for every pointer press anywhere in the document before deciding whether the press was actually on that control.

**Recommendation:**

Centralize scroll-state synchronization behind one per-frame scheduler. Cache the stable viewport/button references after initialization, update the button once after programmatic scrolling settles, and use a direct pointer listener on the button instead of document-wide hit testing unless a documented browser workaround truly requires capture.

**Action type:** Hot-path layout-read and global-listener cleanup.

---

## 3. Every Composer edit serializes the Milkdown document back to Markdown just to decide whether Send should be enabled

**Priority:** Very High

**Locations:**
- `ChatUI/js/composer/markdown-editor.js` — Milkdown `markdownUpdated` listener, `currentMarkdown`, `getComposerMarkdown()`, and `isComposerEmpty()`.
- `ChatUI/js/composer/composer.js` — `onChange: () => updateComposerButtons()` and `updateComposerButtons()`.

**Finding:**

Milkdown already supplies the new Markdown string to `markdownUpdated`, and the module stores that string in `currentMarkdown` before invoking the Composer change callback. That callback calls `updateComposerButtons()`, which calls `isComposerEmpty()`. `isComposerEmpty()` then calls `getComposerMarkdown()`, causing `editor.action(getMarkdown())` to serialize the editor state again even though the fresh Markdown is already cached.

This happens on ordinary typing and editing, so the rich document is unnecessarily serialized on each edit for a boolean emptiness check.

**Recommendation:**

Use `currentMarkdown` (or pass a precomputed `hasText` value through the change callback) for button-state synchronization. Reserve `getMarkdown()` serialization for boundaries that actually need the canonical output, such as Send or explicit export/read operations.

**Action type:** Very-high-confidence hot-path simplification.

---

## 4. Composer direction synchronization rescans the whole rich-editor DOM on typing frames

**Priority:** Medium/High

**Location:** `ChatUI/js/composer/markdown-editor.js` — `scheduleDirectionSync()` / `syncDirectionAttributes()`.

**Finding:**

Direction synchronization is sensibly coalesced through one `requestAnimationFrame()`, but each run queries the full editor for block nodes (`p`, headings, lists, list items, blockquotes, table cells) and code nodes, then rewrites `dir` attributes. As the draft becomes larger, ordinary typing repeatedly scans the entire editor DOM even when only one paragraph changed.

**Recommendation:**

Prefer CSS/ProseMirror node semantics for direction where possible, or update only changed/nearby nodes from the editor transaction. Keep the current rAF coalescing if a DOM pass remains necessary.

**Action type:** Medium-priority editor scaling optimization.

---

## 5. Small sidebar changes trigger a wholesale rebuild and repeated full-chat partitioning

**Priority:** Very High

**Location:** `ChatUI/js/sidebar/sidebar-render.js`.

**Frequent callers include:**
- chat Send before generation;
- generation lifecycle finish;
- automatic title completion;
- pin/unpin, rename/delete, Project operations, navigation, and chat loading.

**Finding:**

`renderSidebar()` clears Pinned, Projects, and Recent containers and recreates every row/listener. It filters/sorts `state.chats` separately for Pinned and Recent, then for **every Project** filters the entire chat array again to find that Project's chats. The result is repeated `projects × chats` partition work plus complete DOM/listener recreation even when only one chat's title, active state, pin state, or generation indicator changed.

Normal Send can refresh the Sidebar before generation, generation finalization can refresh it again, and background automatic title generation can trigger another full refresh.

**Recommendation:**

At minimum, partition chats once per render into Pinned/Recent/Project buckets and sort each bucket once. Prefer a keyed sidebar renderer that updates only affected chat/project rows and active/generating classes. A full rebuild can remain as a simple recovery/fallback path.

**Action type:** Very-high-value rendering/state-synchronization cleanup.

---

## 6. Sidebar long-press cleanup exists but the wholesale renderer ignores it

**Priority:** High

**Locations:**
- `ChatUI/js/sidebar/press-actions.js` — `bindSidebarActionPress()` returns a teardown function and owns long-press/suppress-click timers.
- `ChatUI/js/sidebar/sidebar-render.js` — binds Project/chat press behavior but discards the returned teardown.

**Finding:**

The press helper has an explicit lifecycle contract for removing seven listeners and clearing armed timers. The renderer replaces all sidebar rows via `innerHTML = ''` but never calls that teardown. Detached node listeners will normally become collectible with their nodes, but an already armed timer can keep the closure alive until it fires and can invoke an action callback against an anchor that has already been removed by a sidebar rerender.

**Recommendation:**

If full rerendering remains, register and run row teardowns before replacing the DOM. Better, move long-press/context handling to a single delegated Sidebar interaction manager so one timer/listener lifecycle survives row updates safely.

**Action type:** Event/timer lifecycle correctness cleanup; do not describe it as a guaranteed permanent memory leak.

---

## 7. Workspace navigation can rebuild the entire expanded tree multiple times for one logical action

**Priority:** Very High

**Location:** `ChatUI/js/workspace/workspace-ui.js`.

**Examples:**
- expanding a directory renders once for the loading state and again after children load;
- `revealPath()` ends by calling `renderTree()`;
- `selectEntry()` calls `renderTree()` again;
- root-path opening calls `renderTree()` before `selectEntry()`;
- non-root opening can render in `revealPath()` and then again in `selectEntry()`;
- mutation refresh paths can repeat the same reveal/render/select sequence.

**Finding:**

`renderTree()` clears and recreates the complete visible tree, row listeners, expanded children, selected classes, and icons. Several navigation/mutation workflows call that whole-tree renderer twice or more before one user-visible state transition is complete.

**Recommendation:**

Separate path/cache preparation from render commit. Resolve/reveal/select state first, then commit one tree render per navigation or mutation refresh. Longer term, update expanded branches and selected-row classes incrementally instead of replacing the entire tree.

**Action type:** Very-high-value Workspace rendering consolidation.

---

## 8. Workspace “repagination” on resize/theme change performs a full file reload instead of repaginating cached content

**Priority:** High

**Locations:**
- `ChatUI/js/workspace/workspace-ui.js` — `scheduleDocumentRepagination()` and `showFile()`.
- `ChatUI/js/workspace/workspace-document.js` — Markdown pagination/rendering.
- `ChatUI/js/settings/settings.js` — publishes `workspace:theme-changed`.

**Finding:**

Resize/theme events are debounced, which is good. But once the debounce fires, the repagination path calls `showFile(selectedNode)`. `showFile()` resets Workspace views, rebuilds breadcrumb/actions/loading UI, re-reads the file through `readFileForViewer()`, and then reparses/repaginates the Markdown document. A width or color-theme change does not require another storage read or navigation rebuild when the selected file and revision have not changed.

The paginator itself performs repeated layout measurements while placing top-level blocks, so doing the entire load/render pipeline for every settled resize amplifies the cost.

**Recommendation:**

Cache the selected file's current text/revision in the Workspace view controller. On width/theme-only changes, call the document renderer/paginator directly with the cached text and skip storage reads, breadcrumb reconstruction, and selection-state work. Re-read only when selection or file revision changes.

**Action type:** High-value resize/theme rendering optimization.

---

## 9. User-message collapsing creates one ResizeObserver plus delayed layout measurement per rendered user message

**Priority:** High

**Location:** `ChatUI/js/chat/message-renderer.js` — user-message collapse/overflow measurement.

**Finding:**

Every rendered user text message creates its own `ResizeObserver`. Initial overflow detection is scheduled through nested `requestAnimationFrame()` callbacks, and each measurement reads width, scroll height, computed style/font metrics, and line-height information. Opening a long chat therefore creates one observer and initial measurement sequence per user turn, and a resize/embedded-frame visibility change can trigger many expensive message measurements together.

The observer is not represented by a shared lifecycle/disposer owned by the conversation renderer.

**Recommendation:**

Use one shared ResizeObserver/measurement manager for collapsible user messages, batch initial measurement after the conversation is rendered, and explicitly unobserve rows when they are removed. If reliable, use CSS line-clamp as the primary presentation and measure only to decide whether the disclosure control is needed.

**Action type:** Layout-observer scaling and lifecycle cleanup.

---

## 10. Read Selected Text scans every readable message root on each `selectionchange`

**Priority:** High

**Location:** `ChatUI/js/voice/read-selection.js`.

**Finding:**

The feature correctly preserves exact selected text across menu interaction, but its capture path listens to document-wide `selectionchange`. For every non-collapsed selection, it queries all `.message-text`, `.content-slot`, and `.activity-item-text` elements in the conversation and checks the Range against each root. For intersecting roots it creates/clips ranges, clones contents, removes excluded controls, and extracts text.

Dragging or extending a selection through a long chat can therefore repeatedly scan the complete set of readable message roots. A selection elsewhere in the document can also enter the scan before being rejected as having no usable chat roots.

**Recommendation:**

Preserve the current exact-selection behavior, but first reject ranges that do not intersect the conversation container. Batch selection processing to one animation frame (or the relevant pointer/keyboard completion point) and derive affected readable roots from the Range's ancestry/TreeWalker rather than scanning every message root.

**Action type:** High-value selection hot-path optimization; selection correctness must not regress.

---

## 11. Read Aloud runs a 10 Hz whole-player/toolbar polling loop even when the player is hidden and paused

**Priority:** Very High

**Locations:**
- `ChatUI/js/voice/read-player-ui.js` — `startReadPlayerLoop()` uses a 100 ms `setInterval()`.
- `ChatUI/js/voice/read-player-ui.js` — `renderReadPlayer()` and `syncToolbar()`.
- `ChatUI/js/voice/read-aloud.js` — job lifecycle, `hideReadPlayer()`, and Live Audio callbacks.

**Finding:**

While a Read Aloud job exists, the UI loop calls `renderReadPlayer()` ten times per second. Each render re-queries the player elements and `syncToolbar()` queries **all** `.read-msg-btn` controls in the conversation and rewrites reading/loading/ARIA state across them.

`hideReadPlayer()` pauses/hides the active job but does not stop the interval, so a hidden paused job can keep doing this work indefinitely until it is disposed. Live generation also calls `renderReadPlayer()` from audio/status callbacks in addition to the polling loop.

**Recommendation:**

Stop the loop when the player is hidden or playback is paused and restart it only when visible progress needs animation. Update message-toolbar state only when the active message/status changes, not every progress tick. Prefer media `timeupdate`/state events plus `requestAnimationFrame()` while actively playing over unconditional 100 ms polling.

**Action type:** Very-high-value long-session runtime cleanup.

---

## 12. Blob/Object URL ownership is incomplete, and rerenders can create additional URLs for the same persisted file

**Priority:** Very High

**Locations:**
- `ChatUI/js/chat/send-message.js` — `buildAttachments()` creates Object URLs for new user attachments.
- `ChatUI/js/storage/load.js` — `loadChatContent()` creates Object URLs for loaded attachment Blobs.
- `ChatUI/js/chat/message-tools.js` — generated tool-file cards create Object URLs while rendering and append them to `msgObj._blobUrls`.
- `ChatUI/js/chat/message-actions.js` — `revokeMessageBlobUrls()` only owns `_blobUrls` cleanup for selected edit/delete paths.
- `ChatUI/js/chat/conversation.js` / chat switching and deletion paths.

**Finding:**

User attachment URLs and generated-tool URLs do not share one resource owner/disposer. User `attachments[].url` values are not part of `revokeMessageBlobUrls()`. Navigating away from a chat does not dispose its runtime URLs because loaded chats stay cached. Generated file cards can create another Object URL whenever the same message is rendered again, appending another URL to `_blobUrls` without first reusing/revoking the previous render URL.

**Recommendation:**

Introduce one runtime resource disposer for a message/chat. Cache one Object URL per Blob/attachment identity, reuse it across pure rerenders, and revoke it on message deletion, chat deletion, deliberate chat-cache eviction, or replacement of the underlying Blob. Keep Object URLs—they are appropriate for local Blob media—but give them explicit ownership.

**Action type:** Very-high-priority long-session resource-lifecycle hardening.

---

## 13. Lazy-loaded chats are cached forever for the browser session

**Priority:** High

**Locations:**
- `ChatUI/js/chat/chat-loader.js` — once `messagesLoaded === true`, `ensureChatLoaded()` always returns the resident chat.
- `ChatUI/js/storage/load.js` — loaded messages can contain long text, attachment Blobs/Object URLs, tool metadata, and generated-file Blobs.

**Finding:**

Lazy loading successfully reduces startup cost, but there is no unload/eviction policy after a chat is visited. Opening many large conversations gradually turns the metadata-only startup state back into a fully resident copy of every visited chat for the remainder of the session. The Object URL issue above makes that retained state more expensive.

**Recommendation:**

Add a bounded inactive-chat cache/LRU. Keep the active chat plus chats that are generating or participating in active Read Aloud/Voice work resident; unload older inactive chats back to metadata + `messageCount` after their durable state is confirmed, disposing runtime Blob URLs at the same time.

**Action type:** High-value long-session memory bound; preserve current lazy-load and pending-load protections.

---

## 14. Global Lucide icon initialization is repeatedly invoked from partial and high-frequency renderers

**Priority:** High

**Locations / examples:**
- `ChatUI/js/chat/activity-renderer.js` — after every activity-timeline render, including streaming frames.
- `ChatUI/js/sidebar/sidebar-render.js` — after every whole-sidebar rebuild.
- `ChatUI/js/workspace/workspace-ui.js` — after tree/view/action rendering.
- `ChatUI/js/voice/read-settings.js`, message/composer renderers, and other partial UI controllers.

**Finding:**

Many feature renderers call `lucide.createIcons()` with no local ownership after changing only one subtree. In the streaming path this can happen once per animation frame after the activity DOM was rebuilt. Icon hydration is therefore coupled to broad application DOM work instead of the specific newly created icons.

**Recommendation:**

Create one scoped icon helper/factory that hydrates only newly created subtrees or directly creates the needed SVG. Call global icon initialization once for initial static layout and avoid document-wide rescans from high-frequency partial render paths.

**Action type:** Cross-cutting DOM-work reduction.

---

## 15. API-key validation progress rebuilds the complete key-status list for every completed key

**Priority:** Medium

**Location:** `ChatUI/js/api/api-config.js` — key-pool rendering and validation-progress callbacks.

**Finding:**

During pool validation, progress updates call the key-status renderer repeatedly. That renderer clears and recreates the complete key list each time, so validating N keys performs roughly N progressively repeated list rebuilds rather than updating only the completed row/progress label. Time labels also construct date-formatting work repeatedly during those rebuilds.

This is unlikely to dominate normal usage because key pools are usually small, but it is unnecessary UI work in a clearly bounded process.

**Recommendation:**

Update the progress label and changed key row incrementally during validation, then do one final full sync if desired. Cache a shared date/time formatter instead of constructing formatting machinery for every row render.

**Action type:** Medium-priority Settings rendering optimization.

---

## 16. Every executed conversation search scans the complete Messages store

**Priority:** High

**Locations:**
- `ChatUI/js/sidebar/search.js` — 200 ms debounce, AbortController, stale-sequence protection.
- `ChatUI/js/storage/search.js` — `searchConversationMatches()` opens a cursor over the entire `messages` store.

**Finding:**

Search correctly debounces input, aborts obsolete queries, and guards against stale results. However, each query that actually executes still visits every stored message and performs text matching/excerpt work. Result/excerpt caps limit retained output but do not terminate the cursor because the function continues counting matching messages. With a very large history, each settled query remains O(all stored messages).

**Recommendation:**

Keep the existing debounce/abort/stale guards. Add a lightweight searchable-text index/store maintained alongside message persistence, or use another deliberate indexing strategy so normal queries do not scan every full message record. If exact global match counts are not a product requirement, consider a documented total/count cap as an additional bound.

**Action type:** High-priority large-history search scaling.

---

## 17. Loading one chat issues one attachment-index query per message

**Priority:** Medium/High

**Locations:**
- `ChatUI/js/storage/load.js` — `loadAttachmentsForMessages()` issues `attachments.index('messageId').getAll(message.id)` for every message.
- `ChatUI/js/storage/database.js` — the attachments store has a `messageId` index but no chat-level attachment index.
- `ChatUI/js/storage/records.js` — attachment records currently store `messageId` but not `chatId`.

**Finding:**

After loading all messages for one chat, attachment hydration starts one IndexedDB index request per message, even though most messages may have no attachments. The requests share one transaction and run concurrently, which is better than separate transactions, but a 1,000-message chat still creates 1,000 index requests just to discover which messages own attachment records.

**Recommendation:**

If large-chat profiling confirms this cost, add `chatId` to attachment records plus a chat-level index so one query can fetch the chat's attachments and group them by `messageId` in memory. Coordinate that schema change with the attachment normalization work from Category 6 rather than adding another ad-hoc field path.

**Action type:** Medium/high IndexedDB query-count optimization; schema migration required.

---

## 18. Static ChatUI HTML fragments deliberately bypass browser caching on every startup

**Priority:** High

**Location:** `ChatUI/js/layout-loader.js` — nine fragment `fetch()` calls use `{ cache: 'no-store' }`.

**Finding:**

The layout loader fetches the sidebar, empty state, chat area, settings, several modal fragments, right sidebar, and Read Aloud player concurrently, but every request opts out of browser caching. These are static same-deployment assets, so each standalone or embedded ChatUI startup is forced to revalidate/refetch all fragments instead of using normal asset caching.

**Recommendation:**

Use normal browser caching for production fragments, preferably with deployment/versioned asset URLs or cache headers that make release invalidation explicit. Keep `no-store` only for a deliberate development mode if hot fragment editing requires it. A future static build could also assemble the fragments at build time and eliminate these runtime fetches entirely.

**Action type:** High-value startup/network simplification.

---

## Category 8 patterns checked and intentionally NOT flagged as problems

- `streaming.js` already coalesces activity/text callbacks to at most one scheduled render per animation frame. That throttling is good and should remain; the issue is the amount of work inside each frame.
- Sidebar search's 200 ms debounce, AbortController cancellation, and stale sequence checks are useful protections and should remain even if the underlying search index changes.
- `chat-loader.js`'s `pendingLoads` Map correctly deduplicates concurrent loads for the same chat. An eviction policy should preserve that protection.
- Workspace `childrenCache` is useful and should not be removed. The cleanup target is repeated whole-tree rendering and stale/overlapping refresh work, not caching itself.
- Workspace search's current-query check after an asynchronous result is a good stale-result guard.
- A full conversation DOM rebuild when deliberately switching chats is a reasonable simple baseline. The audit focuses on avoidable repeated rebuilds inside a single streaming/navigation/update operation.
- The per-message user-collapse measurement exists partly to handle hidden embedded-frame sizing. Any shared observer/CSS solution must preserve correct collapse behavior when the iframe becomes visible or changes width.
- Object URLs are the correct browser mechanism for local Blob-backed images/audio/files. The issue is ownership/reuse/revocation, not their use.
- Application-lifetime listeners that are initialized once during bootstrap are not automatically leaks. Findings above are limited to unused teardown contracts, document-wide hot-path work, or recurring work that remains active when it no longer needs to.
- The hourly Read Aloud expired-cache cleanup is low-frequency maintenance and is not the same problem as the 100 ms player polling loop.

---

# Next category

Not started yet: **Category 9 — security/privacy/trust-boundary hardening, third-party dependency exposure, and unsafe HTML/data handling.**
