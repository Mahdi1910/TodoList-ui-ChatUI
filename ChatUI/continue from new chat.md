# ChatUI — Continue From New Chat

> Purpose: This is the main continuity/handoff file for starting a fresh ChatGPT conversation about ChatUI without losing the important project state.
>
> Repository: `Mahdi1910/ChatUI`
>
> Historical local project path: `C:\Users\mahdy\Desktop\Progect\ChatUI`
>
> Current source of truth: GitHub `main`
>
> Created after Plan 10 was fully implemented and merged.
>
> Important: this file supersedes the older `NEW_CHAT_HANDOFF.md` where Plan 10 was still described as in progress.

---

# 1. What ChatUI Is

ChatUI is a personal-use ChatGPT-style web application built mainly with:

- HTML5;
- CSS3;
- Vanilla JavaScript ES modules;
- IndexedDB;
- Gemini-compatible REST/SSE APIs;
- Gemini Live audio for Read Aloud / Voice-related features;
- Markdown rendering with syntax highlighting and KaTeX support;
- Cloudflare Workers static-assets deployment.

It is intentionally not a React/Next/Angular application.

The application is designed mainly for one user, so architecture decisions should optimize correctness, responsiveness, maintainability, and personal usability rather than hypothetical 10,000-user scale.

Production URL used during development:

`https://chatui.mahdy-00523775.workers.dev`

---

# 2. Current Main Status

Plan 10 is already fully implemented and merged into `main`.

Important recent commits:

- Plan 08 Workspace implementation: `23f3180eb6f5e3fe2a9318b2d06713f606a3212a`
- Plan 09 targeted persistence implementation: `b8ac47437850ac73a33966c74ba4fa7a540273ec`
- Plan 10 always-streaming agent timeline implementation: `ca4957b4d0533660abd5729b5d4e67038509e7a5`
- Previous handoff commit: `96a304da0c41762e38be3a536e9ef7ffc911dbd5`

The Plan 10 implementation commit specifically states that every ChatUI text-generation model round was changed to use `streamGenerateContent` SSE and that a persisted chronological activity timeline was added for thinking, Workspace/custom tools, returned built-in tools, Code Execution, and normal assistant Markdown.

Before making future changes, always verify the current `main` head because this handoff file itself creates a newer commit.

---

# 3. Important User Preferences / Working Rules

## Easy explanations

When explaining technical issues, use easy English first, then enough technical detail to stay accurate.

## No browser automation

Do NOT use browser automation for ChatUI unless the user explicitly changes this rule.

Do not use:

- Playwright;
- Selenium;
- headless Chrome / Chromium / Edge / Firefox;
- CDP automation.

The user manually tests the browser behavior.

Preferred verification:

- JavaScript syntax checks;
- ES-module import checks;
- repository/diff inspection;
- architecture invariant checks;
- static production build;
- Cloudflare branch preview.

## Git workflow

For substantial implementation work:

1. verify latest `main`;
2. create a feature branch;
3. implement only the requested scope/plan;
4. review the code carefully;
5. run static/code-level verification;
6. use a temporary GitHub Actions workflow if useful;
7. remove temporary verification workflow files before merge;
8. require successful Cloudflare preview for the exact shippable branch head;
9. confirm `main` did not unexpectedly move;
10. squash-merge into `main` as one easy-to-revert commit.

Do not force-push or rewrite `main` history.

GitHub history itself is normally enough backup; a separate local-style backup branch is not usually required for online GitHub work.

---

# 4. Main Product Areas

ChatUI currently includes:

