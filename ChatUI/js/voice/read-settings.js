/**
 * read-settings.js — Audio Read settings, custom voice picker, and voice preview.
 */

import { state, setState } from '../state/store.js';
import { getApiSettings } from '../api/api-config.js';
import { startGeminiLiveAudio } from '../api/gemini-live-audio.js';
import { persistSettings, applyReadAudioRetentionPolicy } from '../storage/storage.js';
import { ReadAudioEngine } from './read-audio-engine.js';

export const READ_AUDIO_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
];

const VOICE_PREVIEW_TEXT = 'Hello. This is a short preview of this voice.';
let activeVoicePreview = null;

function normalizeVoice(value) {
  return READ_AUDIO_VOICES.includes(value) ? value : 'Zephyr';
}

function normalizeRetention(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 7;
  return Math.max(1, Math.min(90, Math.round(number)));
}

async function persistAudioRead(nextAudioRead) {
  const previous = { ...(state.audioRead || {}) };
  setState({ audioRead: nextAudioRead });
  try {
    await persistSettings();
    return previous;
  } catch (error) {
    setState({ audioRead: previous });
    throw error;
  }
}

function refreshIcons() {
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function ensureVoicePicker() {
  const existingTrigger = document.getElementById('audio-read-voice-trigger');
  if (existingTrigger) {
    return {
      root: existingTrigger.closest('.audio-voice-control'),
      picker: existingTrigger.closest('.audio-voice-picker'),
      trigger: existingTrigger,
      label: document.getElementById('audio-read-voice-label'),
      menu: document.getElementById('audio-read-voice-menu'),
      preview: document.getElementById('audio-read-voice-preview-btn')
    };
  }

  const legacySelect = document.getElementById('audio-read-voice-select');
  if (!legacySelect) return null;

  const root = document.createElement('div');
  root.className = 'audio-voice-control';
  root.innerHTML = `
    <div class="audio-voice-picker">
      <button type="button" class="audio-voice-trigger" id="audio-read-voice-trigger"
        aria-haspopup="listbox" aria-expanded="false" aria-controls="audio-read-voice-menu">
        <span id="audio-read-voice-label">Zephyr</span>
        <i data-lucide="chevron-down"></i>
      </button>
      <div class="audio-voice-menu hidden" id="audio-read-voice-menu" role="listbox"
        aria-label="Read Aloud voice"></div>
    </div>
    <button type="button" class="audio-voice-preview-btn" id="audio-read-voice-preview-btn"
      title="Preview selected voice" aria-label="Preview selected voice" aria-pressed="false">
      <i data-lucide="play"></i>
    </button>`;
  legacySelect.replaceWith(root);
  refreshIcons();

  return {
    root,
    picker: root.querySelector('.audio-voice-picker'),
    trigger: root.querySelector('#audio-read-voice-trigger'),
    label: root.querySelector('#audio-read-voice-label'),
    menu: root.querySelector('#audio-read-voice-menu'),
    preview: root.querySelector('#audio-read-voice-preview-btn')
  };
}

function setPreviewButtonState(button, stateName = 'idle') {
  if (!button) return;
  button.classList.toggle('is-loading', stateName === 'loading');
  button.classList.toggle('is-playing', stateName === 'playing');
  button.setAttribute('aria-pressed', String(stateName === 'playing'));
  button.disabled = false;
  const icon = stateName === 'loading' ? 'loader-circle' : stateName === 'playing' ? 'square' : 'play';
  button.innerHTML = `<i data-lucide="${icon}"></i>`;
  button.title = stateName === 'playing' ? 'Stop voice preview' : 'Preview selected voice';
  button.setAttribute('aria-label', button.title);
  refreshIcons();
}

async function finishVoicePreview(preview, error = null) {
  if (!preview || preview.finished) return;
  preview.finished = true;
  preview.cancelled = true;
  if (activeVoicePreview === preview) activeVoicePreview = null;
  try { preview.session?.close(1000, 'Voice preview finished'); } catch (_) {}
  preview.session = null;
  if (preview.engine) {
    try { await preview.engine.destroy(); } catch (_) {}
  }
  preview.engine = null;
  setPreviewButtonState(preview.button, 'idle');
  if (error) {
    console.error('Voice preview failed:', error);
    alert('Voice preview failed: ' + (error?.message || 'Unknown audio error'));
  }
}

async function stopVoicePreview() {
  const preview = activeVoicePreview;
  if (!preview) return;
  await finishVoicePreview(preview);
}

async function startVoicePreview(voiceName, button) {
  if (activeVoicePreview) {
    await stopVoicePreview();
    return;
  }

  if (!getApiSettings().voiceApiKey) {
    alert('Audio API key is missing. Add it in Settings > Audio Read before previewing a voice.');
    return;
  }

  const preview = {
    voiceName,
    button,
    engine: null,
    session: null,
    cancelled: false,
    finished: false
  };
  activeVoicePreview = preview;
  setPreviewButtonState(button, 'loading');

  try {
    preview.engine = new ReadAudioEngine({
      onPlaybackEnded: () => {
        if (activeVoicePreview === preview && !preview.cancelled) void finishVoicePreview(preview);
      }
    });
    await preview.engine.play();
    if (activeVoicePreview !== preview || preview.cancelled) return;

    preview.session = await startGeminiLiveAudio({
      text: VOICE_PREVIEW_TEXT,
      voiceName,
      callbacks: {
        onSetupComplete: () => {
          if (activeVoicePreview !== preview || preview.cancelled) return;
          setPreviewButtonState(button, 'playing');
        },
        onAudio: bytes => {
          if (activeVoicePreview !== preview || preview.cancelled) return;
          preview.engine?.appendPcmBytes(bytes);
        },
        onGenerationComplete: () => {
          if (activeVoicePreview !== preview || preview.cancelled) return;
          preview.engine?.markGenerationComplete();
        },
        onTurnComplete: () => {
          if (activeVoicePreview !== preview || preview.cancelled) return;
          try { preview.session?.close(1000, 'Voice preview turn complete'); } catch (_) {}
          preview.session = null;
        },
        onInterrupted: () => void finishVoicePreview(preview, new Error('Gemini Live audio was interrupted.')),
        onGoAway: () => void finishVoicePreview(preview, new Error('Gemini Live server requested disconnect.')),
        onError: error => void finishVoicePreview(preview, error)
      }
    });
  } catch (error) {
    await finishVoicePreview(preview, error);
  }
}

export function initReadSettingsUI() {
  const retentionInput = document.getElementById('audio-read-retention-input');
  const controls = ensureVoicePicker();
  if (!controls?.trigger || !controls.menu || !controls.label || !controls.preview || !retentionInput) return;
  if (controls.root?.dataset.initialized === 'true') return;
  if (controls.root) controls.root.dataset.initialized = 'true';

  const { trigger, label, menu, preview } = controls;
  let selectedVoice = normalizeVoice(state.audioRead?.voiceName);
  let currentRetention = normalizeRetention(state.audioRead?.retentionDays);
  label.textContent = selectedVoice;
  retentionInput.value = String(currentRetention);

  const closeMenu = ({ restoreFocus = false } = {}) => {
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    if (restoreFocus) trigger.focus();
  };

  const renderOptions = () => {
    menu.innerHTML = '';
    READ_AUDIO_VOICES.forEach(name => {
      const option = document.createElement('button');
      option.type = 'button';
      option.className = 'audio-voice-option';
      option.setAttribute('role', 'option');
      option.dataset.voice = name;
      option.setAttribute('aria-selected', String(name === selectedVoice));
      option.innerHTML = `<span>${name}</span>${name === selectedVoice ? '<i data-lucide="check"></i>' : '<span></span>'}`;
      option.addEventListener('click', async () => {
        const previousVoice = selectedVoice;
        selectedVoice = normalizeVoice(name);
        label.textContent = selectedVoice;
        renderOptions();
        closeMenu({ restoreFocus: true });
        if (activeVoicePreview && activeVoicePreview.voiceName !== selectedVoice) await stopVoicePreview();
        try {
          await persistAudioRead({ ...(state.audioRead || {}), voiceName: selectedVoice });
        } catch (error) {
          selectedVoice = normalizeVoice(state.audioRead?.voiceName || previousVoice);
          label.textContent = selectedVoice;
          renderOptions();
          console.error('Failed to save Read Aloud voice:', error);
          alert('Failed to save Read Aloud voice: ' + error.message);
        }
      });
      menu.appendChild(option);
    });
    refreshIcons();
  };

  const openMenu = (focusDirection = 0) => {
    renderOptions();
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    const options = [...menu.querySelectorAll('.audio-voice-option')];
    if (!options.length) return;
    const selectedIndex = Math.max(0, options.findIndex(option => option.dataset.voice === selectedVoice));
    const index = focusDirection < 0 ? Math.max(0, selectedIndex - 1) : focusDirection > 0 ? Math.min(options.length - 1, selectedIndex + 1) : selectedIndex;
    options[index]?.focus();
  };

  trigger.addEventListener('click', event => {
    event.stopPropagation();
    if (menu.classList.contains('hidden')) openMenu();
    else closeMenu();
  });

  trigger.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (menu.classList.contains('hidden')) openMenu(event.key === 'ArrowDown' ? 1 : -1);
    }
  });

  menu.addEventListener('keydown', event => {
    const options = [...menu.querySelectorAll('.audio-voice-option')];
    const currentIndex = options.indexOf(document.activeElement);
    let nextIndex = currentIndex;
    if (event.key === 'ArrowDown') nextIndex = Math.min(options.length - 1, currentIndex + 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(0, currentIndex - 1);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = options.length - 1;
    else if (event.key === 'Escape') {
      event.preventDefault();
      closeMenu({ restoreFocus: true });
      return;
    } else return;
    event.preventDefault();
    options[nextIndex]?.focus();
  });

  preview.addEventListener('click', () => {
    void startVoicePreview(selectedVoice, preview);
  });

  retentionInput.addEventListener('change', async () => {
    const retentionDays = normalizeRetention(retentionInput.value);
    const previousRetention = currentRetention;
    currentRetention = retentionDays;
    retentionInput.value = String(retentionDays);
    try {
      await persistAudioRead({ ...(state.audioRead || {}), retentionDays });
      await applyReadAudioRetentionPolicy(retentionDays);
    } catch (error) {
      currentRetention = normalizeRetention(state.audioRead?.retentionDays || previousRetention);
      retentionInput.value = String(currentRetention);
      console.error('Failed to save Audio Read retention:', error);
      alert('Failed to save Audio Read retention: ' + error.message);
    }
  });

  document.addEventListener('click', event => {
    if (!controls.picker?.contains(event.target)) closeMenu();
  });

  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !menu.classList.contains('hidden')) closeMenu({ restoreFocus: true });
  });

  document.getElementById('settings-back-btn')?.addEventListener('click', () => {
    closeMenu();
    void stopVoicePreview();
  });
  document.getElementById('close-settings-modal-btn')?.addEventListener('click', () => {
    closeMenu();
    void stopVoicePreview();
  });

  renderOptions();
  setPreviewButtonState(preview, 'idle');
}
