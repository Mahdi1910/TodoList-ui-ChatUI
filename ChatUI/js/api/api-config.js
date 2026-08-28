/*
 * api-config.js — Gemini API Settings, Credential Management & URL Normalization
 */

import { state, setState } from '../state/store.js';
import { persistSettings } from '../storage/storage.js';
import {
  ensureTextApiKeyPoolState,
  getTextApiKeyPoolSummary,
  maskApiKey,
  setTextApiKeyPoolFromText,
  textApiKeyPoolText,
  validateTextApiKeyPool
} from './text-api-key-pool.js';

export const DEFAULT_GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com';
export const CHATUI_VERSION = '1.1';

let validationTimer = null;
let validationController = null;
let validationRunId = 0;

export function getApiSettings() {
  const api = ensureTextApiKeyPoolState();
  return {
    textApiKey: api.textApiKey || '',
    textApiKeys: Array.isArray(api.textApiKeys) ? api.textApiKeys : [],
    textApiKeyIndex: Number(api.textApiKeyIndex) || 0,
    textBaseUrl: api.textBaseUrl || '',
    voiceApiKey: api.voiceApiKey || '',
    voiceBaseUrl: api.voiceBaseUrl || ''
  };
}

export async function saveApiSettings(settings) {
  if (settings) {
    setState({ api: { ...state.api, ...Object.fromEntries(
      Object.entries(settings).filter(([, value]) => value !== undefined)
    ) } });
    ensureTextApiKeyPoolState();
    await persistSettings();
    return;
  }

  const textInput = document.getElementById('text-api-key-input');
  if (textInput) setTextApiKeyPoolFromText(textInput.value);
  const values = {
    textBaseUrl: document.getElementById('text-base-url-input')?.value.trim(),
    voiceApiKey: document.getElementById('voice-api-key-input')?.value.trim(),
    voiceBaseUrl: document.getElementById('voice-base-url-input')?.value.trim()
  };
  setState({ api: { ...state.api, ...Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  ) } });
  ensureTextApiKeyPoolState();
  await persistSettings();
}

function ensureMultilineTextKeyInput() {
  const existing = document.getElementById('text-api-key-input');
  if (!existing) return null;
  if (existing.tagName === 'TEXTAREA') return existing;

  const textarea = document.createElement('textarea');
  textarea.id = existing.id;
  textarea.className = `${existing.className} api-key-pool-input`;
  textarea.placeholder = 'One Gemini Text API Key per line';
  textarea.rows = 6;
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('spellcheck', 'false');
  textarea.setAttribute('aria-label', 'Gemini text API keys, one per line');
  existing.replaceWith(textarea);
  return textarea;
}

function ensureKeyPoolStatusUI(input) {
  if (!input) return;
  const group = input.closest('.api-key-form-group');
  if (!group) return;
  if (!document.getElementById('text-api-key-pool-hint')) {
    const hint = document.createElement('div');
    hint.id = 'text-api-key-pool-hint';
    hint.className = 'api-key-pool-hint';
    hint.textContent = 'One key per line. Whitespace and duplicate keys are removed automatically. Keys are validated after editing.';
    group.appendChild(hint);
  }
  if (!document.getElementById('text-api-key-pool-status')) {
    const status = document.createElement('div');
    status.id = 'text-api-key-pool-status';
    status.className = 'api-key-pool-status';
    status.setAttribute('role', 'status');
    status.setAttribute('aria-live', 'polite');
    group.appendChild(status);
  }
  if (!document.getElementById('text-api-key-pool-list')) {
    const list = document.createElement('div');
    list.id = 'text-api-key-pool-list';
    list.className = 'api-key-pool-list';
    group.appendChild(list);
  }
}

function formatLocalTime(timestamp) {
  if (!timestamp) return '';
  try {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: 'medium',
      timeStyle: 'short'
    }).format(new Date(timestamp));
  } catch (_) {
    return new Date(timestamp).toLocaleString();
  }
}

function renderKeyPoolStatus(progressText = '') {
  const api = ensureTextApiKeyPoolState();
  const summary = getTextApiKeyPoolSummary();
  const status = document.getElementById('text-api-key-pool-status');
  const list = document.getElementById('text-api-key-pool-list');
  if (status) {
    status.textContent = progressText || `${summary.total} keys • ${summary.available} available • ${summary.cooling} cooling • ${summary.invalid} invalid`;
  }
  if (!list) return;
  list.innerHTML = '';
  const now = Date.now();
  (api.textApiKeys || []).forEach((entry, index) => {
    const row = document.createElement('div');
    row.className = 'api-key-pool-row';
    const left = document.createElement('span');
    left.className = 'api-key-pool-key';
    left.textContent = `${index + 1}. ${maskApiKey(entry.key)}`;
    const right = document.createElement('span');
    right.className = 'api-key-pool-state';
    if (Number(entry.cooldownUntil) > now) {
      right.textContent = `Cooling until ${formatLocalTime(entry.cooldownUntil)}`;
    } else if (entry.validationStatus === 'invalid') {
      right.textContent = 'Invalid';
    } else if (entry.validationStatus === 'valid') {
      right.textContent = index === api.textApiKeyIndex ? 'Active' : 'Available';
    } else if (entry.validationStatus === 'error') {
      right.textContent = 'Validation error';
    } else {
      right.textContent = 'Not checked';
    }
    row.append(left, right);
    if (entry.lastFailureAt) {
      row.title = `Last failure: ${formatLocalTime(entry.lastFailureAt)}${entry.lastError?.message ? ` — ${entry.lastError.message}` : ''}`;
    }
    list.appendChild(row);
  });
}

