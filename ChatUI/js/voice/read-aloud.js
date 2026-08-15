/**
 * read-aloud.js — Read Aloud coordinator across toolbar, Live API, cache, and player.
 */

import { state } from '../state/store.js';
import { getApiSettings } from '../api/api-config.js';
import { startGeminiLiveAudio } from '../api/gemini-live-audio.js';
import { ReadAudioEngine } from './read-audio-engine.js';
import { initReadSelection } from './read-selection.js';
import { loadValidReadAudio, persistReadAudioJob } from './read-audio-cache.js';
import {
  deleteReadAudio,
  deleteReadAudioForMessages,
  deleteReadAudioForChat,
  cleanupExpiredReadAudio
} from '../storage/storage.js';
import {
  getReadGenerationFraction,
  renderReadPlayer,
  startReadPlayerLoop,
  stopReadPlayerLoop,
  initReadPlayerUi
} from './read-player-ui.js';

let activeJob = null;
let jobSequence = 0;
let cleanupTimer = null;

function normalizeText(value) {
  return String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/[ \t]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
function currentMessage(chatId, messageId) {
  const chat = state.chats.find(item => item.id === chatId) || null;
  const message = chat?.messages?.find(item => item.id === messageId) || null;
  return { chat, message };
}

function readableText(row, fallbackText) {
  const slot = row?.querySelector?.('.content-slot');
  if (!slot) return normalizeText(fallbackText);
  const clone = slot.cloneNode(true);
  clone.querySelectorAll('.streaming-cursor, button').forEach(node => node.remove());
  return normalizeText(clone.innerText || clone.textContent || fallbackText);
}

function isLiveIncomplete(job) {
  return job?.mode === 'live' && !job.generationComplete && !job.failed && !job.cancelled;
}

async function disposeJob(job, cancelLive = true) {
  if (!job) return;
  job.cancelled = true;
  if (cancelLive) {
    try { job.session?.close(1000, 'Audio Read source closed'); } catch (error) {}
  }
  job.session = null;
  if (job.audio) {
    try { job.audio.pause(); } catch (error) {}
    job.audio.removeAttribute('src');
    try { job.audio.load(); } catch (error) {}
  }
  if (job.objectUrl) {
    try { URL.revokeObjectURL(job.objectUrl); } catch (error) {}
  }
  if (job.engine) await job.engine.destroy();
  if (activeJob === job) activeJob = null;
  renderReadPlayer(activeJob);
  if (!activeJob) stopReadPlayerLoop();
}

async function startCached(job, cached) {
  job.mode = 'cached';
  job.status = 'cached-playing';
  job.generationComplete = true;
  job.objectUrl = URL.createObjectURL(cached.data);
  job.audio = new Audio(job.objectUrl);
  job.audio.preload = 'auto';
  job.duration = Number(cached.durationMs || 0) / 1000;
  activeJob = job;
  startReadPlayerLoop();

  job.audio.addEventListener('loadedmetadata', () => {
    if (activeJob !== job) return;
    if (Number.isFinite(job.audio.duration)) job.duration = job.audio.duration;
    renderReadPlayer(job);
  });
  job.audio.addEventListener('timeupdate', () => activeJob === job && renderReadPlayer(job));
  job.audio.addEventListener('ended', () => {
    if (activeJob !== job) return;
    job.status = 'cached-paused';
    renderReadPlayer(job);
  });
  job.audio.addEventListener('error', async () => {
    if (activeJob !== job) return;
    await deleteReadAudio(job.messageId).catch(() => undefined);
    alert('Saved Read Aloud audio could not be played and was removed. Click Read again to regenerate it.');
    await disposeJob(job);
  });
  try { await job.audio.play(); }
  catch (error) {
    job.status = 'cached-paused';
    console.warn('Cached audio playback was blocked:', error);
  }
  renderReadPlayer(job);
}

async function saveCompletedJob(job) {
  if (!job || job.sourceType !== 'message' || job.cancelled || job.failed || job.cacheSaved || job.cacheSaving) return;
  if (!job.generationComplete || !job.engine?.totalBytes) return;
  const fresh = currentMessage(job.chatId, job.messageId).message;
  if (!fresh || fresh.updatedAt !== job.sourceUpdatedAt || normalizeText(fresh.content) !== job.sourceRawText) return;

  job.cacheSaving = true;
  const saved = await persistReadAudioJob(job, Number(state.audioRead?.retentionDays ?? 7));
  job.cacheSaving = false;
  job.cacheSaved = saved;
  if (!saved && !job.hidden) alert('The audio finished, but it could not be saved in local storage.');
}

async function failLive(job, error) {
  if (!job || job.failed || job.cancelled) return;
  job.failed = true;
  job.status = 'error';
  try { job.session?.close(1011, 'Audio Read failed'); } catch (closeError) {}
  job.session = null;
  job.engine?.markGenerationComplete();
  console.error('Gemini Live Read Aloud failed:', error);
  if (!job.hidden) alert('Read Aloud generation failed: ' + (error?.message || 'Unknown Live API error'));
  renderReadPlayer(job);
}
async function startLive(job) {
  if (!getApiSettings().voiceApiKey) throw new Error('Audio API key is missing. Open Settings > Audio Read.');
  job.mode = 'live';
  job.status = 'connecting';
  job.engine = new ReadAudioEngine({
    onPlaybackEnded: () => {
      if (activeJob !== job) return;
      if (job.generationComplete) job.status = 'completed';
      renderReadPlayer(job);
    }
  });
  activeJob = job;
  startReadPlayerLoop();
  renderReadPlayer(job);
  await job.engine.play();

  job.session = await startGeminiLiveAudio({
    text: job.sourceText,
    voiceName: job.voiceName,
    callbacks: {
      onSetupComplete: () => {
        if (activeJob !== job || job.cancelled) return;
        job.status = 'live-playing';
        renderReadPlayer(job);
      },
      onAudio: bytes => {
        if (activeJob !== job || job.cancelled || job.failed) return;
        job.engine.appendPcmBytes(bytes);
        renderReadPlayer(job);
      },
      onTranscription: text => {
        if (activeJob !== job || job.cancelled) return;
        job.transcription += text || '';
      },
      onGenerationComplete: () => {
        if (activeJob !== job || job.cancelled || job.generationComplete) return;
        job.generationComplete = true;
        job.status = job.engine.playing ? 'live-playing' : 'live-paused';
        job.engine.markGenerationComplete();
        renderReadPlayer(job);
        saveCompletedJob(job);
      },
      onTurnComplete: () => {
        if (activeJob !== job || job.cancelled) return;
        try { job.session?.close(1000, 'Read Aloud turn complete'); } catch (error) {}
        job.session = null;
      },
      onInterrupted: () => failLive(job, new Error('Gemini Live audio was interrupted.')),
      onGoAway: () => failLive(job, new Error('Gemini Live server requested disconnect.')),
      onError: error => failLive(job, error)
    }
  });
}

function createJob(chat, message, row) {
  return {
    id: ++jobSequence,
    sourceType: 'message',
    chatId: chat.id,
    messageId: message.id,
    sourceUpdatedAt: message.updatedAt,
    sourceText: readableText(row, message.content),
    sourceRawText: normalizeText(message.content),
    voiceName: state.audioRead?.voiceName || 'Zephyr',
    transcription: '', hidden: false, generationComplete: false,
    cacheSaved: false, cacheSaving: false, failed: false, cancelled: false, status: 'idle'
  };
}
export async function readAssistantMessage(chatId, messageId, row) {
  const { chat, message } = currentMessage(chatId, messageId);
  if (!chat || !message || message.role !== 'assistant') return;
  if (!['completed', 'interrupted'].includes(message.status) || !message.content?.trim()) return;
  const candidate = createJob(chat, message, row);
  if (!candidate.sourceText) return;

  if (activeJob?.messageId === messageId && activeJob?.chatId === chatId) {
    if (activeJob.failed) await disposeJob(activeJob);
    else {
      activeJob.hidden = false;
      await toggleReadPlayback(true);
      renderReadPlayer(activeJob);
      return;
    }
  }

  if (isLiveIncomplete(activeJob)) {
    alert('Another Read Aloud audio is still being generated. Let it finish before starting a different uncached answer.');
    return;
  }
  if (activeJob) await disposeJob(activeJob);

  const cached = await loadValidReadAudio(messageId, message.updatedAt, candidate.sourceText);
  if (cached) {
    await startCached(candidate, cached);
    return;
  }
  try { await startLive(candidate); }
  catch (error) { await failLive(candidate, error); }
}

export async function readSelectedText(text) {
  const sourceText = normalizeText(text);
  if (!sourceText) return;
  if (activeJob?.sourceType === 'selection' && activeJob.sourceText === sourceText && !activeJob.failed) {
    activeJob.hidden = false;
    await toggleReadPlayback(true);
    renderReadPlayer(activeJob);
    return;
  }
  if (isLiveIncomplete(activeJob)) {
    alert('Another Read Aloud audio is still being generated. Let it finish before starting a different selection.');
    return;
  }
  if (activeJob) await disposeJob(activeJob);
  const job = {
    id: ++jobSequence, sourceType: 'selection', chatId: state.activeChatId || null, messageId: null,
    sourceText, sourceRawText: sourceText, voiceName: state.audioRead?.voiceName || 'Zephyr',
    transcription: '', hidden: false, generationComplete: false,
    cacheSaved: false, cacheSaving: false, failed: false, cancelled: false, status: 'idle'
  };
  try { await startLive(job); }
  catch (error) { await failLive(job, error); }
}

export async function toggleReadPlayback(forcePlay = false) {
  const job = activeJob;
  if (!job) return;
  if (job.mode === 'cached') {
    const audio = job.audio;
    if (!audio) return;
    const shouldPlay = forcePlay || audio.paused || audio.ended;
    if (shouldPlay) {
      if (audio.ended || (Number.isFinite(audio.duration) && audio.currentTime >= audio.duration)) audio.currentTime = 0;
      try { await audio.play(); } catch (error) { console.warn('Read Aloud play failed:', error); }
      job.status = 'cached-playing';
    } else {
      audio.pause();
      job.status = 'cached-paused';
    }
  } else if (job.engine) {
    const shouldPlay = forcePlay || !job.engine.playing;
    if (shouldPlay) {
      if (job.generationComplete && job.engine.getCurrentTime() >= job.engine.generatedDuration) await job.engine.seek(0);
      await job.engine.play();
      job.status = 'live-playing';
    } else {
      await job.engine.pause();
      job.status = 'live-paused';
    }
  }
  renderReadPlayer(job);
}
export async function seekReadPlayback(globalFraction) {
  const job = activeJob;
  if (!job) return;
  const fraction = Math.max(0, Math.min(1, Number(globalFraction) || 0));
  if (job.mode === 'cached') {
    const duration = Number.isFinite(job.audio?.duration) ? job.audio.duration : job.duration;
    if (job.audio && duration > 0) job.audio.currentTime = fraction * duration;
  } else if (job.engine) {
    const generated = Math.max(0.0001, getReadGenerationFraction(job));
    await job.engine.seek(Math.min(1, fraction / generated) * job.engine.generatedDuration);
  }
  renderReadPlayer(job);
}

export async function hideReadPlayer() {
  if (!activeJob) return;
  activeJob.hidden = true;
  if (activeJob.mode === 'cached') {
    activeJob.audio?.pause();
    activeJob.status = 'cached-paused';
  } else if (activeJob.engine) {
    await activeJob.engine.pause();
    activeJob.status = activeJob.generationComplete ? 'completed' : 'live-hidden';
  }
  renderReadPlayer(activeJob);
}

export async function invalidateReadAudioForMessage(messageId) {
  if (!messageId) return;
  if (activeJob?.messageId === messageId) await disposeJob(activeJob);
  await deleteReadAudio(messageId);
}
export async function invalidateReadAudioForMessages(messageIds = []) {
  const ids = [...new Set((messageIds || []).filter(Boolean))];
  if (!ids.length) return;
  if (activeJob && ids.includes(activeJob.messageId)) await disposeJob(activeJob);
  await deleteReadAudioForMessages(ids);
}

export async function invalidateReadAudioForChat(chatId) {
  if (!chatId) return;
  if (activeJob?.chatId === chatId) await disposeJob(activeJob);
  await deleteReadAudioForChat(chatId);
}

export async function stopActiveReadForChat(chatId) {
  if (activeJob?.chatId === chatId) await disposeJob(activeJob);
}

export async function stopActiveReadAloud() {
  if (activeJob) await disposeJob(activeJob);
  else {
    renderReadPlayer(null);
    stopReadPlayerLoop();
  }
}

export function isReadAloudActiveForMessage(messageId) {
  return !!activeJob && activeJob.messageId === messageId;
}

export function initReadAloud() {
  initReadSelection();
  initReadPlayerUi(() => activeJob, {
    onToggle: () => toggleReadPlayback(),
    onSeek: fraction => seekReadPlayback(fraction),
    onClose: () => hideReadPlayer()
  });
  cleanupExpiredReadAudio().catch(error => console.warn('Read Aloud startup cleanup failed:', error));
  if (!cleanupTimer) {
    cleanupTimer = window.setInterval(() => {
      cleanupExpiredReadAudio().catch(error => console.warn('Read Aloud cleanup failed:', error));
    }, 60 * 60 * 1000);
  }
  window.addEventListener('pagehide', () => {
    try { activeJob?.session?.close(1000, 'Page closing'); } catch (error) {}
  });
}
