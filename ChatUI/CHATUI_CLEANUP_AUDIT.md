# ChatUI Cleanup Audit

This document records cleanup and architecture findings only. It is **not** an implementation plan and does not authorize any code changes.

## Working process

- Audit one category at a time.
- Save each completed category here immediately.
- Do not delete, refactor, consolidate, or otherwise modify application code unless explicitly approved later.
- When cleanup is eventually approved, re-check every finding against the then-current `main` branch before changing code.

Audit branch: `audit/chatui-cleanup-audit`

Initial audit base: `main` at `9104d33b077c7368247f90c3545a9a9664d8ddf2`.

---

# Category 1 — Duplicate implementations / parallel UI systems

Status: **Audit complete. No fixes performed.**

## 1. Three separate selector/listbox implementations

**Priority:** High

**Locations:**
- `ChatUI/js/ui/model-thinking-menu.js`, approximately lines 48–124.
- `ChatUI/js/voice/read-settings.js`, approximately lines 192–310.

**Finding:** Model selection, Thinking-level selection, and Audio Voice selection separately implement the same trigger/list/open-close/focus/keyboard/selection pattern. The implementations have already drifted; for example the Voice picker has richer Arrow/Home/End behavior.

**Recommendation:** Introduce a reusable listbox-popover primitive and let Model, Thinking, and Voice supply only data/rendering/selection callbacks.

**Action type:** Consolidate, not blind deletion.

---

## 2. Popup lifecycle repeated despite an existing shared popup system

**Priority:** High

**Locations:**
- Canonical action menu: `ChatUI/js/ui/action-menu.js`, approximately lines 20–160.
- `ChatUI/js/ui/model-thinking-menu.js`, approximately lines 48–124.
- `ChatUI/js/composer/composer.js`, approximately lines 98–174.
- `ChatUI/js/voice/read-settings.js`, approximately lines 192–310.

**Finding:** Active anchor state, outside-click closing, Escape, focus restoration, positioning, and keyboard handling are repeated across several popup families.

**Recommendation:** Extract lower-level popover mechanics, then build semantic components such as `action-menu`, `listbox-popover`, and Tools on top of that primitive.

**Action type:** Shared-infrastructure refactor.

---

## 3. Modal lifecycle has multiple owners and the central registry is incomplete

**Priority:** High

**Locations:**
- `ChatUI/js/ui/modals.js`, approximately lines 8–112.
- `ChatUI/html/chat-modals.html`, approximately lines 1–145.
- `ChatUI/js/sidebar/projects.js`.
- `ChatUI/js/sidebar/search.js`.
- `ChatUI/js/settings/settings.js`, approximately lines 107–145 and 220–227.

**Finding:** `modals.js` presents itself as the generic modal manager but manually enumerates selected dialogs. Feature modules also independently open/close dialogs. Current HTML contains dialogs such as Manage Project Chats and Rename Chat that are not fully represented in the central active-dialog/Escape registry.

**Recommendation:** One modal manager should own common open/close, focus trap/restoration, Escape, and backdrop behavior. Feature modules should own only feature content/actions.

**Action type:** Consolidate carefully.

---

## 4. Audio Voice keeps a legacy native `<select>` and replaces it at runtime

**Priority:** Medium/High

**Locations:**
- `ChatUI/html/settings-modal.html`, Audio Read Voice row.
- `ChatUI/js/voice/read-settings.js`, `ensureVoicePicker()`, approximately lines 48–92.

**Finding:** Source HTML contains `<select id="audio-read-voice-select">`, while JavaScript replaces it with the actual custom voice picker. There are therefore two representations of the same setting.

**Recommendation:** Put the final picker markup directly in Settings (or render it through one standard component system) and remove the legacy-select conversion path after verification.

**Action type:** Remove legacy representation after verification.

---

## 5. Old per-message popup-menu CSS remains after migration to the shared action menu

**Priority:** High

**Locations:**
- `ChatUI/css/chat/message-actions.css`, approximately lines 30–88 — `.message-more-menu`, `.message-menu-item`, and related rules.
- Current message implementation: `ChatUI/js/chat/message-controls.js`, approximately lines 82–174.

**Finding:** Current message More actions call the shared `openActionMenu()`, but the stylesheet still describes the retired dedicated message popup.

**Recommendation:** Remove the legacy selectors once their remaining override references are removed. Category 2 below confirms this migration residue.

**Action type:** Delete obsolete CSS after final regression check.

---

## 6. `modals.js` still contains handling for an old message-context-menu system

**Priority:** High

**Location:** `ChatUI/js/ui/modals.js`, Escape handler around the `.message-context-menu.show` query.

