# Implementation Plan ID 12 — ChatUI UI Refinement

This pass refines five existing UI areas while preserving application behavior.

- Move the composer keyboard-focus treatment from the inner editor rectangle to the outer rounded composer.
- Replace the Audio Read native voice selector at runtime with a dark custom picker and a voice preview control that reuses the existing audio transport/playback engine.
- Give Settings a subtle dark scrollbar and keep the close control separated from the scroll rail.
- Keep common message actions visible and put secondary actions in a More menu. No new share or send actions are added.
- Align project titles with first-level chat titles, keep project children as the only indented level, and add a subtle hierarchy guide.
- Bump ChatUI version to 2.0.

Verification: existing regression checks, a focused Plan 12 static check, production static build, and an exact-head Cloudflare preview. Browser automation is not used.
