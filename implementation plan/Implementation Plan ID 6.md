# Implementation Plan ID 6 — Single-Surface Real-Time Markdown Composer

## Status

**Plan only. Do not implement until explicitly approved.**

Baseline inspected:

```text
main @ 5c67a64ae779cdaaccb9a1e5723f916c3362c6a4
```

This plan fixes the composer behavior introduced by Implementation Plan ID 4 where the application currently renders a second Markdown preview box above the real textarea.

The intended result is **one visual input surface**: the user types in the composer and Markdown becomes rich/structured formatting in that same editable area. There must not be a raw textarea plus a separate rendered preview.

---

# 1. Problem confirmed in the current code

The current implementation is structurally wrong for the requested UX, not merely incorrectly styled.

`ChatUI/js/composer/composer.js` currently:

1. creates `#composer-markdown-preview` as a separate `<div>`;
2. inserts it before `#composer-bar` with `composerBar.before(preview)`;
3. reads raw text from `#composer-textarea`;
4. renders the same text into the separate preview with `renderMarkdown(...)`.

`ChatUI/css/chat/composer.css` then gives this preview its own border, background, padding, height and scroll area.

Therefore the user sees two copies while composing:

```text
rendered Markdown preview
-------------------------
raw Markdown textarea
```

That behavior must be removed rather than visually hidden or repositioned.

There is also a deeper dependency: the send and new-chat flows directly read and mutate `composerTextarea.value`. Replacing the textarea correctly requires a small composer API boundary so the rest of ChatUI does not depend on one specific editable DOM element.

---

# 2. Research performed before choosing the architecture

The implementation decision below is based on public primary sources and mature editor architecture. It does **not** guess ChatGPT's private frontend library.

## 2.1 ChatGPT / OpenAI

OpenAI publicly documents direct editing experiences such as writing blocks and rich editing surfaces, but the exact internal implementation/library of the current ChatGPT web composer is not publicly documented in enough detail to use as an engineering source of truth.

Therefore this plan does **not** claim that ChatGPT uses Milkdown, ProseMirror, Lexical, or any other specific editor library.

OpenAI's public Codex repository does expose a mature composer abstraction. Its reusable `ComposerInput` wraps the internal composer behind operations such as `is_empty`, `clear`, input handling and paste handling instead of making unrelated application code manipulate an input widget directly. That separation is useful for this application even though Codex's public implementation is a terminal UI, not a web WYSIWYG editor.

## 2.2 ProseMirror

ProseMirror's official **Friendly Markdown** example matches the central architecture needed here:

- Markdown remains the external/backend representation;
- the user edits through a structured WYSIWYM editor;
- Markdown is parsed into an editor document;
- the editor document is serialized back to Markdown when content is needed.

This is preferable to continuously replacing editable HTML while the browser is trying to maintain caret, selection, undo, paste and IME state.

## 2.3 Milkdown

Milkdown is explicitly a WYSIWYG Markdown editor framework built on ProseMirror and Remark. Its Kit API is headless/customizable and is a better fit for the existing custom ChatUI composer than its ready-made Crepe UI.

Official Milkdown APIs provide the exact boundary this application needs:

- CommonMark editor preset;
- GFM preset used together with CommonMark;
- `getMarkdown()` to serialize the current document;
- `replaceAll(markdown)` to replace editor content from Markdown;
- `markdownUpdated(...)` listener for real-time state/button synchronization.

The GFM preset also supplies structured support such as tables and related input/paste rules.

## 2.4 Alternatives reviewed

### Raw ProseMirror

Technically excellent and gives maximum control, but the application would need to assemble and maintain more Markdown/GFM schema, parser, serializer and input-rule behavior itself.

### Lexical

A strong rich-text framework with Markdown import/export support. It is viable, but Milkdown is more directly Markdown-first and already packages the ProseMirror + Remark transformation pipeline needed here.

### CodeMirror

Excellent for editing **raw Markdown source with syntax highlighting**. It is not the best match for this request because the goal is to hide/transform Markdown syntax into rich structure in the same editing surface, not merely color the raw source.