**Finding:** The branch predates the shared action-menu lifecycle. Current message actions no longer create this menu type.

**Recommendation:** Remove the obsolete branch. Category 2 below confirms it as migration residue.

**Action type:** Delete dead branch.

---

## 7. `refinements.css` acts as a second CSS architecture

**Priority:** Very High

**Primary location:** `ChatUI/css/refinements.css`.

**Related component files include:**
- `ChatUI/css/components/model-menu.css`
- `ChatUI/css/components/thinking-menu.css`
- Composer, Tools, Settings, Sidebar, Message, and Voice component styles.

**Finding:** Final styles for many components live in a late override layer with many `!important` rules. Reading the owning component stylesheet does not reveal the final behavior.

**Recommendation:** Move final component-specific rules back to their owning stylesheets. Keep only genuinely global rules in a global layer, with the goal of deleting or drastically shrinking `refinements.css`.

**Action type:** Gradual consolidation; high visual-regression risk if done blindly.

---

## 8. ChatUI uses both custom dialogs and native browser dialogs

**Priority:** Medium/High

**Locations:**
- `ChatUI/js/workspace/workspace-ui.js` — `prompt()`/`confirm()` for Workspace CRUD.
- `ChatUI/js/settings/settings.js` — `window.confirm()` for Remove Everything.
- Additional `alert()` calls exist across feature modules.

**Finding:** Application flows are split between ChatUI's dialog framework and browser-native dialogs, producing two interaction architectures.

**Recommendation:** After modal infrastructure is stabilized, add reusable promise-based application dialogs such as `promptDialog()` and `confirmDialog()` and migrate workflows gradually.

**Action type:** Replace parallel dialog system gradually.

---

# Category 2 — Dead / obsolete / unused code and references

Status: **Audit complete. No fixes performed.**

For this category, a candidate was recorded only when the current source showed no live behavioral need, or when the current markup makes a compatibility branch unreachable in a normal same-version deployment. Active-but-temporary features were intentionally excluded.

## 1. Settings still contains handlers for Model and Thinking controls that no longer exist

**Priority:** High

**Locations:**
- `ChatUI/js/settings/settings.js` — import of `syncModelDisplay` / `syncThinkingDisplay` near the top.
- `ChatUI/js/settings/settings.js` — `settingsModelSelect` and `settingsThinkingLevel` lookups in `initSettingsUI()`.
- `ChatUI/js/settings/settings.js` — guarded `if (settingsModelSelect)` and `if (settingsThinkingLevel)` event-handler blocks near the end of `initSettingsUI()`.
- `ChatUI/html/settings-modal.html` — current Settings markup contains no `settings-model-select` or `settings-thinking-level` elements.

**What it is:** Settings used to own model/thinking selectors. The current UI moved those controls to the header Model/Thinking menus, but the old Settings lookup and event-handler paths remain. Because the elements are absent, these branches never execute.

**Recommendation:** Delete the two missing-element lookups and their guarded handler blocks, then remove imports that become unused. Keep the active `getModelConfig()` thinking-level normalization.

**Action type:** Safe dead-code removal after one regression check.

---

## 2. Obsolete `.message-context-menu.show` Escape branch remains in the global modal listener

**Priority:** High

**Location:** `ChatUI/js/ui/modals.js`, Escape handler immediately before Model/Thinking menu handling.

**Current replacement:** `ChatUI/js/ui/action-menu.js` owns Escape for the shared action menu, and `ChatUI/js/chat/message-controls.js` uses `openActionMenu()` for message More actions.

**Finding:** No current message-menu producer creates the legacy `.message-context-menu.show` structure. The branch is migration residue.

**Recommendation:** Delete the legacy query/close block. Keep Escape ownership in `action-menu.js`.

**Action type:** Dead migration residue; delete.

---

## 3. Dedicated message More-menu CSS is dead, including late overrides for it

**Priority:** High

**Locations:**
- `ChatUI/css/chat/message-actions.css` — `.message-more-menu`, `.message-menu-item`, `.message-menu-item.danger`, and related hover/focus/mobile rules.
- `ChatUI/css/refinements.css` — surviving overrides for those same retired selectors.
- Current implementation: `ChatUI/js/chat/message-controls.js` renders `.message-more-btn` but sends menu items to shared `openActionMenu()`.

**Recommendation:** Remove the retired popup selectors from both stylesheets. Preserve `.message-more-btn`, which is active.

**Action type:** Dead CSS removal.

---

## 4. API Settings contains DOM compatibility branches for markup already guaranteed by current fragments

**Priority:** Medium/High

