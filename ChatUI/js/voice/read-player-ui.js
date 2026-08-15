/**
 * read-player-ui.js — Floating Read Aloud player rendering and controls.
 */

let getActiveJob = () => null;
let callbacks = {};
let timer = null;

function elements() {
  return {
    root: document.getElementById('read-aloud-player'),
    playBtn: document.getElementById('read-aloud-play-btn'),
    seek: document.getElementById('read-aloud-seek'),
    generationFill: document.getElementById('read-aloud-generation-fill'),
    playbackFill: document.getElementById('read-aloud-playback-fill'),
    currentTime: document.getElementById('read-aloud-current-time'),
    totalTime: document.getElementById('read-aloud-total-time'),
    closeBtn: document.getElementById('read-aloud-close-btn')
  };
}

function normalizeLength(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().length;
}

export function formatReadTime(seconds) {
  const safe = Number.isFinite(Number(seconds)) && Number(seconds) > 0 ? Math.floor(Number(seconds)) : 0;
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function ariaReadTime(seconds) {
  const safe = Math.max(0, Math.floor(Number(seconds) || 0));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const secs = safe % 60;
  return [hours ? `${hours} hour${hours === 1 ? '' : 's'}` : '', minutes ? `${minutes} minute${minutes === 1 ? '' : 's'}` : '', `${secs} second${secs === 1 ? '' : 's'}`].filter(Boolean).join(' ');
}

export function getReadGenerationFraction(job) {
  if (!job) return 0;
  if (job.mode === 'cached' || job.generationComplete) return 1;
  const sourceLength = Math.max(1, normalizeLength(job.sourceText));
  const spokenLength = normalizeLength(job.transcription);
  const hasAudio = (job.engine?.generatedDuration || 0) > 0;
  return Math.min(0.98, Math.max(hasAudio ? 0.04 : 0, spokenLength / sourceLength));
}
function playbackState(job) {
  if (!job) return { playing: false, current: 0, duration: 0 };
  if (job.mode === 'cached') {
    const audio = job.audio;
    return {
      playing: !!audio && !audio.paused && !audio.ended,
      current: Number(audio?.currentTime) || 0,
      duration: Number.isFinite(audio?.duration) ? audio.duration : (job.duration || 0)
    };
  }
  return {
    playing: !!job.engine?.playing,
    current: job.engine?.getCurrentTime?.() || 0,
    duration: job.engine?.generatedDuration || 0
  };
}

function syncToolbar(job) {
  document.querySelectorAll('.read-msg-btn').forEach(button => {
    const same = !!job && button.dataset.readMessageId === job.messageId;
    button.classList.toggle('is-reading', same);
    button.classList.toggle('is-loading', same && job.status === 'connecting');
    button.setAttribute('aria-pressed', same ? 'true' : 'false');
  });
}

function syncPlayIcon(button, playing) {
  const iconName = playing ? 'pause' : 'play';
  if (button.dataset.readIcon === iconName) return;
  button.dataset.readIcon = iconName;
  button.innerHTML = `<i data-lucide="${iconName}"></i>`;
  if (typeof lucide !== 'undefined') lucide.createIcons?.();
}
export function renderReadPlayer(job = getActiveJob()) {
  const { root, playBtn, seek, generationFill, playbackFill, currentTime, totalTime } = elements();
  if (!root || !playBtn || !seek || !generationFill || !playbackFill || !currentTime || !totalTime) return;
  if (!job || job.hidden) {
    root.classList.add('hidden');
    syncToolbar(job);
    return;
  }

  root.classList.remove('hidden');
  root.classList.toggle('is-generating', job.mode === 'live' && !job.generationComplete && !job.failed && !job.cancelled);
  const generation = getReadGenerationFraction(job);
  const playback = playbackState(job);
  const local = playback.duration > 0 ? Math.max(0, Math.min(1, playback.current / playback.duration)) : 0;
  const global = job.mode === 'cached' || job.generationComplete ? local : generation * local;

  generationFill.style.width = `${generation * 100}%`;
  playbackFill.style.width = `${global * 100}%`;
  seek.value = String(Math.round(global * 1000));
  currentTime.textContent = formatReadTime(playback.current);
  totalTime.textContent = formatReadTime(playback.duration);
  seek.setAttribute('aria-valuetext', `${ariaReadTime(playback.current)} of ${ariaReadTime(playback.duration)} available`);
  syncPlayIcon(playBtn, playback.playing);
  playBtn.title = playback.playing ? 'Pause audio' : 'Play audio';
  playBtn.setAttribute('aria-label', playBtn.title);
  syncToolbar(job);
}

export function startReadPlayerLoop() {
  if (!timer) timer = window.setInterval(() => renderReadPlayer(), 100);
}

export function stopReadPlayerLoop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}
export function initReadPlayerUi(activeJobGetter, handlers = {}) {
  getActiveJob = typeof activeJobGetter === 'function' ? activeJobGetter : () => null;
  callbacks = handlers;
  const { playBtn, seek, closeBtn } = elements();
  playBtn?.addEventListener('click', () => callbacks.onToggle?.());
  seek?.addEventListener('input', event => {
    callbacks.onSeek?.((Number(event.target.value) || 0) / 1000);
  });
  closeBtn?.addEventListener('click', () => callbacks.onClose?.());
  renderReadPlayer();
}
