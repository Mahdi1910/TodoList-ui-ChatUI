# Task — Fix Vibe Coding Errors

Use this file as the progress checklist for the problems found during the full ChatUI review.

- `[x]` = fixed and implemented in `main`
- `[ ]` = still needs work

## 🔴 High Priority

- [x] **Make Voice Mode functional.** Voice Mode now records through the existing microphone pipeline, detects speech and trailing silence, submits the audio through the normal selected Gemini chat model, and speaks the streaming assistant answer in sentence-aware queued chunks. TTS preparation can run ahead in the background while playback stays strictly sequential, the normal floating Read Aloud player is not used, mute controls microphone capture, and typed fallback remains inside Voice Mode.

- [x] **Remove fake Project Memory / Custom Memory UI.** The unused memory selector and misleading custom-instructions text were removed. Projects now clearly behave as folders for related chats only.

- [ ] **Long chats resend too much history.** Every Gemini request can resend the full conversation and previous image/PDF/audio attachments. There is no context pruning or recent/relevant-history strategy.

- [x] **Lazy-load chats instead of loading all history at startup.** Startup now loads lightweight project/chat/settings metadata first. Messages and attachment Blobs are loaded only when a chat is opened, loaded chats are cached for the session, and chats have bookmarkable `/chat/<chatId>` URLs with browser Back/Forward support.

- [ ] **Generated files can be stored more than once.** Code Execution output may exist in `modelResponseParts`, tool metadata, and IndexedDB attachment blobs instead of having one canonical stored representation.

## 🟠 Medium Priority

- [x] **Replace broad `saveState()` hot-path saves with targeted persistence.** Normal Send, assistant completion, edit/delete/regenerate, navigation, settings/tools, and sidebar/project actions now write only the changed IndexedDB records. User turns are still durably committed before Gemini starts; image/PDF/audio attachments and generated tool files retain their existing persistence semantics. Full `saveState()` remains only as an ordered reconciliation fallback, preserving lazy-loaded-chat safety.

- [x] **Make attachment limits consistent.** Manual files and microphone recordings now share a 20 MB per-file limit and 30 MB combined-per-message limit. Recordings are size-monitored and attachments are validated again before Base64 conversion/sending.

- [ ] **API keys are stored as normal browser data and CDN dependencies need hardening.** This is acceptable for a personal client-only app, but third-party dependencies should be pinned/bundled instead of relying on floating CDN versions such as `@latest`.

- [ ] **Markdown sanitization is a homemade security boundary.** Assistant Markdown becomes HTML and is inserted with `innerHTML`. Consider DOMPurify or disabling raw HTML rather than relying only on the custom sanitizer.

- [x] **Fix stale/nonexistent Project state.** Deleted/missing project IDs are now normalized during load, project deletion clears active/runtime references, and new chats validate the project ID before creation so chats cannot disappear under nonexistent projects.

## 🟡 Lower Priority

- [ ] **Modal/accessibility management is incomplete.** Rename Chat and Manage Project Chats are not fully covered by the central modal focus/Escape/visible-dialog handling.

- [ ] **Light mode is only partially designed.** Theme values are changed in several places instead of using one complete set of theme tokens, which can create inconsistent colors and defaults.

- [ ] **Read Aloud has long-session resource inefficiencies.** PCM chunks can remain in memory, seeking can concatenate generated PCM, the player uses a frequent timer, and cache retention has no maximum storage-size budget.

- [ ] **Search can still become slow with a very large history.** Search is now debounced and message text is queried from IndexedDB only when Search is used, so startup no longer requires all messages in memory. However, each executed text search still scans all stored message records instead of using a dedicated searchable index.

## 🟢 Cleanup

- [x] **Generated-code cleanup debt.** Removed the obsolete `chat-options.css`, unused `duplicateChat`, stale `User / Free` and `ChatGPT Clone` branding, outdated Settings comments, duplicated generated markup, and obvious mojibake/source-label artifacts.

---

## Progress

**Fixed: 7 / 15**

**Remaining: 8 / 15**