- left sidebar;
- New Chat;
- chat list;
- project folders;
- project collapse/expand;
- rename/move/delete/pin chat actions;
- right sidebar;
- model picker;
- thinking-level picker;
- Gemini settings;
- separate Read Aloud settings;
- Google Search tool toggle;
- URL Context tool toggle;
- Code Execution tool toggle;
- Workspace tool toggle;
- normal text chat;
- streaming assistant responses;
- chronological agent activity timeline;
- image/PDF/audio/file attachments;
- microphone recording;
- Copy / Edit / Delete / Regenerate message actions;
- Read Aloud;
- selected-text Read command;
- Live Voice mode;
- browser-local Workspace;
- bookmarkable `/chat/<chatId>` URLs;
- browser Back/Forward routing;
- lazy chat loading;
- dark/light theme support;
- Cloudflare static deployment.

---

# 5. Models

Current configured models in `js/models/models.js`:

1. `3.6 Flash`
   - backend: `gemini-3.6-flash`
   - thinking: minimal / low / medium / high
   - default: medium

2. `3.5 Flash`
   - backend: `gemini-3.5-flash`
   - thinking: minimal / low / medium / high
   - default: medium

3. `3.5 Lite`
   - backend: `gemini-3.5-flash-lite`
   - thinking: minimal / low / medium / high
   - default: minimal

4. `3.1 Pro`
   - backend: `gemini-3.1-pro-preview`
   - thinking: low / medium / high
   - default: high

Do not casually rename backend IDs because the custom API gateway may depend on them.

---

# 6. Gemini Networking — Plan 10 COMPLETE

Main networking file:

`js/api/gemini.js`

Related files:

- `js/api/api-config.js`
- `js/api/gemini-live-audio.js`

Plan 10 changed the text-generation architecture so normal model rounds and custom Workspace-function rounds use SSE streaming.

Desired/current text-generation endpoint pattern:

```text
/v1beta/models/<model>:streamGenerateContent?alt=sse
```

The custom function loop should NOT return to the old pattern:

```text
:generateContent
await response.json()
```

unless the user explicitly decides to change architecture later.

## Important protocol rules

The custom tool loop must preserve:

- exact function-call IDs;
- function-response IDs matched to the original calls;
- thought-signature-bearing Gemini model parts;
- model Content needed for sequential function calling;
- AbortSignal behavior;
- maximum tool rounds / call limits;
- native tools and custom Workspace tools together;
- final safe model response parts for future history.

The visible UI activity timeline is NOT Gemini protocol history.

Never rebuild protocol history from display-only timeline cards.

---

# 7. Chronological Agent Activity Timeline — Plan 10 COMPLETE

Important files:

- `js/chat/activity-timeline.js`
- `js/chat/activity-renderer.js`
- `css/chat/activity-timeline.css`

Assistant messages can contain an optional:

```js
activityTimeline
```

The timeline displays execution in actual chronological order.

Example:

```text
Thinking
↓
Workspace tool requested
↓
Workspace tool running
↓
Workspace tool completed
↓
Thinking
↓
Assistant text
↓
Another tool call
↓
Thinking
↓
More assistant text
```

## Timeline item types

The timeline can represent:

- thinking blocks;
- normal assistant text segments;
- Workspace/custom function calls;
- built-in tool activity when Gemini actually returns invocation parts;
- Code Execution activity;
- failed/interrupted tools.

## Tool card behavior

Each invocation is its own collapsed agent-style card.

Typical states:

- Requested;
- Running;
- Done/Completed;
- Failed;
- Interrupted.

The tool card should appear as soon as the function call arrives, BEFORE the Workspace operation finishes.

Then the same card updates in place when the result is known.

Expanded details can show:

- tool/function name;
- safe arguments;
- bounded result preview;
- error details when present.

Do not dump huge Workspace file contents into the card or duplicate giant outputs in chat persistence.

## Thinking behavior

Separate thinking periods stay separate.

Do not collapse all reasoning periods into one giant block when tool calls/text appear between them.

Interrupted/failed thinking must not falsely display `Completed`.

## Built-in tool activity

When Gemini/custom gateway returns real server-side `toolCall` / `toolResponse` parts, ChatUI may show them for:

- Google Search;
- URL Context;
- Code Execution.

If the server does not return real invocation parts, do NOT invent fake tool-call activity just for appearance.