## 2.5 Chosen approach

Use a **single Milkdown Kit editor** inside the existing composer bar.

Use:

- Milkdown Kit API, not Crepe;
- CommonMark preset;
- GFM preset;
- history/undo support;
- listener plugin;
- only the minimum additional plugins needed for the required composer UX;
- completely custom ChatUI CSS.

The rest of the application communicates with this editor through a small local adapter that exposes Markdown strings.

---

# 3. Fixed product behavior

These are requirements for implementation, not optional implementation-agent choices.

## 3.1 Exactly one editable visual surface

The composer must contain one editable rich Markdown surface inside the existing rounded `composer-bar`.

Do not create:

- a preview above the composer;
- a preview below the composer;
- a side-by-side preview;
- a hidden raw textarea mirrored to rendered HTML;
- two synchronized editable controls.

The current `#composer-markdown-preview` must be removed completely.

## 3.2 Markdown formatting happens inside the input area

When Markdown syntax becomes structurally complete, supported syntax should become rich editor structure in the same place the user is typing.

Examples include:

- bold;
- italic/emphasis;
- headings;
- inline code;
- fenced code blocks;
- blockquotes;
- ordered lists;
- unordered lists;
- links;
- horizontal rules;
- GFM strikethrough;
- GFM task lists;
- GFM tables where supported by the selected preset/editor configuration.

Partially typed syntax may remain visible until the editor can recognize a complete construct. No second preview is allowed during that transition.

## 3.3 Markdown remains the application data boundary

The rich editor's internal ProseMirror document must **not** become the persisted chat format.

When ChatUI needs the user's prompt, it asks the composer adapter for a Markdown string.

Existing message records continue to store:

```text
message.content = Markdown string
```

Existing sent-user-message rendering continues through `ChatUI/js/chat/markdown.js` and `renderMessageDOM(...)`.

No IndexedDB schema migration is required.

## 3.4 Semantic round-trip, not byte-for-byte source preservation

A WYSIWYG Markdown editor can canonicalize equivalent Markdown during serialization.

For example, marker style or whitespace may be normalized while preserving document meaning.

Acceptance is therefore based on **semantic Markdown round-trip** rather than requiring exactly the same source characters the user originally typed.

Literal content inside inline/fenced code must remain literal and must not be silently reformatted as rich Markdown.

## 3.5 No arbitrary HTML editing path

The composer must not accept user Markdown and repeatedly write arbitrary rendered HTML into the editable DOM.

Editor content must be represented by the editor schema/model.

Raw HTML embedded in Markdown must not become executable arbitrary DOM in the composer. If unsupported, preserve it safely as literal text or another explicitly safe representation rather than executing it.

## 3.6 No accidental network requests from Markdown images

A pasted/typed Markdown image URL must not silently cause the composer to fetch a remote image merely because it was converted into an editor node.

Attachments remain ChatUI's supported rich-media input path.

If the GFM/CommonMark schema includes image nodes, composer configuration must prevent automatic remote-image loading or render such nodes as a non-fetching safe representation.

## 3.7 Links are editing content, not navigation targets

Normal clicking/tapping a link while composing must prioritize cursor/selection editing and must not unexpectedly navigate away from ChatUI.

Opening a link can be provided only through an explicit safe gesture/action if desired; it is not required for this plan.

---

# 4. Exact current files inspected before this plan

The following current `main` files were read because they directly affect this change.

## Composer structure and behavior

- `ChatUI/html/main-chat.html`
- `ChatUI/js/composer/composer.js`
- `ChatUI/css/chat/composer.css`
- `ChatUI/css/responsive.css`

## Send/new-chat lifecycle

- `ChatUI/js/chat/send-message.js`
- `ChatUI/js/chat/ui.js`
- `ChatUI/js/chat/conversation.js`
- `ChatUI/js/chat/chat.js`
- `ChatUI/js/chat/generation.js`

## Existing Markdown display path

- `ChatUI/js/chat/messages.js`
- `ChatUI/js/chat/message-renderer.js`
- `ChatUI/js/chat/markdown.js`
- `ChatUI/css/chat/markdown.css`

