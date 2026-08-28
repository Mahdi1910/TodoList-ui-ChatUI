# Implementation Plan ID 8 — Adaptive Chat Composer Layout

## Goal

Redesign the existing ChatUI composer so it behaves like a polished adaptive chat input while preserving all current functionality: Milkdown/ProseMirror Markdown editing, attachments, AI tools, audio recording, Live Voice, Send, Stop generation, keyboard submission, and embedded/standalone behavior.

## Current problem

The composer currently places the editor and every control in one flex row with `align-items: flex-end`. This produces two UX problems:

1. In the empty state the placeholder and buttons do not share a balanced vertical center.
2. As text grows, the editor gets taller while the controls remain sibling items at the bottom edge, so the composer does not read as a stable text region plus a stable action row.

The editor already provides the correct rich-text behavior and should not be replaced.

## Design behavior

### Empty composer

- Keep the composer compact.
- Show Attach, Tools, placeholder/editor, Record, and Live Voice/Send/Stop on one horizontal level.
- Center controls vertically and keep consistent circular hit targets.
- Keep active-tool indicators usable without allowing them to destroy the editor width.

### Composer with text

- Switch the composer to a two-row grid.
- Put the editor on the full top row.
- Keep Attach, Tools, active-tool indicators, Record, and the primary action on a fixed bottom row.
- Let the editor grow upward naturally with wrapped/multiline content.
- Cap editor height and use internal scrolling after the cap.
- Keep the bottom action row anchored while the editor scrolls.

### Mobile

- Preserve the existing 16px editor font to avoid unwanted mobile browser zoom.
- Use touch-friendly control sizes.
- Allow a larger bounded editor height than the old 170px cap so long prompts remain comfortable.
- Keep safe-area padding and the existing `100dvh` application layout.

## Implementation

1. `ChatUI/js/composer/composer.js`
   - Derive whether the editor currently contains text.
   - Toggle a `composer-has-text` state class on `#composer-bar` on every composer-state update.
   - Preserve the existing Send/Voice/Stop decision logic.

2. `ChatUI/css/chat/composer.css`
   - Replace the single-row flex composer layout with an adaptive CSS grid.
   - Define compact empty-state and expanded text-state grid areas.
   - Standardize button dimensions/icon alignment and primary action appearance.
   - Keep tool popover positioning compatible with the composer bar.

3. `ChatUI/css/chat/composer-editor.css`
   - Center the empty editor/placeholder correctly.
   - Give the ProseMirror root stable internal padding and positioning.
   - Increase the bounded multiline height while retaining internal scrolling.

4. `ChatUI/css/responsive.css`
   - Apply mobile grid dimensions, touch targets, border radius, and editor height limits.

5. `ChatUI/js/api/api-config.js`
   - Bump visible ChatUI version from 1.3 to 1.4.

## Non-goals

- No changes to Gemini networking, key rotation, storage, message persistence, or tool execution.
- No changes to Enter/Shift+Enter/keyboard submission semantics.
- No replacement of Milkdown/ProseMirror.
- No removal of existing composer controls.
- No browser automation.

## Verification

- Static syntax checks for changed JavaScript.
- Deterministic source assertions that the adaptive grid and state class remain present.
- Verify the mobile editor keeps a 16px font and bounded scrollable height.
- Run the existing safe static build and integration workflow.
- Require a successful Cloudflare branch/commit preview on the exact PR head before merge.
