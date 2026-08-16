# Implementation Plan ID 2 — Fast Gemini-Compatible AAC Voice Recording

## Status

**Plan only. Do not implement until reviewed/approved.**

---

# 1. Goal

Fix ChatUI voice-message recordings that currently become `audio/webm` / `.webm` and can enter Gemini Files API `FAILED` processing state.

For the confirmed current Chromium/Brave environment, the browser reports support for:

```text
audio/mp4                         true
audio/mp4;codecs=mp4a.40.2        true
```

while direct MediaRecorder support for Gemini's documented audio MIME types is false:

```text
audio/mpeg / audio/mp3            false
audio/wav                         false
audio/ogg                         false
audio/aac                         false
audio/aiff                        false
audio/flac                        false
```

The implementation should therefore use the browser's native AAC encoder, but avoid sending the MP4 container to Gemini as if it were AAC.

The target pipeline is:

```text
Microphone
  ↓
MediaRecorder
  ↓
audio/mp4;codecs=mp4a.40.2
  ↓
MP4 container containing AAC-LC samples
  ↓
extract AAC samples without decoding/re-encoding
  ↓
wrap samples with ADTS headers
  ↓
recorded_audio_<timestamp>.aac
MIME: audio/aac
  ↓
existing ChatUI attachment pipeline
  ↓
existing Gemini Files API / inlineData policy
```

The AAC audio payload must remain encoded AAC. This plan must **not** decode the recording and encode it again as MP3.

---

# 2. Why this is the selected method

## 2.1 It avoids the current WebM failure path

Current `ChatUI/js/composer/recorder.js` creates `new MediaRecorder(requestedStream)` without specifying a MIME type.

The browser therefore chooses the recording format. In the current environment that becomes WebM/Opus, and the recorder creates files such as:

```text
recorded_audio_1786869416740.webm
```

The current Gemini Files pipeline then uploads that Blob and waits for the remote File to become `ACTIVE`. If Gemini reports `FAILED`, `waitForGeminiFileActive()` throws `Gemini File processing failed.`.

The fix should prevent normal voice recordings from entering Gemini as `audio/webm` in the first place.

## 2.2 It is faster than WebM → MP3 transcoding

The browser already has a native AAC encoder available through:

```text
audio/mp4;codecs=mp4a.40.2
```

Therefore the fastest route is:

```text
AAC inside MP4
  ↓
container/sample extraction only
  ↓
AAC/ADTS
```

There is no audio decode and no second lossy encode.

## 2.3 Do not use ffmpeg.wasm for this implementation

`ffmpeg.wasm` can solve the conversion, but it is not the best fit for this repository:

- official ffmpeg.wasm usage documentation describes loading an approximately 31 MB core;
- the current combined app is deployed through Cloudflare Workers static assets;
- Cloudflare Workers currently limits an individual static asset to 25 MiB;
- loading the FFmpeg core from an external CDN would add a large first-use download and an unnecessary runtime dependency;
- the required operation is only MP4 AAC extraction/remuxing, not full transcoding.

Use a lightweight MP4 parser/sample extractor instead.

---

# 3. Current source facts verified before writing this plan

## 3.1 Recorder ownership

File:

```text
ChatUI/js/composer/recorder.js
```

Current behavior:

- microphone is acquired with `navigator.mediaDevices.getUserMedia({ audio: true })`;
- recording is started with `new MediaRecorder(requestedStream)` with no explicit MIME;
- `runtime.audioChunks` stores MediaRecorder chunks;
- current recording size limits are enforced while chunks arrive;
- when recording stops, the code builds a Blob using `recorder.mimeType || 'audio/webm'`;
- `recordingFileName()` maps MP4/AAC-looking MIME types to `.m4a`, OGG to `.ogg`, and everything else to `.webm`;
- the resulting `File` is passed into the normal `tryAddAttachmentFile()` path.

This is the primary file that must change.

## 3.2 The recorder is shared by normal composer recording and Live Voice

File:

```text
ChatUI/js/voice/live-voice-controller.js
```

Live Voice imports:

```text
startAudioRecording
stopAudioRecording
cancelAudioRecording
```

from the same recorder module.

Therefore this fix must preserve the existing recorder API and Promise behavior. A correct recorder-level fix automatically benefits both:

- normal composer voice messages;
- Live Voice user-turn recordings.