## Bootstrap/runtime packaging

- `ChatUI/js/app.js`
- `ChatUI/js/layout-loader.js`
- `ChatUI/index.html`
- `ChatUI/embedded.html`
- `ChatUI/css/chat.css`
- `scripts/build-static.mjs`

## Composer-adjacent behavior

- `ChatUI/js/composer/recorder.js`
- `ChatUI/js/chat/message-actions.js`

## Existing verification that must be reconciled

- `scripts/verify-chatui-plan4.mjs`
- `.github/workflows/iframe-integration-check.yml`

A particularly important finding is that `verify-chatui-plan4.mjs` currently asserts that `composer-markdown-preview` and `renderMarkdown` exist in `composer.js`. That assertion represented Plan 4's old implementation and must be changed when Plan 6 intentionally removes that behavior.

---

# 5. Target architecture

## 5.1 Add one low-level composer editor adapter

Create:

```text
ChatUI/js/composer/markdown-editor.js
```

This module is the **only normal application module that knows about Milkdown/ProseMirror internals**.

Suggested public API:

```js
initMarkdownComposer(options)
getComposerMarkdown()
setComposerMarkdown(markdown, options)
clearComposer()
isComposerEmpty()
focusComposer()
isComposerReady()
destroyComposer()
```

Exact names may be adjusted during implementation only if the resulting API remains equally small and clear.

`initMarkdownComposer(...)` should accept callbacks such as:

```js
onChange(markdown)
onSubmit()
```

The adapter must not import `send-message.js`, `chat.js`, `conversation.js`, or other high-level chat lifecycle modules. This prevents circular dependencies.

## 5.2 `composer.js` remains UI orchestration

`ChatUI/js/composer/composer.js` should continue owning:

- tools menu behavior;
- send/voice/stop button visibility;
- initialization wiring;
- composer submit callback wiring.

It should **not** contain the structured-editor model implementation.

Remove from it:

- `renderMarkdown` import;
- `previewFrame`;
- `ensureMarkdownPreview()`;
- `syncComposerMarkdownPreview()`;
- `scheduleMarkdownPreview()`;
- every `composer-markdown-preview` dependency.

## 5.3 Chat lifecycle uses adapter methods, not DOM assumptions

`send-message.js` must call the composer adapter to obtain Markdown.

`conversation.js` must call `clearComposer()` rather than changing `.value` and `.style.height`.

`chat/ui.js` should stop exposing `composerTextarea` from the generic chat DOM helper.

This creates a stable contract so future composer changes do not require send/storage code to know whether the UI is a textarea, contenteditable element, or another editor implementation.

---

# 6. HTML changes

Modify:

```text
ChatUI/html/main-chat.html
```

Remove:

```html
<textarea class="composer-textarea" id="composer-textarea" ...></textarea>
```

Replace it with one accessible editor mount/host inside the existing `composer-bar`, for example:

```html
<div
  id="composer-editor-host"
  class="composer-editor-host"
  aria-label="Message"
></div>
```

Milkdown/ProseMirror will mount the actual editable DOM inside this host.

The final editable descendant must expose correct textbox semantics, including:

- accessible name `Message`;
- multiline semantics;
- focusability;
- an empty-state placeholder equivalent to `Ask anything`.

Do not represent the placeholder as editable document content.

---

# 7. Milkdown configuration

The adapter should use Milkdown Kit with the smallest practical plugin set.

Required baseline:

```text
commonmark
gfm
history
listener
```

Add only plugins/keymaps needed to satisfy the composer acceptance criteria.

Do not use the full Crepe UI because ChatUI already owns:

- the composer shell;
- buttons;
- tools menu;
- theme;
- responsive layout;
- send lifecycle.

The editor must visually integrate into ChatUI instead of looking like a second embedded application.

---

# 8. Dependency packaging

ChatUI is currently a static application and does not have a normal runtime package/bundler dependency chain.

Do **not** make sending messages depend on a newly added unpinned runtime CDN import.

