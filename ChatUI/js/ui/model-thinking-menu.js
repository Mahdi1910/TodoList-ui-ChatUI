/**
 * model-thinking-menu.js - Model and thinking-level selector behavior.
 */

import { MODELS, getModelConfig } from '../models/models.js';
import { state, setState } from '../state/store.js';
import { persistSettings } from '../storage/storage.js';
import { closeActionMenu } from './action-menu.js';

const THINKING_LEVELS = [
  { id: 'high', label: 'High', color: '#F87171' },
  { id: 'medium', label: 'Medium', color: '#F59E0B' },
  { id: 'low', label: 'Low', color: '#60A5FA' },
  { id: 'minimal', label: 'Minimal', color: '#9CA3AF' }
];

function getSelectedModel() {
  return getModelConfig(state.currentModel);
}

function getSupportedThinkingLevels(model = getSelectedModel()) {
  return THINKING_LEVELS.filter(level => model.thinkingLevels.includes(level.id));
}

function getValidThinkingLevel(model = getSelectedModel(), level = state.thinkingLevel) {
  return model.thinkingLevels.includes(level) ? level : model.defaultThinkingLevel;
}

export function syncModelDisplay() {
  const span = document.getElementById('selected-model-name');
  const model = getSelectedModel();
  if (span) span.textContent = model.shortName || model.name;
}

export function syncThinkingDisplay() {
  const span = document.getElementById('selected-thinking-level');
  const trigger = document.getElementById('thinking-dropdown-trigger');
  const model = getSelectedModel();
  const validLevel = getValidThinkingLevel(model);
  const level = THINKING_LEVELS.find(item => item.id === validLevel) || THINKING_LEVELS[0];
  if (span) span.textContent = level.label;
  if (trigger) {
    trigger.classList.remove(...THINKING_LEVELS.map(item => `thinking-${item.id}`));
    trigger.classList.add(`thinking-${level.id}`);
  }
}

export function initModelDropdownUI() {
  const trigger = document.getElementById('model-dropdown-trigger');
  const menu = document.getElementById('model-dropdown-menu');
  const thinkingTrigger = document.getElementById('thinking-dropdown-trigger');
  const thinkingMenu = document.getElementById('thinking-dropdown-menu');
  if (!trigger || !menu) return;

  syncModelDisplay();
  syncThinkingDisplay();
  menu.classList.add('hidden');
  thinkingMenu?.classList.add('hidden');
  trigger.setAttribute('aria-expanded', 'false');
  thinkingTrigger?.setAttribute('aria-expanded', 'false');

  trigger.addEventListener('click', e => {
    e.stopPropagation();
    closeActionMenu();
    thinkingMenu?.classList.add('hidden');
    thinkingTrigger?.setAttribute('aria-expanded', 'false');
    const opening = menu.classList.contains('hidden');
    if (opening) {
      renderModelDropdownOptions(menu);
      menu.classList.remove('hidden');
      trigger.setAttribute('aria-expanded', 'true');
      menu.querySelector('.model-option.selected')?.focus();
    } else {
      menu.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
    }
  });

  trigger.addEventListener('wheel', e => {
    e.preventDefault();
    const direction = e.deltaY > 0 ? 1 : -1;
    const currentIndex = MODELS.findIndex(m => m.name === state.currentModel || m.id === state.currentModel || m.shortName === state.currentModel);
    const nextIndex = Math.max(0, Math.min(MODELS.length - 1, currentIndex + direction));
    if (nextIndex !== currentIndex) selectModel(MODELS[nextIndex]);
  }, { passive: false });

  thinkingTrigger?.addEventListener('wheel', e => {
    e.preventDefault();
    const supportedLevels = getSupportedThinkingLevels();
    const currentLevel = getValidThinkingLevel();
    const currentIndex = supportedLevels.findIndex(item => item.id === currentLevel);
    const direction = e.deltaY > 0 ? 1 : -1;
    const nextIndex = Math.max(0, Math.min(supportedLevels.length - 1, currentIndex + direction));
    if (nextIndex !== currentIndex) selectThinkingLevel(supportedLevels[nextIndex]);
  }, { passive: false });

  thinkingTrigger?.addEventListener('click', e => {
    e.stopPropagation();
    closeActionMenu();
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    const opening = thinkingMenu.classList.contains('hidden');
    if (opening) {
      renderThinkingOptions(thinkingMenu);
      thinkingMenu.classList.remove('hidden');
      thinkingTrigger.setAttribute('aria-expanded', 'true');
    } else {
      thinkingMenu.classList.add('hidden');
      thinkingTrigger.setAttribute('aria-expanded', 'false');
    }
  });

  document.addEventListener('click', e => {
    if (!menu.contains(e.target) && e.target !== trigger) {
      menu.classList.add('hidden');
      trigger.setAttribute('aria-expanded', 'false');
    }
    if (thinkingMenu && !thinkingMenu.contains(e.target) && e.target !== thinkingTrigger) {
      thinkingMenu.classList.add('hidden');
      thinkingTrigger?.setAttribute('aria-expanded', 'false');
    }
    closeActionMenu();
  });
}