Do not create a separate duplicate recorder only for normal chat.

## 3.3 AAC is already accepted by ChatUI attachment validation

File:

```text
ChatUI/js/composer/attachment-types.js
```

The existing registry already contains:

```text
.aac → audio/aac
```

and `audio/aac` is already in `SUPPORTED_MIME_TYPES`.

Therefore no new product-level attachment type is required.

## 3.4 Existing attachment storage already preserves Blob + MIME

Files:

```text
ChatUI/js/storage/records.js
ChatUI/js/storage/load.js
```

The existing attachment record stores:

- name;
- MIME type;
- size;
- Blob data;
- Gemini remote File metadata.

Reload reconstructs message attachments from those values.

Therefore an `.aac` Blob can use the existing IndexedDB model. No database version or schema migration is needed.

## 3.5 Existing Gemini transport already works with `audio/aac`

Files:

```text
ChatUI/js/chat/attachment-transport.js
ChatUI/js/api/gemini-files.js
```

The transport obtains the MIME type from the attachment/Blob, then either:

- uploads the local Blob through Gemini Files API; or
- sends the local Blob as `inlineData` when the policy falls back.

Once the recorder produces a real AAC/ADTS Blob with MIME `audio/aac`, the existing Gemini transport should not require special audio-specific branching.

Do not rewrite the Gemini Files API implementation as part of this plan.

## 3.6 Static build behavior

Combined build:

```text
scripts/build-static.mjs
```

Standalone ChatUI build:

```text
ChatUI/scripts/build-static.mjs
```

Both already copy the `ChatUI/js/` tree recursively.

Therefore a vendored parser placed under:

```text
ChatUI/js/vendor/
```

will automatically be included by both builds. No build-script modification should be needed if all new runtime assets remain inside `ChatUI/js/`.

---

# 4. Chosen architecture

Add one small conversion/remux boundary between MediaRecorder output and attachment creation.

```text
recorder.js
  │
  ├─ start
  │    └─ request native AAC-LC in MP4
  │
  └─ stop
       ├─ assemble raw MP4 Blob
       ├─ release microphone immediately
       ├─ remux MP4 AAC → ADTS AAC
       ├─ create File(.aac, audio/aac)
       └─ existing tryAddAttachmentFile()
```

The remux helper should be isolated from recorder UI/state logic.

Proposed module:

```text
ChatUI/js/composer/aac-remuxer.js
```

The parser dependency should be vendored under something like:

```text
ChatUI/js/vendor/mp4box/
```

with its license retained.

Do not load `@latest` dynamically at runtime.

---

# 5. Dependency choice

Use a pinned browser build of **MP4Box.js** from the GPAC project.

Why:

- it is designed for MP4 parsing in browsers;
- it exposes track metadata;
- it exposes sample extraction through `setExtractionOptions()` / `onSamples`;
- extracted samples expose their encoded `data` bytes;
- it does not require decoding/re-encoding the AAC audio;
- it is dramatically smaller in scope than loading a full FFmpeg WebAssembly runtime;
- the app has no bundler, so a pinned local browser/ESM build is appropriate.

Implementation rule:

- vendor one exact verified MP4Box.js release;
- keep its BSD-3-Clause license notice with the vendored file;
- import it locally from `aac-remuxer.js`;
- do not rely on an external CDN at recording time.

---

# 6. Detailed implementation steps

## Phase 1 — Add recorder MIME selection

Modify:

```text
ChatUI/js/composer/recorder.js
```

Add a dedicated function such as:

```text
getPreferredRecordingMimeType()
```

Selection order for this plan:

1. `audio/mp4;codecs=mp4a.40.2`
2. `audio/mp4` only as a guarded secondary choice
3. existing browser-default MediaRecorder only as a legacy compatibility fallback

The first choice must use:

```text
MediaRecorder.isTypeSupported('audio/mp4;codecs=mp4a.40.2')
```

When supported, construct MediaRecorder with the explicit MIME:

```text
new MediaRecorder(stream, { mimeType: preferredMime })
```

Do not merely change the filename or MIME label of WebM bytes.

### Secondary `audio/mp4` rule

If only generic `audio/mp4` is selected, the remuxer must inspect the MP4 audio track and confirm it is AAC before accepting it.

Do not assume every possible MP4 audio track is AAC.

---

## Phase 2 — Add `aac-remuxer.js`