**Locations:**
- `ChatUI/js/api/api-config.js` — `ensureMultilineTextKeyInput()`.
- `ChatUI/js/api/api-config.js` — `ensureTextProfileSwitcher()`.
- `ChatUI/html/settings-modal.html` — already contains the Text API textarea and Mode 1 / Mode 2 switcher.

**Finding:** The JavaScript still supports converting an older single-line key input and dynamically creating a missing profile switcher, even though current same-version fragments already contain both structures.

**Recommendation:** Keep current configuration/state setup, but remove the old-markup conversion/creation branches once the deployment assumption of same-version fragments is reconfirmed. Do not remove persisted-data migration.

**Action type:** Obsolete DOM compatibility cleanup.

---

## 5. `runtime.currentVoiceIndex` is orphaned state

**Priority:** Medium

**Location:** `ChatUI/js/state/store.js`.

**Finding:** Current Live Voice/Audio Read code uses persisted voice names, not an integer runtime voice index. The reviewed voice modules do not consume `runtime.currentVoiceIndex`.

**Recommendation:** Remove the field after one final repository-wide reference check.

**Action type:** Orphaned state removal.

---

## 6. `runtime.activeChatForProjectAdd` is written but current Add-to-Project behavior uses its closure

**Priority:** Medium

**Locations:**
- `ChatUI/js/state/store.js`.
- `ChatUI/js/sidebar/projects.js`, `openAddToProjectModal()`.

**Finding:** The modal stores the chat globally, but its handlers use the `chat` function variable directly. No reviewed behavioral consumer needs the runtime field.

**Recommendation:** Remove the runtime field and write after final reference verification.

**Action type:** Orphaned runtime-state cleanup.

---

## 7. `runtime.activeProjectForChatManagement` is bookkeeping without a behavioral consumer

**Priority:** Medium

**Locations:**
- `ChatUI/js/state/store.js`.
- `ChatUI/js/sidebar/projects.js`, `openManageProjectChatsModal()` and `deleteProject()` cleanup.

**Finding:** The Manage Project Chats UI uses the `project` function argument/closure. The runtime field is set and defensively cleared on project deletion but is not read by the current modal behavior.

**Recommendation:** Remove the field, write, and associated deletion bookkeeping after final reference verification. Do not remove `activeProjectForRename`, which is active.

**Action type:** Orphaned state and housekeeping removal.

---

## 8. Thinking-level definitions contain unused `color` metadata

**Priority:** Low

**Location:** `ChatUI/js/ui/model-thinking-menu.js`, `THINKING_LEVELS`.

**Finding:** JavaScript consumes level IDs and labels while visual color comes from CSS classes in `thinking-menu.css`; the `color` property does not drive the current UI.

**Recommendation:** If CSS remains the color source of truth, remove the unused data property. If future refactoring makes data own colors, remove the duplicate CSS source instead.

**Action type:** Small dead-data cleanup.

---

## 9. Manage-Project-Chats local group objects carry unused `id` and `target` properties

**Priority:** Low

**Location:** `ChatUI/js/sidebar/projects.js`, inside `openManageProjectChatsModal()`.

**Finding:** The current render loop consumes fields such as `name`, `icon`, and `chats`; `id` and `target` are not used by the present checkbox/render behavior.

**Recommendation:** Remove those private-object properties unless a future consolidation deliberately starts consuming them.

**Action type:** Small dead-data cleanup.

---

## Category 2 items checked and intentionally NOT classified as dead

- `appendLegacyAssistantContent()` remains necessary for stored messages without an `activityTimeline`.
- Text API active aliases (`textApiKey`, `textApiKeys`, `textApiKeyIndex`, `textBaseUrl`) are still consumed by existing request/failover code.
- `TEMP_PERF_DIAGNOSTICS` is active even though it is explicitly temporary; it belongs in Category 3 below.
- Small facade modules such as `menus.js`, `messages.js`, `sidebar.js`, and `chat.js` remain valid stable import boundaries.
- `activeProjectId` is active.
- `activeProjectForRename` is active.

---

# Category 3 — Temporary / development-only / likely-unnecessary production functionality

Status: **Audit complete. No fixes performed.**

This category is intentionally conservative. A normal advanced feature is not classified as “unrequested” merely because it is complex. The findings below are based on explicit source markers showing that the functionality is temporary/profiling-only, plus evidence that it is still shipped or reachable in the production runtime.

## 1. The full Performance Diagnostics feature is explicitly temporary but still ships as a normal Settings feature

**Priority:** Very High

