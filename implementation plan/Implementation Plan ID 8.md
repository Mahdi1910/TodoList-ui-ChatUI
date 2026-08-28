# Implementation Plan ID 8 — Adaptive Chat Composer Layout

## Goal

Keep the existing two-part ChatUI composer, but make its empty state compact like the supplied Google AI Studio reference and make mobile paste safe from trailing Enter/newline behavior. Preserve Milkdown/ProseMirror Markdown editing, attachments, AI tools, audio recording, Live Voice, Send, Stop generation, keyboard submission, and embedded/standalone behavior.

## Current problem

The composer now correctly separates editor content from controls, but its fixed empty sizing is too tall on mobile. The mobile rules force a 64px text row plus a 44px controls row, extra spacing/padding, and a 136px minimum composer height. This makes the empty composer substantially taller than the supplied reference.

A second issue exists at the editor boundary: clipboard text can end with newline/Enter characters, and some mobile clipboard/keyboard integrations can also emit an Enter key event immediately after paste. A paste must never submit the message or create a meaningless trailing blank paragraph.

## Design behavior

### Permanent two-part structure

- Keep the Milkdown/ProseMirror editor and placeholder exclusively in the top row.
- Keep Attach, Tools, active-tool indicators, Record, and Live Voice/Send/Stop exclusively in the bottom row.
- Never allow editor text or placeholder content to share the controls row.

### Compact empty composer

- Desktop: start with a 40px editor row over a 40px controls row.
- Mobile: start with a 44px editor row over a 44px controls row.
- Keep only a small gap/padding between the rows so the empty composer is compact.
- The text row should be approximately the same height as the controls row when empty or when showing one short line.
- The editor must grow naturally only when content requires additional lines.
- Preserve the existing bounded maximum editor height and internal scrolling for long prompts.

### Paste safety

- Preserve intentional internal line breaks in pasted text.
- Normalize mobile/Unicode clipboard line separators to normal line feeds.
- Remove only trailing pasted newline/Enter characters so copied text ending with a return does not create an empty paragraph.
- Mark paste events at the editor DOM boundary.
- For a short bounded window immediately after paste, consume any Enter key event emitted by a mobile clipboard/keyboard integration instead of submitting or inserting another line.
- Outside that short paste guard, preserve the existing manual Enter-to-send, modifier submit, Shift+Enter, Alt+Enter, and composition behavior.

### Mobile

- Preserve the 16px editor font to avoid browser auto-zoom.
- Keep 44px touch targets for composer controls.
- Keep safe-area padding and the existing `100dvh` application layout.

## Implementation

1. `ChatUI/css/chat/composer.css`
   - Reduce the desktop minimum composer height.
   - Use equal 40px minimum editor/control rows with a small row gap.

2. `ChatUI/css/chat/composer-editor.css`
   - Reduce the empty editor minimum to the corresponding control height.
   - Keep placeholder alignment, bounded multiline growth, and internal scrolling.

3. `ChatUI/css/responsive.css`
   - Reduce the mobile minimum composer height from the oversized previous value.
   - Use equal 44px editor/control rows.

4. `ChatUI/js/composer/paste-normalization.js`
   - Add a pure clipboard text normalizer and the bounded mobile paste Enter-guard duration.

5. `ChatUI/js/composer/markdown-editor.js`
   - Normalize pasted plain text through the new helper.
   - Mark paste events and suppress paste-generated Enter submission during the short guard window.
   - Preserve normal keyboard submission outside that window.

6. `ChatUI/js/api/api-config.js`
   - Bump visible ChatUI version from 1.5 to 1.6.

## Non-goals

- No changes to Gemini networking, key rotation, storage, message persistence, or tool execution.
- No changes to normal manual keyboard submission semantics outside the paste guard.
- No replacement of Milkdown/ProseMirror.
- No removal of existing composer controls.
- No browser automation.

## Verification

- Deterministic checks for 40px desktop and 44px mobile equal-height empty rows.
- Verify the reduced overall minimum composer heights.
- Unit-style checks that pasted internal newlines remain while trailing line breaks are removed.
- Verify the editor installs both paste normalization and the short Enter guard.
- Verify normal Enter submission code remains present.
- Run Plan 7, Plan 8, JavaScript syntax checks, safe runtime build, and repository integration workflow.
- Require a successful Cloudflare branch/commit preview on the exact PR head before merge.