async function validateCurrentPool() {
  const runId = ++validationRunId;
  validationController?.abort();
  validationController = new AbortController();
  const cleanBaseUrl = getCleanBaseUrl(state.api?.textBaseUrl || '');
  const total = ensureTextApiKeyPoolState().textApiKeys?.length || 0;
  if (!total) {
    renderKeyPoolStatus();
    return;
  }

  try {
    renderKeyPoolStatus(`Validating 0/${total} keys…`);
    await validateTextApiKeyPool({
      cleanBaseUrl,
      signal: validationController.signal,
      onProgress: ({ completed, total: count }) => {
        if (runId === validationRunId) renderKeyPoolStatus(`Validating ${completed}/${count} keys…`);
      }
    });
    if (runId === validationRunId) renderKeyPoolStatus();
  } catch (error) {
    if (error?.name === 'AbortError') return;
    console.error('Failed to validate Gemini text API key pool:', error);
    if (runId === validationRunId) renderKeyPoolStatus('Key validation could not finish. Saved keys remain available for normal requests.');
  }
}

function schedulePoolSaveAndValidation(input) {
  window.clearTimeout(validationTimer);
  validationTimer = window.setTimeout(async () => {
    const cleanedApi = setTextApiKeyPoolFromText(input.value);
    input.value = (cleanedApi.textApiKeys || []).map(entry => entry.key).join('\n');
    try {
      await persistSettings();
      renderKeyPoolStatus();
      await validateCurrentPool();
    } catch (error) {
      console.error('Failed to save Gemini API key pool:', error);
      renderKeyPoolStatus('Failed to save API keys.');
    }
  }, 700);
}

function ensureVersionRow() {
  const pane = document.getElementById('tab-general');
  if (!pane || document.getElementById('chatui-version-row')) return;
  const row = document.createElement('div');
  row.className = 'setting-row';
  row.id = 'chatui-version-row';
  const info = document.createElement('div');
  info.className = 'setting-info';
  const label = document.createElement('div');
  label.className = 'setting-label';
  label.textContent = 'Version';
  const value = document.createElement('div');
  value.className = 'setting-version-value';
  value.textContent = CHATUI_VERSION;
  info.appendChild(label);
  row.append(info, value);
  const destructive = pane.querySelector('.destructive-setting-row');
  if (destructive) pane.insertBefore(row, destructive);
  else pane.appendChild(row);
}

export function initApiSettingsUI() {
  ensureTextApiKeyPoolState();
  const textApiKeyInput = ensureMultilineTextKeyInput();
  const textBaseUrlInput = document.getElementById('text-base-url-input');
  const voiceApiKeyInput = document.getElementById('voice-api-key-input');
  const voiceBaseUrlInput = document.getElementById('voice-base-url-input');
  const toggleTextKeyBtn = document.getElementById('toggle-text-key-visibility');
  const toggleVoiceKeyBtn = document.getElementById('toggle-voice-key-visibility');

  ensureKeyPoolStatusUI(textApiKeyInput);
  ensureVersionRow();

  const settings = getApiSettings();
  if (textApiKeyInput) {
    textApiKeyInput.value = textApiKeyPoolText();
    textApiKeyInput.classList.remove('api-key-visible');
  }
  if (textBaseUrlInput) textBaseUrlInput.value = settings.textBaseUrl;
  if (voiceApiKeyInput) voiceApiKeyInput.value = settings.voiceApiKey;
  if (voiceBaseUrlInput) voiceBaseUrlInput.value = settings.voiceBaseUrl;
  renderKeyPoolStatus();

  const persistApiSettings = async () => {
    try {
      await saveApiSettings();
    } catch (err) {
      console.error('Failed to save API settings:', err);
      alert('Failed to save API settings: ' + err.message);
    }
  };

  if (textApiKeyInput) {
    textApiKeyInput.addEventListener('input', () => schedulePoolSaveAndValidation(textApiKeyInput));
    textApiKeyInput.addEventListener('change', () => schedulePoolSaveAndValidation(textApiKeyInput));
  }
  if (textBaseUrlInput) textBaseUrlInput.addEventListener('change', async () => {
    await persistApiSettings();
    await validateCurrentPool();
  });
  if (voiceApiKeyInput) voiceApiKeyInput.addEventListener('change', persistApiSettings);
  if (voiceBaseUrlInput) voiceBaseUrlInput.addEventListener('change', persistApiSettings);

  if (toggleTextKeyBtn && textApiKeyInput) {
    toggleTextKeyBtn.addEventListener('click', () => {
      textApiKeyInput.classList.toggle('api-key-visible');
      toggleTextKeyBtn.setAttribute('aria-pressed', String(textApiKeyInput.classList.contains('api-key-visible')));
    });
  }

  if (toggleVoiceKeyBtn && voiceApiKeyInput) {
    toggleVoiceKeyBtn.addEventListener('click', () => {
      const isPass = voiceApiKeyInput.type === 'password';
      voiceApiKeyInput.type = isPass ? 'text' : 'password';
    });
  }
}

export function getCleanBaseUrl(inputUrl) {
  const trimmed = (inputUrl || '').trim().replace(/\/+$/, '');
  return trimmed.length > 0 ? trimmed : DEFAULT_GOOGLE_BASE_URL;
}
