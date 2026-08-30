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

**What it is:**

Settings used to own model/thinking selectors. The current UI moved those controls to the header Model/Thinking menus, but the old Settings lookup and event-handler paths remain. Because the elements are absent, these branches never execute.

**Why it is dead/obsolete:**

The guards make the stale code harmless, but they also hide the fact that an old feature path is still present. After removing those branches, the `syncModelDisplay`/`syncThinkingDisplay` import from `../ui/menus.js` is no longer needed by Settings.

**Recommendation:**

Delete the two missing-element lookups and their guarded handler blocks, then remove imports that become unused. Keep the current `getModelConfig()` thinking-level normalization because that is still active startup behavior.

**Action type:** Safe dead-code removal after one regression check.

---

## 2. Obsolete `.message-context-menu.show` Escape branch remains in the global modal listener

**Priority:** High

**Location:**
- `ChatUI/js/ui/modals.js`, Escape handler, approximately the block immediately before Model/Thinking menu handling.

**Current replacement:**
- `ChatUI/js/ui/action-menu.js` owns Escape for the shared action menu.
- `ChatUI/js/chat/message-controls.js` uses `openActionMenu()` for message More actions.

**What it is:**

`modals.js` still queries `.message-context-menu.show`, removes the `show` class, and marks Escape as handled. Current message menus use the shared global `#action-menu` instead.

**Why it is dead/obsolete:**

There is no current message-menu producer for that legacy class in the reviewed message/sidebar/workspace menu paths. The comment in `modals.js` itself acknowledges that the shared action menu owns its own Escape lifecycle.

**Recommendation:**

Delete this legacy query/close block. Escape for the current shared menu should remain owned by `action-menu.js`.

**Action type:** Dead migration residue; delete.

---

## 3. Dedicated message More-menu CSS is dead, including late overrides for it

**Priority:** High

**Locations:**
- `ChatUI/css/chat/message-actions.css` — `.message-more-menu`, `.message-menu-item`, `.message-menu-item.danger`, and related hover/focus/mobile rules.
- `ChatUI/css/refinements.css` — `.message-more-menu` in the shared-surface override group and `.message-menu-item*` hover/danger overrides.
- Current implementation: `ChatUI/js/chat/message-controls.js` renders a `.message-more-btn` trigger but sends menu items to the shared `openActionMenu()` primitive.

**What it is:**

The old dedicated message popup was replaced by the global shared action popup, but both its base CSS and later theme-fix overrides survived.

**Why it is dead/obsolete:**

The current message controller does not create `.message-more-menu` or `.message-menu-item` elements. Keeping their styling creates a false impression that two message-menu systems still exist.

**Recommendation:**

Remove the old selector blocks from both `message-actions.css` and `refinements.css`. Preserve `.message-more-btn`, because that trigger is current and active.

**Action type:** Dead CSS removal.

---

## 4. API Settings still contains runtime compatibility branches for markup that is now guaranteed by current fragments

**Priority:** Medium/High

**Locations:**
- `ChatUI/js/api/api-config.js` — `ensureMultilineTextKeyInput()`.
- `ChatUI/js/api/api-config.js` — `ensureTextProfileSwitcher()`.
- `ChatUI/html/settings-modal.html` — already contains a `<textarea id="text-api-key-input">` and explicit `#text-api-profile-switcher` with Mode 1 / Mode 2 buttons.

**What it is:**

`ensureMultilineTextKeyInput()` still supports converting an old single-line input into a textarea. `ensureTextProfileSwitcher()` can dynamically create the Mode switcher if it is absent.

**Why it is obsolete in the current architecture:**

ChatUI's layout loader fetches the JavaScript and HTML fragments from the same deployed version. In the current fragments, both structures already exist before API Settings initializes, so the old-markup conversion/creation branches are not part of the normal current execution path.

This is different from data migration: old IndexedDB data still needs migration support. These are DOM-markup compatibility fallbacks for an earlier code layout.

**Recommendation:**

Keep the configuration functions that apply current attributes/state, but remove the unreachable old-input conversion and missing-switcher creation branches once the supported deployment model is confirmed to always use same-version fragments.

**Action type:** Remove obsolete DOM compatibility code; do not remove persisted-data migration.

---

## 5. `runtime.currentVoiceIndex` is an orphaned state field

**Priority:** Medium

**Location:**
- `ChatUI/js/state/store.js`, `runtime` initial state — `currentVoiceIndex: 0`.

**Current voice implementation reviewed:**
- `ChatUI/js/voice/voice-ui.js`
- `ChatUI/js/voice/live-voice-controller.js`
- `ChatUI/js/voice/read-settings.js`
- `ChatUI/js/voice/read-aloud.js`

**What it is:**

Runtime state still reserves an integer voice index, apparently from an older indexed voice-selection implementation.

**Why it is unused now:**

Current voice/read code uses the persisted voice **name** (`state.audioRead.voiceName`, e.g. `Zephyr`) rather than an index. The reviewed current voice modules do not consume `runtime.currentVoiceIndex`.