Preferred deployment design:

1. pin the selected Milkdown package versions during implementation;
2. produce one browser ESM bundle containing only the required editor pieces;
3. commit that generated runtime under:

```text
ChatUI/js/vendor/
```

For example:

```text
ChatUI/js/vendor/milkdown-composer.bundle.js
ChatUI/js/vendor/milkdown-composer.LICENSE.txt
ChatUI/js/vendor/milkdown-composer.version.json
```

Milkdown is MIT licensed; preserve required license notice with the vendored bundle.

Because `scripts/build-static.mjs` already copies the whole `ChatUI/js` directory, placing the vendor runtime beneath `ChatUI/js/vendor/` avoids adding a new static-copy root.

The implementation should also preserve enough version/build metadata that the bundle can later be reproduced or upgraded intentionally.

Do not copy arbitrary unversioned files from a CDN into the repository without package/version provenance.

---

# 9. Composer initialization and bootstrap

Milkdown editor creation is asynchronous.

Update `ChatUI/js/app.js` so composer initialization is fully awaited before later composer-adjacent initialization depends on it.

The existing bootstrap order should remain conceptually:

```text
Markdown display renderer init
storage/state load
...
rich composer init and await ready
attachment listeners
recorder listeners
...
```

Do not allow attachment/recorder/button logic to observe a half-created composer.

If `initComposerListeners(...)` becomes asynchronous, use the existing startup deadline machinery rather than introducing an independent unbounded initialization wait.

Failure to load/create the editor must fail clearly through the existing startup-error path; it must not leave a visually present composer whose Send button silently does nothing.

---

# 10. Real-time state synchronization

Use Milkdown's Markdown listener rather than rendering a duplicate preview.

On document change:

1. receive current Markdown from `markdownUpdated(...)` or equivalent adapter state;
2. cache/update the adapter's current Markdown if useful;
3. call the existing composer button synchronization logic;
4. do **not** send or persist merely because the user typed.

`updateComposerButtons()` must use `isComposerEmpty()` instead of `composerTextarea.value`.

Existing behavior must continue to support:

- text-only send;
- attachment-only send;
- audio-only send;
- text + attachment;
- text + audio;
- tools enabled/disabled independently of editor content.

---

# 11. Send flow

Modify:

```text
ChatUI/js/chat/send-message.js
```

## Before send

Read Markdown through the adapter:

```text
rawMarkdown = getComposerMarkdown()
```

Use trimming only to decide whether the prompt is logically empty.

Do not read editor HTML or `textContent` as the canonical prompt.

## Persistence contract

Continue constructing the user message with:

```text
content: Markdown string
```

The existing durable pre-generation persistence rule remains unchanged.

No Gemini request should start until the user turn is successfully stored, just as today.

## Clear timing

Do not clear the editor before the current durable persistence boundary has succeeded.

After the message has been successfully accepted/persisted and rendered, call:

```text
clearComposer()
```

If the local persistence step fails, the user's composed rich content must remain available for retry; do not destroy the draft.

## Sent message rendering

Do not change the user message display pipeline solely because the composer is rich.

`message-renderer.js` should continue rendering stored Markdown with the existing sanitized `renderMarkdown(content)` display renderer.

---

# 12. New-chat / navigation lifecycle

Modify `ChatUI/js/chat/conversation.js` so `startNewChat()` uses the composer adapter.

Required behavior:

- New Chat clears editor content;
- editor remains usable immediately afterward;
- button state returns to empty/voice mode;
- focus behavior remains sensible;
- no stale rich document survives into a new chat unintentionally.

Do not change chat routing, Workspace routing, Shell history, or persistent iframe architecture for this feature.

---

# 13. Keyboard behavior

A structured editor cannot treat every Enter identically without making lists/tables/code blocks unusable.

Use these rules:

## Ordinary top-level text

```text
Enter         -> Send
Shift+Enter   -> Insert line/hard break
Ctrl+Enter    -> Send
Cmd+Enter     -> Send
```

## Structured blocks that require Enter for editing

Inside structures such as:

- list items;
- fenced/code blocks;
- table editing contexts;
- other editor nodes where Enter is required for normal structural editing;

use:

```text
Enter         -> editor-native structural action
Shift+Enter   -> line/hard break where supported
Ctrl+Enter    -> Send
Cmd+Enter     -> Send
```

The visible Send button must always provide an unambiguous way to submit.

## IME safety

Never submit while an IME composition is active.

Enter used to confirm Arabic/CJK/other composition must be handled by the editor/browser and not interpreted as ChatUI Send.

Implementation must use editor composition state / composition events rather than timing guesses.

---

# 14. Paste, copy, selection, undo and redo

These are first-class acceptance requirements because they are common failure points in hand-written `contenteditable` implementations.

The editor must preserve normal browser/editor behavior for:

- normal text paste;
- Markdown paste;
- multiline paste;
- copy;
- cut;
- select all;
- mouse/touch selection;
- keyboard selection;
- undo;
- redo;
- word navigation;
- Home/End where applicable;
- mobile long-press selection.

Do not implement these by repeatedly assigning `innerHTML` during typing.

---

# 15. RTL, Arabic and mixed-direction text

The existing application explicitly supports Arabic/mixed-direction Markdown and this must not regress.

Requirements:

- editor root uses automatic/natural direction behavior;
- paragraphs/headings/list items/blockquote/table cells can resolve direction from their content;
- use logical CSS such as `padding-inline-start` and `text-align: start`;
- code and code blocks remain LTR;
- mixed English/Arabic ordered and unordered lists remain visually correct;
- caret movement and selection must remain usable in mixed-direction text.

Do not restore old hard-coded left/right list hacks.

---

# 16. Styling

Prefer a dedicated stylesheet:

```text
ChatUI/css/chat/composer-editor.css
```

Import it from:

```text
ChatUI/css/chat.css
```

The editor must visually be part of the existing `composer-bar`.

## Geometry

Suggested behavior:

```text
flex: 1
min-width: 0
single-line minimum height
bounded growing height
internal vertical scroll after max height
```

Desktop and mobile must not allow the editor to widen the composer or page.

Use a practical max height similar to the existing composer, with a mobile-aware `dvh` bound.

## Appearance

- no additional outer border around the editor;
- no second background panel;
- existing `.composer-bar:focus-within` remains the visual focus treatment;
- compact headings appropriate for a chat composer;
- lists use logical indentation;
- code blocks are compact and readable;
- tables must not make the whole app overflow horizontally;
- placeholder looks like the old `Ask anything` placeholder;
- editor selection and caret remain clearly visible.

Do not reuse the display-only `.code-block-wrapper` UI with a `Copy code` toolbar inside the editable composer.

---

# 17. Existing display Markdown renderer remains display-only

`ChatUI/js/chat/markdown.js` is for rendering persisted/sent content.

It currently includes behavior such as:

- Marked parsing;
- HTML sanitization;
- syntax highlighting;
- code block wrapper/header;
- Copy code button;
- direction attributes.

Do not use this output as the contenteditable document.

The rich composer and message renderer should share **Markdown text as the boundary**, not share mutable rendered HTML.

This separation avoids editor selection/caret problems and keeps display-only buttons out of the editing surface.

---

# 18. CSS cleanup from Plan 4

Remove obsolete preview CSS from:

```text
ChatUI/css/chat/composer.css
ChatUI/css/chat/markdown.css
```

In particular remove `.composer-markdown-preview` selectors.

Keep user-bubble Markdown styling intact.

Update `ChatUI/css/responsive.css` so mobile rules target the new editor host/ProseMirror surface rather than `.composer-textarea`.

---

# 19. Verification changes

## 19.1 Retire the obsolete Plan 4 preview assertion

`script/verify-chatui-plan4.mjs` currently treats the separate preview as a required invariant.

Update the existing verifier so Plan 4's broader invariants remain protected while the intentionally superseded preview assertion is removed/replaced.

It should now verify that sent user messages still render Markdown and that RTL list behavior remains preserved, without requiring the obsolete preview element.