Existing source/grounding metadata can still display normally.

## Important separation

`message.content` remains the normal assistant-visible text.

`message.thinking` remains cumulative thinking text.

`activityTimeline` is presentation/execution history.

Read Aloud, Live Voice TTS, and Copy should use normal assistant content, NOT tool arguments/results/status labels/thinking.

---

# 8. Chat Generation Architecture

Important files in `js/chat/` include:

- `chat.js` — small public chat entry/barrel;
- `chat-loader.js` — lazy message loading;
- `conversation.js` — conversation/chat state operations;
- `generation.js` — generation exports/bridge;
- `generation-lifecycle.js` — generation lifecycle state;
- `generation-runner.js` — main generation orchestration;
- `activity-timeline.js` — timeline state/model;
- `activity-renderer.js` — chronological activity UI;
- `message-renderer.js` — main message rendering;
- `message-controls.js` — toolbar actions/UI;
- `message-actions.js` — edit/delete/action behavior;
- `message-attachments.js` — rendered attachment UI;
- `message-tools.js` — grounding/code/tool artifact UI;
- `markdown.js` — Markdown rendering/sanitization helpers.

Do not merge all of these back into one large `chat.js`. The application was intentionally modularized.

---

# 9. Message Actions — Important Invariants

Current message actions include:

- Copy;
- Delete;
- Edit;
- Regenerate;
- Read Aloud on assistant messages;
- selected-text Read from the top-right menu.

These are sensitive because earlier versions had duplicate-assistant/regeneration bugs.

## Stable message IDs

Message actions resolve messages using stable message IDs.

Do not change to fragile array-position behavior.

## User Edit

User Edit should:

- keep the same user message ID;
- preserve its existing attachments unless explicitly changed;
- save the edited text;
- not automatically regenerate unless the intended action specifically requests regeneration.

## Assistant Edit

Assistant Edit should keep the message identity but clear stale generated state that no longer matches manually edited text, including as appropriate:

- thinking;
- thought signature;
- model response parts;
- tool metadata;
- generated tool-file attachments;
- old activity timeline.

A manually edited assistant must not falsely claim old tool execution still happened.

## Regenerate

Both paths matter:

- regenerate from user message;
- regenerate from assistant message.

The implementation should preserve the logical assistant turn and avoid duplicate assistant messages.

When replacing an existing assistant answer, reuse the intended assistant identity/relationship rather than blindly appending another answer.

If regeneration fails before the replacement is durably committed, restore the old assistant content/state/timeline.

## Delete

Delete behavior should preserve current semantics:

- deleting a user can also remove its associated assistant where current logic expects that;
- deleting only an assistant should not unexpectedly destroy unrelated conversation history.

## Copy

Copy should copy the intended message text, not hidden activity metadata/tool results.

---

# 10. Plan 09 — Targeted Persistence / Fast Durable Send — COMPLETE

Important files:

- `js/storage/database.js`
- `js/storage/load.js`
- `js/storage/save.js`
- `js/storage/mutations.js`
- `js/storage/records.js`
- `js/storage/delete.js`
- `js/storage/write-coordinator.js`
- `js/storage/blob-utils.js`
- `js/storage/read-audio.js`
- `js/storage/migration.js`
- `js/storage/storage.js`

Plan 09 fixed a major latency problem.

Before Plan 09, sending one message could wait for a broad `saveState()` reconciliation over many loaded chats/messages/attachments.

Now the normal Send hot path uses targeted durable persistence.

Conceptually:

```text
Press Send
↓
write current chat metadata
write new user message
write only this message's new attachments
↓
Gemini starts
```

The safety invariant remains:

**The user message must be durably saved before Gemini receives it.**

Do not optimize this by making the user message fire-and-forget before persistence unless explicitly reconsidered.

## Full `saveState()`

The broad `saveState()` still exists as reconciliation/recovery behavior.

It should NOT be put back into ordinary hot paths such as:

