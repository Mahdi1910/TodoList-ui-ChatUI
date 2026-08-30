import assert from 'node:assert/strict';
import fs from 'node:fs';
import { isUnsafeMarkdownUrl } from '../ChatUI/js/chat/markdown.js';

for (const value of [
  'javascript:alert(1)',
  'java\tscript:alert(1)',
  'java\nscript:alert(1)',
  'java\rscript:alert(1)',
  'java\u0000script:alert(1)',
  'vbscript:msgbox(1)',
  'data:text/html,<script>alert(1)</script>',
  'file:///etc/passwd'
]) {
  assert.equal(isUnsafeMarkdownUrl(value), true, `dangerous Markdown URL must be blocked: ${JSON.stringify(value)}`);
}

for (const value of [
  'https://example.com/path',
  'http://example.com/',
  '/relative/path',
  './relative/path',
  '#section',
  'mailto:test@example.com'
]) {
  assert.equal(isUnsafeMarkdownUrl(value), false, `normal Markdown URL must remain allowed: ${JSON.stringify(value)}`);
}

const source = fs.readFileSync('ChatUI/js/chat/markdown.js', 'utf8');
assert.match(source, /name === 'href' \|\| name === 'src' \|\| name === 'xlink:href'/, 'sanitizer must inspect navigable/resource URL attributes');
assert.match(source, /isUnsafeMarkdownUrl\(attr\.value\)/, 'sanitizer must apply the normalized protocol check to URL attributes');

console.log('ChatUI Markdown URL sanitizer verification passed.');