Correct path:

```text
scripts/verify-chatui-plan4.mjs
```

## 19.2 Add a Plan 6 verifier

Create:

```text
scripts/verify-chatui-plan6.mjs
```

Static/pure-JS assertions should cover at least:

1. `composer-markdown-preview` no longer exists in runtime composer HTML/JS/CSS.
2. `composer.js` no longer imports/uses the display `renderMarkdown()` for live composer mirroring.
3. `main-chat.html` contains one editor host and no composer textarea.
4. `markdown-editor.js` exposes the intended Markdown API boundary.
5. the editor adapter uses the intended Milkdown CommonMark + GFM + listener architecture.
6. `send-message.js` obtains prompt content through the composer adapter rather than `.value`/editable HTML.
7. `conversation.js` clears via the composer adapter.
8. `chat/ui.js` no longer exposes a textarea-specific composer handle.
9. `message-renderer.js` still renders user messages through the existing Markdown display path.
10. no new unpinned runtime Milkdown CDN URL is introduced.
11. vendored editor runtime/version/license metadata exist if the local-bundle strategy is used.
12. existing File API recovery invariants remain untouched.
13. existing Todo bridge/integration checks remain untouched.

## 19.3 Workflow

Modify:

```text
.github/workflows/iframe-integration-check.yml
```

Add the Plan 6 verifier and syntax-check new authored source modules.

Do not attempt `node --check` on generated vendor output if its generated format makes that check inappropriate; instead verify it through the actual build/import strategy chosen during implementation.

Keep existing integration/File/Todo verification jobs.

## 19.4 Build

Run the existing safe static build.

If a vendor bundle is under `ChatUI/js/vendor`, confirm `scripts/build-static.mjs` carries it into `dist/ChatUI/js/vendor/` through the existing recursive `ChatUI/js` copy.

---

# 20. Manual browser test checklist

Per project policy, do **not** run headless Chrome/browser automation. The user will manually test browser/mobile behavior.

After static/CI verification passes, manually test:

## Same-surface rendering

- Type plain text: one input surface only.
- Type `**bold**`: completed syntax becomes rich bold in that same surface.
- Type emphasis/inline code.
- Create heading/quote/list/code block.
- Create or paste a GFM table/task list/strikethrough.
- Confirm there is never a second rendered box above the composer.

## Editing quality

- Move caret before/inside/after formatted text.
- Select formatted text.
- Delete across format boundaries.
- Undo/redo repeatedly.
- Copy/cut/paste formatted and plain content.
- Paste multiline Markdown.
- Paste a long prompt and verify internal composer scrolling.

## Keyboard

- ordinary Enter sends;
- Shift+Enter inserts a line break;
- list/code/table Enter remains usable for the structure;
- Ctrl/Cmd+Enter sends from structured blocks;
- IME confirmation does not accidentally send.

## RTL/mobile

- Arabic paragraph;
- English paragraph;
- mixed Arabic/English paragraph;
- Arabic numbered list;
- mixed-direction list;
- code inside Arabic text remains LTR;
- Android keyboard, selection handles and scrolling remain usable;
- composer does not overflow when the mobile virtual keyboard opens.

## Links/security

- normal click on a composer link does not unexpectedly navigate away;
- raw HTML typed/pasted into Markdown does not execute;
- remote Markdown image syntax does not silently fetch an external image in the composer.

## Send lifecycle

- text-only send;
- attachment-only send;
- audio-only send;
- text + attachment send;
- persistence failure leaves composed content available;
- successful send clears editor;
- sent user bubble keeps the same semantic Markdown;
- New Chat clears editor;
- chat switching/navigation does not break the composer.

## Regression

- AI generation works normally;
- Stop Generation works;
- tools menu works;
- right sidebar overlay works;
- Workspace routes work;
- exact-message search/deep links work;
- Gemini File API recovery remains intact;
- Todo integration remains intact.

---

# 21. Expected file changes

## New runtime/source files

