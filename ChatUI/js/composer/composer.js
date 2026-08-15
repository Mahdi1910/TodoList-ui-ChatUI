/**
 * composer.js — Textarea Auto-Resize, Enter Key & Dynamic Send/Stop Button State
 */

import { state, setState, runtime } from '../state/store.js';
import { persistSettings } from '../storage/storage.js';
import { sendMessage } from '../chat/chat.js';

export function updateComposerButtons() {
  const composerTextarea = document.getElementById('composer-textarea');
  const sendBtn = document.getElementById('send-btn');
  const startVoiceBtn = document.getElementById('open-voice-mode-btn');
  const stopGeneratingBtn = document.getElementById('stop-generating-btn');

  if (!sendBtn || !startVoiceBtn || !stopGeneratingBtn) return;

  if (runtime.isGenerating) {
    sendBtn.classList.add('hidden');
    startVoiceBtn.classList.add('hidden');
    stopGeneratingBtn.classList.remove('hidden');
    return;
  }

  stopGeneratingBtn.classList.add('hidden');

  const hasText = composerTextarea ? composerTextarea.value.trim().length > 0 : false;
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

export function renderToolsUI() {
  const tools = state.tools || { googleSearch: false, urlContext: false, codeExecution: false, workspace: false };
  const toggleGoogleSearch = document.getElementById('toggle-google-search');
  const toggleUrlContext = document.getElementById('toggle-url-context');
  const toggleCodeExecution = document.getElementById('toggle-code-execution');
  const toggleWorkspace = document.getElementById('toggle-workspace');

  const sidebarToggleGoogleSearch = document.getElementById('sidebar-toggle-google-search');
  const sidebarToggleUrlContext = document.getElementById('sidebar-toggle-url-context');
  const sidebarToggleCodeExecution = document.getElementById('sidebar-toggle-code-execution');
  const sidebarToggleWorkspace = document.getElementById('sidebar-toggle-workspace');

  const activeIndicators = document.getElementById('active-tools-indicators');

  if (toggleGoogleSearch) toggleGoogleSearch.checked = !!tools.googleSearch;
  if (toggleUrlContext) toggleUrlContext.checked = !!tools.urlContext;
  if (toggleCodeExecution) toggleCodeExecution.checked = !!tools.codeExecution;
  if (toggleWorkspace) toggleWorkspace.checked = !!tools.workspace;

  if (sidebarToggleGoogleSearch) sidebarToggleGoogleSearch.checked = !!tools.googleSearch;
  if (sidebarToggleUrlContext) sidebarToggleUrlContext.checked = !!tools.urlContext;
  if (sidebarToggleCodeExecution) sidebarToggleCodeExecution.checked = !!tools.codeExecution;
  if (sidebarToggleWorkspace) sidebarToggleWorkspace.checked = !!tools.workspace;

  if (!activeIndicators) return;

  activeIndicators.innerHTML = '';

  const activePills = [];
  if (tools.googleSearch) activePills.push({ key: 'googleSearch', icon: 'search', label: 'Google Search' });
  if (tools.urlContext) activePills.push({ key: 'urlContext', icon: 'link', label: 'URL Context' });
  if (tools.codeExecution) activePills.push({ key: 'codeExecution', icon: 'code-2', label: 'Code Execution' });
  if (tools.workspace) activePills.push({ key: 'workspace', icon: 'folder-tree', label: 'Workspace' });

  activePills.forEach(pill => {
    const btn = document.createElement('button');
    btn.className = 'tool-indicator-pill';
    btn.dataset.toolKey = pill.key;
    btn.title = `${pill.label} (Click to turn off)`;
    btn.setAttribute('aria-label', `Turn off ${pill.label}`);
    btn.innerHTML = `<span class="pill-icon"><i data-lucide="${pill.icon}"></i></span>`;

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      setState({ tools: { ...state.tools, [pill.key]: false } });
      renderToolsUI();
      try {
        await persistSettings();
      } catch (err) {
        console.error('Failed to save tools state:', err);
      }
    });

    activeIndicators.appendChild(btn);
  });

  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

export function initToolsMenuListeners() {
  const toolsBtn = document.getElementById('tools-menu-btn');
  const toolsMenu = document.getElementById('tools-popup-menu');
  const closeBtn = document.getElementById('close-tools-menu-btn');
  const toggleGoogleSearch = document.getElementById('toggle-google-search');
  const toggleUrlContext = document.getElementById('toggle-url-context');
  const toggleCodeExecution = document.getElementById('toggle-code-execution');
  const toggleWorkspace = document.getElementById('toggle-workspace');

  const sidebarToggleGoogleSearch = document.getElementById('sidebar-toggle-google-search');
  const sidebarToggleUrlContext = document.getElementById('sidebar-toggle-url-context');
  const sidebarToggleCodeExecution = document.getElementById('sidebar-toggle-code-execution');
  const sidebarToggleWorkspace = document.getElementById('sidebar-toggle-workspace');

  renderToolsUI();

  if (toolsBtn && toolsMenu) {
    toolsBtn.addEventListener('click', (e) => {
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
    setState({ tools: { ...state.tools, [key]: checked } });
    renderToolsUI();
    try {
      await persistSettings();
    } catch (err) {
      console.error('Failed to save tools state:', err);
    }
  };

  if (toggleGoogleSearch) toggleGoogleSearch.addEventListener('change', (e) => handleToggle('googleSearch', e.target.checked));
  if (toggleUrlContext) toggleUrlContext.addEventListener('change', (e) => handleToggle('urlContext', e.target.checked));
  if (toggleCodeExecution) toggleCodeExecution.addEventListener('change', (e) => handleToggle('codeExecution', e.target.checked));
  if (toggleWorkspace) toggleWorkspace.addEventListener('change', (e) => handleToggle('workspace', e.target.checked));

  if (sidebarToggleGoogleSearch) sidebarToggleGoogleSearch.addEventListener('change', (e) => handleToggle('googleSearch', e.target.checked));
  if (sidebarToggleUrlContext) sidebarToggleUrlContext.addEventListener('change', (e) => handleToggle('urlContext', e.target.checked));
  if (sidebarToggleCodeExecution) sidebarToggleCodeExecution.addEventListener('change', (e) => handleToggle('codeExecution', e.target.checked));
  if (sidebarToggleWorkspace) sidebarToggleWorkspace.addEventListener('change', (e) => handleToggle('workspace', e.target.checked));

  document.addEventListener('click', (e) => {
    if (toolsMenu && !toolsMenu.contains(e.target) && e.target !== toolsBtn) {
      toolsMenu.classList.add('hidden');
      toolsMenu.setAttribute('hidden', '');
      toolsBtn?.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && toolsMenu && !toolsMenu.classList.contains('hidden')) {
      toolsMenu.classList.add('hidden');
      toolsMenu.setAttribute('hidden', '');
      toolsBtn?.setAttribute('aria-expanded', 'false');
    }
  });
}

export function initComposerListeners(updateSidebarCallback = null) {
  const composerTextarea = document.getElementById('composer-textarea');
  const sendBtn = document.getElementById('send-btn');

  initToolsMenuListeners();

  if (composerTextarea) {
    composerTextarea.addEventListener('input', () => {
      composerTextarea.style.height = 'auto';
      composerTextarea.style.height = `${Math.min(composerTextarea.scrollHeight, 200)}px`;
      updateComposerButtons();
    });

    composerTextarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(updateSidebarCallback);
      }
    });
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', () => {
      sendMessage(updateSidebarCallback);
    });
  }
}
