/*
 * text-api-key-input.js — Normalize multiline API key text from desktop and mobile clipboards.
 */

const NON_LF_LINE_BREAKS = /\r\n|[\r\u0085\u2028\u2029]/g;

export function normalizeMultilineApiKeyText(value) {
  return String(value ?? '').replace(NON_LF_LINE_BREAKS, '\n');
}
