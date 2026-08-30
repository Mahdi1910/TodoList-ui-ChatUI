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

# Next category

Not started yet: **Category 4 — oversized / over-coupled modules, mixed responsibilities, and difficult-to-maintain architecture boundaries.**