```text
ChatUI/js/composer/markdown-editor.js
ChatUI/css/chat/composer-editor.css
ChatUI/js/vendor/milkdown-composer.bundle.js
ChatUI/js/vendor/milkdown-composer.LICENSE.txt
ChatUI/js/vendor/milkdown-composer.version.json
```

The exact generated vendor filenames may differ if the implementation uses an equally clear pinned/reproducible naming scheme.

## New verification

```text
scripts/verify-chatui-plan6.mjs
```

## Existing files expected to change

```text
ChatUI/html/main-chat.html
ChatUI/js/composer/composer.js
ChatUI/js/chat/send-message.js
ChatUI/js/chat/conversation.js
ChatUI/js/chat/ui.js
ChatUI/js/app.js
ChatUI/css/chat/composer.css
ChatUI/css/chat/markdown.css
ChatUI/css/chat.css
ChatUI/css/responsive.css
scripts/verify-chatui-plan4.mjs
.github/workflows/iframe-integration-check.yml
```

## Files inspected but not expected to require feature changes

```text
ChatUI/js/chat/chat.js
ChatUI/js/chat/generation.js
ChatUI/js/chat/messages.js
ChatUI/js/chat/message-renderer.js
ChatUI/js/chat/markdown.js
ChatUI/js/composer/recorder.js
ChatUI/js/chat/message-actions.js
ChatUI/js/layout-loader.js
ChatUI/index.html
ChatUI/embedded.html
scripts/build-static.mjs
```

If implementation discovers a real necessity to modify an item in the second group, it should document why before widening scope.

---

# 22. Implementation sequence

## Phase 1 — Introduce the editor adapter without changing storage

1. Add pinned/local Milkdown runtime.
2. Add `markdown-editor.js`.
3. Configure CommonMark, GFM, history and listener.
4. Implement Markdown getter/setter/clear/focus/readiness API.
5. Add safe image/raw-HTML/link behavior.

## Phase 2 — Replace the textarea UI

1. Replace the textarea with editor host in `main-chat.html`.
2. Remove preview creation/render code.
3. Initialize Milkdown in `composer.js`.
4. Wire `markdownUpdated` to button state.
5. Add editor CSS and responsive styling.

## Phase 3 — Decouple send/new-chat from textarea DOM

1. Update `send-message.js` to use Markdown getter.
2. Preserve durable persistence-before-generation behavior.
3. Clear only after successful acceptance/persistence.
4. Update `conversation.js` to use `clearComposer()`.
5. Remove textarea-specific member from `chat/ui.js`.

## Phase 4 — Keyboard/IME/RTL hardening

1. Add send-vs-structural Enter rules.
2. Guard IME composition.
3. Verify focus and selection behavior.
4. Apply RTL/mixed-direction behavior and LTR code rules.
5. Verify mobile height/scroll behavior.

## Phase 5 — CI/static verification

1. Update obsolete Plan 4 preview assertion.
2. Add Plan 6 verifier.
3. Add verifier/new source checks to GitHub Actions.
4. Run existing integration/Todo/File checks.
5. Run safe static build.
6. Stop before merge and give the user the manual browser checklist.

---

# 23. Acceptance criteria

The implementation is complete only when all of the following are true:

1. There is only **one** composer editing surface.
2. There is no `composer-markdown-preview` runtime UI.
3. There is no mirrored raw textarea behind/under/above the rich editor.
4. Supported Markdown becomes rich structure in the same editing surface.
5. Caret, selection, paste, undo/redo and IME are handled by the structured editor rather than DOM replacement hacks.
6. ChatUI still sends/persists a Markdown string, not editor HTML/JSON.
7. Existing sent user messages still use the current sanitized Markdown renderer.
8. New Chat and successful send clear the rich editor correctly.
9. Persistence failure does not erase the user's draft.
10. Attachment-only and audio-only sends still work.
11. Arabic, mixed direction and lists work correctly.
12. Composer code blocks remain editable and do not contain display-only Copy buttons.
13. Markdown links do not accidentally navigate during normal editing.
14. Remote Markdown images do not silently create external network fetches in the editor.
15. Existing Chat routing, Workspace, Gemini File recovery, Todo bridge and storage schemas are not changed by this feature.
16. GitHub static/CI verification passes.
17. User completes manual desktop/mobile browser testing before merge.

