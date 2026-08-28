import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  TEXT_KEY_RETRY_DELAYS_MS,
  isRateLimitError,
  nextPacificQuotaReleaseAt,
  normalizeStoredTextApiPool,
  parseApiKeyLines
} from '../ChatUI/js/api/text-api-key-pool.js';
import { normalizeMultilineApiKeyText } from '../ChatUI/js/api/text-api-key-input.js';

assert.deepEqual(
  parseApiKeyLines('  key-one  \n\n key-two\nkey-one\n key - three '),
  ['key-one', 'key-two', 'key-three'],
  'multiline key cleanup should trim whitespace, remove blank lines, and deduplicate'
);

assert.equal(
  normalizeMultilineApiKeyText('key-one\rkey-two\r\nkey-three\u2028key-four\u2029key-five\u0085key-six'),
  'key-one\nkey-two\nkey-three\nkey-four\nkey-five\nkey-six',
  'mobile and Unicode clipboard line separators must normalize to LF without joining keys'
);

assert.deepEqual(
  parseApiKeyLines(normalizeMultilineApiKeyText(' key-one \r key-two \u2028 key-three \u2029 key-four ')),
  ['key-one', 'key-two', 'key-three', 'key-four'],
  'normalized mobile clipboard text must remain one API key per line'
);

assert.deepEqual(
  TEXT_KEY_RETRY_DELAYS_MS,
  [2000, 4000, 8000],
  'generic retry backoff must remain 2s, 4s, 8s'
);

assert.equal(isRateLimitError({ httpStatus: 429 }), true, 'HTTP 429 must trigger quota cooldown');
assert.equal(isRateLimitError({ apiStatus: 'RESOURCE_EXHAUSTED' }), true, 'RESOURCE_EXHAUSTED must trigger quota cooldown');
assert.equal(isRateLimitError({ httpStatus: 503 }), false, 'generic 5xx failures must use normal retry/failover');

const summerStart = Date.parse('2026-08-28T12:00:00Z');
const summerRelease = nextPacificQuotaReleaseAt(summerStart);
assert.equal(
  new Date(summerRelease).toISOString(),
  '2026-08-29T08:00:00.000Z',
  'summer cooldown should release at 01:00 America/Los_Angeles after the next Pacific midnight reset'
);

const winterStart = Date.parse('2026-12-15T12:00:00Z');
const winterRelease = nextPacificQuotaReleaseAt(winterStart);
assert.equal(
  new Date(winterRelease).toISOString(),
  '2026-12-16T09:00:00.000Z',
  'winter cooldown should follow Pacific standard time automatically'
);

const legacy = normalizeStoredTextApiPool({ textApiKey: ' legacy-key ', textBaseUrl: '' });
assert.equal(legacy.textApiKeys.length, 1, 'legacy single-key settings must migrate to one pool entry');
assert.equal(legacy.textApiKeys[0].key, 'legacy-key');
assert.equal(legacy.textApiKeyIndex, 0);

const persisted = normalizeStoredTextApiPool({
  textApiKey: 'key-b',
  textApiKeyIndex: 1,
  textApiKeys: [
    { key: 'key-a', cooldownUntil: 123, lastFailureAt: 100, failureHistory: [{ at: 100, message: 'quota', rateLimited: true }] },
    { key: 'key-b', lastSuccessAt: 200, validationStatus: 'valid' }
  ]
});
assert.equal(persisted.textApiKeys[0].cooldownUntil, 123, 'cooldown metadata must survive normalization');
assert.equal(persisted.textApiKeys[0].lastFailureAt, 100, 'failure timestamp must survive normalization');
assert.equal(persisted.textApiKeys[0].failureHistory.length, 1, 'failure history must survive normalization');
assert.equal(persisted.textApiKeyIndex, 1, 'active pool index must survive normalization');

const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');
const settingsHtml = fs.readFileSync('ChatUI/html/settings-modal.html', 'utf8');
const loadSource = fs.readFileSync('ChatUI/js/storage/load.js', 'utf8');
const recoverySource = fs.readFileSync('ChatUI/js/api/gemini-file-recovery-wrapper.js', 'utf8');
const cssIndex = fs.readFileSync('ChatUI/css/components.css', 'utf8');

assert.match(apiConfig, /CHATUI_VERSION = '1\.8'/, 'ChatUI Settings version must be 1.8');
assert.match(apiConfig, /normalizeMultilineApiKeyText/, 'text API key input must normalize mobile clipboard line endings');
assert.match(apiConfig, /addEventListener\('paste'/, 'text API key textarea must explicitly preserve multiline paste');
assert.match(settingsHtml, /<textarea[^>]+id="text-api-key-input"/, 'text API key control must be a native textarea in the settings markup');
assert.match(settingsHtml, /wrap="off"/, 'text API key textarea must preserve one visual row per key instead of soft-wrapping');
assert.match(apiConfig, /setTextApiKeyPoolFromText\(normalizedText\);/, 'editor changes must still update the cleaned internal key pool');
assert.doesNotMatch(
  apiConfig,
  /input\.value\s*=\s*\([^;]*textApiKeys[^;]*join/,
  'debounced save must not rewrite the textarea and remove blank lines while the user is editing'
);
assert.match(apiConfig, /validateTextApiKeyPool/, 'settings must automatically validate the key pool');
assert.match(loadSource, /textApiKeys:/, 'startup load must restore text API key pool metadata');
assert.match(loadSource, /textApiKeyIndex:/, 'startup load must restore the active pool index');
assert.match(recoverySource, /runWithTextApiKeyFailover/, 'generation must pass through text key failover');
assert.match(recoverySource, /chatUiGenerationStarted/, 'failover must protect already-started streamed generations from replay');
assert.match(cssIndex, /api-key-pool\.css/, 'key-pool settings stylesheet must be included');

console.log('ChatUI Plan 7 verification passed.');