Create:

```text
ChatUI/js/composer/aac-remuxer.js
```

Responsibility:

```text
MP4 Blob containing AAC
  ↓
AAC/ADTS Blob
```

It must not know about:

- composer buttons;
- Live Voice state;
- Chat state;
- IndexedDB;
- Gemini API;
- attachment UI.

Suggested public API:

```text
remuxMp4AacToAdts(blob, options?) → Promise<Blob>
```

or a similarly narrow function.

### MP4 parsing flow

1. Read the completed MP4 Blob into an `ArrayBuffer`.
2. Set the MP4Box input buffer `fileStart = 0`.
3. Create an MP4Box file parser.
4. On `onReady(info)`:
   - find the audio track;
   - require an AAC codec, preferably `mp4a.40.2` for the requested AAC-LC path;
   - read sample rate;
   - read channel count;
   - read number of samples;
   - configure extraction for the audio track.
5. Start sample extraction.
6. Collect encoded AAC access units from `onSamples`.
7. For each AAC sample, prepend a valid 7-byte ADTS header.
8. Concatenate ADTS header + existing AAC sample bytes.
9. Return:

```text
Blob(type = 'audio/aac')
```

### Important rule

The `sample.data` payload must be copied as encoded AAC data. Do not pass it through an audio decoder or encoder.

---

## Phase 3 — Implement ADTS header creation

Inside `aac-remuxer.js`, add a small internal ADTS header writer.

For the current requested codec:

```text
mp4a.40.2 = AAC-LC
```

The ADTS writer needs:

- AAC profile/object type;
- sample-rate index;
- channel configuration;
- encoded AAC frame length + 7-byte header.

Maintain an explicit sample-rate table for ADTS frequencies rather than guessing.

At minimum validate the common supported rates:

```text
96000
88200
64000
48000
44100
32000
24000
22050
16000
12000
11025
8000
7350
```

Reject instead of producing corrupt output if:

- no audio track exists;
- codec is not an AAC form the remuxer understands;
- sample rate cannot be mapped to ADTS;
- channel configuration is invalid;
- sample extraction is incomplete;
- MP4Box reports a parser error.

---

## Phase 4 — Convert before creating the final attachment File

Modify `stopAudioRecording()` in:

```text
ChatUI/js/composer/recorder.js
```

Current order:

```text
MediaRecorder chunks
→ Blob using recorder MIME
→ File
→ tryAddAttachmentFile
```

New preferred order:

```text
MediaRecorder chunks
→ raw MP4 Blob
→ remuxMp4AacToAdts(rawBlob)
→ AAC Blob
→ File(name=.aac, type=audio/aac)
→ tryAddAttachmentFile
```

The final user-visible/stored file should be:

```text
recorded_audio_<timestamp>.aac
```

with:

```text
type: audio/aac
```

The raw `.mp4` recording is only temporary in memory and should never be persisted as the message attachment when the AAC path succeeds.

---

## Phase 5 — Release microphone before remux work

The current `stopAudioRecording()` stops MediaStream tracks after creating/attaching the final file.

Because remuxing introduces asynchronous work, change the stop lifecycle so that after MediaRecorder's `stop` event fires:

1. copy/capture the raw recording Blob and any state values needed for finalization;
2. stop the MediaStream tracks immediately;
3. then perform the MP4 → AAC remux;
4. then attach the final AAC File;
5. reset UI/runtime state safely.

Do not keep the microphone active while JavaScript is only remuxing already-recorded bytes.

Preserve existing button and Voice Mode state behavior.

---

## Phase 6 — Preserve asynchronous recorder contract

`stopAudioRecording()` already returns a Promise and its important callers already await it.

The remux operation should complete before that Promise resolves.

Expected meaning after the change:

```text
await stopAudioRecording(...)
```

means:

```text
recording stopped
+ microphone released
+ AAC remux finished
+ final AAC File attached (if requested)
```

This is particularly important for:

```text
ChatUI/js/voice/live-voice-controller.js
```

because Voice Mode immediately uses the returned `File` as the user's voice turn.

Do not let Voice Mode receive the raw temporary MP4 file.

---

## Phase 7 — Failure behavior

A remux failure must not silently attach mislabeled or unsupported bytes.

### Normal composer recording

If native AAC/MP4 recording succeeded but remuxing fails:

- log the detailed technical error to the console;
- return no attachment;
- show one concise user-facing recording error when alerts are enabled;
- restore recorder button/runtime state;
- release the microphone;
- do not create a fake `.aac` file containing MP4 or WebM bytes.

### Live Voice

Live Voice calls recording with alerts disabled.

On remux failure:

- `stopAudioRecording()` should return `null`;
- existing Live Voice null/error handling should be allowed to continue/restart listening;
- do not create an extra alert loop.

### Unsupported browser

Do not pretend unsupported formats are AAC.

For browsers where exact native AAC-LC MP4 recording is unavailable, preserve a clearly separated compatibility path. The primary goal of this plan is the confirmed Brave/Chromium path.

A future plan can add a universal PCM/WAV fallback if needed; do not add a full transcoder to this change.

---

# 7. Size-limit handling

Current recorder size logic watches encoded MediaRecorder chunk bytes and reserves only a small headroom before the attachment limit.

ADTS adds a small header to each AAC frame, so final `.aac` output is slightly larger than the AAC payload stored inside MP4.

Update the recording stop headroom so a recording close to the 20 MB attachment ceiling does not become invalid after ADTS headers are added.

Requirements:

- reserve a conservative remux overhead before auto-stop;
- still run the existing final attachment validation on the completed AAC File;
- never bypass the existing 20 MB per-file limit;
- never bypass the existing 30 MB combined-message attachment limit;
- if final validation still fails, return no attached File and preserve existing error behavior.

Do not change the global attachment limits in this plan.

---

# 8. Existing files that should NOT need Gemini-specific changes

Unless implementation reveals a concrete incompatibility, do not change:

```text
ChatUI/js/api/gemini-files.js
ChatUI/js/chat/attachment-transport.js
ChatUI/js/api/gemini.js
```

Reason:

The fix should happen before the recording becomes an attachment. Gemini should simply receive a normal supported:

```text
audio/aac
```

attachment through the existing pipeline.

Also do not modify TodoList-ui for this task.

---

# 9. Storage / migration rules

No IndexedDB schema change.

No migration of existing messages is required.

New recordings after this change should persist as:

```text
name: recorded_audio_<timestamp>.aac
mimeType: audio/aac
data: Blob(audio/aac)
```

Existing historical `.webm` recordings remain untouched.

Do not destructively rewrite historical attachments.

---

# 10. Build/deployment rules

## Combined application

The root build already copies:

```text
ChatUI/js
```

recursively into `dist/ChatUI/js`.

## Standalone ChatUI

The ChatUI build also copies:

```text
js
```

recursively.

Therefore place all new JavaScript/vendor assets below `ChatUI/js/` so both deployment modes receive the same code automatically.

Do not add a 31 MB FFmpeg WASM asset to the Worker build.

Do not add CDN-only runtime requirements for voice recording.

---

# 11. Proposed file changes

## New files

```text
ChatUI/js/composer/aac-remuxer.js
ChatUI/js/vendor/mp4box/<pinned browser build>
ChatUI/js/vendor/mp4box/LICENSE
```

Exact vendored filename can follow the selected MP4Box release distribution.

## Modify

```text
ChatUI/js/composer/recorder.js
```

## Expected no-change files

```text
ChatUI/js/composer/attachment-types.js
ChatUI/js/chat/attachment-transport.js
ChatUI/js/api/gemini-files.js
ChatUI/js/storage/records.js
ChatUI/js/storage/load.js
ChatUI/js/voice/live-voice-controller.js
scripts/build-static.mjs
ChatUI/scripts/build-static.mjs
TodoList-ui/**
```

Only change an expected no-change file if implementation finds a concrete blocker, and document why before broadening scope.

---

# 12. Verification plan

## A. MIME verification

After recording a normal voice message, console/runtime inspection should show:

```text
file.name endsWith('.aac') === true
file.type === 'audio/aac'
```

There must be no new normal voice message named `.webm` on the confirmed AAC-capable browser.

## B. Byte/container verification

Do not rely only on filename/MIME.

Verify that the produced output begins with valid ADTS AAC sync/header bytes and is not an MP4 container renamed to `.aac`.

The implementation test should explicitly detect and fail if output still begins as an MP4 `ftyp` container.

## C. Playback verification

Create an object URL from the resulting AAC Blob and confirm the browser can play the recording correctly where supported.