- normal Send;
- normal Edit;
- normal Delete;
- normal Regenerate;
- routine navigation;
- basic setting/tool toggles.

## Ordered writes

Targeted writes and reconciliation must remain coordinated so an old broad write cannot overwrite newer targeted data.

---

# 11. IndexedDB Architecture

Database:

`ChatUI_DB`

Current version:

`3`

Important stores include:

- `projects`;
- `chats`;
- `messages`;
- `attachments`;
- `settings`;
- `readAudio`;
- `workspaceNodes`;
- `workspaceFiles`.

Do not bump DB version unless an actual schema migration requires it.

## Lazy loading invariant

Startup loads lightweight chat/project metadata rather than all messages and attachment Blobs.

Important rule:

```text
messagesLoaded === false
```

must NEVER be interpreted as:

```text
this chat has zero messages
```

That distinction prevents an unloaded chat from accidentally being reconciled as empty and losing history.

---

# 12. Attachments

Composer files:

- `js/composer/attachments.js`
- `js/composer/composer.js`
- `js/composer/recorder.js`

Chat attachment rendering:

- `js/chat/message-attachments.js`

Current rules:

- normal files and microphone recordings share a 20 MB per-file limit;
- total attachments per message are limited to 30 MB;
- recordings are size-monitored;
- validation occurs before Gemini Base64 conversion/sending;
- image/PDF/audio attachment Blobs are persisted in IndexedDB;
- Plan 09 preserved MIME types and original Blob semantics.

User text Edit should not unnecessarily rewrite or delete existing image/PDF/audio attachment Blobs.

Generated Code Execution files may also become message attachments.

Known unresolved issue: generated files can still exist in more than one representation (`modelResponseParts`, tool metadata, attachment Blob), so generated-file canonicalization remains future cleanup work.

---

# 13. Projects

Projects currently behave as folders/grouping for chats.

The old fake Project Memory / Custom Memory UI was removed.

Do not reintroduce misleading project memory controls unless real memory/instructions functionality is intentionally designed.

Important fixed project invariant:

- deleted or nonexistent project IDs are normalized;
- deleting a project clears relevant active/runtime references;
- new chats validate project IDs;
- chats should never become hidden because they reference a nonexistent project.

---

# 14. Routing / Bookmarkable Chats

ChatUI supports SPA-style chat URLs:

```text
/chat/<chatId>
```

Important router code lives under:

`js/router/`

Browser Back/Forward navigation should work.

Chat routes are designed to allow bookmarking a specific conversation.

Cloudflare deployment must preserve SPA fallback behavior so direct `/chat/<id>` loading returns the application shell rather than a 404.

---

# 15. Workspace — Plan 08 COMPLETE

Workspace is ChatUI's own persistent virtual filesystem.

It is NOT access to the user's Windows filesystem.

It has a virtual root:

```text
/
```

Current v1 file type is Markdown `.md` pages.

Workspace features include:

- nested folders;
- folders inside folders;
- Markdown pages;
- search;
- manual creation;
- rename;
- move;
- delete;
- A4-style rendered document viewer;
- dark/light theme-aware page viewing;
- mobile Workspace handling;
- persistent IndexedDB storage;
- AI Workspace tool toggle.

Important Workspace files:

- `js/workspace/workspace-ui.js`
- `js/workspace/workspace-document.js`
- `js/workspace/workspace-mobile.js`
- `js/workspace/workspace-navigation-bridge.js`
- `js/workspace/workspace-paths.js`
- `js/workspace/workspace-service.js`
- `js/workspace/workspace-storage.js`
- `js/workspace/workspace-tool-definitions.js`
- `js/workspace/workspace-tool-executor.js`

Tool registry bridge:

`js/tools/function-tool-registry.js`

## Workspace AI functions

1. `workspace_list_directory`
2. `workspace_read_file`
3. `workspace_read_multiple_files`
4. `workspace_write_file`
5. `workspace_edit_block`
6. `workspace_create_directory`
7. `workspace_move`
8. `workspace_delete_file`
9. `workspace_delete_directory`
10. `workspace_get_file_info`
11. `workspace_search`

