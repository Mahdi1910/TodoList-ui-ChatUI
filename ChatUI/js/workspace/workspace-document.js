/**
 * workspace-document.js - Render shared sanitized Markdown into A4-style Workspace pages.
 */

import { renderMarkdown } from '../chat/markdown.js';

const A4_PAGE_HEIGHT_PX = 1123;
const A4_VERTICAL_PADDING_PX = 140;
const A4_CONTENT_HEIGHT_PX = A4_PAGE_HEIGHT_PX - A4_VERTICAL_PADDING_PX;

function createPage() {
  const page = document.createElement('article');
  page.className = 'workspace-page';
  const body = document.createElement('div');
  body.className = 'workspace-page-body';
  const markdown = document.createElement('div');
  markdown.className = 'markdown-content';
  markdown.setAttribute('dir', 'auto');
  body.appendChild(markdown);
  page.appendChild(body);
  return { page, body, markdown };
}

function extractTopLevelBlocks(markdownText) {
  const template = document.createElement('template');
  template.innerHTML = renderMarkdown(markdownText, { isFinal: true });
  const root = template.content.querySelector('.markdown-content');
  if (!root) return [];
  return [...root.children].map(element => element.cloneNode(true));
}

function appendMeasured(stage, blocks) {
  const pages = [];
  let current = createPage();
  stage.appendChild(current.page);

  const finishCurrentPage = () => {
    if (!pages.includes(current.page)) pages.push(current.page);
  };

  for (let index = 0; index < blocks.length; index += 1) {
    const block = blocks[index];
    current.markdown.appendChild(block);

    if (current.body.scrollHeight <= A4_CONTENT_HEIGHT_PX) continue;

    // If the first block cannot fit on an A4 body, keep it intact on an oversize page.
    // Correctness and readable content are preferred over clipping the block.
    if (current.markdown.children.length === 1) {
      current.page.classList.add('oversize');
      finishCurrentPage();
      current = createPage();
      stage.appendChild(current.page);
      continue;
    }

    current.markdown.removeChild(block);
    finishCurrentPage();
    current = createPage();
    stage.appendChild(current.page);
    current.markdown.appendChild(block);

    if (current.body.scrollHeight > A4_CONTENT_HEIGHT_PX) {
      current.page.classList.add('oversize');
      finishCurrentPage();
      current = createPage();
      stage.appendChild(current.page);
    }
  }

  if (current.markdown.children.length > 0 || pages.length === 0) finishCurrentPage();

  // Remove an unused staging page that may have been created after an oversize final block.
  [...stage.querySelectorAll('.workspace-page')].forEach(page => {
    if (!page.querySelector('.markdown-content')?.children.length && !pages.includes(page)) page.remove();
  });

  return pages;
}

export function renderWorkspaceDocument(markdownText, target = null) {
  const canvas = target || document.getElementById('workspace-document-canvas');
  const stage = document.getElementById('workspace-pagination-stage');
  if (!canvas || !stage) return { pageCount: 0 };

  stage.replaceChildren();
  canvas.replaceChildren();

  const blocks = extractTopLevelBlocks(markdownText);
  if (blocks.length === 0) {
    const { page } = createPage();
    canvas.appendChild(page);
    if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
    return { pageCount: 1 };
  }

  const stagedPages = appendMeasured(stage, blocks);
  stagedPages.forEach(stagedPage => canvas.appendChild(stagedPage.cloneNode(true)));
  stage.replaceChildren();

  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
  return { pageCount: stagedPages.length };
}
