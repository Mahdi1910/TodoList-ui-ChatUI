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
import {
  customToolRoundLimitError,
  isValidCustomToolRoundLimit,
  normalizeCustomToolRoundLimit
} from '../tools/custom-tool-limits.js';

const THEME_TOKENS = Object.freeze({
  light: {
    '--bg-primary': '#FCFCFC',
    '--bg-secondary': '#FCFCFC',
    '--bg-tertiary': '#F3F4F6',
    '--bg-hover': '#E9ECEF',
    '--bg-selected': '#E2E6EA',
    '--menu-bg': '#FFFFFF',
    '--menu-hover': '#F2F4F6',
    '--text-primary': '#0D0D0D',
    '--text-secondary': '#4B5563',
    '--text-muted': '#6B7280',
    '--border-color': '#E5E7EB',
    '--border-light': '#D1D5DB',
    '--focus-ring': '#7A828D',
    '--scrollbar-thumb': 'rgba(75, 85, 99, 0.34)',
    '--scrollbar-thumb-hover': 'rgba(75, 85, 99, 0.52)',
    '--menu-shadow': '0 18px 44px rgba(15, 23, 42, 0.18)',
    '--workspace-canvas-bg': '#EDEEF0',
    '--workspace-paper-bg': '#FFFFFF',
    '--workspace-paper-text': '#111111',
    '--workspace-paper-border': '#D7DADF',
    '--workspace-paper-shadow': '0 18px 48px rgba(0, 0, 0, 0.12)',
    '--workspace-code-bg': '#F3F4F6'
  },
  dark: {
    '--bg-primary': '#000000',
    '--bg-secondary': '#000000',
    '--bg-tertiary': '#212121',
    '--bg-hover': '#2F2F2F',
    '--bg-selected': '#303030',
    '--menu-bg': '#242424',
    '--menu-hover': '#343434',
    '--text-primary': '#FFFFFF',
    '--text-secondary': '#AFAFAF',
    '--text-muted': '#AFAFAF',
    '--border-color': 'rgba(255, 255, 255, 0.1)',
    '--border-light': 'rgba(255, 255, 255, 0.18)',
    '--focus-ring': '#A3A3A3',
    '--scrollbar-thumb': 'rgba(148, 163, 184, 0.42)',
    '--scrollbar-thumb-hover': 'rgba(148, 163, 184, 0.62)',
    '--menu-shadow': '0 18px 44px rgba(0, 0, 0, 0.52)',
    '--workspace-canvas-bg': '#090909',
    '--workspace-paper-bg': '#111111',
    '--workspace-paper-text': '#F5F5F5',
    '--workspace-paper-border': 'rgba(255, 255, 255, 0.12)',
    '--workspace-paper-shadow': '0 18px 48px rgba(0, 0, 0, 0.42)',
    '--workspace-code-bg': '#080808'
  }
});

const ACCENTS = Object.freeze({
  blue: { base: '#2563EB', hover: '#1D4ED8', soft: 'rgba(37, 99, 235, 0.16)' },
  green: { base: '#10A37F', hover: '#0D8A6C', soft: 'rgba(16, 163, 127, 0.16)' },
  purple: { base: '#8B5CF6', hover: '#7C3AED', soft: 'rgba(139, 92, 246, 0.16)' }
});

export function applyTheme(mode) {
  const normalizedMode = mode === 'light' ? 'light' : 'dark';
  setState({ theme: normalizedMode });
  document.documentElement.dataset.theme = normalizedMode;
  Object.entries(THEME_TOKENS[normalizedMode]).forEach(([name, value]) => {
    document.documentElement.style.setProperty(name, value);
  });
  window.dispatchEvent(new CustomEvent('workspace:theme-changed', { detail: { theme: normalizedMode } }));
}

export function applyAccentColor(color) {
  const accentName = Object.prototype.hasOwnProperty.call(ACCENTS, color) ? color : 'green';
  const accent = ACCENTS[accentName];
  setState({ accentColor: accent.base });
  // --accent-blue remains as a compatibility alias used throughout the existing UI.
  document.documentElement.style.setProperty('--accent-blue', accent.base);
  document.documentElement.style.setProperty('--accent-blue-hover', accent.hover);
  document.documentElement.style.setProperty('--accent-soft', accent.soft);
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
  if (thinkingWasCorrected) setState({ thinkingLevel: selectedModel.defaultThinkingLevel });

  applyTheme(state.theme || 'dark');
  let colorName = 'green';
  if (String(state.accentColor).toUpperCase() === '#2563EB') colorName = 'blue';
  if (String(state.accentColor).toUpperCase() === '#8B5CF6') colorName = 'purple';
  applyAccentColor(colorName);

  const openSettingsTrigger = document.getElementById('open-settings-trigger');
  const closeSettingsModalBtn = document.getElementById('close-settings-modal-btn');
  const settingsModal = document.getElementById('settings-modal');
  const settingsSections = document.querySelectorAll('.settings-section-btn');
  const settingsBackBtn = document.getElementById('settings-back-btn');

  const appearanceSelect = document.getElementById('appearance-select');
  const accentColorSelect = document.getElementById('accent-color-select');
  const settingsModelSelect = document.getElementById('settings-model-select');
  const settingsThinkingLevel = document.getElementById('settings-thinking-level');
  const customToolLimitInput = document.getElementById('custom-tool-round-limit-input');
  const customToolLimitError = document.getElementById('custom-tool-round-limit-error');

  const persistSettingsChange = async () => {
    try {
      await persistSettings();
      return true;
    } catch (err) {
      console.error('Failed to save settings:', err);
      alert('Failed to save settings: ' + err.message);
      return false;
    }
  };

  if (thinkingWasCorrected) persistSettingsChange();
  if (appearanceSelect) appearanceSelect.value = state.theme || 'dark';
  if (accentColorSelect) accentColorSelect.value = colorName;

  if (customToolLimitInput) {
    customToolLimitInput.value = String(normalizeCustomToolRoundLimit(state.customToolRoundLimit));
    const saveCustomToolLimit = async () => {
      const raw = customToolLimitInput.value;
      if (!isValidCustomToolRoundLimit(raw)) {
        customToolLimitInput.setAttribute('aria-invalid', 'true');
        if (customToolLimitError) {
          customToolLimitError.textContent = customToolRoundLimitError();
          customToolLimitError.classList.remove('hidden');
        }
        return;
      }

      const previous = state.customToolRoundLimit;
      const next = normalizeCustomToolRoundLimit(raw);
      customToolLimitInput.removeAttribute('aria-invalid');
      customToolLimitError?.classList.add('hidden');
      setState({ customToolRoundLimit: next });
      const saved = await persistSettingsChange();
      if (!saved) {
        setState({ customToolRoundLimit: previous });
        customToolLimitInput.value = String(previous);
      } else {
        customToolLimitInput.value = String(next);
      }
    };
    customToolLimitInput.addEventListener('change', () => void saveCustomToolLimit());
  }

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
      if (settingsThinkingLevel) settingsThinkingLevel.value = thinkingLevel;
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