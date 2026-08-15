/**
 * voice-ui.js — Full-screen Voice Mode overlay facade.
 */

import { runtime, setRuntime } from '../state/store.js';
import {
  startLiveVoiceMode,
  stopLiveVoiceMode,
  toggleLiveVoiceMuted,
  toggleLiveVoiceAutoDetect,
  handleLiveVoiceOrbAction
} from './live-voice-controller.js';

let sidebarCallback = null;
let levelFrameId = null;
let pendingLevel = 0;

const STATE_CLASSES = [
  'is-listening',
  'is-hearing-speech',
  'is-processing',
  'is-speaking',
  'is-queued-user-turn',
  'is-muted',
  'has-error'
];

function stateLabel(state) {
  switch (state) {
    case 'listening': return 'Your turn';
    case 'speech-detected': return 'Listening to you';
    case 'ending-user-turn': return 'Finishing your voice message';
    case 'sending': return 'Sending';
    case 'waiting-for-response': return 'Processing response';
    case 'speaking': return 'Assistant speaking';
    case 'queued-user-turn': return 'Your voice message is queued';
    case 'muted': return 'Microphone muted';
    case 'error': return 'Voice Mode error';
    default: return 'Voice Mode';
  }
}

function renderVoiceLevel(level) {
  pendingLevel = Math.max(0, Math.min(1, Number(level) || 0));
  if (levelFrameId !== null) return;
  levelFrameId = requestAnimationFrame(() => {
    levelFrameId = null;
    const overlay = document.getElementById('voice-mode-overlay');
    if (!overlay) return;
    const value = pendingLevel;
    overlay.style.setProperty('--voice-level', value.toFixed(3));
    overlay.style.setProperty('--voice-scale', (1 + value * 0.16).toFixed(3));
    overlay.style.setProperty('--voice-wave-scale', (1 + value * 0.12).toFixed(3));
    overlay.style.setProperty('--voice-glow-size', `${Math.round(48 + value * 48)}px`);
    overlay.style.setProperty('--voice-wave-opacity', (0.20 + value * 0.55).toFixed(3));
    overlay.style.setProperty('--voice-wave2-opacity', (0.12 + value * 0.42).toFixed(3));
  });
}

function renderAutoDetectButton(button, enabled) {
  if (!button) return;
  button.classList.toggle('is-off', !enabled);
  button.title = enabled ? 'Auto Detect: On' : 'Auto Detect: Off';
  button.setAttribute('aria-label', enabled ? 'Auto Detect on' : 'Auto Detect off');
  button.setAttribute('aria-pressed', enabled ? 'true' : 'false');
  const desiredIcon = enabled ? 'audio-lines' : 'circle-slash';
  if (button.dataset.voiceAutoIcon !== desiredIcon) {
    button.dataset.voiceAutoIcon = desiredIcon;
    button.innerHTML = `<i data-lucide="${desiredIcon}" id="voice-auto-detect-icon"></i>`;
    if (typeof lucide !== 'undefined') lucide.createIcons?.();
  }
}

function renderOrbAction(orb, { canFinishTurn, canInterrupt } = {}) {
  if (!orb) return;
  if (canInterrupt) {
    orb.disabled = false;
    orb.title = 'Interrupt assistant and speak';
    orb.setAttribute('aria-label', 'Interrupt assistant and speak');
    return;
  }
  if (canFinishTurn) {
    orb.disabled = false;
    orb.title = 'Finish speaking';
    orb.setAttribute('aria-label', 'Finish speaking');
    return;
  }
  orb.disabled = true;
  orb.removeAttribute('title');
  orb.setAttribute('aria-label', 'Voice status');
}

