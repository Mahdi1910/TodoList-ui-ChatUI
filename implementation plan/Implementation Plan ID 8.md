# Implementation Plan ID 8 — Adaptive Chat Composer Layout

## Goal

Redesign the existing ChatUI composer so it behaves like a polished adaptive chat input while preserving all current functionality: Milkdown/ProseMirror Markdown editing, attachments, AI tools, audio recording, Live Voice, Send, Stop generation, keyboard submission, and embedded/standalone behavior.

## Current problem

The original composer placed the editor and every control in one flex row with `align-items: flex-end`. Plan 8 first replaced that with an adaptive grid, but the empty state still kept the placeholder/editor between the controls on one horizontal row. The final reference behavior requires a stricter layout contract:

1. The editor/placeholder must always live in a dedicated top region.
2. Attach, Tools, active-tool indicators, Record, and the primary action must always live in a dedicated bottom region.
3. Empty and non-empty composer states must use the same two-row structure so the input never jumps between fundamentally different geometries.

The editor already provides the correct rich-text behavior and should not be replaced.

## Design behavior

### All composer states

- Always use a two-row grid.
- Put the Milkdown/ProseMirror editor and placeholder on the full top row.
- Put Attach, Tools, active-tool indicators, Record, and Live Voice/Send/Stop on the bottom row.
- Never allow editor text or placeholder content to share the controls row.
- Keep consistent circular hit targets and stable bottom-row alignment.
- Keep active-tool indicators usable without allowing them to destroy editor width.

### Empty composer

- Keep a dedicated top text area even when no text exists.
- Show the placeholder near the top/start of that text area, matching the supplied reference.
- Keep the bottom row visually separate and free of input text.
- Avoid the previous pill-like single-line empty geometry.

### Composer with text

- Keep the same two-row structure used by the empty state.
- Let the editor grow upward naturally with wrapped/multiline content.
- Cap editor height and use internal scrolling after the cap.
- Keep the bottom action row anchored while the editor scrolls.

### Mobile

- Preserve the existing 16px editor font to avoid unwanted mobile browser zoom.
- Use touch-friendly 44px controls.
- Reserve a 64px minimum editor row above the controls even when empty.
- Allow a larger bounded editor height for long prompts.
- Keep safe-area padding and the existing `100dvh` application layout.

## Implementation

1. `ChatUI/css/chat/composer.css`
   - Use one permanent two-row CSS grid for every composer state.
   - Reserve a desktop editor row above the fixed controls row.
   - Standardize button dimensions/icon alignment and primary action appearance.
   - Keep tool popover positioning compatible with the composer bar.

2. `ChatUI/css/chat/composer-editor.css`
   - Give the editor a dedicated minimum top-row height even when empty.
   - Anchor placeholder positioning inside the ProseMirror surface.
   - Keep bounded multiline growth and internal scrolling.

3. `ChatUI/css/responsive.css`
   - Apply the same permanent two-row geometry on mobile.
   - Keep 44px touch targets and a 64px minimum editor row.

4. `ChatUI/js/composer/composer.js`
   - Preserve existing text-aware Send/Voice/Stop decision logic.
   - No layout behavior should depend on the text-present state.

5. `ChatUI/js/api/api-config.js`
   - Bump visible ChatUI version from 1.4 to 1.5.

## Non-goals

- No changes to Gemini networking, key rotation, storage, message persistence, or tool execution.
- No changes to Enter/Shift+Enter/keyboard submission semantics.
- No replacement of Milkdown/ProseMirror.
- No removal of existing composer controls.
- No browser automation.

## Verification

- Deterministic source assertions that the editor is always on the top grid row and controls are always on the bottom grid row.
- Reject any future single-row grid area containing both `editor` and control areas.
- Verify mobile keeps a dedicated editor row, 16px anti-zoom font, and bounded scrollable height.
- Run the existing Plan 7 key-pool checks, Plan 8 composer checks, safe build/integration workflow, and syntax checks.
- Require a successful Cloudflare branch/commit preview on the exact PR head before merge.