**Locations:**
- `ChatUI/html/settings-modal.html` — unconditional “Performance Diagnostics” Settings entry and full diagnostics tab, both marked `TEMP_PERF_DIAGNOSTICS`.
- `ChatUI/js/diagnostics/performance-diagnostics.js` — core recorder; source header says `TEMPORARY PERFORMANCE DIAGNOSTICS — remove after profiling is complete.`
- `ChatUI/js/diagnostics/performance-diagnostics-ui.js` — Settings UI for enabling/copying/clearing diagnostics; same explicit temporary marker.
- `ChatUI/js/diagnostics/performance-report.js` — report construction.
- `ChatUI/css/components/performance-diagnostics.css` — dedicated diagnostics styling; same explicit temporary marker.
- `ChatUI/css/components.css` — always imports `performance-diagnostics.css` under `TEMP_PERF_DIAGNOSTICS`.

**What it is:**

A profiling utility has become a visible application feature. It records timing/size metadata, keeps captured runs in browser storage, shows run counts/status, can copy a diagnostic report, and can clear its temporary data. The Settings copy itself describes it as a “Temporary measurement tool.”

**Why it is a cleanup candidate:**

The source does not merely look debug-like; it explicitly says it should be removed after profiling. Leaving it in the normal Settings hierarchy expands production UI, maintenance, persistence, accessibility, and support surface for a tool whose own lifecycle says it is temporary.

**Recommendation:**

If the profiling task is complete, remove the entire subsystem as one coordinated cleanup: Settings markup, diagnostics UI/core/report modules, diagnostics CSS/import, and all call-site instrumentation. If profiling is still occasionally needed, do not expose it as a normal production setting; gate it behind an explicit development/profile build or similarly deliberate developer-only mechanism.

**Action type:** Remove or properly dev-gate an explicitly temporary feature.

---

## 2. Temporary diagnostics instrumentation is woven through core Send / Generation / Streaming hot paths

**Priority:** Very High

**Locations:**
- `ChatUI/js/chat/send-message.js` — `TEMP_PERF_DIAGNOSTICS` imports plus request-kind, attachment-summary, phase, and metadata instrumentation.
- `ChatUI/js/chat/generation-runner.js` — `TEMP_PERF_DIAGNOSTICS` imports and generation lifecycle timing.
- `ChatUI/js/chat/streaming.js` — `TEMP_PERF_DIAGNOSTICS` imports plus network-round, SSE/chunk, activity, render, history, and tool timing instrumentation.
- `ChatUI/js/diagnostics/performance-diagnostics.js` — shared state/recording implementation.

**What it is:**

The temporary profiler is not isolated to a developer screen. Core request modules import it directly and execute diagnostic guards/hooks around normal user operations.

**Why it matters even when diagnostic mode is off:**

The profiler is part of the production module graph and the hot-path source architecture. Disabled mode limits recording, but the application still carries imports, helper functions, conditional checks, and additional coupling in the code that handles ordinary Send and streaming responses.

**Recommendation:**

When diagnostics is retired, remove these hooks and temporary helper functions from the hot paths instead of leaving no-op scaffolding behind. If diagnostics must remain available for future profiling, isolate it behind a single instrumentation interface or build-time boundary so normal production modules do not permanently depend on a temporary subsystem.

**Action type:** Cross-cutting temporary-instrumentation removal/isolation.

---

## 3. Embedded ChatUI can expose the diagnostics Settings page without initializing its diagnostics UI behavior

**Priority:** High

**Locations:**
- `ChatUI/html/settings-modal.html` — diagnostics Settings button/tab are included unconditionally.
- `ChatUI/js/settings/settings.js` — every `.settings-section-btn` is wired generically to `openSettingsSection(...)`, so the diagnostics section remains navigable.
- `ChatUI/js/layout-loader.js` — diagnostics UI is dynamically imported and initialized only when `!IS_EMBEDDED`.
- `shell/js/frame-manager.js` — the combined application loads ChatUI through `/ChatUI/embedded.html?embedded=1`.

**What it is:**

The combined app uses embedded ChatUI. Embedded mode deliberately skips `performance-diagnostics-ui.js` initialization to avoid extra listener/UI cost, but the Settings fragment still contains the diagnostics navigation button and controls and generic Settings navigation can open them.

**Why it is a cleanup candidate:**

A temporary feature is only half-gated: its UI can remain visible/reachable while its feature-specific event handlers are not initialized. Toggle/copy/clear controls can therefore be presented in an environment where the corresponding diagnostics Settings controller was intentionally not loaded.

**Recommendation:**

Prefer removing the temporary feature entirely. If it must remain, use one consistent availability gate controlling markup visibility, UI initialization, CSS, and core instrumentation together. Do not gate only the Settings controller.

**Action type:** Fix temporary-feature leakage/inconsistent environment gating.

---

## 4. The production static build has no boundary that excludes the temporary diagnostics subsystem