**Recommendation:**

Remove `currentVoiceIndex` from runtime state after a final repository-wide reference check at cleanup time.

**Action type:** High-confidence orphaned state removal.

---

## 6. `runtime.activeChatForProjectAdd` is written but the Add-to-Project flow uses its closure instead

**Priority:** Medium

**Locations:**
- `ChatUI/js/state/store.js` — runtime field `activeChatForProjectAdd`.
- `ChatUI/js/sidebar/projects.js` — `openAddToProjectModal()` calls `setRuntime({ activeChatForProjectAdd: chat })`.

**What it is:**

The modal saves the active chat into global runtime state, but every action inside the current modal uses the `chat` variable captured by `openAddToProjectModal()`.

**Why it is unused:**

The field is not required to resolve the selected chat for the current Add-to-Project handlers. It is state left over from a design where modal actions likely needed to retrieve their target globally.

**Recommendation:**

Remove the runtime field and the write if no external consumer is found during the final pre-cleanup reference check.

**Action type:** Orphaned runtime state cleanup.

---

## 7. `runtime.activeProjectForChatManagement` is effectively bookkeeping without a behavioral consumer

**Priority:** Medium

**Locations:**
- `ChatUI/js/state/store.js` — runtime field `activeProjectForChatManagement`.
- `ChatUI/js/sidebar/projects.js` — `openManageProjectChatsModal()` stores the project in this field.
- `ChatUI/js/sidebar/projects.js` — `deleteProject()` contains cleanup logic to null the field if the project is deleted.

**What it is:**

The currently rendered Manage Project Chats modal uses the `project` function argument/closure throughout. The runtime field is set and later defensively cleaned up, but the modal behavior does not read it.

**Why it is unnecessary:**

It creates global state plus deletion bookkeeping for information already available in the active function closure.

**Recommendation:**

Remove the field, the write, and the associated delete-project cleanup after final reference verification. Do **not** remove `activeProjectForRename`; that separate field is actively consumed by the rename-confirm handler.

**Action type:** Orphaned state and housekeeping removal.

---

## 8. Thinking-level definitions contain an unused `color` property

**Priority:** Low

**Location:**
- `ChatUI/js/ui/model-thinking-menu.js` — `THINKING_LEVELS` objects define `{ id, label, color }`.

**Current consumer behavior:**

JavaScript uses the level `id` and `label`; visual colors are supplied by CSS classes such as `.thinking-high`, `.thinking-medium`, `.thinking-low`, and `.thinking-minimal` in `ChatUI/css/components/thinking-menu.css`.

**Why it is unused:**

The `color` metadata is not used to render or style the current selector. The color values therefore exist twice conceptually, but only the CSS copy drives the UI.

**Recommendation:**

Remove the unused `color` properties if CSS remains the chosen source of truth. If a later cleanup makes the data model own colors instead, do the opposite—but keep one source, not dead metadata.

**Action type:** Small dead-data cleanup.

---

## 9. Manage-Project-Chats group objects carry unused `id` and `target` properties

**Priority:** Low

**Location:**
- `ChatUI/js/sidebar/projects.js`, inside `openManageProjectChatsModal()` where the local `groups` array is constructed.

**What it is:**

Each group object contains `id` and `target`, but the current render loop only consumes fields such as `name`, `icon`, and `chats`.

**Why it is unused:**

These properties appear to be remnants of an earlier design for distinguishing the target project or routing assignment logic through the group object. Current checkbox behavior closes over the actual `project` argument instead.

**Recommendation:**

Remove `id` and `target` from these private local objects unless a forthcoming consolidation deliberately starts using them.

**Action type:** Small dead-data cleanup.

---

## Category 2 items checked and intentionally NOT classified as dead

- `ChatUI/js/chat/message-renderer.js` still has `appendLegacyAssistantContent()`. Despite the name, it remains necessary for stored chats/messages that do not have an `activityTimeline`; deleting it now could break historical chats.
- The Text API profile module still mirrors legacy active aliases (`textApiKey`, `textApiKeys`, `textApiKeyIndex`, `textBaseUrl`). Those aliases are currently consumed by the existing request/failover code, so they are architectural debt rather than dead code.
- `TEMP_PERF_DIAGNOSTICS` is explicitly temporary, but the standalone ChatUI loader still imports and initializes it. It belongs in a later **temporary/unrequested features** category, not dead code.
- Small facade modules such as `ChatUI/js/ui/menus.js`, `ChatUI/js/chat/messages.js`, `ChatUI/js/sidebar/sidebar.js`, and `ChatUI/js/chat/chat.js` are still valid stable import boundaries; small size alone does not make them dead.
- `activeProjectId` is active: new-chat/project routing sets it and sidebar rendering reads it.
- `activeProjectForRename` is active and used when confirming a project rename.

---

# Next category

Not started yet: **Category 3 — unnecessary / temporary / unrequested features and development-only functionality that may not belong in the production ChatUI.**
