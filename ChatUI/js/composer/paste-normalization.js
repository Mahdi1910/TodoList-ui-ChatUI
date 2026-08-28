export const COMPOSER_PASTE_ENTER_GUARD_MS = 400;

const CLIPBOARD_LINE_SEPARATOR_RE = /\r\n?|\u2028|\u2029|\u0085/g;

export function normalizePastedComposerText(value) {
  const normalized = (typeof value === 'string' ? value : String(value ?? ''))
    .replace(CLIPBOARD_LINE_SEPARATOR_RE, '\n');

  // Preserve intentional internal line breaks, but discard newline/Enter markers
  // at the very end of clipboard text so a copied trailing return never becomes
  // a new empty paragraph in the composer.
  return normalized.replace(/\n+[\t ]*$/, '');
}
