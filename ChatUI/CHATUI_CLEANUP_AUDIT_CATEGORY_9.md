# ChatUI Cleanup Audit — Category 9

This companion document records Category 9 findings for the ongoing ChatUI cleanup audit. It is **not** an implementation plan and does not authorize application-code changes.

Audit branch: `audit/chatui-cleanup-audit`

Category 9 audited against `main` at `2caf0577f97325e5797bb7b3906c55bb5ed0d893`.

# Category 9 — Security/privacy trust boundaries, third-party dependency exposure, unsafe HTML/data handling, and agentic mutation authority

Status: **Audit complete. No fixes performed.**

The audit distinguishes source-level vulnerabilities from intentional client-only tradeoffs. Existing origin/source checks, structural validation, replay protection, and other useful controls are explicitly preserved below rather than being treated as cleanup targets.

---

## 1. The homemade Markdown sanitizer has a URL-normalization bypass class that can permit `javascript:` links

**Priority:** Very High — potential persistent XSS

**Locations:**
- `ChatUI/js/chat/markdown.js` — `sanitizeHtml()`.
- `ChatUI/js/chat/message-renderer.js` — both user and assistant Markdown are inserted with `innerHTML = renderMarkdown(...)`.
- `ChatUI/js/workspace/workspace-document.js` — Workspace Markdown uses the same renderer/sanitizer.

**Finding:**

The sanitizer parses HTML into a `<template>`, removes a blocklist of elements/attributes, then rejects `href`, `src`, and `xlink:href` only when the raw attribute string matches `^(javascript|vbscript|data|file):` after trim/lowercase.

That check is performed before canonical URL parsing. HTML character references can produce ASCII tab/newline characters inside the scheme, while browser URL parsing removes those characters. A raw HTML value such as `<a href="java&#x09;script:alert(1)">...</a>` can therefore evade the regular expression even though the browser may canonicalize the final URL to the `javascript:` scheme when the link is activated.

Because the same renderer is used for assistant messages, user messages, restored chats, and Workspace Markdown, this is not limited to one transient remote-model response. Malicious content can be persisted locally and re-rendered later.

**Recommendation:**

Do not maintain a custom URL/HTML blocklist as the security boundary. Prefer disabling raw HTML in Markdown entirely. If raw HTML is required, use a mature allowlist sanitizer such as DOMPurify with explicit allowed tags/attributes/protocols and URL-parser-based scheme handling. Add regression tests for encoded/control-character protocol bypasses.

**Action type:** Security-critical sanitization replacement/hardening.

---

## 2. Raw HTML remains broadly enabled, allowing DOM clobbering and application-UI spoofing even when script execution is blocked

**Priority:** High

**Locations:**
- `ChatUI/js/chat/markdown.js`.
- `ChatUI/js/chat/message-renderer.js`.
- `ChatUI/js/workspace/workspace-document.js`.

**Finding:**

The sanitizer removes selected dangerous tags plus event/style attributes, but it still permits many arbitrary HTML elements and attributes. Untrusted Markdown can therefore create controls and structural elements such as `input`, `button`, `textarea`, `select`, `details`, arbitrary `id`, `class`, `tabindex`, `autofocus`, `contenteditable`, and other attributes.

ChatUI itself relies heavily on global IDs and CSS class names. Allowing untrusted content to inject duplicate application IDs/classes creates a DOM-clobbering/UI-spoofing surface and can cause later `getElementById()`/selector-based behavior to target the wrong element or render application-looking controls inside a message.

**Recommendation:**

Use a narrow element/attribute allowlist for rendered Markdown. Strip `id`, arbitrary application classes, focus-management attributes, and interactive form controls from untrusted content unless there is a demonstrated product requirement. Keep code/pre/table/link/image support as deliberate Markdown features rather than permitting general HTML.

**Action type:** Untrusted-DOM surface reduction.

---

## 3. Rendered Markdown can automatically load arbitrary third-party resources and disclose browsing metadata

**Priority:** High — privacy/tracking boundary

**Locations:**
- `ChatUI/js/chat/markdown.js`.
- `ChatUI/js/chat/message-renderer.js`.
- `ChatUI/js/workspace/workspace-document.js`.

**Finding:**

The sanitizer explicitly allows normal `http:`/`https:` resource URLs and does not reduce untrusted HTML to text-only/resource-free markup. Markdown images and raw media/resource elements can therefore initiate cross-origin network requests as soon as a message or Workspace document is rendered, without the user clicking a link.

This can disclose the user's IP address and normal HTTP request metadata to a third-party host chosen by model output, pasted/imported Markdown, a restored chat, or a restored Workspace file. Raw HTML attributes such as `referrerpolicy`, `srcset`, `poster`, and similar resource-loading controls are not constrained by the current sanitizer.

**Recommendation:**

