/**
 * settings.js — Settings modal, appearance, Gemini model and thinking controls
 */

import { state, runtime, setState, setRuntime } from '../state/store.js';
import { persistSettings, removeAllData } from '../storage/storage.js';
import { initApiSettingsUI } from '../api/api-config.js';
import { initReadSettingsUI } from '../voice/read-settings.js';
import { initBackupRestoreUI } from './backup-restore-ui.js';
import { syncModelDisplay, syncThinkingDisplay } from '../ui/menus.js';
import { getModelConfig } from '../models/models.js';

export function applyTheme(mode) {
  setState({ theme: mode });
  if (mode === 'light') {
    document.documentElement.style.setProperty('--bg-primary', '#FCFCFC');
    document.documentElement.style.setProperty('--bg-secondary', '#FCFCFC');
    document.documentElement.style.setProperty('--bg-tertiary', '#F3F4F6');
    document.documentElement.style.setProperty('--text-primary', '#0D0D0D');
    document.documentElement.style.setProperty('--text-secondary', '#4B5563');
    document.documentElement.style.setProperty('--border-color', '#E5E7EB');
    document.documentElement.style.setProperty('--workspace-canvas-bg', '#EDEEF0');
    document.documentElement.style.setProperty('--workspace-paper-bg', '#FFFFFF');
    document.documentElement.style.setProperty('--workspace-paper-text', '#111111');
    document.documentElement.style.setProperty('--workspace-paper-border', '#D7DADF');
    document.documentElement.style.setProperty('--workspace-paper-shadow', '0 18px 48px rgba(0, 0, 0, 0.12)');
    document.documentElement.style.setProperty('--workspace-code-bg', '#F3F4F6');
  } else {
    document.documentElement.style.setProperty('--bg-primary', '#000000');
    document.documentElement.style.setProperty('--bg-secondary', '#000000');
    document.documentElement.style.setProperty('--bg-tertiary', '#212121');
    document.documentElement.style.setProperty('--text-primary', '#FFFFFF');
    document.documentElement.style.setProperty('--text-secondary', '#AFAFAF');
    document.documentElement.style.setProperty('--border-color', 'rgba(255, 255, 255, 0.1)');
    document.documentElement.style.setProperty('--workspace-canvas-bg', '#090909');
    document.documentElement.style.setProperty('--workspace-paper-bg', '#111111');
    document.documentElement.style.setProperty('--workspace-paper-text', '#F5F5F5');
    document.documentElement.style.setProperty('--workspace-paper-border', 'rgba(255, 255, 255, 0.12)');
    document.documentElement.style.setProperty('--workspace-paper-shadow', '0 18px 48px rgba(0, 0, 0, 0.42)');
    document.documentElement.style.setProperty('--workspace-code-bg', '#080808');
  }

  window.dispatchEvent(new CustomEvent('workspace:theme-changed', { detail: { theme: mode } }));
}

export function applyAccentColor(color) {
  let hex = '#10A37F';
  if (color === 'blue') hex = '#2563EB';
  if (color === 'purple') hex = '#8B5CF6';

  setState({ accentColor: hex });
  document.documentElement.style.setProperty('--accent-blue', hex);
}

export function openSettingsModal() {
  const settingsModal = document.getElementById('settings-modal');
  const home = document.getElementById('settings-home');
  const content = document.getElementById('settings-content');
  if (settingsModal) {
    setRuntime({ lastFocusedElement: document.activeElement });
    settingsModal.classList.remove('hidden');
    home?.classList.remove('hidden');
    content?.classList.add('hidden');
    document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
  }
}

function openSettingsSection(section) {
  const home = document.getElementById('settings-home');
  const content = document.getElementById('settings-content');
  const pane = document.getElementById(`tab-${section}`);
  if (!home || !content || !pane) return;
  home.classList.add('hidden');
  content.classList.remove('hidden');
  document.querySelectorAll('.tab-pane').forEach(item => item.classList.remove('active'));
  pane.classList.add('active');
}

function returnToSettingsHome() {
  document.getElementById('settings-home')?.classList.remove('hidden');
  document.getElementById('settings-content')?.classList.add('hidden');
  document.querySelectorAll('.tab-pane').forEach(pane => pane.classList.remove('active'));
}