**Priority:** High

**Location:**
- `scripts/build-static.mjs` — production combined build recursively copies `ChatUI/css`, `ChatUI/html`, and `ChatUI/js` into `dist/`.

**What it is:**

All diagnostics JavaScript, CSS, and Settings markup are part of directories copied wholesale into the production static build.

**Why it is a cleanup candidate:**

Even if the standalone diagnostics UI is conditionally initialized at runtime, the current build architecture packages the temporary subsystem by default. There is no production/development asset boundary for it.

**Recommendation:**

If diagnostics is retained for development, create an explicit mechanism that keeps it out of normal production assets or loads it only through a deliberate profiling build. If diagnostics is no longer needed, deleting the subsystem is simpler and safer than adding a permanent build exception for temporary code.

**Action type:** Production-boundary cleanup for development-only tooling.

---

## Category 3 items checked and intentionally NOT classified as unnecessary/unrequested

- Workspace, Workspace AI tools, To-Do integration, Google Search, URL Context, Code Execution, attachments, Live Voice, Audio Read, Backup & Restore, Text API profiles, automatic chat titles, and custom-tool round limits are implemented as intentional product capabilities. Complexity alone is not evidence that they should be removed.
- `scripts/verify-*.mjs`, GitHub Actions workflows, implementation plans/reviews, and local development helpers are development assets, but they are not ordinary ChatUI production UI and should be evaluated under repository/CI hygiene rather than deleted merely for being developer-facing.
- Console `warn`/`error` logging used for real failure reporting is normal operational diagnostics and is not equivalent to the temporary performance profiler.
- The legacy assistant renderer is compatibility behavior, not a temporary feature.

---

# Category 4 — Oversized / over-coupled modules and mixed architecture boundaries

Status: **Audit complete. No fixes performed.**

File size alone was not used as the criterion for this category. A module was recorded when it owns multiple architectural layers or feature domains in a way that increases change blast radius, makes isolated testing difficult, or forces unrelated features to depend on one another.

## 1. `gemini.js` is a protocol/network/tool-orchestration god module

**Priority:** Very High

**Location:** `ChatUI/js/api/gemini.js`.

**Responsibilities currently combined:**
- conversation-history ordering and Gemini Content serialization;
- attachment-history preparation and compatibility fallback;
- model/thinking configuration;
- native-tool payload construction;
- grounding/URL/Code Execution metadata extraction;
- API error parsing;
- SSE transport and line/event parsing;
- streamed text/thought/tool activity normalization;
- custom function-call validation and execution loop;
- custom-tool round-limit narration;
- attachment capability recovery/retry coordination;
- top-level `streamChat()` orchestration.

**Why this boundary is difficult to maintain:**

Changes to Gemini wire protocol, history rules, tool execution, Code Execution presentation metadata, or attachment recovery all touch one central file. A defect in one concern can therefore destabilize unrelated generation behavior. The module also has to understand both low-level SSE framing and high-level product rules such as custom-tool limits.

**Recommendation:**

Keep one thin Gemini orchestration facade, but extract stable responsibilities such as `gemini-history`, `gemini-sse-client`, response/tool metadata normalization, and the client-function loop. Attachment recovery should remain behind the existing attachment/recovery boundary rather than being reimplemented inside transport code.

**Action type:** High-priority architectural decomposition with protocol regression tests.

---

## 2. `workspace-ui.js` owns almost the entire Workspace product surface

**Priority:** Very High

**Location:** `ChatUI/js/workspace/workspace-ui.js`.

**Responsibilities currently combined:**
- Workspace route writing and route resolution;
- selected-node and expanded-tree state;
- directory-child caching;
- tree rendering and keyboard expansion behavior;
- breadcrumb rendering/navigation;
- folder-card rendering;
- Markdown document selection/viewer rendering;
- action menus;
- create/rename/move/delete UI flows;
- native prompt/confirm/error handling;
- search debounce, execution, and result rendering;
- Workspace visibility/sidebar behavior;
- mutation-event synchronization;
- theme/resize-triggered document repagination;
- all Workspace event-listener initialization.

**Why this boundary is difficult to maintain:**

Explorer rendering, routing, search, CRUD dialogs, document viewing, cache invalidation, and mutation synchronization share one large mutable module scope. A change to a search or CRUD flow can affect navigation state and rendering caches. The file also becomes the mandatory editing point for nearly every Workspace UI feature.

**Recommendation:**

Preserve one Workspace controller, but extract focused components/controllers for tree/explorer state, selection/document viewing, search UI, and CRUD actions/dialogs. Route synchronization and mutation refresh should be explicit controller responsibilities rather than being interleaved with element construction.

