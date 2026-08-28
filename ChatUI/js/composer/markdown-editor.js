/**
 * markdown-editor.js — Single-surface Milkdown composer adapter.
 *
 * ChatUI's application boundary remains Markdown strings. Milkdown/ProseMirror
 * internals stay isolated in this module.
 */

import {
  Editor,
  defaultValueCtx,
  editorViewCtx,
  editorViewOptionsCtx,
  rootCtx,
  commonmark,
  gfm,
  history,
  clipboard,
  listener,
  listenerCtx,
  getMarkdown,
  replaceAll
} from '../vendor/milkdown-composer.runtime.js';
import {
  COMPOSER_PASTE_ENTER_GUARD_MS,
  normalizePastedComposerText
} from './paste-normalization.js';

let editor = null;
let editorHost = null;
let currentMarkdown = '';
let ready = false;
let submitCallback = null;
let changeCallback = null;
let compositionActive = false;
let directionFrame = null;
let editorDom = null;
let suppressPasteEnterUntil = 0;

function normalizeMarkdown(value) {
  return typeof value === 'string' ? value : String(value ?? '');
}

function editorAttributes(previous = {}) {
  const previousClass = typeof previous.class === 'string' ? previous.class.trim() : '';
  return {
    ...previous,
    class: [previousClass, 'composer-prosemirror'].filter(Boolean).join(' '),
    role: 'textbox',
    'aria-label': 'Message',
    'aria-multiline': 'true',
    'aria-placeholder': 'Ask anything',
    dir: 'auto',
    spellcheck: 'true'
  };
}

