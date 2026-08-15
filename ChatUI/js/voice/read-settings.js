/**
 * read-settings.js — Audio Read voice and cache-retention settings.
 */

import { state, setState } from '../state/store.js';
import { persistSettings, applyReadAudioRetentionPolicy } from '../storage/storage.js';

export const READ_AUDIO_VOICES = [
  'Zephyr', 'Puck', 'Charon', 'Kore', 'Fenrir', 'Leda', 'Orus', 'Aoede',
  'Callirrhoe', 'Autonoe', 'Enceladus', 'Iapetus', 'Umbriel', 'Algieba',
  'Despina', 'Erinome', 'Algenib', 'Rasalgethi', 'Laomedeia', 'Achernar',
  'Alnilam', 'Schedar', 'Gacrux', 'Pulcherrima', 'Achird', 'Zubenelgenubi',
  'Vindemiatrix', 'Sadachbia', 'Sadaltager', 'Sulafat'
];

function normalizeVoice(value) {
  return READ_AUDIO_VOICES.includes(value) ? value : 'Zephyr';
}

function normalizeRetention(value) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < -1) return null;
  return parsed;
}

async function persistAudioRead(nextAudioRead) {
  const previous = state.audioRead;
  setState({ audioRead: nextAudioRead });
  try {
    await persistSettings();
  } catch (error) {
    setState({ audioRead: previous });
    throw error;
  }
}
export function initReadSettingsUI() {
  const voiceSelect = document.getElementById('audio-read-voice-select');
  const retentionInput = document.getElementById('audio-read-retention-input');
  if (!voiceSelect || !retentionInput) return;

  voiceSelect.replaceChildren(...READ_AUDIO_VOICES.map(name => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    return option;
  }));

  const currentVoice = normalizeVoice(state.audioRead?.voiceName);
  const currentRetention = normalizeRetention(state.audioRead?.retentionDays) ?? 7;
  voiceSelect.value = currentVoice;
  retentionInput.value = String(currentRetention);

  voiceSelect.addEventListener('change', async () => {
    const voiceName = normalizeVoice(voiceSelect.value);
    try {
      await persistAudioRead({ ...state.audioRead, voiceName });
    } catch (error) {
      voiceSelect.value = normalizeVoice(state.audioRead?.voiceName);
      console.error('Failed to save Audio Read voice:', error);
      alert('Failed to save Audio Read voice: ' + error.message);
    }
  });

  retentionInput.addEventListener('change', async () => {
    const retentionDays = normalizeRetention(retentionInput.value);
    if (retentionDays === null) {
      retentionInput.setCustomValidity('Enter -1 or a non-negative whole number of days.');
      retentionInput.reportValidity();
      retentionInput.value = String(state.audioRead?.retentionDays ?? 7);
      return;
    }
    retentionInput.setCustomValidity('');
    try {
      await persistAudioRead({ ...state.audioRead, retentionDays });
      await applyReadAudioRetentionPolicy(retentionDays);
    } catch (error) {
      retentionInput.value = String(state.audioRead?.retentionDays ?? 7);
      console.error('Failed to save Audio Read retention:', error);
      alert('Failed to save Audio Read retention: ' + error.message);
    }
  });
}
