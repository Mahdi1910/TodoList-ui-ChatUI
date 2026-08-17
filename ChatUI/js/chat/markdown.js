/**
 * markdown.js — marked.js Configuration, Highlight.js, HTML Sanitizer & Code Block Cards
 */

import { escapeHtml, copyTextToClipboard } from '../utils/dom.js';

function sanitizeHtml(html) {
  if (!html) return '';
  const template = document.createElement('template');
  template.innerHTML = html;

  template.content.querySelectorAll('script, iframe, object, embed, svg, math, style, base, meta, link, form').forEach(el => el.remove());
  template.content.querySelectorAll('*').forEach(el => {
    Array.from(el.attributes).forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = attr.value.trim().toLowerCase();
      if (name.startsWith('on') || name === 'srcdoc' || name === 'style') {
        el.removeAttribute(attr.name);
        return;
      }
      if ((name === 'href' || name === 'src' || name === 'xlink:href') && /^(?:javascript|vbscript|data|file):/i.test(value)) {
        el.removeAttribute(attr.name);
      }
    });
  });
  return template.innerHTML;
}

let currentHighlightingEnabled = true;

export function initMarkdown() {
  if (typeof marked !== 'undefined') {
    const renderer = new marked.Renderer();
    renderer.code = function(codeToken, languageToken) {
      const code = typeof codeToken === 'string' ? codeToken : (codeToken?.text ?? codeToken?.raw ?? '');
      const language = typeof languageToken === 'string' ? languageToken : (codeToken?.lang ?? '');
      const validLang = language && typeof hljs !== 'undefined' && hljs.getLanguage(language) ? language : '';
      let highlighted = code;

      if (currentHighlightingEnabled && validLang && typeof hljs !== 'undefined') {
        try { highlighted = hljs.highlight(code, { language: validLang }).value; }
        catch (_) { highlighted = escapeHtml(code); }
      } else {
        highlighted = escapeHtml(code);
      }

      const langLabel = validLang || 'code';
      const encodedCode = encodeURIComponent(code);
      return `
        <div class="code-block-wrapper" dir="ltr">
          <div class="code-block-header">
            <span>${langLabel}</span>
            <button class="copy-code-btn" data-code="${encodedCode}">
              <i data-lucide="copy"></i> Copy code
            </button>
          </div>
          <pre><code class="hljs ${validLang}">${highlighted}</code></pre>
        </div>`;
    };
    marked.setOptions({ renderer, breaks: true });
  }

  document.addEventListener('click', async e => {
    const btn = e.target.closest('.copy-code-btn');
    if (!btn) return;

    const code = decodeURIComponent(btn.getAttribute('data-code') || '');
    const copied = await copyTextToClipboard(code);
    if (!copied) {
      btn.title = 'Copy failed';
      return;
    }

    btn.title = 'Copied!';
    btn.innerHTML = '<i data-lucide="check"></i> Copied!';
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    setTimeout(() => {
      btn.title = 'Copy code';
      btn.innerHTML = '<i data-lucide="copy"></i> Copy code';
      if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    }, 2000);
  });
}

export function renderMarkdown(text, options = {}) {
  const isFinal = options.isFinal !== false;
  currentHighlightingEnabled = isFinal;

  if (typeof marked !== 'undefined' && marked.parse) {
    const sanitized = sanitizeHtml(marked.parse(text || ''));
    const template = document.createElement('template');
    template.innerHTML = sanitized;

    template.content.querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, li, th, td, blockquote').forEach(el => {
      el.setAttribute('dir', 'auto');
    });
    template.content.querySelectorAll('.code-block-wrapper, pre, code').forEach(el => {
      el.setAttribute('dir', 'ltr');
    });

    return `<div class="markdown-content" dir="auto">${template.innerHTML}</div>`;
  }
  return `<div class="markdown-content" dir="auto">${escapeHtml(text || '')}</div>`;
}