function markdownImageLabel(node) {
  const alt = normalizeMarkdown(node?.attrs?.alt).replace(/\]/g, '\\]');
  const src = normalizeMarkdown(node?.attrs?.src);
  const title = normalizeMarkdown(node?.attrs?.title);
  return `![${alt}](${src}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
}

function safeImageNodeView(node) {
  const dom = document.createElement('span');
  dom.className = 'composer-image-markdown';
  dom.setAttribute('contenteditable', 'false');
  dom.setAttribute('role', 'img');

  const render = nextNode => {
    dom.textContent = markdownImageLabel(nextNode);
    const alt = normalizeMarkdown(nextNode?.attrs?.alt).trim();
    dom.setAttribute('aria-label', alt ? `Markdown image: ${alt}` : 'Markdown image');
    dom.title = 'Remote images are not loaded in the composer. Send as an attachment to include image content.';
  };
  render(node);

  return {
    dom,
    update(nextNode) {
      if (nextNode.type !== node.type) return false;
      render(nextNode);
      return true;
    }
  };
}

function selectionIsTopLevelParagraph(view) {
  const selection = view?.state?.selection;
  if (!selection?.$from) return false;
  const { $from } = selection;
  return $from.depth === 1 && $from.parent?.type?.name === 'paragraph';
}

function requestSubmit() {
  if (typeof submitCallback !== 'function') return;
  queueMicrotask(() => {
    try {
      const result = submitCallback();
      if (result && typeof result.catch === 'function') {
        result.catch(error => console.error('Composer submit failed:', error));
      }
    } catch (error) {
      console.error('Composer submit failed:', error);
    }
  });
}

function markComposerPaste() {
  suppressPasteEnterUntil = Date.now() + COMPOSER_PASTE_ENTER_GUARD_MS;
}

function handleComposerKeyDown(view, event) {
  if (event.key !== 'Enter') return false;
  if (compositionActive || event.isComposing || view?.composing) return false;

  // Some mobile keyboards/clipboard integrations emit an Enter key event as part
  // of paste completion. Consume that event without submitting or inserting an
  // extra line. A normal user Enter after the short paste window keeps the
  // existing submit behavior unchanged.
  if (Date.now() < suppressPasteEnterUntil) return true;

  const modifierSubmit = (event.ctrlKey || event.metaKey) && !event.altKey;
  if (modifierSubmit) {
    if (!event.repeat) requestSubmit();
    return true;
  }

  if (event.shiftKey || event.altKey) return false;
  if (!selectionIsTopLevelParagraph(view)) return false;

  if (!event.repeat) requestSubmit();
  return true;
}

function syncDirectionAttributes() {
  if (!editorHost) return;
  if (directionFrame !== null) cancelAnimationFrame(directionFrame);
  directionFrame = requestAnimationFrame(() => {
    directionFrame = null;
    if (!editorHost) return;
    const root = editorHost.querySelector('.ProseMirror');
    root?.setAttribute('dir', 'auto');
    editorHost
      .querySelectorAll('p, h1, h2, h3, h4, h5, h6, ul, ol, li, blockquote, th, td')
      .forEach(element => element.setAttribute('dir', 'auto'));
    editorHost
      .querySelectorAll('pre, code')
      .forEach(element => element.setAttribute('dir', 'ltr'));
  });
}

function syncEmptyState() {
  editorHost?.classList.toggle('is-empty', !currentMarkdown.trim());
}

function handleMarkdownUpdated(markdown, previousMarkdown = null) {
  currentMarkdown = normalizeMarkdown(markdown);
  syncEmptyState();
  syncDirectionAttributes();
  if (previousMarkdown !== null && currentMarkdown !== previousMarkdown && typeof changeCallback === 'function') {
    changeCallback(currentMarkdown);
  }
}

function preventComposerLinkNavigation(event) {
  if (event.target?.closest?.('a')) event.preventDefault();
}

function handleCompositionStart() {
  compositionActive = true;
}

function handleCompositionEnd() {
  compositionActive = false;
}

function attachEditorDomListeners() {
  if (!editor) return;
  editorDom = editor.action(ctx => ctx.get(editorViewCtx)?.dom || null);
  if (!editorDom) return;

  editorDom.setAttribute('role', 'textbox');
  editorDom.setAttribute('aria-label', 'Message');
  editorDom.setAttribute('aria-multiline', 'true');
  editorDom.setAttribute('aria-placeholder', 'Ask anything');
  editorDom.setAttribute('dir', 'auto');
  editorDom.addEventListener('paste', markComposerPaste, true);
  editorDom.addEventListener('compositionstart', handleCompositionStart);
  editorDom.addEventListener('compositionend', handleCompositionEnd);
  editorDom.addEventListener('click', preventComposerLinkNavigation);
}

function detachEditorDomListeners() {
  if (!editorDom) return;
  editorDom.removeEventListener('paste', markComposerPaste, true);
  editorDom.removeEventListener('compositionstart', handleCompositionStart);
  editorDom.removeEventListener('compositionend', handleCompositionEnd);
  editorDom.removeEventListener('click', preventComposerLinkNavigation);
  editorDom = null;
  compositionActive = false;
  suppressPasteEnterUntil = 0;
}

export async function initMarkdownComposer(options = {}) {
  if (editor) await destroyComposer();

  editorHost = options.host || document.getElementById('composer-editor-host');
  if (!editorHost) throw new Error('Markdown composer host is missing.');

  submitCallback = typeof options.onSubmit === 'function' ? options.onSubmit : null;
  changeCallback = typeof options.onChange === 'function' ? options.onChange : null;
  currentMarkdown = normalizeMarkdown(options.initialMarkdown || '');
  ready = false;
  editorHost.classList.add('is-initializing');
  syncEmptyState();

  const instance = Editor.make()
    .config(ctx => {
      ctx.set(rootCtx, editorHost);
      ctx.set(defaultValueCtx, currentMarkdown);
      ctx.update(editorViewOptionsCtx, previous => ({
        ...previous,
        attributes: editorAttributes(previous?.attributes),
        nodeViews: {
          ...(previous?.nodeViews || {}),
          image: safeImageNodeView
        },
        transformPastedText(text, plain, view) {
          const transformed = typeof previous?.transformPastedText === 'function'
            ? previous.transformPastedText(text, plain, view)
            : text;
          return normalizePastedComposerText(transformed);
        },
        handleKeyDown(view, event) {
          if (handleComposerKeyDown(view, event)) return true;
          return typeof previous?.handleKeyDown === 'function'
            ? previous.handleKeyDown(view, event)
            : false;
        }
      }));

      ctx.get(listenerCtx).markdownUpdated((_ctx, markdown, previousMarkdown) => {
        handleMarkdownUpdated(markdown, previousMarkdown);
      });
    })
    .use(commonmark)
    .use(gfm)
    .use(history)
    .use(clipboard)
    .use(listener);

  editor = await instance.create();
  ready = true;
  editorHost.classList.remove('is-initializing');
  currentMarkdown = normalizeMarkdown(editor.action(getMarkdown()));
  attachEditorDomListeners();
  syncEmptyState();
  syncDirectionAttributes();
  return editor;
}

export function getComposerMarkdown() {
  if (!editor || !ready) return currentMarkdown;
  currentMarkdown = normalizeMarkdown(editor.action(getMarkdown()));
  syncEmptyState();
  return currentMarkdown;
}

export function setComposerMarkdown(markdown, options = {}) {
  const nextMarkdown = normalizeMarkdown(markdown);
  currentMarkdown = nextMarkdown;

  if (editor && ready) {
    editor.action(replaceAll(nextMarkdown, options.resetHistory !== false));
    currentMarkdown = normalizeMarkdown(editor.action(getMarkdown()));
  }

  syncEmptyState();
  syncDirectionAttributes();
  if (options.focus) focusComposer();
  return currentMarkdown;
}

export function clearComposer(options = {}) {
  return setComposerMarkdown('', {
    resetHistory: true,
    focus: Boolean(options.focus)
  });
}

export function isComposerEmpty() {
  return !getComposerMarkdown().trim();
}

export function focusComposer() {
  if (!editor || !ready) return false;
  const view = editor.action(ctx => ctx.get(editorViewCtx));
  view?.focus();
  return Boolean(view);
}

export function isComposerReady() {
  return ready && Boolean(editor);
}

export async function destroyComposer() {
  if (directionFrame !== null) {
    cancelAnimationFrame(directionFrame);
    directionFrame = null;
  }
  detachEditorDomListeners();
  const oldEditor = editor;
  editor = null;
  ready = false;
  currentMarkdown = '';
  submitCallback = null;
  changeCallback = null;
  suppressPasteEnterUntil = 0;
  if (oldEditor) await oldEditor.destroy();
  if (editorHost) {
    editorHost.classList.remove('is-initializing', 'is-empty');
    editorHost = null;
  }
}