**Action type:** Very-high-value UI decomposition; perform incrementally because visual/state regressions are possible.

---

## 3. `workspace-service.js` is authoritative, but it combines too many domain and infrastructure roles

**Priority:** High

**Location:** `ChatUI/js/workspace/workspace-service.js`.

**Responsibilities currently combined:**
- public Workspace error translation;
- path traversal/canonicalization;
- file and directory limits;
- file reads and multi-file batching;
- file create/rewrite/append/edit semantics;
- recursive directory creation;
- move validation and hierarchy-cycle prevention;
- file/directory deletion and subtree collection;
- metadata queries;
- recursive search traversal and content matching;
- storage repository coordination;
- browser `workspace:changed` event dispatch.

**Finding:**

The service is correctly acting as the authoritative virtual-filesystem layer, which should be preserved. The problem is that command behavior, query behavior, storage translation, traversal algorithms, and browser event publication all live in one module. In particular, direct `window.dispatchEvent(...)` makes the domain service aware of the browser UI event mechanism.

**Recommendation:**

Keep a single public Workspace service facade, but internally separate query operations, mutation commands, path resolution/traversal, and change publication. Change notifications should be injected or emitted through a small Workspace event boundary so domain semantics are independently testable without DOM globals.

**Action type:** Internal service decomposition; preserve the current public API initially.

---

## 4. Live Voice controller owns capture, chat generation, TTS playback, and user-facing failure UI

**Priority:** Very High

**Location:** `ChatUI/js/voice/live-voice-controller.js`.

**Responsibilities currently combined:**
- the Live Voice state machine and UI-state callbacks;
- microphone turn capture and silence-detector lifecycle;
- recorder cancellation/recycling;
- composer attachment manipulation for captured files;
- pending-turn queues and retry timers;
- ChatUI text-generation submission/observation;
- streamed assistant-text handoff to speech synthesis;
- speech queue creation/interruption/draining;
- AudioContext preparation and processing sounds;
- Read Aloud mutual exclusion;
- mute/auto-detect/orb actions;
- alert-based microphone/playback/request error handling;
- pagehide cleanup.

**Why this boundary is difficult to maintain:**

The central state machine must understand details from the composer recorder, attachment list, chat generator, Read Aloud, silence detection, speech playback, UI callbacks, and browser audio lifecycle. Voice turn-taking changes therefore have a wide regression surface.

**Recommendation:**

Make `live-voice-controller` primarily a state/turn coordinator. Extract a voice-input session adapter for capture/silence handling and a voice-output/generation adapter for assistant generation plus speech playback. Failure presentation should be surfaced to `voice-ui.js` as state/events instead of issuing alerts deep inside the controller.

**Action type:** High-risk/high-value state-machine decomposition; requires focused lifecycle tests.

---

## 5. The supposedly reusable recorder is coupled to composer UI and attachment ownership

**Priority:** High

**Location:** `ChatUI/js/composer/recorder.js`.

**Finding:**

`startAudioRecording()`, `stopAudioRecording()`, and `cancelAudioRecording()` provide a reusable capture API used by Live Voice, but the same module directly changes the composer record button, calls `updateComposerButtons()`, reads/writes global composer recording state, enforces attachment limits, creates the final `File`, and optionally inserts that file into composer attachments.

**Why this boundary matters:**

Live Voice depends on a module under `composer/` and must pass flags such as `updateButton: false` and `attach: true/false` to suppress composer-specific side effects. The comments themselves distinguish “Voice-owned recordings” from the normal composer recorder, which is evidence that two callers with different ownership models are sharing a UI-coupled implementation.

**Recommendation:**

Extract a UI-independent audio-capture core that returns the recorded Blob/File and owns MediaRecorder/remux lifecycle only. Keep a small composer adapter responsible for record-button state, attachment-limit policy, and attaching the resulting file. Live Voice should depend on the capture core rather than the composer adapter.

**Action type:** Layer-boundary cleanup with strong reuse payoff.

---

## 6. `api-config.js` mixes pure API configuration with a full Settings controller

**Priority:** High

**Location:** `ChatUI/js/api/api-config.js`.

**Responsibilities currently combined:**
- API settings getters and persistence;
- base-URL normalization;
- public ChatUI version constant;
- Text API profile selection;
- Text API key-pool state synchronization;
- textarea compatibility/configuration and paste normalization;
- key-pool status/list rendering;
- key-validation scheduling/AbortController lifecycle;
- dynamic Settings markup creation;
- API-key visibility controls;
- Voice API input wiring;
- General Settings version-row DOM creation.

**Why this boundary is difficult to maintain:**

