# Implementation Plan ID 13 — ChatUI 2.1 Theme, Controls, API Modes, and Automatic Titles

This pass fixes a coordinated set of ChatUI desktop, appearance, settings, and conversation refinements without changing the existing message/tool semantics.

- Position message More menus above the three-dot control from its leading edge, using the shared action-menu primitive.
- Remove the unwanted blue focus line from the composer and native input/select editing fields while retaining quiet keyboard focus for discrete controls.
- Make the right Controls sidebar consume layout width and push/shrink chat content on desktop; preserve the existing overlay drawer behavior on phones.
- Make Light mode use explicit light hover, selected-row, popup-menu, focus, scrollbar, and related surface tokens instead of inheriting dark-theme colors.
- Keep the selected-chat state intact and add a little spacing below the left-sidebar header.
- Make the Gemini Text API key editor compact and add persistent Mode 1 / Mode 2 Text API profiles. Each mode owns its key pool, key health/cooldowns/index, and Base URL; Voice API configuration remains separate.
- Migrate existing single Text API configuration into Mode 1 and leave Mode 2 empty until configured.
- After two completed user-assistant exchanges in a newly created chat, generate one background title with fixed `gemini-3.5-flash-lite` using the currently selected Text API profile, streaming transport, and existing key failover policy.
- A manual chat rename always takes title ownership. Automatic-title failure never changes the successful answer lifecycle or chat ordering.
- Hide the default large new-chat heading while preserving loading/error empty-state messages.
- Bump ChatUI version to 2.1.

Verification: Plans 7–13 regression checks, iframe integration checks, production static build, and an exact-head Cloudflare preview. Browser automation is not used.