## Critical Workspace editing rule

Edits are content-based, not line-replacement-based.

Preferred edit tool semantics:

```text
old_string
→
new_string
```

with:

```text
expected_replacements
```

If the exact expected match count is wrong, fail without mutation.

Line offsets/ranges are useful for reading, not the primary editing identity.

## Workspace safety

Do not allow:

- path escape using `..`;
- Windows drive access;
- `/etc`, `/home`, or arbitrary OS access;
- direct host filesystem mapping.

Workspace remains a browser-local virtual filesystem.

## Workspace permission

If Workspace tool access is OFF, Gemini should not have permission to execute Workspace operations.

Execution checks permission at operation time too, so turning Workspace off while a response is still working prevents later operations.

---

# 16. Tool Toggles

Main AI tool options include:

- Google Search;
- URL Context;
- Code Execution;
- Workspace.

Workspace is a client-executed custom function system.

The others are Gemini/native/server-oriented tools depending on endpoint support.

Do not confuse the Workspace UI itself with Workspace AI permission: the user can have Workspace data in ChatUI while choosing whether the current AI gets tool access.

---

# 17. Read Aloud

Important files:

- `js/voice/read-aloud.js`
- `js/voice/read-audio-cache.js`
- `js/voice/read-audio-engine.js`
- `js/voice/read-player-ui.js`
- `js/voice/read-selection.js`
- `js/voice/read-settings.js`
- `js/api/gemini-live-audio.js`
- `js/storage/read-audio.js`

Read Aloud uses a separate audio API key/base URL configuration from the normal text model configuration.

Audio is generated with Gemini Live-style audio and can be cached locally.

Important behavior:

- normal assistant Read button can reuse cached audio;
- floating Read Aloud player is separate from Live Voice;
- selected text can be read from the top-right menu;
- generated audio is stored separately from normal message attachments;
- old audio can be auto-cleaned according to retention settings;
- Read Aloud should speak only assistant-visible text, not hidden thinking/tool timeline content.

Known future issue: long-session audio memory/resource efficiency still needs improvement.

---

# 18. Live Voice

Important files:

- `js/voice/live-voice-controller.js`
- `js/voice/voice-ui.js`
- `js/voice/voice-silence-detector.js`
- `js/voice/voice-speech-queue.js`
- `js/voice/voice-processing-sound.js`
- `js/composer/recorder.js`

Live Voice is a simulated conversational voice loop built on the existing normal chat model plus streamed Read-Aloud-style speech generation.

It is not a full microphone-in / Gemini-Live duplex conversation session.

## Current state colors

White:

- user's turn;
- microphone listening;
- orb reacts to real microphone amplitude.

Yellow:

- user finished;
- request is processing/generating;
- selected Tick Tock cue plays;
- yellow orb reacts to the actual Tick Tock audio amplitude.

Blue:

- AI audio is actually speaking;
- orb reacts to real AI playback amplitude.

Kiwi:

- a new user recording is waiting because a previous Gemini text response is still finishing.

## Auto Detect

Auto Detect ON:

- trailing silence automatically finishes the user's turn.

Auto Detect OFF:

- silence does not submit;
- user clicks the white orb to finish the turn manually.

## Blue interruption

Clicking the blue orb:

- immediately stops/mutes/discards remaining Voice speech for that response;
- does NOT cancel the underlying Gemini text response;
- immediately returns microphone control to the user;
- allows one pending/kiwi user recording while the older text response finishes;
- sends that queued turn automatically after the old generation releases the chat pipeline.

## Request failure

If the underlying Gemini text request fails during Live Voice:

- do not simply return to white listening;
- stop processing cue/TTS/microphone resources;
- close the Voice overlay;
- return to normal ChatUI where the normal error message can remain visible.

A TTS-only failure is a separate type of failure.

## Live Voice speech chunking

