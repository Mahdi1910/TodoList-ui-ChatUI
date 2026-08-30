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

- `ChatUI/js/ui/model-thinking-menu.js`, approximately lines 48–124 — Model selector and Thinking selector lifecycle.
- `ChatUI/js/voice/read-settings.js`, approximately lines 192–310 — Audio Read voice selector lifecycle.

**What it is:**

Model selection, Thinking-level selection, and Audio Voice selection are all the same broad UI pattern: a trigger button opens a list of choices, one option is selected, keyboard/focus state is managed, outside clicks close the list, and `aria-expanded`/selection state is updated.

**Why it is a cleanup candidate:**

Each feature implements its own open/close, outside-click, focus, Escape, option rendering, and keyboard behavior. The implementations have already drifted: the Audio Voice picker supports Arrow/Home/End behavior that Model/Thinking do not implement in the same way.

**Recommendation:**

Create a reusable `listbox-popover.js`-style primitive. Model, Thinking, and Voice should provide data, rendering details, and selection callbacks while the primitive owns the shared lifecycle and keyboard behavior.

**Action type:** Consolidate; do not simply delete one implementation.

---

## 2. Popup lifecycle repeated despite an existing shared popup system

**Priority:** High

**Canonical/shared implementation:**

- `ChatUI/js/ui/action-menu.js`, approximately lines 20–160.

**Parallel implementations:**

- `ChatUI/js/ui/model-thinking-menu.js`, approximately lines 48–124.
- `ChatUI/js/composer/composer.js`, approximately lines 98–174 — Tools popup.
- `ChatUI/js/voice/read-settings.js`, approximately lines 192–310 — Voice picker.

**What it is:**

`action-menu.js` already owns common popup mechanics such as active anchor state, open/close behavior, outside interaction, Escape handling, focus restoration, positioning, and keyboard navigation. Other popup-like controls independently implement overlapping mechanics.

**Why it is a cleanup candidate:**

The application now has multiple sources of truth for popup lifecycle. Fixes to positioning, focus restoration, accessibility, or mobile behavior can therefore be applied to one popup family but not the others.

**Recommendation:**

Do **not** force every UI into `action-menu.js`, because action menus, listboxes, and the Tools panel have different semantics. Instead, extract a lower-level `popover-controller`/popover utility and let specialized components build on it:

- `action-menu.js`
- `listbox-popover.js`
- Tools popup/dialog controller

**Action type:** Refactor shared mechanics, preserving component semantics.

---

## 3. Modal lifecycle has multiple owners and the central registry is already incomplete

**Priority:** High

**Locations:**

- `ChatUI/js/ui/modals.js`, approximately lines 8–112.
- `ChatUI/html/chat-modals.html`, approximately lines 1–145.
- `ChatUI/js/sidebar/projects.js` — project modal opening/closing and project-dialog actions.
- `ChatUI/js/sidebar/search.js` — Search dialog open/close lifecycle.
- `ChatUI/js/settings/settings.js`, approximately lines 107–145 and 220–227 — Settings modal lifecycle.

**What it is:**

`modals.js` presents itself as the generic modal manager, including Escape handling and focus trapping, but it manually enumerates selected modal IDs. Feature modules also independently open, close, and handle backdrop behavior for their own dialogs.

**Specific drift found:**

`ChatUI/html/chat-modals.html` contains dialogs including **Manage Project Chats** and **Rename Chat**, while the central `getVisibleActiveDialog()` / Escape chain in `modals.js` does not enumerate all current dialogs.

**Why it is a cleanup candidate:**

Every new modal requires developers to remember several separate locations. Missing one location silently produces inconsistent Escape/focus behavior.

**Recommendation:**

Use one modal manager that discovers or registers dialogs generically rather than hard-coding every modal ID. Feature modules should own feature-specific content and actions, while the common manager owns open/close, focus restoration/trapping, Escape, and backdrop behavior.

**Action type:** Consolidate modal infrastructure carefully.

---

## 4. Audio Voice keeps a legacy native `<select>` and replaces it at runtime

**Priority:** Medium/High

**Locations:**

- `ChatUI/html/settings-modal.html`, approximately lines 41–49 — `<select id="audio-read-voice-select">`.
- `ChatUI/js/voice/read-settings.js`, approximately lines 48–92 — `ensureVoicePicker()` finds the legacy select, builds an entirely different custom picker, then calls `legacySelect.replaceWith(root)`.

**What it is:**

There are two representations of the same setting: a native select in source HTML and a custom listbox generated by JavaScript.

**Why it is a cleanup candidate:**

The HTML no longer describes the actual rendered component. It adds runtime transformation logic and a legacy branch that every future change has to understand. ChatUI is already JavaScript-dependent, so this does not provide a meaningful no-JavaScript fallback.

**Recommendation:**

Put the current custom voice picker markup directly in the Settings HTML (or generate it through one standard component system) and remove the legacy-select conversion path after confirming nothing relies on it.

**Action type:** Remove legacy representation after verification.

---

## 5. Old per-message popup-menu CSS appears to remain after migration to the shared action menu

**Priority:** High; likely safe removal after final reference verification

**Locations:**

- `ChatUI/css/chat/message-actions.css`, approximately lines 30–88 — `.message-more-menu`, `.message-menu-item`, danger/hover/touch rules.
- Current implementation: `ChatUI/js/chat/message-controls.js`, approximately lines 82–174 — message More actions call `openActionMenu()`.

