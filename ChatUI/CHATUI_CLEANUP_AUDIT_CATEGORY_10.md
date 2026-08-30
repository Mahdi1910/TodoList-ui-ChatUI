# ChatUI Cleanup Audit — Category 10

This companion document records Category 10 findings for the ongoing ChatUI cleanup audit. It is **not** an implementation plan and does not authorize application-code changes.

Audit branch: `audit/chatui-cleanup-audit`

Category 10 audited against current `main` at `fe4e49e5379b6b6a9d0d16a99b510e1a49fb6122`.

# Category 10 — Test/verification gaps, regression-coverage weaknesses, CI blind spots, and auditability of high-risk behavior

Status: **Audit complete. No fixes performed.**

The repository does contain useful verification. In particular, there are real pure-JavaScript assertions around API-key normalization/cooldowns, Todo normalization and replay identity, and File URI recovery. This category therefore does **not** classify ChatUI as “untested.” The main issue is that the riskiest browser, persistence, cross-frame, network-protocol, and agentic-mutation boundaries are still protected mostly by source-shape assertions and manual verification rather than executable behavioral contracts.

---

## 1. `main` has no enforced branch-protection or required-check boundary

**Priority:** Very High

**Evidence:**
- GitHub reports `main` as `protected: false`.
- Required status checks are disabled.
- Repository rulesets endpoint currently returns an empty list.

**Finding:**

The project has a disciplined written workflow—feature branch, checks, exact-head Cloudflare preview, squash merge—but GitHub itself does not enforce that workflow. A direct push, manual merge, or merge with a failing/missing check can still land on `main`.

For a client-side application that stores credentials locally and allows AI-triggered Workspace/To-Do mutations, this means the strongest validation rules exist as process convention rather than repository policy.

**Recommendation:**

Protect `main` and require the stable integration/security-critical CI checks before merge. Keep force-push and branch deletion restricted. If the repository intentionally permits owner bypass, make that an explicit emergency path rather than the normal state.

**Action type:** Repository-governance hardening.

---

## 2. Reviewed CI is pull-request-triggered; there is no independent push-to-`main` verification layer

**Priority:** High

**Locations:**
- `.github/workflows/iframe-integration-check.yml`.
- `.github/workflows/chatui-plan7-key-pool-check.yml` through Plan 16 workflows.
- Current Todo feature workflows use the same plan-specific pattern.

**Finding:**

The reviewed stable workflows use `pull_request` triggers. Repository code search did not find a `push:` workflow trigger.

Even after a PR passes, the final merge commit on `main` is therefore not independently rebuilt/reverified by repository CI. This matters because the project explicitly values **exact-head** verification. A squash merge produces a new commit SHA, and future direct pushes or conflict-resolution changes can also create a state different from the checked PR head.

**Recommendation:**

Add a small stable `push` verification workflow for `main` that at minimum runs the canonical syntax/module checks, behavioral test suite, safe static build, and critical security invariants. It does not need to duplicate every expensive feature workflow.

**Action type:** CI trigger coverage.

---

## 3. Much of ChatUI verification checks source text rather than executing behavior

**Priority:** Very High

**Representative locations:**
- `scripts/verify-chatui-plan14.mjs`.
- `scripts/verify-chatui-plan15.mjs`.
- `scripts/verify-chatui-plan16.mjs`.
- `scripts/verify-integration.mjs`.
- `scripts/verify-chatui-plan6.mjs`.

**Finding:**

Many assertions use `fs.readFileSync()` plus `assert.match()`, `includes()`, or `doesNotMatch()` to prove that a function name, CSS declaration, event listener, or code fragment exists.

These checks are useful architectural tripwires, but they do not prove that the relevant browser state transition actually works. A source file can contain every expected string while the runtime ordering, object state, event target, selection range, iframe visibility, or async race is still wrong.

Plan 15/16 are a good example: the verification asserts that selection is captured on `pointerdown`, that the correct helper names exist, and that Range-clipping code exists, but it never constructs a real selection and drives the menu lifecycle.

**Recommendation:**

Keep source-shape assertions for architecture, but distinguish them explicitly from behavioral tests. For pure logic, execute imported functions. For DOM-dependent logic, extract testable state/normalization helpers and add a lightweight DOM test harness where browser behavior can be represented faithfully without violating the project's browser-automation prohibition.

**Action type:** Test-quality upgrade, not removal of existing checks.

---

## 4. Selection/focus/menu/ResizeObserver behavior has no executable interaction contract

**Priority:** Very High