async function selectModel(model) {
  const previousModel = state.currentModel;
  const previousThinkingLevel = state.thinkingLevel;
  const thinkingLevel = getValidThinkingLevel(model, previousThinkingLevel);
  setState({ currentModel: model.name, thinkingLevel });
  try {
    await persistSettings();
  } catch (err) {
    setState({ currentModel: previousModel, thinkingLevel: previousThinkingLevel });
    console.error('Failed to save model selection:', err);
    alert('Failed to save model selection: ' + err.message);
    return;
  }
  syncModelDisplay();
  syncThinkingDisplay();
  const menu = document.getElementById('model-dropdown-menu');
  const trigger = document.getElementById('model-dropdown-trigger');
  menu?.classList.add('hidden');
  trigger?.setAttribute('aria-expanded', 'false');
}

function renderModelDropdownOptions(menu) {
  menu.innerHTML = '';
  MODELS.forEach(model => {
    const selected = state.currentModel === model.name || model.id === state.currentModel || model.shortName === state.currentModel;
    const option = document.createElement('div');
    option.className = `model-option ${selected ? 'selected active' : ''}`;
    option.tabIndex = 0;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
    const iconName = {
      '3.7-flash': 'sparkles',
      '3.5-flash': 'zap',
      '3.5-flash-light': 'gauge',
      '3.1-pro': 'brain'
    }[model.id] || 'sparkles';
    option.innerHTML = `<div class="model-icon"><i data-lucide="${iconName}"></i></div>
      <div class="model-details"><div class="model-title">${model.name} ${model.badge ? `<span class="badge">${model.badge}</span>` : ''}</div></div><i data-lucide="check" class="check-icon"></i>`;
    option.addEventListener('click', () => selectModel(model));
    option.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectModel(model); }
    });
    menu.appendChild(option);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons?.();
}

async function selectThinkingLevel(level) {
  const previousLevel = state.thinkingLevel;
  setState({ thinkingLevel: level.id });
  try {
    await persistSettings();
  } catch (err) {
    setState({ thinkingLevel: previousLevel });
    console.error('Failed to save thinking level:', err);
    alert('Failed to save thinking level: ' + err.message);
    return;
  }
  syncThinkingDisplay();
  const menu = document.getElementById('thinking-dropdown-menu');
  menu?.classList.add('hidden');
  document.getElementById('thinking-dropdown-trigger')?.setAttribute('aria-expanded', 'false');
}

function renderThinkingOptions(menu) {
  menu.innerHTML = '';
  const supportedLevels = getSupportedThinkingLevels();
  supportedLevels.forEach(level => {
    const selected = state.thinkingLevel === level.id;
    const option = document.createElement('div');
    option.className = `thinking-option thinking-${level.id} ${selected ? 'selected' : ''}`;
    option.tabIndex = 0;
    option.setAttribute('role', 'option');
    option.setAttribute('aria-selected', selected ? 'true' : 'false');
    option.innerHTML = `<span class="thinking-color-dot"></span><span>${level.label}</span>${selected ? '<i data-lucide="check" class="thinking-check-icon"></i>' : ''}`;
    const choose = () => selectThinkingLevel(level);
    option.addEventListener('click', choose);
    option.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(); }
    });
    menu.appendChild(option);
  });
  if (typeof lucide !== 'undefined') lucide.createIcons?.();
}