export function closeSettingsModal() {
  const settingsModal = document.getElementById('settings-modal');
  if (settingsModal) {
    settingsModal.classList.add('hidden');
    if (runtime.lastFocusedElement && typeof runtime.lastFocusedElement.focus === 'function') {
      runtime.lastFocusedElement.focus();
    }
  }
}

export function initSettingsUI() {
  initApiSettingsUI();
  initReadSettingsUI();
  initBackupRestoreUI();

  const selectedModel = getModelConfig(state.currentModel);
  const thinkingWasCorrected = !selectedModel.thinkingLevels.includes(state.thinkingLevel);
  if (thinkingWasCorrected) {
    setState({ thinkingLevel: selectedModel.defaultThinkingLevel });
  }

  if (state.theme) applyTheme(state.theme);
  if (state.accentColor) {
    let colorName = 'default';
    if (state.accentColor === '#2563EB') colorName = 'blue';
    if (state.accentColor === '#8B5CF6') colorName = 'purple';
    applyAccentColor(colorName);
  }

  const openSettingsTrigger = document.getElementById('open-settings-trigger');
  const closeSettingsModalBtn = document.getElementById('close-settings-modal-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsSections = document.querySelectorAll('.settings-section-btn');
  const settingsBackBtn = document.getElementById('settings-back-btn');

  const appearanceSelect = document.getElementById('appearance-select');
  const accentColorSelect = document.getElementById('accent-color-select');
  const settingsModelSelect = document.getElementById('settings-model-select');
  const settingsThinkingLevel = document.getElementById('settings-thinking-level');

  const persistSettingsChange = async () => {
    try {
      await persistSettings();
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert('Failed to save settings: ' + err.message);
    }
  };

  if (thinkingWasCorrected) persistSettingsChange();
  if (appearanceSelect && state.theme) appearanceSelect.value = state.theme;

  if (openSettingsTrigger) {
    openSettingsTrigger.addEventListener('click', () => openSettingsModal());
    openSettingsTrigger.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openSettingsModal();
      }
    });
  }

  settingsSections.forEach(section => {
    section.addEventListener('click', () => openSettingsSection(section.dataset.settingsSection));
  });
  settingsBackBtn?.addEventListener('click', returnToSettingsHome);

  if (closeSettingsModalBtn) closeSettingsModalBtn.addEventListener('click', closeSettingsModal);
  if (settingsModal) {
    settingsModal.addEventListener('click', e => {
      if (e.target === settingsModal) closeSettingsModal();
    });
  }

  if (appearanceSelect) {
    appearanceSelect.addEventListener('change', e => {
      applyTheme(e.target.value);
      persistSettingsChange();
    });
  }

  if (accentColorSelect) {
    accentColorSelect.addEventListener('change', e => {
      applyAccentColor(e.target.value);
      persistSettingsChange();
    });
  }

  if (settingsModelSelect) {
    settingsModelSelect.value = state.currentModel;
    settingsModelSelect.addEventListener('change', e => {
      const model = getModelConfig(e.target.value);
      const thinkingLevel = model.thinkingLevels.includes(state.thinkingLevel)
        ? state.thinkingLevel
        : model.defaultThinkingLevel;
      setState({ currentModel: model.name, thinkingLevel });
      syncModelDisplay();
      syncThinkingDisplay();
      settingsThinkingLevel.value = thinkingLevel;
      persistSettingsChange();
    });
  }

  if (settingsThinkingLevel) {
    settingsThinkingLevel.value = state.thinkingLevel || 'high';
    settingsThinkingLevel.addEventListener('change', e => {
      setState({ thinkingLevel: e.target.value });
      syncThinkingDisplay();
      persistSettingsChange();
    });
  }

  const removeEverythingBtn = document.getElementById('remove-everything-btn');
  if (removeEverythingBtn) {
    removeEverythingBtn.addEventListener('click', async () => {
      const confirmed = window.confirm('Are you sure you want to remove everything? This will permanently delete all local chats, projects, attachments, API settings, and local database records.');
      if (confirmed) {
        closeSettingsModal();
        try {
          await removeAllData();
        } catch (err) {
          console.error('Failed to reset local data:', err);
          alert('Failed to remove local data: ' + err.message);
        }
      }
    });
  }
}