Also verify duration/audio content is not truncated.

## D. Gemini Files API verification

Send a newly recorded voice message.

Expected sequence:

```text
record → AAC
upload → Gemini Files API
PROCESSING → ACTIVE
request uses fileData
```

The previous error:

```text
Gemini File processing failed
```

must not occur because of `recorded_audio_....webm`.

## E. inlineData fallback verification

Force/observe the existing Files API fallback path and confirm the final AAC Blob is encoded as:

```text
inlineData.mimeType = audio/aac
```

No WebM should reappear during fallback.

## F. normal composer behavior

Verify:

- start recording;
- stop recording;
- AAC attachment pill appears;
- remove attachment;
- send attachment;
- regenerate a message containing the voice attachment;
- refresh page and reload the chat;
- historical AAC attachment is still available from IndexedDB.

## G. Live Voice behavior

Verify the shared recorder still works for:

- listening start;
- speech detection;
- silence-triggered end turn;
- manual end turn;
- AAC file returned from `stopAudioRecording()`;
- generation starts normally;
- next listening turn starts normally;
- microphone is released/reacquired correctly between turns;
- no alert loop if conversion fails.

## H. cancellation behavior

Verify cancelling a recording:

- does not run unnecessary remux work;
- does not attach a partial AAC file;
- releases microphone;
- restores UI state.

## I. size-limit behavior

Test recordings close to the app limit and confirm:

- auto-stop still occurs before final output exceeds limits;
- final AAC is validated through existing attachment validation;
- no oversized file bypass occurs.

## J. combined iframe deployment

Verify in the merged app:

```text
/chat-ui
```

and a nested chat route.

Ensure recording/remuxing works inside the persistent ChatUI iframe and switching to TodoList-ui does not destroy the ongoing ChatUI recorder state.

The fix must remain ChatUI-owned; TodoList-ui should not need changes.

---

# 13. Acceptance criteria

This plan is complete when all of the following are true:

1. On the confirmed AAC-capable Chromium/Brave browser, ChatUI explicitly records AAC-LC inside MP4 instead of browser-default WebM.
2. The temporary MP4 recording is remuxed locally into real ADTS AAC without decoding/re-encoding.
3. The final attachment filename is `.aac`.
4. The final attachment MIME is `audio/aac`.
5. The final bytes are actual AAC/ADTS, not renamed MP4 bytes.
6. Existing attachment validation accepts the result without MIME hacks.
7. Existing IndexedDB stores and reloads the AAC Blob without a schema migration.
8. Existing Gemini Files API receives `audio/aac` through the normal attachment transport.
9. Existing inlineData fallback receives `audio/aac` through the normal attachment transport.
10. Normal composer recording continues to work.
11. Live Voice continues to work through the shared recorder API.
12. Cancellation still works.
13. Microphone tracks are released before potentially asynchronous remux work.
14. Final file-size validation is preserved.
15. No TodoList-ui runtime changes are made.
16. No ffmpeg.wasm runtime is added.
17. No new large CDN dependency is required when the user stops a recording.
18. Both standalone ChatUI and the combined iframe deployment continue to build with the existing recursive `js/` copy behavior.

---

# 14. Explicit non-goals

This plan does **not** solve:

- Gemini multi-account File-ID/account affinity;
- HTTPS page → HTTP local proxy mixed-content blocking;
- old historical WebM attachments;
- general video transcoding;
- arbitrary user-uploaded unsupported audio conversion;
- universal recording support for every browser;
- TodoList-ui behavior;
- iframe architecture changes.

Those are separate problems.

---

# 15. Implementation order

Implement in this exact order to reduce risk:

```text
1. Vendor pinned MP4Box browser build + license
2. Create isolated aac-remuxer.js
3. Validate MP4 AAC → ADTS AAC with a small test Blob
4. Add explicit AAC-LC MediaRecorder MIME selection
5. Make stopAudioRecording() await remux before returning File
6. Release microphone before remux
7. Add final AAC file creation and existing attachment validation
8. Verify normal composer
9. Verify Live Voice
10. Verify persistence/reload
11. Verify Gemini Files API reaches ACTIVE for new recorded audio
12. Verify combined iframe route behavior
```

Do not modify Gemini transport first. The recording format should be corrected at the recorder boundary, then the existing attachment/Gemini pipeline should consume the corrected file unchanged.
