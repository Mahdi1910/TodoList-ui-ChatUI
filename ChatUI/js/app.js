/**
 * app.js — Explicit ChatUI bootstrap and route orchestrator.
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
import { initWorkspaceNavigationBridge } from './workspace/workspace-navigation-bridge.js';

const STARTUP_DEADLINE_MS = 15000;
let startupDeadlineAt = 0;
let startupFailed = false;

function escapeHtml(value) {
  return String(value || '').replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[char]);
}

function showBootstrapFailure(stage, error, target = null) {
  console.error(`ChatUI startup failed during ${stage}:`, error);
  document.getElementById('startup-error')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'startup-error';
  overlay.className = 'startup-error-overlay';
  overlay.setAttribute('role', 'alert');
  const message = error instanceof Error ? error.message : String(error || 'Unknown startup error');
  overlay.innerHTML = `
    <div class="startup-error-card">
      <h1 class="startup-error-title">ChatUI could not finish starting</h1>
      <p class="startup-error-description">Initialization stopped during <strong>${escapeHtml(stage)}</strong>.</p>
      <pre class="startup-error-details">${escapeHtml(message)}</pre>
      <button id="startup-retry-btn" class="startup-retry-btn" type="button">Reload ChatUI</button>
    </div>`;
  overlay.querySelector('#startup-retry-btn')?.addEventListener('click', () => window.location.reload());
  (target || document.body).appendChild(overlay);
}

function startupIsActive() {
  return !startupFailed && Date.now() < startupDeadlineAt;
}

async function runBootstrapStep(name, fn, { asyncStartup = false, errorTarget = null } = {}) {
  if (!startupIsActive()) {
    const error = new Error(`ChatUI startup exceeded its overall ${STARTUP_DEADLINE_MS / 1000}-second deadline before ${name}.`);
    startupFailed = true;
    showBootstrapFailure(name, error, errorTarget);
    throw error;
  }

  let timedOut = false;
  const remainingMs = Math.max(0, startupDeadlineAt - Date.now());
  const timeoutId = window.setTimeout(() => {
    timedOut = true;
    startupFailed = true;
    showBootstrapFailure(name, new Error(`ChatUI startup exceeded its overall ${STARTUP_DEADLINE_MS / 1000}-second deadline during ${name}.`), errorTarget);
  }, remainingMs);

  try {
    console.debug(`[ChatUI startup] ${name}`);
    const result = asyncStartup ? await fn({ isActive: startupIsActive }) : await fn();
    if (timedOut || !startupIsActive()) throw new Error(`ChatUI startup exceeded its overall ${STARTUP_DEADLINE_MS / 1000}-second deadline during ${name}.`);
    return result;
  } catch (error) {
    if (!startupFailed) {
      startupFailed = true;
      showBootstrapFailure(name, error, errorTarget);
    }
    throw error;
  } finally {
    window.clearTimeout(timeoutId);
  }
}

function normalizeRoute(route) {
  if (!route) return parseChatRoute();
  if (route.type === 'chat-home' || route.type === 'home') return { type: 'home', chatId: null };
  if (route.type === 'chat') return { type: 'chat', chatId: route.chatId };
  return { type: 'unknown', chatId: null };
}

async function handleRoute(route, { startup = false } = {}) {
  const chatRoute = normalizeRoute(route);
  if (chatRoute.type === 'chat') {
    const exists = state.chats.some(chat => chat.id === chatRoute.chatId);
    if (!exists) {
      alert('Chat not available in this browser. It may have been deleted, cleared, or saved on another device.');
      startNewChat(renderSidebar, null, { historyMode: 'replace' });
      return;
    }
    await loadChat(chatRoute.chatId, renderSidebar, { historyMode: 'none' });
    return;
  }

  if (chatRoute.type === 'home') {
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

export async function startChatUI({ initialRoute = null, errorTarget = null } = {}) {
  startupFailed = false;
  startupDeadlineAt = Date.now() + STARTUP_DEADLINE_MS;
  const step = (name, fn, options = {}) => runBootstrapStep(name, fn, { ...options, errorTarget });

  await step('Markdown initialization', () => initMarkdown());
  await step('IndexedDB metadata loading', ({ isActive }) => loadState({ isActive }), { asyncStartup: true });
  await step('Action menu initialization', () => initActionMenu());
  await step('Sidebar initialization', () => initSidebarUI());
  await step('Workspace initialization', () => initWorkspaceUI());
  await step('Workspace navigation initialization', () => initWorkspaceNavigationBridge());
  await step('Chat router initialization', () => {
    initChatRouter(route => { void handleRoute(route, { startup: false }); });
  });
  await step('Route restoration', () => handleRoute(initialRoute || parseChatRoute(), { startup: true }));
  await step('Composer initialization', () => initComposerListeners(renderSidebar));

  const attachFileBtn = document.getElementById('attach-file-btn');
  const fileAttachmentInput = document.getElementById('file-attachment-input');
  await step('Attachment initialization', () => initAttachmentListeners(attachFileBtn, fileAttachmentInput, updateComposerButtons));

  const recordAudioBtn = document.getElementById('record-audio-btn');
  await step('Recorder initialization', () => initRecorderListeners(recordAudioBtn));
  await step('Settings initialization', () => initSettingsUI());
  await step('Read Aloud initialization', () => initReadAloud());
  await step('Voice UI initialization', () => initVoiceUI(renderSidebar));
  await step('Model/menu initialization', () => initModelDropdownUI());
  await step('Right sidebar initialization', () => initRightSidebarUI(renderSidebar));
  await step('Modal initialization', () => initModalGlobalListeners());
  await step('Smart-scroll initialization', () => initSmartScrollControls());
  await step('Composer button synchronization', () => updateComposerButtons());

  return {
    handleRoute: route => handleRoute(route, { startup: false }),
    renderSidebar
  };
}
