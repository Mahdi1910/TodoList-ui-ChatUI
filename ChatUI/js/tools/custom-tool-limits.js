/**
 * custom-tool-limits.js - One validation contract for client custom-tool rounds.
 */

export const DEFAULT_CUSTOM_TOOL_ROUND_LIMIT = 24;
export const MAX_CUSTOM_CALLS_PER_ROUND = 16;

export function normalizeCustomToolRoundLimit(value, fallback = DEFAULT_CUSTOM_TOOL_ROUND_LIMIT) {
  const numeric = typeof value === 'number' ? value : Number(String(value ?? '').trim());
  if (numeric === -1) return -1;
  if (Number.isSafeInteger(numeric) && numeric >= 1) return numeric;
  return fallback;
}

export function isValidCustomToolRoundLimit(value) {
  const text = String(value ?? '').trim();
  if (!text) return false;
  const numeric = Number(text);
  return numeric === -1 || (Number.isSafeInteger(numeric) && numeric >= 1);
}

export function customToolRoundLimitError() {
  return 'Enter -1 for unlimited, or a whole number of 1 or greater.';
}
