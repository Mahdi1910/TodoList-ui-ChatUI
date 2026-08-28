/**
 * composer.js — Rich Markdown composer, tools, and send/stop button state.
 */

import { state, setState, runtime } from '../state/store.js';
import { persistSettings } from '../storage/storage.js';
import { sendMessage } from '../chat/chat.js';
import { initMarkdownComposer, isComposerEmpty } from './markdown-editor.js';
import { isTodoBridgeSupported } from '../todo/todo-bridge-client.js';

const TOOL_DESCRIPTORS = Object.freeze([
  { key: 'googleSearch', icon: 'search', label: 'Google Search', toggle: 'toggle-google-search', sidebarToggle: 'sidebar-toggle-google-search' },
  { key: 'urlContext', icon: 'link', label: 'URL Context', toggle: 'toggle-url-context', sidebarToggle: 'sidebar-toggle-url-context' },
  { key: 'codeExecution', icon: 'code-2', label: 'Code Execution', toggle: 'toggle-code-execution', sidebarToggle: 'sidebar-toggle-code-execution' },
  { key: 'workspace', icon: 'folder-tree', label: 'Workspace', toggle: 'toggle-workspace', sidebarToggle: 'sidebar-toggle-workspace' },
  { key: 'todo', icon: 'list-todo', label: 'To-Do', toggle: 'toggle-todo', sidebarToggle: 'sidebar-toggle-todo' }
]);
let todoSupportListenerInstalled = false;

function toolAvailable(key) {
  return key !== 'todo' || isTodoBridgeSupported();
}

export function updateComposerButtons() {
  const sendBtn = document.getElementById('send-btn');
  const startVoiceBtn = document.getElementById('open-voice-mode-btn');
  const stopGeneratingBtn = document.getElementById('stop-generating-btn');
  if (!sendBtn || !startVoiceBtn || !stopGeneratingBtn) return;

  const hasText = !isComposerEmpty();

  if (runtime.isGenerating) {
    sendBtn.classList.add('hidden');
    startVoiceBtn.classList.add('hidden');
    stopGeneratingBtn.classList.remove('hidden');
    return;
  }

  stopGeneratingBtn.classList.add('hidden');
  const hasAttachments = runtime.attachedFiles.length > 0;
  const shouldShowSend = hasText || hasAttachments || runtime.isRecordingAudio;

  if (shouldShowSend) {
    sendBtn.classList.remove('hidden');
    startVoiceBtn.classList.add('hidden');
  } else {
    sendBtn.classList.add('hidden');
    startVoiceBtn.classList.remove('hidden');
  }
}

function syncToolToggle(id, key, tools) {
  const input = document.getElementById(id);
  if (!input) return;
  const available = toolAvailable(key);
  input.checked = !!tools[key];
  input.disabled = !available;
  const card = input.closest('.tool-option, .sidebar-tool-card');
  card?.classList.toggle('tool-unavailable', !available);
  card?.setAttribute('aria-disabled', available ? 'false' : 'true');
  if (!available && key === 'todo') input.title = 'To-Do tools are available only inside the combined Chat + Todo application.';
  else input.removeAttribute('title');
}