The assistant text is streamed and converted to speech in sentence-aware chunks.

Important behavior:

- first chunk begins after roughly 3 complete sentences;
- 3 sentences is a minimum trigger, not a maximum chunk size;
- while current audio is playing, next speech can be prepared in the background;
- around 50% playback progress, accumulated complete sentences can be sent for preparation;
- playback remains strictly sequential;
- final 1–2 remaining sentences must flush when the response ends;
- never read two chunks simultaneously.

Live Voice should speak only `message.content`, not activity timeline/tool/thinking text.

---

# 19. Main JavaScript Source Structure

Top-level `js/` currently includes these main areas:

```text
js/
├── api/
├── app.js
├── chat/
├── composer/
├── layout-loader.js
├── models/
├── router/
├── settings/
├── sidebar/
├── state/
├── storage/
├── tools/
├── ui/
├── utils/
├── voice/
└── workspace/
```

## `js/api/`

```text
api-config.js
gemini-live-audio.js
gemini.js
```

## `js/chat/`

Important current files include:

```text
activity-renderer.js
activity-timeline.js
chat-loader.js
chat.js
conversation.js
generation-lifecycle.js
generation-runner.js
generation.js
markdown.js
message-actions.js
message-attachments.js
message-controls.js
message-renderer.js
message-tools.js
...
```

## `js/composer/`

```text
attachments.js
composer.js
recorder.js
```

## `js/storage/`

```text
blob-utils.js
database.js
delete.js
load.js
migration.js
mutations.js
read-audio.js
records.js
save.js
storage.js
write-coordinator.js
```

## `js/voice/`

```text
live-voice-controller.js
read-aloud.js
read-audio-cache.js
read-audio-engine.js
read-player-ui.js
read-selection.js
read-settings.js
voice-processing-sound.js
voice-silence-detector.js
voice-speech-queue.js
voice-ui.js
```

## `js/workspace/`

```text
workspace-document.js
workspace-mobile.js
workspace-navigation-bridge.js
workspace-paths.js
workspace-service.js
workspace-storage.js
workspace-tool-definitions.js
workspace-tool-executor.js
workspace-ui.js
```

## `js/tools/`

```text
function-tool-registry.js
```

## `js/models/`

```text
models.js
```

The application was intentionally broken into smaller logical modules. Avoid recreating giant all-purpose files when adding new behavior.

---

# 20. CSS Structure

The CSS was also modularized.

Important entry/area files include:

- `css/chat.css`
- `css/components.css`
- `css/animations.css`

Important chat CSS modules include:

- `css/chat/activity-timeline.css`
- `css/chat/composer.css`
- `css/chat/layout.css`
- `css/chat/markdown.css`
- `css/chat/message-actions.css`
- `css/chat/messages.css`
- `css/chat/tool-results.css`
- `css/chat/tools.css`

Important component CSS includes:

- composer attachments;
- message attachments;
- modals;
- model menu;
- Read Aloud;
- right sidebar;
- settings;
- thinking menu;
- Voice Mode;
- Workspace;
- Workspace responsive/mobile rules.

Preserve logical CSS separation when extending the UI.

---

# 21. HTML / Layout Loading

The app uses `index.html` plus reusable layout fragments under `html/`, loaded by `js/layout-loader.js`.

Do not assume everything is hardcoded directly in `index.html`.

When changing a button/menu/sidebar element, inspect both the HTML fragment and the JS/CSS that owns it.

---

# 22. Deployment

Cloudflare deployment is static-assets based.

Build script:

`scripts/build-static.mjs`

It copies runtime assets into `dist/` rather than publishing the entire repository.

Typical runtime copy set:

- `index.html`;
- `css/`;
- `html/`;
- `js/`.

The repository planning/review Markdown files should not be publicly deployed as runtime assets.

Wrangler configuration uses static assets and SPA fallback behavior.

Do not claim a production deploy is live merely because source is merged; independently confirm production deployment if that distinction matters.

---

# 23. Implementation Plan History

