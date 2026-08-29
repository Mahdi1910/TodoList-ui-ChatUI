# Implementation Plan ID 16 — Triple-click Read Selection + Sent-message Wrapping

## Goal

Fix two user-visible correctness problems without changing Read Aloud transport or message persistence:

1. Triple-click/paragraph selections must enable **Read Selected Text** even when the browser places one Range endpoint just outside the visible readable block.
2. Sent user messages must never expose a horizontal scrollbar for ordinary prose; long text should wrap inside the bubble.

## Implementation

- Replace endpoint-membership gating in `read-selection.js` with readable-root range intersection and boundary clipping.
- Preserve the existing readable roots: user `.message-text`, legacy assistant `.content-slot`, and activity-timeline `.activity-item-text`.
- Preserve stale-selection clearing, chat ownership, pointerdown capture, and the existing Gemini Live Read Aloud path.
- Change the whole `.user-bubble` from horizontal auto-scroll to hidden horizontal overflow.
- Explicitly make normal user prose wrap with `white-space: normal`, `overflow-wrap: break-word`, and `word-break: normal`.
- Keep specialized code/table surfaces responsible for their own local overflow.
- Bump visible ChatUI version from 2.3 to 2.4.

## Verification

- Run Plans 7–16 and Iframe Integration on the exact PR head.
- Run the static production build.
- Require a successful Cloudflare preview for the exact shippable head.
- Do not use browser automation; manual visual testing remains with the user.