function renderVoiceState({ state, muted, autoDetectEnabled = true, canFinishTurn = false, canInterrupt = false } = {}) {
  const overlay = document.getElementById('voice-mode-overlay');
  const micBtn = document.getElementById('voice-mic-btn');
  const autoDetectBtn = document.getElementById('voice-auto-detect-btn');
  const orb = document.getElementById('voice-orb-btn');
  const status = document.getElementById('voice-mode-status');
  if (!overlay) return;

  STATE_CLASSES.forEach(className => overlay.classList.remove(className));
  if (state === 'listening') overlay.classList.add('is-listening');
  else if (state === 'speech-detected') overlay.classList.add('is-hearing-speech');
  else if (['ending-user-turn', 'sending', 'waiting-for-response'].includes(state)) overlay.classList.add('is-processing');
  else if (state === 'speaking') overlay.classList.add('is-speaking');
  else if (state === 'queued-user-turn') overlay.classList.add('is-queued-user-turn');
  else if (state === 'error') overlay.classList.add('has-error');
  if (muted) overlay.classList.add('is-muted');

  if (!['listening', 'speech-detected', 'speaking'].includes(state)) renderVoiceLevel(0);

  if (status) status.textContent = muted && state !== 'speaking'
    ? 'Microphone muted'
    : stateLabel(state);

  if (micBtn) {
    micBtn.classList.toggle('muted', !!muted);
    micBtn.title = muted ? 'Unmute Mic' : 'Mute Mic';
    micBtn.setAttribute('aria-pressed', muted ? 'true' : 'false');
    const desiredIcon = muted ? 'mic-off' : 'mic';
    if (micBtn.dataset.voiceIcon !== desiredIcon) {
      micBtn.dataset.voiceIcon = desiredIcon;
      micBtn.innerHTML = `<i data-lucide="${desiredIcon}" id="voice-mic-icon"></i>`;
      if (typeof lucide !== 'undefined') lucide.createIcons?.();
    }
  }

  renderAutoDetectButton(autoDetectBtn, !!autoDetectEnabled);
  renderOrbAction(orb, { canFinishTurn, canInterrupt });
}

export function openVoiceMode() {
  const voiceModeOverlay = document.getElementById('voice-mode-overlay');
  const openVoiceModeBtn = document.getElementById('open-voice-mode-btn');
  const closeVoiceModeBtn = document.getElementById('close-voice-mode-btn');

  if (!voiceModeOverlay || !voiceModeOverlay.classList.contains('hidden')) return;
  setRuntime({ lastFocusedElement: document.activeElement });
  voiceModeOverlay.classList.remove('hidden');
  if (openVoiceModeBtn) openVoiceModeBtn.classList.add('hidden');
  closeVoiceModeBtn?.focus();
  renderVoiceLevel(0);
  renderVoiceState({ state: 'listening', muted: false, autoDetectEnabled: true });
  void startLiveVoiceMode({
    onStateChange: renderVoiceState,
    onLevelChange: renderVoiceLevel,
    onRequestFailure: () => closeVoiceMode(),
    sidebarCallback
  });
}

export function closeVoiceMode() {
  const voiceModeOverlay = document.getElementById('voice-mode-overlay');
  const openVoiceModeBtn = document.getElementById('open-voice-mode-btn');

  void stopLiveVoiceMode();
  renderVoiceLevel(0);
  if (voiceModeOverlay) {
    voiceModeOverlay.classList.add('hidden');
    STATE_CLASSES.forEach(className => voiceModeOverlay.classList.remove(className));
  }
  if (openVoiceModeBtn) openVoiceModeBtn.classList.remove('hidden');
  if (runtime.lastFocusedElement && typeof runtime.lastFocusedElement.focus === 'function') {
    runtime.lastFocusedElement.focus();
  }
}

export function initVoiceUI(updateSidebarCallback = null) {
  sidebarCallback = updateSidebarCallback;
  const openVoiceModeBtn = document.getElementById('open-voice-mode-btn');
  const closeVoiceModeBtn = document.getElementById('close-voice-mode-btn');
  const voiceMicBtn = document.getElementById('voice-mic-btn');
  const autoDetectBtn = document.getElementById('voice-auto-detect-btn');
  const orb = document.getElementById('voice-orb-btn');

  openVoiceModeBtn?.addEventListener('click', openVoiceMode);
  closeVoiceModeBtn?.addEventListener('click', closeVoiceMode);

  voiceMicBtn?.addEventListener('click', async () => {
    await toggleLiveVoiceMuted();
  });

  autoDetectBtn?.addEventListener('click', () => {
    toggleLiveVoiceAutoDetect();
  });

  orb?.addEventListener('click', () => {
    void handleLiveVoiceOrbAction();
  });

  renderVoiceLevel(0);
  renderVoiceState({ state: 'closed', muted: runtime.isVoiceMuted, autoDetectEnabled: true });
}
