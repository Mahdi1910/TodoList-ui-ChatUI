# Implementation Plan ID 14 — Embedded Light Theme and Sent Message Compactness

This pass fixes the remaining appearance regressions visible in the combined ChatUI shell and makes long sent prompts easier to scan without changing message data or Gemini behavior.

- Load the final ChatUI refinement stylesheet from the embedded runtime as well as the standalone runtime.
- Keep shared action menus, Settings chrome, selector menus, hover states, selected states, and scrollbars appearance-aware in Light mode.
- Present Gemini Text API Mode 1 / Mode 2 as a centered compact segmented selector while preserving the existing persistent profile switching behavior.
- Reduce the Text API key editor height while keeping multiline key pools, masking, validation, cooldown state, and manual resize support.
- Give New Chat and Workspace the same first-level sidebar navigation treatment and add clear vertical spacing between them.
- Render user-sent message bubbles in the requested deep blue with readable Markdown colors.
- Collapse only long user-sent message content to approximately six lines by default, with Show more / Show less controls driven by actual rendered overflow. The complete message stays in the DOM and message state for copy, edit, regenerate, export, and Gemini context.
- Bump ChatUI version to 2.2.

Verification: existing Plans 7–13, focused Plan 14 static checks, iframe integration, production static build, and exact-head Cloudflare preview. Browser automation is not used.
