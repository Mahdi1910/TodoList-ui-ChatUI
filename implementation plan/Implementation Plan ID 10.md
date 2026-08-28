# Implementation Plan ID 10 — Mobile Interaction Polish

## Goal

Make the combined ChatUI application behave like a modern mobile chat interface without changing Gemini generation, chat persistence, project data, attachments, voice behavior, or the intentional mouse-wheel model/thinking selection feature.

This plan supersedes Plan 9 only for per-row sidebar action controls: row buttons are replaced by long-press/context-menu actions while Plan 9's two-level hierarchy and selected-row styling remain intact.

## 1. Keyboard ownership between shell and ChatUI

The combined shell must keep its To-Do / AI / Habit / Diary / Settings navigation anchored to the shell layout bottom. Opening the software keyboard must not lift that rail above the keyboard.

- Remove `interactive-widget=resizes-content` from the outer shell viewport metadata.
- Anchor the mobile shell rail with `position: absolute` inside the stable `.shell` layout box instead of `position: fixed` against the visual viewport.
- Observe `window.visualViewport` in the shell.
- Compute how much of the ChatUI stage is actually covered by the visual viewport/keyboard.
- Send that bottom occlusion only to the ChatUI iframe through `shell:viewport-insets`.
- Apply the received value to `--shell-keyboard-occlusion-bottom` inside embedded ChatUI.
- On mobile, add that value as the composer's bottom margin so the composer rises above the keyboard while the outer navigation remains underneath it.
- Ignore sub-80px visual viewport differences so normal browser chrome changes do not masquerade as a keyboard.

## 2. Compact mobile header

Desktop header behavior stays unchanged. On screens up to 767px:

- Keep the sidebar opener, model selector, thinking selector, and chat overflow menu in the header.
- Reduce model selector typography/padding and allow its label to ellipsize.
- Remove the thinking selector's desktop minimum width and use compact typography.
- Hide the dedicated right Controls-panel icon on mobile.
- Add `Controls` to the existing chat overflow menu on mobile so no capability is lost.
- Keep 40px header icon hit areas.

The intentional mouse-wheel behavior for model/thinking selection is not changed.

## 3. Tools popover touch targets

The descriptions-free Tools design from Plan 9 remains.

- Keep each visible switch at 34×18px.
- Give the switch label a 44×44px finger target.
- Make the rest of each 48px tool row tappable and route it through the existing checkbox `change` handler.
- Avoid double toggles when the user taps the native switch label itself.
- Give the close control a 44×44px target.
- Keep unavailable tools non-interactive.

## 4. Active tool indicators

Increase composer active-tool indicator buttons from 28×28px to 34×34px on desktop and 36×36px on phones, with a modest icon increase. They remain smaller than the primary 44px composer controls.

## 5. Sidebar row actions by long press/context menu

Remove the redundant per-row project `+`/menu buttons and chat pin/menu buttons.

- Normal chat tap still opens the chat.
- Normal project tap still expands/collapses the project.
- Touch/pen long press for 500ms opens the existing shared action menu.
- Moving more than 10px cancels the long press so normal vertical scrolling is not interrupted.
- A successful long press consumes the synthetic click so it cannot also navigate or toggle collapse.
- Desktop right-click opens the same menu.
- Keyboard `ContextMenu` and `Shift+F10` open the same menu.
- Chat menu retains Pin/Unpin, Move to Project, and Delete.
- Project menu retains Create Chat Inside, Manage Chats, Rename, and Delete Project.
- Section-level create buttons remain because users still need a way to create the first project/chat.

## 6. Real mobile sidebar backdrop

Replace the decorative non-interactive pseudo backdrop with a real DOM backdrop button.

- The backdrop sits below the drawer and above app content.
- It receives pointer events itself, so taps cannot reach controls behind it.
- Tapping the backdrop closes the sidebar and stops propagation.
- The backdrop is synchronized whenever the mobile drawer opens/closes or the viewport crosses the mobile breakpoint.

## Version

ChatUI Settings version: **1.8**.

## Verification

`ChatUI Plan 10 Mobile Interaction Check` statically verifies the shell keyboard contract, compact header, Tools touch targets, larger active-tool pills, long-press/context-menu sidebar behavior, real backdrop behavior, and version 1.8. Existing Plan 7, Plan 8, Plan 9, and Iframe Integration checks must continue to pass. No browser automation is used.