---

# 24. Risks and mitigations

## Risk: rich-editor bundle increases runtime size

Mitigation: use Milkdown Kit instead of full Crepe, include only required presets/plugins, pin versions, measure the generated bundle and avoid unrelated UI plugins.

## Risk: Markdown serialization changes cosmetic source formatting

Mitigation: define semantic Markdown round-trip as the contract; preserve literal code content; test all supported structures before merge.

## Risk: Enter-to-send conflicts with structured editing

Mitigation: ordinary text keeps Enter-to-send, structured nodes retain native Enter behavior, and Ctrl/Cmd+Enter + Send button always submit.

## Risk: mobile/IME regressions

Mitigation: rely on ProseMirror's controlled contenteditable model rather than rewriting HTML, explicitly guard composition, and require manual Android testing.

## Risk: security/privacy from rich content

Mitigation: no arbitrary editable HTML path, no automatic remote Markdown image fetching, safe link behavior, and keep existing sanitized renderer for sent content.

## Risk: old Plan 4 CI assertion blocks the intentional change

Mitigation: replace only that superseded preview invariant while retaining all unrelated Plan 4 regression checks.

## Risk: editor initialization failure disables messaging

Mitigation: await editor creation inside existing startup deadline/error handling and fail visibly instead of presenting a broken input.

---

# 25. Rollback boundary

This feature should be isolated enough that rollback means reverting the Plan 6 composer commits/PR.

It must not require rollback/migration of:

- chat records;
- messages;
- attachments;
- Workspace data;
- Todo data;
- Settings database version;
- Shell routing.

Because persisted user text remains Markdown, existing conversations remain compatible before and after rollback.

---

# 26. Non-goals

Do not add as part of this plan:

- a separate Markdown preview toggle;
- a raw-source/preview split mode;
- collaborative editing;
- cloud draft sync;
- message-editor redesign for already-sent messages;
- slash-command menus;
- formatting toolbar unless a minimal control is later explicitly requested;
- new chat storage schema;
- Gemini/API changes;
- Todo changes;
- Shell/router changes;
- headless browser automation.

---

# 27. Research sources

Primary/public sources used to choose this architecture:

- OpenAI Codex public composer wrapper — `openai/codex`, `codex-rs/tui/src/public_widgets/composer_input.rs`
  - https://github.com/openai/codex/blob/main/codex-rs/tui/src/public_widgets/composer_input.rs

- OpenAI Help Center — Writing blocks and code blocks in ChatGPT
  - https://help.openai.com/en/articles/20001246-working-with-writing-blocks-and-code-blocks-in-chatgpt

- ProseMirror — Friendly Markdown example
  - https://prosemirror.net/examples/markdown/

- ProseMirror — project overview
  - https://prosemirror.net/

- Milkdown — Getting Started / Milkdown Kit
  - https://milkdown.dev/docs/guide/getting-started
  - https://milkdown.dev/docs/guide/using-milkdown-kit

- Milkdown — GFM preset
  - https://milkdown.dev/docs/api/preset-gfm

- Milkdown — listener plugin
  - https://milkdown.dev/docs/api/plugin-listener

- Milkdown — utility macros (`getMarkdown`, `replaceAll`, etc.)
  - https://milkdown.dev/docs/api/utils

- Milkdown — architecture overview
  - https://milkdown.dev/docs/guide/architecture-overview

- Milkdown license
  - https://github.com/Milkdown/milkdown/blob/main/LICENSE

---

# 28. Final implementation rule

When implementation is explicitly requested later:

1. start from the then-current `main`, not blindly from this baseline SHA;
2. reread this plan and the current versions of every affected file;
3. preserve any newer fixes that landed after this plan;
4. implement only this plan's scope;
5. run static/build/CI checks, but no headless browser tests;
6. open a PR and wait for the user's manual desktop/mobile test approval before merge unless the user explicitly instructs otherwise.