export function renderToolsUI() {
  const tools = state.tools || {};
  TOOL_DESCRIPTORS.forEach(tool => {
    syncToolToggle(tool.toggle, tool.key, tools);
    syncToolToggle(tool.sidebarToggle, tool.key, tools);
  });

  const activeIndicators = document.getElementById('active-tools-indicators');
  if (!activeIndicators) return;
  activeIndicators.innerHTML = '';

  TOOL_DESCRIPTORS
    .filter(tool => tools[tool.key] && toolAvailable(tool.key))
    .forEach(pill => {
      const btn = document.createElement('button');
      btn.className = 'tool-indicator-pill';
      btn.dataset.toolKey = pill.key;
      btn.title = `${pill.label} (Click to turn off)`;
      btn.setAttribute('aria-label', `Turn off ${pill.label}`);
      btn.innerHTML = `<span class="pill-icon"><i data-lucide="${pill.icon}"></i></span>`;
      btn.addEventListener('click', async e => {
        e.stopPropagation();
        setState({ tools: { ...state.tools, [pill.key]: false } });
        renderToolsUI();
        try { await persistSettings(); }
        catch (err) { console.error('Failed to save tools state:', err); }
      });
      activeIndicators.appendChild(btn);
    });

  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

export function initToolsMenuListeners() {
  const toolsBtn = document.getElementById('tools-menu-btn');
  const toolsMenu = document.getElementById('tools-popup-menu');
  const closeBtn = document.getElementById('close-tools-menu-btn');

  renderToolsUI();
  if (!todoSupportListenerInstalled) {
    todoSupportListenerInstalled = true;
    window.addEventListener('todo-bridge-support-changed', () => renderToolsUI());
  }

  if (toolsBtn && toolsMenu) {
    toolsBtn.addEventListener('click', e => {
      e.stopPropagation();
      const isHidden = toolsMenu.classList.contains('hidden');
      if (isHidden) {
        toolsMenu.classList.remove('hidden');
        toolsMenu.removeAttribute('hidden');
        toolsBtn.setAttribute('aria-expanded', 'true');
      } else {
        toolsMenu.classList.add('hidden');
        toolsMenu.setAttribute('hidden', '');
        toolsBtn.setAttribute('aria-expanded', 'false');
      }
    });
  }

  if (closeBtn && toolsMenu) {
    closeBtn.addEventListener('click', () => {
      toolsMenu.classList.add('hidden');
      toolsMenu.setAttribute('hidden', '');
      toolsBtn?.setAttribute('aria-expanded', 'false');
    });
  }

  const handleToggle = async (key, checked) => {
    if (checked && !toolAvailable(key)) {
      renderToolsUI();
      return;
    }
    setState({ tools: { ...state.tools, [key]: checked } });
    renderToolsUI();
    try { await persistSettings(); }
    catch (err) { console.error('Failed to save tools state:', err); }
  };

  TOOL_DESCRIPTORS.forEach(tool => {
    const composerToggle = document.getElementById(tool.toggle);
    composerToggle?.addEventListener('change', e => handleToggle(tool.key, e.target.checked));
    document.getElementById(tool.sidebarToggle)?.addEventListener('change', e => handleToggle(tool.key, e.target.checked));

    const row = composerToggle?.closest('.tool-option');
    row?.addEventListener('click', event => {
      // The switch label already toggles its checkbox natively. Everywhere else
      // in the row is also a finger target, without double-toggling the switch.
      if (event.target.closest?.('.toggle-switch') || composerToggle.disabled) return;
      composerToggle.checked = !composerToggle.checked;
      composerToggle.dispatchEvent(new Event('change', { bubbles: true }));
    });
  });

  document.addEventListener('click', e => {
    if (toolsMenu && !toolsMenu.contains(e.target) && e.target !== toolsBtn) {
      toolsMenu.classList.add('hidden');
      toolsMenu.setAttribute('hidden', '');
      toolsBtn?.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && toolsMenu && !toolsMenu.classList.contains('hidden')) {
      toolsMenu.classList.add('hidden');
      toolsMenu.setAttribute('hidden', '');
      toolsBtn?.setAttribute('aria-expanded', 'false');
    }
  });
}

export async function initComposerListeners(updateSidebarCallback = null) {
  const sendBtn = document.getElementById('send-btn');
  const editorHost = document.getElementById('composer-editor-host');
  if (!editorHost) throw new Error('Composer editor host is missing.');

  initToolsMenuListeners();
  await initMarkdownComposer({
    host: editorHost,
    onChange: () => updateComposerButtons(),
    onSubmit: () => sendMessage(updateSidebarCallback)
  });

  sendBtn?.addEventListener('click', () => sendMessage(updateSidebarCallback));
  updateComposerButtons();
}