The GitHub repository contains:

```text
Implementation Plan/
├── Implementation Plan ID 01.md
├── Implementation Plan ID 02.md
├── Implementation Plan ID 03.md
├── Implementation Plan ID 04.md
├── Implementation Plan ID 05.md
├── Implementation Plan ID 06.md
├── Implementation Plan ID 07.md
├── Implementation Plan ID 08.md
├── Implementation Plan ID 09.md
└── Implementation Plan ID 10.md
```

Useful recent meaning:

- Plan 04: bookmarkable `/chat/<id>` routing + lazy chat loading.
- Plan 05: first working simulated Live Voice flow.
- Plan 06: real audio-reactive Voice orb, Auto Detect, interruption, kiwi queue.
- Plan 07: close Live Voice on real Gemini request failure.
- Plan 08: persistent Workspace + Gemini filesystem tools.
- Plan 09: targeted persistence / remove broad `saveState()` from hot paths.
- Plan 10: always-streaming custom tool rounds + chronological agent activity timeline.

Older plans cover earlier cleanup/UI/architecture work and can still be consulted when touching related areas.

---

# 24. Vibe Coding Review Tracker

File:

`Task- Fix Vibe coding errors.md`

Current tracker state before this handoff:

**Fixed: 7 / 15**

**Remaining: 8 / 15**

## Remaining high-priority issues

### Long chats resend too much history

Every Gemini request can still resend a very large amount of previous conversation context, including historical image/PDF/audio attachments.

This is currently one of the most important remaining performance problems.

Do NOT solve it by simply deleting history context; Gemini needs conversation context.

Possible future directions include:

- stateful server conversation API if the custom gateway supports it;
- file-reference reuse rather than repeated Base64 data;
- context caching;
- careful old-history summarization/recent-history strategy;
- preserving exact important turns while reducing redundant binary/context transfer.

This issue was intentionally left separate from Plan 09 and Plan 10.

### Generated files can be stored more than once

Code Execution output may exist simultaneously in:

- `modelResponseParts`;
- tool metadata;
- IndexedDB attachment Blobs.

A future canonical generated-artifact representation could simplify storage.

## Remaining medium issues

- API keys are normal browser data; third-party CDN dependencies need hardening/pinning/bundling.
- Markdown sanitization is a custom security boundary; consider DOMPurify or disabling raw HTML.

## Remaining lower-priority issues

- modal/accessibility behavior is incomplete for some dialogs;
- light mode is only partially centralized into theme tokens;
- Read Aloud has long-session PCM/timer/storage inefficiencies;
- search still scans stored messages and may become slow with very large history.

---

# 25. Important Known Mixed Content Issue

This is separate from streaming and separate from Plan 10.

The deployed ChatUI page is HTTPS:

```text
https://chatui.mahdy-00523775.workers.dev
```

The user has sometimes configured the text API base URL as a local HTTP endpoint similar to:

```text
http://192.168.8.109:7860
```

The browser then reports:

```text
Mixed Content
HTTPS page → HTTP API request
```

Modern browsers can block active mixed content.

Changing:

```text
:generateContent
```

to:

```text
:streamGenerateContent
```

does NOT fix HTTP-vs-HTTPS mixed content.

If this issue is addressed later, treat it as endpoint/network deployment/configuration work.

Possible solutions would require an HTTPS-accessible API endpoint/proxy/tunnel or another architecture that keeps browser security intact.

Also, logs mentioning something like `ws://localhost:8081` from a refresh/content script may come from development tooling/extensions; inspect source before assuming every console line belongs to ChatUI core.

---

# 26. Performance Work Already Done vs Still Pending

## Already improved

- lazy chat loading;
- bookmarkable routes;
- targeted IndexedDB persistence before Gemini;
- no broad `saveState()` on normal Send;
- always-streaming custom function model rounds;
- real chronological tool/thinking/text UI instead of hidden buffered Workspace rounds.

## Still potentially expensive

