/*
 * api-config.js — Gemini API Settings, Credential Management & URL Normalization
 */

import { state, setState } from '../state/store.js';
import { persistSettings } from '../storage/storage.js';

export const DEFAULT_GOOGLE_BASE_URL = 'https://generativelanguage.googleapis.com';

export function getApiSettings() {
  return {
    textApiKey: state.api?.textApiKey || '',
    textBaseUrl: state.api?.textBaseUrl || '',
    voiceApiKey: state.api?.voiceApiKey || '',
    voiceBaseUrl: state.api?.voiceBaseUrl || ''
  };
}

export async function saveApiSettings(settings) {
  const values = settings || {
    textApiKey: document.getElementById('text-api-key-input')?.value.trim(),
    textBaseUrl: document.getElementById('text-base-url-input')?.value.trim(),
    voiceApiKey: document.getElementById('voice-api-key-input')?.value.trim(),
    voiceBaseUrl: document.getElementById('voice-base-url-input')?.value.trim()
  };
  setState({ api: { ...state.api, ...Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined)
  ) } });
  await persistSettings();
}

export function initApiSettingsUI() {
  const textApiKeyInput = document.getElementById('text-api-key-input');
  const textBaseUrlInput = document.getElementById('text-base-url-input');
  const voiceApiKeyInput = document.getElementById('voice-api-key-input');
  const voiceBaseUrlInput = document.getElementById('voice-base-url-input');
  const toggleTextKeyBtn = document.getElementById('toggle-text-key-visibility');
  const toggleVoiceKeyBtn = document.getElementById('toggle-voice-key-visibility');

  const settings = getApiSettings();
  if (textApiKeyInput) textApiKeyInput.value = settings.textApiKey;
  if (textBaseUrlInput) textBaseUrlInput.value = settings.textBaseUrl;
  if (voiceApiKeyInput) voiceApiKeyInput.value = settings.voiceApiKey;
  if (voiceBaseUrlInput) voiceBaseUrlInput.value = settings.voiceBaseUrl;

  const persistApiSettings = async () => {
    try {
      await saveApiSettings();
    } catch (err) {
      console.error('Failed to save API settings:', err);
      alert('Failed to save API settings: ' + err.message);
    }
  };

  if (textApiKeyInput) textApiKeyInput.addEventListener('change', persistApiSettings);
  if (textBaseUrlInput) textBaseUrlInput.addEventListener('change', persistApiSettings);
  if (voiceApiKeyInput) voiceApiKeyInput.addEventListener('change', persistApiSettings);
  if (voiceBaseUrlInput) voiceBaseUrlInput.addEventListener('change', persistApiSettings);

  if (toggleTextKeyBtn && textApiKeyInput) {
    toggleTextKeyBtn.addEventListener('click', () => {
      const isPass = textApiKeyInput.type === 'password';
      textApiKeyInput.type = isPass ? 'text' : 'password';
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