**Locations:**
- `ChatUI/js/voice/read-selection.js`.
- `ChatUI/js/ui/chat-controls.js`.
- `ChatUI/js/chat/message-renderer.js`.
- `scripts/verify-chatui-plan15.mjs`.
- `scripts/verify-chatui-plan16.mjs`.

**Finding:**

These features depend on browser-specific state:

- Selection/Range endpoints.
- Focus changes caused by menu pointer events.
- Selection persistence while opening a popup.
- ResizeObserver callbacks after a hidden iframe becomes visible.
- Rendered width/line-height/scrollHeight measurements.

The current Plan 15/16 scripts assert implementation text but do not create the DOM state and verify the resulting user-visible behavior.

The project's handoff explicitly prohibits Playwright/Selenium/headless-browser automation. That rule should be respected, but it leaves this class of bugs dependent on manual testing unless the code is structured so most of the decision logic can be tested outside a real browser.

**Recommendation:**

Without adding browser automation, split DOM-sensitive features into:

1. pure selection/measurement/state-decision helpers with table-driven tests;
2. very thin browser adapters;
3. an explicit manual exact-head checklist for the irreducibly browser-specific portion.

Record that checklist per release so manual verification is auditable instead of implicit.

**Action type:** Non-browser behavioral-test architecture plus documented manual verification.

---

## 5. Historical Plan workflows are fragmented by path filters, while the always-run integration workflow does not execute Plans 7–16

**Priority:** High

**Locations:**
- `.github/workflows/iframe-integration-check.yml`.
- `.github/workflows/chatui-plan14-light-message-check.yml`.
- `.github/workflows/chatui-plan15-read-selection-check.yml`.
- `.github/workflows/chatui-plan16-selection-wrap-check.yml`.

**Finding:**

`iframe-integration-check.yml` runs on every PR, but its ChatUI historical plan checks are Plan 4 and Plan 6 plus several integration/Todo/file-recovery scripts. Plans 7–16 live in separate workflows, many with narrow path filters.

That means an invariant can depend on a shared module that is not listed in the historical workflow's path filter, and a later refactor of that shared dependency can avoid rerunning the feature-specific regression check.

Plan-specific workflows were valuable while implementing each plan, but over time they have become a fragmented regression suite whose triggering depends on historical file lists.

**Recommendation:**

Create one canonical, stable `verify-chatui-regressions.mjs` or workflow that invokes the still-useful plan checks unconditionally for ChatUI-affecting PRs. Historical workflows can then be retired or reduced to wrappers after equivalence is proven.

**Action type:** CI consolidation with preserved coverage.

---

## 6. JavaScript syntax checking is a manually maintained allowlist and does not cover the whole runtime graph

**Priority:** High

**Location:** `.github/workflows/iframe-integration-check.yml`.

**Finding:**

The integration workflow contains a long manual series of `node --check <file>` commands. It covers many important modules but is not generated from the runtime tree and omits other live modules. Plan-specific workflows syntax-check a few more files only when their path filters trigger.

A newly added module, moved file, or live file outside the list can therefore ship without ever being parsed by `node --check` in the always-run workflow.

**Recommendation:**

Replace the manual syntax list with a repository script that recursively enumerates runtime `.js`/`.mjs` files under the approved runtime directories and runs syntax validation on all of them, with explicit exclusions only where necessary.

**Action type:** Verification automation cleanup.

---

## 7. `build-static.mjs` is a safe copier, not a bundler or module-graph validator

**Priority:** High

**Location:** `scripts/build-static.mjs`.

**Finding:**

The production build correctly uses an explicit runtime allowlist, which is good for deployment hygiene. But the script copies directories/files into `dist/`; it does not parse imports, resolve module specifiers, instantiate modules, or verify that every runtime dependency can actually load.

A successful “Build safe runtime bundle” step therefore proves that required top-level paths exist and were copied. It does **not** prove that the JavaScript module graph is valid.

**Recommendation:**

Keep the explicit safe-copy build. Add a separate static module-graph verifier that recursively parses local ES-module imports from runtime entry points, checks that relative targets exist, rejects accidental cross-app/private paths, and reports orphaned/missing runtime dependencies.

**Action type:** Add module-graph verification beside the existing safe build.

---

## 8. Combined-app iframe/RPC verification does not execute the postMessage protocol end-to-end

**Priority:** Very High

**Locations:**
- `scripts/verify-integration.mjs`.
- `.github/workflows/iframe-integration-check.yml`.
- `shell/js/frame-bridge.js`.
- `ChatUI/js/todo/todo-bridge-client.js`.
- `TodoList-ui/js/embedded/shell-bridge.js`.