Treat remote media as a separate permission boundary. Prefer same-origin/blob/data-owned resources by default and require an explicit user action to load third-party media, or proxy/validate remote media through a controlled boundary. Set an explicit conservative Referrer-Policy at the HTTP layer and sanitize resource-bearing attributes with an allowlist.

**Action type:** Privacy hardening for untrusted rendered content.

---

## 4. Production ChatUI executes floating/unverified third-party CDN JavaScript in the same security principal as API keys and local data

**Priority:** Very High

**Locations:**
- `ChatUI/index.html`.
- `ChatUI/embedded.html`.
- `scripts/build-static.mjs`.

**Finding:**

Both ChatUI entrypoints load Lucide from `unpkg.com/lucide@latest`, Marked from `cdn.jsdelivr.net/npm/marked/marked.min.js` without a version in the URL, and Highlight.js from cdnjs. The scripts have no Subresource Integrity metadata. The static build copies these entrypoints unchanged into production assets.

Any compromised CDN response, malicious dependency release, or unexpected floating-version change executes with full ChatUI JavaScript authority: IndexedDB/settings access, Gemini API keys, chat/Workspace data, microphone-facing feature code, and enabled local mutation tools.

**Recommendation:**

Bundle/vendor runtime dependencies into the repository/build and pin exact reviewed versions. If a CDN must remain temporarily, pin exact versions and add SRI plus `crossorigin` where supported. A local build also makes a restrictive `script-src 'self'` CSP practical.

**Action type:** Very-high-priority supply-chain hardening.

---

## 5. Same-origin, unsandboxed Chat and Todo iframes mean a ChatUI compromise is effectively a combined-app compromise

**Priority:** Very High

**Locations:**
- Root `index.html` — Chat and Todo iframe declarations.
- `shell/js/frame-bridge.js`.
- `ChatUI/js/embedded/shell-bridge.js`.

**Finding:**

The combined shell embeds ChatUI and Todo as same-origin iframes without the HTML `sandbox` attribute. The postMessage protocols correctly validate origin/source/channel, but same-origin framing does not create a process/security boundary: script running in a compromised ChatUI frame can access same-origin parent/sibling DOM and storage directly rather than being restricted to the reviewed RPC protocol.

This significantly increases the impact of the Markdown and CDN findings above. A ChatUI XSS/supply-chain compromise is not confined to ChatUI.

**Recommendation:**

Document this explicitly if same-origin full trust is intentional. For real containment, place high-risk surfaces on distinct origins and communicate only through narrow, validated postMessage/RPC contracts. If sandboxing is explored, treat `allow-scripts` plus same-origin access carefully; do not assume a nominal sandbox is a strong boundary while preserving unrestricted same-origin scripting.

**Action type:** Application isolation/trust-boundary redesign.

---

## 6. Web retrieval and durable local mutation tools are exposed to Gemini in the same agent loop

**Priority:** Very High — indirect prompt-injection path

**Locations:**
- `ChatUI/js/api/gemini.js` — `runStreamingFunctionLoop()` combines native tools and custom function declarations in one `tools` payload.
- `ChatUI/js/composer/composer.js` — Google Search, URL Context, Workspace, and To-Do are independent simultaneously enabled toggles.
- `ChatUI/js/workspace/workspace-tool-definitions.js`.
- `ChatUI/js/todo/todo-tool-definitions.js`.

**Finding:**

When custom tools are active, Gemini receives a single tool configuration containing server-side native tools such as Google Search/URL Context **and** client-side Workspace/To-Do function declarations. Retrieved web content is an untrusted input source and can contain prompt-injection instructions. The same model turn can then request client functions that create, rewrite, move, or delete durable local data.

This establishes an architectural indirect-prompt-injection path: untrusted retrieved content can influence the model that holds local mutation authority. Input validation inside Workspace/To-Do protects data shape, but it does not establish that a mutation reflects the user's intent.

**Recommendation:**

Add a tool-policy layer that treats retrieval output as untrusted and separates read authority from mutation authority. Do not rely on system prompts alone. Options include disallowing mutation functions in generations that consume untrusted web retrieval, requiring a clean follow-up user turn, or requiring explicit user approval before executing mutating/destructive calls derived from such context.

**Action type:** Agentic security boundary; very high priority.

---

## 7. Enabling Workspace/To-Do is persistent blanket mutation authority rather than per-operation authorization

**Priority:** Very High

**Locations:**
- `ChatUI/js/composer/composer.js` — tool toggles are persisted in settings.
- `ChatUI/js/tools/function-tool-registry.js` — enabled declarations are exposed and calls execute directly.
- `ChatUI/js/workspace/workspace-tool-executor.js` — write/edit/move/delete operations dispatch directly to Workspace service methods.
- `ChatUI/js/todo/todo-tool-definitions.js` — `todo_delete_tasks` explicitly states it executes without a separate confirmation popup.
- `ChatUI/js/todo/todo-mutation-replay-guard.js` — confirmation tokens apply to repeating an already-completed exact mutation, not to ordinary first-time destructive mutations.