Networking modules import `getApiSettings()` / `getCleanBaseUrl()` from a file that also owns Settings DOM and timers. Conversely, Settings initialization depends on key-pool domain behavior and version rendering from the API layer. This blurs the API/domain/UI layering and makes the config module harder to test outside a browser DOM.

**Recommendation:**

Split pure API configuration/URL helpers from Settings UI. Move Text key-pool/profile controls into a dedicated Settings controller and put release/version presentation in a general app/version module. Keep compatibility/data migration separate from DOM construction.

**Action type:** High-value layer separation.

---

## 7. `settings.js` is both the Settings shell and ChatUI's global theme engine

**Priority:** High

**Location:** `ChatUI/js/settings/settings.js`.

**Responsibilities currently combined:**
- global light/dark theme token definitions and application;
- accent-color definitions/application;
- Workspace theme-change event publication;
- Settings modal open/close/navigation behavior;
- child feature initialization for API, Audio Read, and Backup/Restore;
- model/thinking normalization and legacy control handlers;
- custom-tool round-limit validation/persistence;
- general-setting persistence;
- destructive “Remove Everything” flow.

**Finding:**

Theme behavior is application infrastructure, but it lives inside the Settings modal controller. The same file is also a Settings router, child-controller bootstrapper, general-settings editor, and destructive-data controller.

**Recommendation:**

Extract a dedicated ChatUI theme service/module and keep the Settings shell focused on navigation/lifecycle. Move destructive reset and custom-tool-limit editing into focused settings controllers. `initSettingsUI()` can remain the composition point for those controllers without implementing all of their behavior itself.

**Action type:** Moderate-risk architecture cleanup; aligns ownership with feature boundaries.

---

## 8. Audio Read Settings also owns a complete networked voice-preview player

**Priority:** Medium/High

**Location:** `ChatUI/js/voice/read-settings.js`.

**Responsibilities currently combined:**
- Audio Read setting normalization/persistence;
- retention-policy execution;
- runtime conversion of the voice selector;
- custom listbox rendering/keyboard/focus lifecycle;
- preview-button state/rendering;
- Gemini Live audio session creation/closure;
- `ReadAudioEngine` playback lifecycle;
- preview cancellation/error handling;
- Settings close/back cleanup.

**Finding:**

Changing Settings UI, listbox behavior, retention behavior, or Gemini preview transport all requires editing the same controller. A Settings module should not need to implement the whole live-audio playback protocol to preview a selected value.

**Recommendation:**

After the shared listbox work from Category 1, extract a small `voice-preview` service/controller that owns Gemini Live + playback lifecycle and exposes start/stop/state callbacks. Keep `read-settings.js` responsible for Settings state and persistence only.

**Action type:** Focused extraction; lower risk once the listbox primitive exists.

---

## 9. `attachment-transport.js` combines five separate attachment concerns

**Priority:** High

**Location:** `ChatUI/js/chat/attachment-transport.js`.

**Responsibilities currently combined:**
- MIME/capability caches for Files API and model support;
- unsupported-error classification;
- local Blob → Base64 inline encoding;
- remote Gemini File metadata shape/persistence/invalidation;
- upload, activation polling, and remote refresh;
- auto-selection between `fileData` and `inlineData`;
- history attachment collection/keying;
- concurrency control;
- missing/stale remote-file recovery.

**Why this boundary is difficult to maintain:**

Encoding policy, persistent metadata, Gemini Files lifecycle, history scanning, model-capability learning, and recovery all change for different reasons but share one module. The result is a large policy file whose mutations can affect both ordinary history construction and failure recovery.

**Recommendation:**

Keep one public attachment-preparation facade but separate inline encoding, remote-file lifecycle/persistence, capability policy, and recovery. History attachment collection/key generation can also move to a small history-oriented helper so transport code does not need to know message traversal details.

**Action type:** High-value transport decomposition; preserve current recovery semantics exactly.

---

## 10. Text API key pool mixes state model, retry policy, persistence, time-zone quota policy, and HTTP validation

**Priority:** Medium/High

**Location:** `ChatUI/js/api/text-api-key-pool.js`.

**Responsibilities currently combined:**
- key parsing/deduplication/masking;
- persisted pool-entry normalization;
- active-index rotation;
- failure/success history mutation;
- rate-limit classification;
- Pacific-time quota release calculation;
- retry/backoff and failover orchestration;
- persistence after key transitions;
- summary calculation;
- direct `/v1beta/models` HTTP validation with concurrency;
- validation-result mutation/persistence.

**Finding:**