- rebuilding large Gemini conversation history;
- re-encoding/resending historical attachments;
- custom API gateway/server latency;
- high thinking levels;
- mixed-content failures/retries/configuration confusion;
- very large search histories;
- long-session Read Aloud resources.

When diagnosing latency, measure separately:

```text
Press Send
→ local persistence/preparation delay
→ request appears in Network
→ TTFB/server wait
→ first SSE event
→ rendering
```

Do not assume every slow answer is a model problem.

---

# 27. Important Do-Not-Break Invariants

Before changing core chat code, preserve all of these unless the user explicitly requests different behavior:

1. User turn is durably persisted before Gemini receives it.
2. Image/PDF/audio attachments remain durable and correctly associated with the message.
3. Lazy-unloaded chats are not treated as empty chats.
4. Stable message IDs drive Edit/Delete/Regenerate/Read actions.
5. Regenerate does not create duplicate assistant answers.
6. Failed regenerate restores previous answer/state.
7. Assistant Edit clears stale tool/thinking/activity metadata.
8. Read Aloud speaks visible assistant text only.
9. Live Voice speech uses assistant visible text only.
10. Workspace activity timeline is presentation state, not Gemini protocol history.
11. Gemini function-call IDs and thought signatures are preserved correctly.
12. Every text-generation model round should remain streaming after Plan 10.
13. Workspace execution checks permission before each operation.
14. Workspace cannot escape its virtual root.
15. Full `saveState()` should not return to hot Send/Edit/Delete/Regenerate paths.
16. Existing Code Execution generated files/images/source UI should remain available.
17. Tool cards should appear before execution completes and update the same card in place.
18. Do not invent fake built-in tool calls when the server did not return them.
19. Cloudflare SPA routing must continue to support direct `/chat/<chatId>` loads.
20. Do not use browser automation without explicit permission.

---

# 28. How to Start a New Chat About This Project

A useful first message in a fresh chat is:

> Open the GitHub repository `Mahdi1910/ChatUI` and read `continue from new chat.md`. Treat GitHub `main` as the source of truth. Verify the latest commit before changing anything. Plan 10 is already implemented and merged. Do not use browser automation.

After reading this file, the new chat should still inspect the exact source files related to the next requested change rather than implementing from this summary alone.

This file is context, not a substitute for reading the live code.

---

# 29. Recommended First Steps for Any New Task

1. Read this handoff.
2. Check latest `main` commit.
3. Read the exact related source files.
4. Check whether the requested feature already exists.
5. Understand persistence/message/voice/tool side effects.
6. If only analysis is requested, do not modify code.
7. If an implementation plan is requested, create only the plan.
8. If implementation is requested, create a feature branch and follow the Git workflow above.
9. Avoid unrelated cleanup while implementing a scoped plan.
10. Preserve all invariants listed above.

---

# 30. Current Best Summary

ChatUI is now a fairly capable personal Gemini chat client rather than a simple clone.

It has:

- modular Vanilla JS architecture;
- persistent IndexedDB chats/projects/settings/attachments;
- lazy conversation loading;
- bookmarkable chat URLs;
- multiple Gemini model/thinking choices;
- built-in Gemini tools;
- custom persistent Workspace filesystem tools;
- always-streaming custom tool rounds;
- chronological Codex/agent-style activity timeline;
- file/image/PDF/audio support;
- durable targeted persistence;
- robust Edit/Delete/Regenerate behavior;
- Read Aloud with cached Gemini Live audio;
- advanced simulated Live Voice with real audio-reactive orb states;
- Cloudflare static deployment.

The biggest unresolved architectural/performance issue now is no longer broad `saveState()` or non-streaming Workspace rounds. Those have been fixed.

The biggest remaining performance concern is **long conversation context and historical attachment resending**.

The biggest separate networking/configuration concern is **HTTPS ChatUI calling an HTTP local API endpoint and triggering Mixed Content**.

Always verify the live repository before continuing because new work may have been merged after this file was created.