**Finding:**

Once Workspace Access or To-Do is enabled, the setting persists and future answers may execute mutating calls without a fresh authorization decision. Workspace exposes rewrite/edit/move/delete operations, including recursive directory deletion. To-Do exposes create/update/delete operations over tasks, projects, and tags. The Todo replay guard is strong duplicate/retry protection, but it intentionally does not approve normal first-time mutations.

The current custom-tool round/call limits bound request count, not semantic impact; one recursive Workspace delete can remove a large subtree and Todo mutation calls can affect multiple objects.

**Recommendation:**

Classify every custom function as read-only, mutation, or destructive. Keep read-only tools eligible for persistent enablement if desired, but introduce explicit user-intent/approval boundaries for destructive operations and for high-impact bulk mutations. Consider per-chat/per-turn mutation grants and cumulative affected-object budgets. Preserve the existing duplicate replay guard as a separate safety mechanism.

**Action type:** Agent authorization and least-privilege redesign.

---

## 8. Custom Gemini Base URLs are treated as fully trusted endpoints and can receive the entire API-key pool without a hostname trust confirmation

**Priority:** High

**Locations:**
- `ChatUI/html/settings-modal.html` — editable Text and Audio Base URL fields.
- `ChatUI/js/api/api-config.js` — `getCleanBaseUrl()` only trims slashes; changing Text Base URL triggers validation.
- `ChatUI/js/api/text-api-key-pool.js` — `validateTextApiKeyPool()` sends every configured key to `${cleanBaseUrl}/v1beta/models` using `x-goog-api-key`.
- `ChatUI/js/api/gemini.js` — normal text requests send the active key and complete conversation payload to the configured base URL.
- `ChatUI/js/api/gemini-live-audio.js` — Audio key is appended to the configured WebSocket URL query string.

**Finding:**

The Base URL setting intentionally supports alternate endpoints, but there is no trust/host policy beyond string cleanup. A changed Text Base URL can immediately receive **every key in the configured pool** during automatic validation, not only the active key. Normal requests then send conversation/tool/attachment data to that host. The UI labels the Google default but does not explicitly state that a custom host becomes a fully trusted credential/data recipient.

**Recommendation:**

Parse and validate custom endpoints as URLs, require HTTPS/WSS except explicitly supported localhost development, display the resolved hostname prominently, and require an explicit confirmation before first sending credentials to a non-Google host. Avoid automatically validating the complete key pool against a newly entered untrusted host until that trust decision is confirmed. Redact credential-bearing WebSocket URLs from all diagnostics/logging.

**Action type:** Credential-destination trust hardening.

---

## 9. Long-lived API keys are stored as ordinary same-origin browser data

**Priority:** High — accepted client-only architecture risk

**Locations:**
- `ChatUI/js/storage/records.js` — settings record persists `state.api`.
- `ChatUI/js/storage/load.js` — restores Text/Voice keys and profiles.
- `ChatUI/js/storage/backup-restore.js` — full backup snapshots all stores, including Settings.
- `ChatUI/js/settings/backup-restore-ui.js` and `settings-modal.html` — correctly warn that full backups may contain API keys.

**Finding:**

Text and Audio credentials persist in IndexedDB as normal application data and are readable by any JavaScript executing in the ChatUI origin. This may be an acceptable tradeoff for a personal, client-only application, but it means any successful XSS or third-party-script compromise can exfiltrate long-lived credentials in addition to local content.

The backup UI already discloses the secret-bearing nature of full backups; that warning should be preserved. Encrypting the keys with a key available to the same compromised JavaScript would not solve the XSS threat.

**Recommendation:**

Document the client-only threat model and encourage provider-side key restrictions/quotas. Reduce script-origin risk first (sanitizer, dependency bundling, isolation, CSP). For materially stronger credential protection, use a backend/token broker or short-lived scoped credentials so browser JavaScript never owns a long-lived provider secret.

**Action type:** Architectural credential-risk reduction; not a claim that local persistence is intrinsically invalid.

---

## 10. Full-backup restore has structural validation but no overall resource-exhaustion limits

**Priority:** High

**Locations:**
- `ChatUI/js/storage/backup-restore.js` — `prepareFullBackupRestore()`, recursive `decodePortableValue()`, and relationship validation.
- Positive comparison: `ChatUI/js/workspace/workspace-zip.js`.

**Finding:**

A selected full backup is read entirely with `file.text()`, parsed with `JSON.parse()`, then recursively decoded. Base64 Blob values allocate complete binary buffers. There is no maximum input file size, maximum decoded-byte budget, record-count budget, string-length budget, or nesting-depth limit before those allocations occur.

