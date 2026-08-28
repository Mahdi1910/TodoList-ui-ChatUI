# Implementation Plan ID 9 — Mobile Sidebar Actions and Compact Tools Menu

## Goal

Refine the ChatUI composer Tools popover and left sidebar so the mobile/touch experience does not depend on hover and the project/chat hierarchy reads as two levels instead of three.

## Requested behavior

### Composer Tools popover

- Keep the Tools title, close button, tool icon, tool name, and toggle.
- Remove every explanatory/subtitle line from Google Search, URL Context, Code Execution, Workspace, and To-Do.
- Let the popover become naturally shorter and easier to scan on a phone.
- Preserve all existing tool toggle IDs and behavior.

### Sidebar hierarchy

- Treat a project row as a first-level sidebar item, visually aligned with independent/recent chat rows.
- Remove the extra outer project padding that made projects look like an additional nested level.
- Keep chats inside a project as the only second-level rows.
- Make the nested project chat list stretch across the available sidebar width instead of shrink-wrapping around its contents.
- Preserve the existing selected-chat background/state.

### Sidebar row actions

- Keep project actions in a dedicated right-side area: create-chat `+` and project options.
- Keep chat actions in a dedicated right-side area: pin/unpin and three-dot options.
- On fine-pointer desktop devices, actions may continue to appear on hover/focus.
- On touch/coarse-pointer devices, actions must be directly visible and tappable without hover.
- Use larger touch targets on coarse pointers.
- Prevent keyboard activation of a project action button from also toggling project collapse state.

## Implementation

1. `ChatUI/html/main-chat.html`
   - Remove all `.tool-desc` elements from the composer Tools popover.
   - Preserve tool names, icons, toggles, IDs, and dialog structure.

2. `ChatUI/css/chat/tools.css`
   - Simplify the single-line tool row layout after descriptions are removed.
   - Keep the popup compact without changing toggle behavior.

3. `ChatUI/css/sidebar/items.css`
   - Make project containers stretch rather than center their nested contents.
   - Remove the extra project outer padding.
   - Keep nested project chats as one indented second level and make the nested list full width.
   - Move row actions into a right-aligned action zone.
   - Use hover/focus reveal on desktop and permanent visibility on touch/coarse pointers.
   - Preserve the current active-chat selection background.

4. `ChatUI/js/sidebar/sidebar-render.js`
   - Preserve project create-chat/options and chat pin/options behavior.
   - Add explicit action labels.
   - Prevent project header keyboard handling from swallowing action-button activation.

5. `ChatUI/js/api/api-config.js`
   - Bump the visible ChatUI version from 1.6 to 1.7.

## Non-goals

- No changes to chat/project persistence, routing, creation, deletion, or pin semantics.
- No changes to Gemini networking, API-key rotation, message generation, attachments, voice, or composer text editing.
- No browser automation.

## Verification

- Add deterministic source checks for the removed tool descriptions.
- Verify all five tool names/toggles remain present.
- Verify project rows are first-level/full-width and nested project chats are the only indented level.
- Verify chat/project actions remain present and touch media rules expose them without hover.
- Verify the active chat selection style remains present.
- Run Plan 7, Plan 8, Plan 9, and the existing integration/build workflow.
- Require a successful Cloudflare branch/commit preview on the exact PR head before merge.
