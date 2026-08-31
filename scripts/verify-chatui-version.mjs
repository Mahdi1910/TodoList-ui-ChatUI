import assert from 'node:assert/strict';
import fs from 'node:fs';

const apiConfig = fs.readFileSync('ChatUI/js/api/api-config.js', 'utf8');
const versionMatches = [...apiConfig.matchAll(/export const CHATUI_VERSION = '(\d+)\.(\d+)';/g)];
assert.equal(versionMatches.length, 1, 'ChatUI must define exactly one visible major.minor version constant');

const major = Number(versionMatches[0][1]);
const minor = Number(versionMatches[0][2]);
assert.ok(Number.isSafeInteger(major) && major >= 0, 'ChatUI major version must be a non-negative integer');
assert.ok(Number.isSafeInteger(minor) && minor >= 0, 'ChatUI minor version must be a non-negative integer');
assert.match(apiConfig, /value\.textContent = CHATUI_VERSION;/, 'Settings must display the canonical ChatUI version constant');

for (let plan = 7; plan <= 16; plan += 1) {
  const path = `scripts/verify-chatui-plan${plan}.mjs`;
  const source = fs.readFileSync(path, 'utf8');
  assert.doesNotMatch(
    source,
    /CHATUI_VERSION\s*=\s*'\d+\.\d+'|Settings version must be \d+\.\d+/,
    `${path} must test its feature contract, not a specific release number`
  );
}

console.log(`ChatUI version contract verification passed (${major}.${minor}).`);