These are all related to the key pool, so the module is more cohesive than several other Category 4 findings. The maintainability problem is side-effect density: pure policy/state functions, clock/time-zone rules, HTTP I/O, and persistence are interleaved, which makes deterministic unit testing harder.

**Recommendation:**

Preserve one key-pool facade, but split the pure pool model/policy from the validator transport and persistence adapter. Inject or parameterize the clock for cooldown-policy tests rather than requiring real `Date.now()`/Intl behavior in every path.

**Action type:** Internal testability/refactoring improvement; do not change failover semantics during the split.

---

## 11. The generic activity timeline hardcodes provider-specific Workspace and To-Do presentation rules

**Priority:** Medium/High

**Locations:**
- `ChatUI/js/chat/activity-timeline.js` — `getToolProvider()`, `formatToolSummary()`, provider labels, and explicit switches over Workspace/To-Do function names.
- `ChatUI/js/tools/function-tool-registry.js` — separately knows which custom providers/functions exist and how they execute.
- `ChatUI/js/tools/custom-tool-provider.js` — separately classifies Workspace vs To-Do names.

**Finding:**

The timeline is described as the generic chronological activity model, yet it contains feature-specific knowledge of every Workspace and To-Do function name to produce display summaries. Adding or renaming a custom tool can therefore require edits in the execution registry, provider classifier, and generic timeline model.

**Recommendation:**

Give each custom-tool provider a small presentation descriptor/formatter in the tool registry/provider layer. The generic activity model should receive provider/name/summary metadata rather than knowing all product-specific function names itself.

**Action type:** Dependency-direction cleanup; makes future tools cheaper to add.

---

## 12. Normal generation and regeneration use a brittle, partly duplicated lifecycle contract

**Priority:** Very High

**Locations:**
- `ChatUI/js/chat/streaming.js` — `streamAssistantResponse()` mutates the assistant message, renders activity, and calls completion with six positional values.
- `ChatUI/js/chat/generation-runner.js` — maps those six values into an assistant record, updates DOM/state, persists, finalizes generation, and triggers automatic title generation.
- `ChatUI/js/chat/regenerate.js` — separately performs generation setup, assistant construction/reset, streaming callback mapping, durable replacement, DOM replacement, Read Aloud cleanup, rollback, and generation finalization.
- `ChatUI/js/chat/send-message.js` — owns the user-turn transaction and then hands off into the normal generation runner.

**Finding:**

There is a shared streaming function, but normal generation and regeneration still implement substantial lifecycle logic separately. Both consume a positional completion tuple `(fullText, thinkingText, thoughtSignature, modelResponseParts, toolMetadata, activityTimeline)` and separately copy those values into message state. Regeneration also has its own persistence/render/error/finalization path because its rollback semantics differ.

**Why this boundary is fragile:**

Adding one new assistant-output field requires coordinated positional-callback and assignment changes across multiple modules. Normal and regenerate behavior can drift even when both should share most generation semantics. At the same time, regeneration's rollback rules are important and must not be erased by over-generalizing.

**Recommendation:**

Introduce a structured generation-result object and a shared generation transaction/coordinator that owns assistant result application, lifecycle finalization, and common rendering/persistence hooks. Keep regeneration-specific target selection and rollback as explicit strategy/hooks around that shared core rather than duplicating the entire generation path.

**Action type:** Very-high-value lifecycle consolidation; requires regression coverage for abort, persistence failure, regeneration rollback, generated attachments, and Read Aloud invalidation.

---

## Category 4 modules checked and intentionally NOT flagged merely for size

- `ChatUI/js/app.js` imports many modules, but it is explicitly the application bootstrap/composition root. Broad dependency visibility is appropriate there as long as product logic stays in feature modules.
- `ChatUI/js/chat/activity-timeline.js` is not being flagged just because it is sizable; its pure chronological state model and bounded-preview logic are cohesive. Only its provider-specific presentation knowledge is recorded above.
- `ChatUI/js/workspace/workspace-paths.js` contains substantial path/line-edit utility behavior, but those operations form a coherent low-level Workspace semantics layer.
- `ChatUI/js/voice/voice-silence-detector.js`, `voice-speech-queue.js`, `voice-processing-sound.js`, and `read-audio-engine.js` are examples of useful focused extractions. The Live Voice finding recommends leaning further in that direction rather than recombining them.
- `ChatUI/js/storage/storage.js` and small `chat.js`/`sidebar.js`/`menus.js` facade modules are stable import boundaries, not god modules by virtue of re-exporting functionality.
- Large vendor files are third-party/runtime artifacts and are outside application-architecture cleanup unless dependency replacement is separately requested.

---

# Next category

Not started yet: **Category 5 — global state ownership, async lifecycle/race risks, and hidden cross-module side effects.**