**Finding:**

The integration script checks source strings such as channel names, request routes, message-size constants, and file/module boundaries. The workflow's local HTTP test curls shell routes and checks returned HTML. Todo pure-JS verification tests several normalizers and replay helpers.

What is not executed is the correlated runtime protocol itself:

- Chat sends a request.
- Shell wakes/forwards to Todo.
- Dispatch acknowledgement changes timeout behavior.
- Todo returns a correlated response.
- Cancellation races are handled.
- Late mutation results reconcile after timeout/reload.
- Invalid source/origin/message shapes are ignored.

This is a high-risk boundary because successful RPC calls can mutate durable Todo state.

**Recommendation:**

Build a pure message-transport harness with fake frame endpoints/EventTargets so protocol state machines can be executed in Node without a real browser. Test request correlation, timeout transitions, cancellation, duplicate IDs, oversized payloads, late results, and invalid-message rejection.

**Action type:** Cross-frame protocol behavioral tests.

---

## 9. Gemini SSE/custom-tool orchestration lacks deterministic protocol-fixture tests

**Priority:** Very High

**Locations:**
- `ChatUI/js/api/gemini.js`.
- `ChatUI/js/chat/streaming.js`.
- `ChatUI/js/api/gemini-file-recovery-wrapper.js`.
- `ChatUI/js/tools/function-tool-registry.js`.

**Finding:**

The generation path handles many protocol-sensitive cases:

- incremental SSE parsing;
- malformed/partial events;
- thought signatures;
- function-call IDs;
- multiple custom calls per round;
- native tools plus custom tools;
- partial visible activity;
- aborts;
- File recovery retries;
- key failover/replay prevention;
- tool-round limits.

The existing verification does test some isolated helpers, but the repository does not have a deterministic fake-fetch/SSE fixture suite that drives `streamChat()` through representative multi-round transcripts and asserts exact tool execution/order/final history.

This leaves one of ChatUI's most complex state machines protected mainly by implementation review and static invariants.

**Recommendation:**

Introduce injectable fetch/stream adapters and fixture-based tests for successful text streaming, split SSE boundaries, malformed events, tool calls, tool errors, multiple rounds, abort timing, failover-before-activity, no-failover-after-activity, and round-limit narration.

**Action type:** Network-protocol behavioral test suite.

---

## 10. IndexedDB persistence and full backup/restore lack executable database integration tests

**Priority:** Very High

**Locations:**
- `ChatUI/js/storage/database.js` and storage modules.
- `ChatUI/js/storage/backup-restore.js`.
- `ChatUI/js/storage/backup-restore-transaction.js`.
- Workspace storage modules.

**Finding:**

Repository verification contains no script-level IndexedDB integration harness. Code search in `scripts/` did not find IndexedDB usage or direct calls to `prepareFullBackupRestore()`.

As a result, important guarantees are not machine-tested as transactions:

- durable user turn before generation;
- lazy-loaded chat invariants;
- message/attachment relationship preservation;
- Blob round-trips;
- backup encode/decode fidelity;
- restore rollback/atomicity;
- settings/profile migration;
- read-audio persistence;
- Workspace tree/file replacement.

The backup validator has substantial structural checks, but source inspection is not equivalent to restoring a representative database and comparing the resulting state.

**Recommendation:**

Use a Node-compatible IndexedDB implementation for deterministic integration tests. Build fixtures containing chats, attachments/Blobs, settings, Workspace nodes/files, and cached audio; export, validate, restore into a clean DB, then compare authoritative records. Add failure-injection tests around restore transaction boundaries.

**Action type:** Persistence integration tests.

---

## 11. Category 9 security-critical findings have no dedicated regression suite

**Priority:** Very High

**Locations:**
- `ChatUI/js/chat/markdown.js`.
- `ChatUI/js/chat/message-renderer.js`.
- `ChatUI/js/workspace/workspace-document.js`.
- `ChatUI/js/api/gemini.js` and custom-tool registry/executors.

**Finding:**

The current scripts contain no dedicated sanitizer regression tests. Code search did not find `sanitizeHtml` in `scripts/`.

There is also no policy-level test that asserts untrusted retrieval content cannot directly trigger local destructive mutations, because the current architecture intentionally places native retrieval tools and custom local mutation declarations in the same generation loop.

This means the highest-risk findings from Category 9 have no executable tripwire that would fail if the unsafe behavior remains or later reappears after remediation.

**Recommendation:**

When Category 9 fixes are authorized, require tests in the same change:

- encoded/control-character dangerous URL schemes;
- raw HTML allowlist behavior;
- remote resource-loading policy;
- DOM-clobbering attributes;
- mixed retrieval + mutation authorization boundaries;
- destructive-operation confirmation/policy decisions.

**Action type:** Security regression suite to accompany future fixes.

---

## 12. Workspace ZIP parser security properties are not covered by parser-fixture/fuzz-style tests

**Priority:** High

**Location:** `ChatUI/js/workspace/workspace-zip.js`.

**Finding:**

The ZIP reader contains several good defenses—stored-only method, entry count and uncompressed-size limits, bounds checks, CRC verification, duplicate-name rejection, Zip64 rejection, multi-disk rejection, and symlink rejection.

However, repository scripts do not directly call `readStoredZip()`. These parser defenses are therefore not protected against refactor regressions by malformed archive fixtures.

**Recommendation:**

Add deterministic byte-level tests for truncated local/central headers, inconsistent offsets/sizes, duplicate paths, invalid UTF-8 names, CRC mismatch, symlink metadata, excessive entry count/total size, unsupported compression, Zip64 markers, and valid round-trip archives.

**Action type:** Security parser tests.

---

## 13. Exact-head Cloudflare preview is a written/manual release rule rather than a machine-auditable repository gate

**Priority:** High

**Location:** `ChatUI/NEW_CHAT_HANDOFF.md` and current release workflow practice.

**Finding:**

The handoff correctly requires Cloudflare preview success for the exact shippable head. This is a strong practice. But there is no protected GitHub check/ruleset tying a successful preview deployment to the commit that is actually merged.

Because `main` is unprotected and PR checks are not required, the repository cannot prove from merge policy alone that the final reviewed commit received the required preview.

**Recommendation:**

Expose the preview deployment as a GitHub Deployment/status check associated with the exact commit and make that status required on protected `main`. If that is not practical, record the exact preview commit/deployment URL in the PR and use a merge checklist bot/script that verifies the SHA match.

**Action type:** Release-verification auditability.

---

## 14. Historical Plan verifiers duplicate current-version assertions, coupling unrelated regressions to release-number edits

**Priority:** Medium

**Representative locations:**
- `scripts/verify-chatui-plan7.mjs`.
- `scripts/verify-chatui-plan15.mjs`.
- `scripts/verify-chatui-plan16.mjs`.

**Finding:**

Multiple historical feature verifiers assert the current `CHATUI_VERSION` string. Every visible version bump therefore requires touching or updating unrelated historical verification assumptions.

This does not improve the feature invariant being tested and creates noisy maintenance. It also increases the temptation either to bulk-edit old tests mechanically or to skip them when the version assertion becomes stale.

**Recommendation:**

Move version validation into one canonical release/version check. Historical feature tests should validate their behavioral or architectural contract only.

**Action type:** Test maintenance cleanup.

---

# Existing verification worth preserving

The following should be retained and built upon rather than discarded:

- `scripts/build-static.mjs` uses an explicit runtime allowlist and avoids deploying internal planning/audit files.
- `scripts/verify-chatui-plan7.mjs` executes real pure-JS assertions for API-key parsing, cooldown timing, stored-pool normalization, and rate-limit classification.
- `scripts/verify-todo-tools.mjs` executes real normalizer/replay-context behavior in addition to source invariants.
- `scripts/verify-file-uri-recovery.mjs` executes real error-classification/history-sanitization helpers with representative fixtures.
- `scripts/verify-integration.mjs` usefully enforces architectural separation between ChatUI and Todo storage/runtime modules.
- The project explicitly requires manual browser testing and exact-head Cloudflare preview; the problem is auditability/coverage, not the existence of that discipline.
- Browser automation remains prohibited by project rule unless the user explicitly changes that rule later.

---

# Category 10 recommended order of future work

If these findings are later authorized for implementation, the safest order is:

1. Protect `main` and define required stable checks.
2. Add a canonical always-run regression workflow and `push` verification for `main`.
3. Replace manual JS syntax lists with runtime-tree enumeration and add local module-graph checking.
4. Add protocol fixture tests for Gemini streaming/custom tools and Chat↔Shell↔Todo RPC.
5. Add IndexedDB/backup/restore integration fixtures.
6. Add Workspace ZIP malformed-input tests.
7. When Category 9 security fixes are implemented, land their regression tests in the same commits.
8. Consolidate historical Plan workflows/version assertions only after equivalent coverage exists.

No application cleanup or security fix should be performed merely because it appears in this audit. Re-check each item against the then-current `main` before implementation.