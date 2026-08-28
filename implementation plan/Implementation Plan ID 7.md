# Implementation Plan ID 7 — Gemini Text API Key Pool and Automatic Failover

## Goal

Upgrade ChatUI's Gemini **text-model** credential configuration from one API key to an ordered pool of API keys. The pool is intended for personal use with keys from separate Google Cloud / AI Studio projects.

ChatUI version for this change: **1.1**.

## User-facing requirements

1. The Gemini Text API Key field accepts any practical number of keys, one key per line.
2. Whitespace and blank lines are removed automatically and duplicate keys are collapsed.
3. Keys are automatically validated after editing without sending a model-generation prompt.
4. The UI shows masked per-key health information and aggregate counts.
5. The currently selected usable key remains in use until it fails.
6. A qualifying Gemini rate-limit response immediately moves the key into cooldown and rotates to the next usable key.
7. Rate-limit cooldown expires one hour after the **next Gemini daily quota reset**. Gemini documents the daily reset as midnight Pacific time, so ChatUI resolves the release against `America/Los_Angeles` rather than a fixed UTC or Baghdad hour.
8. Non-rate-limit failures retry the same key with delays of **2 seconds, 4 seconds, and 8 seconds** (initial attempt + three retries). If all four attempts fail before generation activity starts, ChatUI rotates to the next usable key.
9. When the end of the pool is reached, future selection wraps back to the beginning while skipping invalid/cooling keys.
10. Every failure records a timestamp, bounded error summary, HTTP/API status, and rate-limit classification. This metadata persists in IndexedDB.
11. Successful use clears consecutive generic failures for that key.
12. Existing single-key settings migrate automatically into a one-entry pool.
13. Gemini Live/voice credentials remain separate and unchanged.

## Safety / replay invariant

Automatic same-key retry or cross-key replay is allowed only before the assistant has emitted visible/thinking/tool activity. Once generation activity has started, ChatUI must not silently replay the whole request because custom tools can have side effects and streamed text could be duplicated. The failure is still recorded and the next usable key is selected for the next request.

## Attachment invariant

Key failover remains outside the Gemini protocol/history implementation. Each new key attempt re-enters the existing file-recovery path so project-scoped Gemini File references can be repaired/re-uploaded from locally persisted attachment Blobs when necessary.

## Persistence

No IndexedDB schema-version bump is required. The existing `settings` record stores the extended `state.api` object, including:

- ordered `textApiKeys` entries;
- `textApiKeyIndex`;
- active legacy-compatible `textApiKey`;
- validation state;
- `lastValidatedAt`;
- `lastSuccessAt`;
- `lastFailureAt`;
- `consecutiveFailures`;
- `cooldownUntil`;
- bounded `lastError` and `failureHistory`.

Startup loading must restore those fields while remaining compatible with older records containing only `textApiKey`.

## Validation

Key validation uses the configured Gemini base URL's `GET /v1beta/models` endpoint with `x-goog-api-key`, with bounded concurrency. It does not generate model text merely to test credentials.

## Verification

- JavaScript syntax checks for every changed/new JS module.
- Existing repository integration invariants.
- Safe static runtime build.
- Static assertions for multiline normalization, duplicate removal, Pacific reset+1h calculation, rate-limit classification, retry delays, pool persistence fields, and version 1.1.
- Pull-request CI on the exact feature head before merge.
