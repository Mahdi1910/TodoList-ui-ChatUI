/**
 * app.js — Main Application Bootstrap & Module Orchestrator
 */

import { loadState } from './storage/storage.js';
import { initMarkdown } from './chat/markdown.js';
import { initSidebarUI, renderSidebar } from './sidebar/sidebar.js';
import { initComposerListeners, updateComposerButtons } from './composer/composer.js';
import { initAttachmentListeners } from './composer/attachments.js';
import { initRecorderListeners } from './composer/recorder.js';
import { initSettingsUI } from './settings/settings.js';
import { initVoiceUI } from './voice/voice-ui.js';
import { initReadAloud } from './voice/read-aloud.js';
import { initActionMenu } from './ui/action-menu.js';
import { initModalGlobalListeners } from './ui/modals.js';
import { initModelDropdownUI, initRightSidebarUI } from './ui/menus.js';
import { initSmartScrollControls, loadChat, startNewChat } from './chat/chat.js';
import { state } from './state/store.js';
import { initChatRouter, parseChatRoute } from './router/chat-router.js';
import { initWorkspaceUI } from './workspace/workspace-ui.js';
import './workspace/workspace-navigation-bridge.js';

function showBootstrapFailure(stage, error) {
  console.error(`ChatUI startup failed during ${stage}:`, error);

  const existing = document.getElementById('startup-error');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = 'startup-error';
  overlay.className = 'startup-error-overlay';
  overlay.setAttribute('role', 'alert');
  const message = error instanceof Error ? error.message : String(error || 'Unknown startup error');
  overlay.innerHTML = `
    <div class="startup-error-card">
      <h1 class="startup-error-title">ChatUI could not finish starting</h1>
      <p class="startup-error-description">Initialization stopped during <strong>${stage}</strong>.</p>
      <pre class="startup-error-details">${message.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char])}</pre>
      <button id="startup-retry-btn" class="startup-retry-btn" type="button">Reload ChatUI</button>
    </div>`;
  document.body.appendChild(overlay);
  document.getElementById('startup-retry-btn')?.addEventListener('click', () => window.location.reload());
}

const STARTUP_DEADLINE_MS = 15000;
let startupDeadlineAt = 0;
let startupFailed = false;

function startupIsActive() {
  return !startupFailed && Date.now() < startupDeadlineAt;
}

async function runBootstrapStep(name, fn, { asyncStartup = false } = {}) {
  if (!startupIsActive()) {
    const error = new Error(`ChatUI startup exceeded its overall ${STARTUP_DEADLINE_MS / 1000}-second deadline before ${name}.`);
    startupFailed = true;
    showBootstrapFailure(name, error);
    throw error;
  }

  let timedOut = false;
  const remainingMs = Math.max(0, startupDeadlineAt - Date.now());
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    startupFailed = true;
    showBootstrapFailure(name, new Error(`ChatUI startup exceeded its overall ${STARTUP_DEADLINE_MS / 1000}-second deadline during ${name}.`));
  }, remainingMs);

  try {
    console.debug(`[ChatUI startup] ${name}`);
    const result = asyncStartup
      ? await fn({ isActive: startupIsActive })
      : await fn();
    if (timedOut || !startupIsActive()) {
      throw new Error(`ChatUI startup exceeded its overall ${STARTUP_DEADLINE_MS / 1000}-second deadline during ${name}.`);
    }
    return result;
  } catch (error) {
    if (!startupFailed) {
      startupFailed = true;
      showBootstrapFailure(name, error);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

async function handleRoute(route, { startup = false } = {}) {
  if (route.type === 'chat') {
    const exists = state.chats.some(chat => chat.id === route.chatId);
    if (!exists) {
      alert('Chat not available in this browser. It may have been deleted, cleared, or saved on another device.');
      startNewChat(renderSidebar, null, { historyMode: 'replace' });
      return;
    }
    await loadChat(route.chatId, renderSidebar, { historyMode: 'none' });
    return;
  }

  if (route.type === 'home') {
    if (startup && state.activeChatId && state.chats.some(chat => chat.id === state.activeChatId)) {
      const restored = await loadChat(state.activeChatId, renderSidebar, { historyMode: 'replace' });
      if (restored) return;
    }
    startNewChat(renderSidebar, startup ? state.activeProjectId : null, { historyMode: 'none' });
    return;
  }

  alert('This ChatUI URL is not recognized. Returning to a new chat.');
  startNewChat(renderSidebar, null, { historyMode: 'replace' });
}

async function bootstrapApp() {
  startupDeadlineAt = Date.now() + STARTUP_DEADLINE_MS;
  await runBootstrapStep('Markdown initialization', () => initMarkdown());
  await runBootstrapStep('IndexedDB metadata loading', ({ isActive }) => loadState({ isActive }), { asyncStartup: true });
  await runBootstrapStep('Action menu initialization', () => initActionMenu());
  await runBootstrapStep('Sidebar initialization', () => initSidebarUI());
  await runBootstrapStep('Workspace initialization', () => initWorkspaceUI());
  await runBootstrapStep('Chat router initialization', () => {
    initChatRouter(route => {
      void handleRoute(route, { startup: false });
    });
  });
  await runBootstrapStep('Route restoration', () => handleRoute(parseChatRoute(), { startup: true }));
  await runBootstrapStep('Composer initialization', () => initComposerListeners(renderSidebar));

  const attachFileBtn = document.getElementById('attach-file-btn');
  const fileAttachmentInput = document.getElementById('file-attachment-input');
  await runBootstrapStep('Attachment initialization', () => initAttachmentListeners(attachFileBtn, fileAttachmentInput, updateComposerButtons));

  const recordAudioBtn = document.getElementById('record-audio-btn');
  await runBootstrapStep('Recorder initialization', () => initRecorderListeners(recordAudioBtn));
  await runBootstrapStep('Settings initialization', () => initSettingsUI());
  await runBootstrapStep('Read Aloud initialization', () => initReadAloud());
  await runBootstrapStep('Voice UI initialization', () => initVoiceUI(renderSidebar));
  await runBootstrapStep('Model/menu initialization', () => initModelDropdownUI());
  await runBootstrapStep('Right sidebar initialization', () => initRightSidebarUI(renderSidebar));
  await runBootstrapStep('Modal initialization', () => initModalGlobalListeners());
  await runBootstrapStep('Smart-scroll initialization', () => initSmartScrollControls());
  await runBootstrapStep('Composer button synchronization', () => updateComposerButtons());
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bootstrapApp, { once: true });
} else {
  bootstrapApp();
}