An untrusted backup can therefore consume excessive CPU/memory and crash or freeze the tab before relationship validation completes. This is a local denial-of-service/import-hardening issue, not arbitrary code execution.

Workspace ZIP restore already demonstrates the desired defensive pattern: it limits entry count and total uncompressed bytes, rejects unsupported compression/Zip64/symlinks, checks ranges, and validates CRCs.

**Recommendation:**

Add an early `file.size` cap plus cumulative decoded-byte, record-count, string-size, and nesting-depth limits before committing restore state. Reuse the bounded-input philosophy already present in the Workspace ZIP reader.

**Action type:** Untrusted-import resource-bound hardening.

---

## 11. Grounding/URL Context metadata is converted to clickable anchors without an explicit HTTP(S) protocol allowlist

**Priority:** Medium/High

**Locations:**
- `ChatUI/js/chat/message-tools.js` — grounding and URL Context URLs are assigned directly to `a.href`.
- `ChatUI/js/embedded/shell-bridge.js` — external-link interception deliberately handles only HTTP(S) and returns for other protocols.

**Finding:**

Provider metadata is expected to contain web URLs, but the renderer does not verify that expectation before creating active anchors. A non-web scheme reaching `groundingChunks`/URL Context metadata is still placed into `href`. In embedded mode the external-link policy does not neutralize it: when the parsed protocol is not HTTP(S), the policy returns and browser default activation remains possible.

This is a defense-in-depth gap at an external-provider boundary. Provider metadata should not be treated as equivalent to already-validated application URLs.

**Recommendation:**

Normalize provider URLs at the API boundary. Render anchors only for successfully parsed `https:`/`http:` URLs; render unsupported/invalid values as inert text. Keep `rel="noopener noreferrer"` on new-tab links.

**Action type:** External-metadata URL hardening.

---

## 12. The repository does not define a restrictive Content Security Policy or other explicit application security headers

**Priority:** High

**Locations:**
- `worker.js` — route rewriting only; no application security headers are added.
- `wrangler.jsonc` — static assets binding only.
- `ChatUI/index.html` and `ChatUI/embedded.html` — no CSP meta policy.
- Repository tree contains no `_headers` file.

**Finding:**

The application source does not establish a CSP or an explicit HTTP security-header policy. That removes an important defense-in-depth layer precisely where the app renders untrusted HTML, loads live third-party JavaScript, stores provider credentials, and has local mutation capabilities.

A strict CSP cannot compensate for an unsafe sanitizer or trusted-CDN compromise by itself, but it can materially reduce exploitability and prevent accidental new script/resource sources.

**Recommendation:**

After bundling runtime dependencies locally, add response headers such as a restrictive `Content-Security-Policy` with `script-src 'self'`, `object-src 'none'`, and `base-uri 'self'`; an appropriate `frame-ancestors 'self'` policy for the combined same-origin shell; `X-Content-Type-Options: nosniff`; and a conservative `Referrer-Policy`. Add a deliberate `Permissions-Policy` reflecting the microphone/audio features actually required.

**Action type:** Deployment defense-in-depth hardening.

---

## Category 9 protections checked and intentionally NOT classified as problems

- Shell/Chat postMessage handling performs useful exact-origin, exact-source, channel/version/app, type, and payload-size validation. Those checks should be preserved. The iframe finding is about lack of isolation despite those good RPC checks.
- Embedded external HTTP(S) links are opened with `noopener,noreferrer`; that is good behavior. The provider-URL finding is specifically the unvalidated non-HTTP(S) case.
- Workspace ZIP restore has strong bounded archive handling: stored-only entries, size/count limits, bounds checks, UTF-8 validation, CRC checking, and symbolic-link rejection. It is a positive model for full-backup hardening.
- Full-backup UI clearly warns that backup files contain private data and may contain Gemini API keys. The audit does not classify the backup feature as a silent secret leak.
- Todo's mutation replay guard provides meaningful protection against duplicate/replayed mutations and unknown/partial outcomes. It should remain. It is not a general authorization system for first-time destructive mutations.
- Workspace and Todo services perform substantial argument/business validation. The agentic findings are about **authority and provenance of intent**, not a recommendation to weaken those validators.
- Code Execution is provider/server-side in the reviewed Gemini integration; no local `eval()`/`Function()` execution path was identified in the reviewed ChatUI application code.
- `layout-loader.js` inserts same-origin repository-owned HTML fragments; this trusted static-fragment use of `innerHTML` is not equivalent to untrusted Markdown rendering.
- Category 6 already records stale legacy LocalStorage and backup/schema debt; those findings are not duplicated here merely because they also have privacy implications.

---

# Next category

Not started yet: **Category 10 — test/verification gaps, regression coverage weaknesses, CI blind spots, and auditability/observability of high-risk behavior.**