**What it is:**

The stylesheet still defines an entire dedicated per-message popup menu system, including positioning and row styling. Current message controls use the shared global action menu instead.

**Why it is a cleanup candidate:**

If no remaining DOM creator uses `.message-more-menu` or `.message-menu-item`, this is discarded implementation code that increases CSS size and creates false architecture signals.

**Recommendation:**

During the dead-code category, perform a repository-wide reference check. If there are no live creators/references, remove these legacy selectors.

**Action type:** Probable deletion, pending Category 2 verification.

---

## 6. `modals.js` still contains handling for an old message-context-menu system

**Priority:** High; likely dead code

**Location:**

- `ChatUI/js/ui/modals.js`, approximately lines 42–47 — searches for `.message-context-menu.show` and removes `show` on Escape.

**What it is:**

The code comments that the shared action menu owns its own Escape lifecycle, but still contains a branch for `.message-context-menu.show`.

**Why it is a cleanup candidate:**

Current message controls use `action-menu.js`. This looks like migration residue from an older message-menu implementation.

**Recommendation:**

Category 2 should verify there are no remaining creators or references to `.message-context-menu`. If none exist, remove this branch.

**Action type:** Probable deletion, pending dead-reference verification.

---

## 7. `refinements.css` acts as a second CSS architecture layered on top of component CSS

**Priority:** Very High

**Primary location:**

- `ChatUI/css/refinements.css`, approximately lines 1–215.

**Related original component definitions include:**

- `ChatUI/css/components/model-menu.css`, approximately lines 23–61.
- `ChatUI/css/components/thinking-menu.css`, approximately lines 15–41.
- Other Composer, Tools, Settings, Sidebar, Message, and Voice component styles.

**What it is:**

`refinements.css` patches many unrelated components after their normal styles are loaded. It changes Composer focus, message menus, Model, Thinking, Tools, Settings, Voice, scrollbar styling, sidebar selection, API-profile controls, API-key sizing, light-mode Markdown surfaces, and the empty landing state. Many rules use `!important`.

**Why it is a cleanup candidate:**

Correct final appearance now depends on load order and override strength rather than component ownership. A developer reading `model-menu.css`, for example, cannot know the final Model menu styling without also finding later overrides in `refinements.css`.

This is architecture drift rather than merely a large stylesheet.

**Recommendation:**

Move final component-specific rules back into the component stylesheet that owns each feature. Keep only genuinely application-global refinements in a global layer. The end goal should be to delete `refinements.css` or reduce it to a small set of truly cross-cutting rules.

**Action type:** Gradual CSS consolidation; high regression risk if done as one blind deletion.

---

## 8. ChatUI uses both its custom modal framework and native browser dialogs for application workflows

**Priority:** Medium/High

**Locations:**

- `ChatUI/js/workspace/workspace-ui.js`, approximately lines 390–429 — `prompt()` for Rename/Move and `confirm()` for Delete.
- `ChatUI/js/workspace/workspace-ui.js`, approximately lines 430–457 — `prompt()` for New Folder/New Page.
- `ChatUI/js/settings/settings.js`, around the Remove Everything action — `window.confirm()`.
- Additional `alert()` usage exists across feature modules and should be inventoried separately.

**What it is:**

Some application interactions use ChatUI dialogs, while Workspace CRUD and other operations use browser-native `prompt`, `confirm`, and `alert` dialogs.

**Why it is a cleanup candidate:**

Native dialogs bypass ChatUI theme/layout, mobile behavior, consistent focus management, and application-level accessibility/UI conventions. They also create two dialog architectures developers must maintain mentally.

**Recommendation:**

After the modal architecture is stabilized, add small reusable promise-based application dialogs such as:

```js
const name = await promptDialog(...);
const confirmed = await confirmDialog(...);
```

Then migrate application workflows gradually. Error/toast handling should be considered separately rather than blindly converting every `alert()` at once.

**Action type:** Replace parallel browser-dialog system gradually.

---

## Category 1 architecture summary

Current shape observed:

```text
Popup behavior
├── action-menu.js
├── model dropdown logic
├── thinking dropdown logic
├── Tools popup logic
└── Audio Voice popup logic

Dialog behavior
├── modals.js
├── Settings-specific lifecycle
├── Search-specific lifecycle
├── Project-specific lifecycle
├── Workspace prompt()/confirm()
└── various alert() calls

Final styling
├── component CSS
└── refinements.css overriding component CSS
```

A cleaner future direction could be:

```text
UI primitives
├── popover-controller.js
│   ├── action-menu.js
│   ├── listbox-popover.js
│   └── tools-popover.js
│
├── modal-manager.js
│   ├── promptDialog()
│   └── confirmDialog()
│
└── component-owned CSS
    ├── model-menu.css
    ├── thinking-menu.css
    ├── tools.css
    ├── settings.css
    └── ...
```

## Items intentionally not classified as cleanup problems in Category 1

- Small facade files such as `sidebar/sidebar.js` and `chat/chat.js` can provide stable public entry points; small file size alone is not a reason to remove them.
- Tool controls appearing in both the Composer and the Controls sidebar are multiple UI entry points backed by the same underlying state. That is not automatically harmful duplication and should not be removed solely to reduce line count.

---

# Next category

Not started yet in this document: **Category 2 — dead / obsolete / unused code and references.**
