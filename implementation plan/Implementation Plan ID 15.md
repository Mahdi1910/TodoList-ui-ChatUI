# Implementation Plan ID 15 — Accurate sent-message disclosure and Read Selected Text

## Scope

- Show `Show more` only when a user-sent message actually renders beyond roughly six lines.
- Keep short sent messages free of disclosure controls and use a lighter accessible blue bubble.
- Make Read Selected Text recognize current and historical assistant text rendered through activity timelines as well as legacy/user message text.
- Never reuse stale selected text when a new non-readable selection is made or when the active chat changes.
- Preserve the existing Gemini Live Audio transport and pass the captured selection snapshot unchanged into it.
- Advance visible ChatUI version to 2.3.

## Verification

- Plans 7–15 and Iframe Integration must pass on the exact pull-request head.
- Static combined-app build must pass.
- Cloudflare commit/branch preview must succeed for the same exact head before squash merge.
- Do not use browser automation; manual visual verification remains a user/browser responsibility per `NEW_CHAT_HANDOFF.md`.
