const HTML_ESCAPE = Object.freeze({
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;'
});

export function escapeHtml(value = '') {
  return String(value ?? '').replace(/[&<>"']/g, char => HTML_ESCAPE[char]);
}

export function safeFontAwesomeClass(value, fallback = 'fa-cloud') {
  const candidate = String(value || '');
  return /^fa-[a-z0-9-]+$/i.test(candidate) ? candidate : fallback;
}

export function renderBasicBoldHtml(value = '') {
  return escapeHtml(value).replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}
