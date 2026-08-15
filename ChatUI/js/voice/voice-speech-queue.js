/**
 * voice-speech-queue.js — Sentence-aware one-ahead TTS generation + strict sequential playback.
 */

import { startGeminiLiveAudio, LIVE_AUDIO_SAMPLE_RATE } from '../api/gemini-live-audio.js';
import { ReadAudioEngine } from './read-audio-engine.js';

const MIN_SENTENCES_PER_STREAMING_CHUNK = 3;
const HALF_CHECKPOINT = 0.5;
const PLAYBACK_POLL_MS = 100;
const PLAYBACK_LEVEL_FLOOR = 0.004;
const PLAYBACK_LEVEL_PEAK_REFERENCE = 0.20;
const PLAYBACK_LEVEL_ATTACK = 0.50;
const PLAYBACK_LEVEL_RELEASE = 0.14;
const TERMINAL_PUNCTUATION = /[.!?\u061F\u3002\uFF01\uFF1F](?:["'\u201D\u2019)\]}*_~`]+)?\s*$/u;

function safeCall(callback, ...args) {
  try { callback?.(...args); }
  catch (error) { console.error('Live Voice speech callback failed:', error); }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function cleanChunkText(value) {
  return String(value || '')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function fallbackSentenceRanges(text) {
  const ranges = [];
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    const terminal = '.!?\u061F\u3002\uFF01\uFF1F'.includes(char);
    const paragraphBreak = char === '\n' && text[index + 1] === '\n';
    if (!terminal && !paragraphBreak) continue;

    let end = paragraphBreak ? index + 2 : index + 1;
    while (end < text.length && /["'\u201D\u2019)\]}*_~`]/u.test(text[end])) end += 1;
    while (end < text.length && /\s/u.test(text[end])) end += 1;
    ranges.push({ start, end, text: text.slice(start, end) });
    start = end;
    index = Math.max(index, end - 1);
  }
  return ranges;
}

function segmentSentenceRanges(text) {
  if (!text) return [];
  if (typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function') {
    try {
      const segmenter = new Intl.Segmenter(undefined, { granularity: 'sentence' });
      const ranges = [];
      for (const part of segmenter.segment(text)) {
        const segmentText = String(part.segment || '');
        const end = Number(part.index) + segmentText.length;
        const trimmed = segmentText.trim();
        const paragraphComplete = /\n\s*\n\s*$/u.test(segmentText);
        if (trimmed && (TERMINAL_PUNCTUATION.test(trimmed) || paragraphComplete)) {
          ranges.push({ start: Number(part.index), end, text: segmentText });
        }
      }
      return ranges;
    } catch (error) {
      console.warn('Intl.Segmenter sentence parsing failed; using fallback parser.', error);
    }
  }
  return fallbackSentenceRanges(text);
}

export class VoiceSentenceBuffer {
  constructor() {
    this.sourceText = '';
    this.committedOffset = 0;
  }

  update(fullText) {
    const next = String(fullText || '');
    if (next.length < this.committedOffset) return;
    this.sourceText = next;
  }

  takeStreamingReady(minSentences = MIN_SENTENCES_PER_STREAMING_CHUNK) {
    const pending = this.sourceText.slice(this.committedOffset);
    const ranges = segmentSentenceRanges(pending);
    if (ranges.length < minSentences) return null;
    const last = ranges[ranges.length - 1];
    const endOffset = this.committedOffset + last.end;
    const text = cleanChunkText(this.sourceText.slice(this.committedOffset, endOffset));
    this.committedOffset = endOffset;
    return text || null;
  }

  takeFinal() {
    if (this.committedOffset >= this.sourceText.length) return null;
    const text = cleanChunkText(this.sourceText.slice(this.committedOffset));
    this.committedOffset = this.sourceText.length;
    return text || null;
  }

  get hasPendingText() {
    return cleanChunkText(this.sourceText.slice(this.committedOffset)).length > 0;
  }
}

export function prepareLiveVoicePlaybackContext() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) throw new Error('Web Audio API is not supported in this browser.');
  const context = new AudioContextClass({ sampleRate: LIVE_AUDIO_SAMPLE_RATE });
  const resumePromise = context.resume().catch(error => {
    console.warn('Live Voice audio context could not resume immediately:', error);
  });
  return { context, resumePromise };
}

export class LiveVoiceSpeechQueue {
  constructor({ audioContext, voiceName = 'Zephyr', onPlaybackStart, onPlaybackLevel, onDrained, onError } = {}) {
    if (!audioContext) throw new Error('Live Voice requires a prepared AudioContext.');
    this.audioContext = audioContext;
    this.voiceName = voiceName;
    this.onPlaybackStart = onPlaybackStart;
    this.onPlaybackLevel = onPlaybackLevel;
    this.onDrained = onDrained;
    this.onError = onError;
    this.sentenceBuffer = new VoiceSentenceBuffer();
    this.chunks = [];
    this.currentChunk = null;
    this.finalReceived = false;
    this.cancelled = false;
    this.failed = false;
    this.sequence = 0;
    this.halfTimer = null;
    this.playbackLevelFrame = null;
    this.playbackLevel = 0;
    this.playbackAnalyser = this.audioContext.createAnalyser();
    this.playbackAnalyser.fftSize = 1024;
    this.playbackAnalyser.smoothingTimeConstant = 0;
    this.playbackSamples = new Float32Array(this.playbackAnalyser.fftSize);
    this.playbackAnalyser.connect(this.audioContext.destination);
  }

  updateAssistantText(fullText) {
    if (this.cancelled || this.failed || this.finalReceived) return;
    this.sentenceBuffer.update(fullText);
    this._maybeCreateStreamingChunk();
  }

  completeAssistantText(fullText) {
    if (this.cancelled || this.failed || this.finalReceived) return;
    this.sentenceBuffer.update(fullText);
    this.finalReceived = true;

    const remaining = this.sentenceBuffer.takeFinal();
    if (remaining) this._enqueueText(remaining, { final: true });
    this._pump();
    this._checkDrained();
  }

  _activeFutureChunk() {
    return this.chunks.find(chunk => chunk !== this.currentChunk && ['preparing', 'ready'].includes(chunk.status)) || null;
  }

  _pendingChunk() {
    return this.chunks.find(chunk => chunk.status === 'pending') || null;
  }

  _canCreateStreamingChunk() {
    const active = this.chunks.filter(chunk => ['pending', 'preparing', 'ready', 'playing'].includes(chunk.status));
    if (active.length === 0) return true;
    if (!this.currentChunk) return false;
    if (!this.currentChunk.halfReached) return false;
    return !active.some(chunk => chunk !== this.currentChunk);
  }

  _maybeCreateStreamingChunk() {
    if (!this._canCreateStreamingChunk()) return;
    const text = this.sentenceBuffer.takeStreamingReady();
    if (!text) return;
    this._enqueueText(text, { final: false });
    this._pump();
  }

  _enqueueText(text, { final = false } = {}) {
    const clean = cleanChunkText(text);
    if (!clean) return null;
    const chunk = {
      id: ++this.sequence,
      text: clean,
      final,
      status: 'pending',
      session: null,
      engine: null,
      generationComplete: false,
      playbackStarted: false,
      halfReached: false
    };
    this.chunks.push(chunk);
    return chunk;
  }

  _canPreparePending() {
    if (this._activeFutureChunk()) return false;
    if (!this.currentChunk) return true;
    return this.currentChunk.halfReached;
  }

  _pump() {
    if (this.cancelled || this.failed) return;
    this._pumpPlayback();

    const pending = this._pendingChunk();
    if (pending && this._canPreparePending()) void this._prepareChunk(pending);
  }

  async _prepareChunk(chunk) {
    if (!chunk || chunk.status !== 'pending' || this.cancelled || this.failed) return;
    chunk.status = 'preparing';
    chunk.engine = new ReadAudioEngine({
      sampleRate: LIVE_AUDIO_SAMPLE_RATE,
      audioContext: this.audioContext,
      ownsAudioContext: false,
      outputNode: this.playbackAnalyser,
      onPlaybackEnded: () => void this._finishPlayback(chunk)
    });

    try {
      chunk.session = await startGeminiLiveAudio({
        text: chunk.text,
        voiceName: this.voiceName,
        callbacks: {
          onAudio: bytes => {
            if (this.cancelled || this.failed || chunk.status === 'failed') return;
            chunk.engine?.appendPcmBytes(bytes);
            if (chunk.status === 'preparing' && chunk.engine?.totalBytes > 0) chunk.status = 'ready';
            this._pumpPlayback();
          },
          onGenerationComplete: () => {
            if (this.cancelled || this.failed || chunk.generationComplete) return;
            chunk.generationComplete = true;
            chunk.engine?.markGenerationComplete();
            this._checkHalfCheckpoint(chunk);
            this._pumpPlayback();
          },
          onTurnComplete: () => {
            try { chunk.session?.close(1000, 'Live Voice speech chunk complete'); } catch (error) {}
            chunk.session = null;
          },
          onInterrupted: () => this._fail(new Error('Live Voice speech generation was interrupted.')),
          onGoAway: () => this._fail(new Error('Live Voice speech server requested disconnect.')),
          onError: error => this._fail(error)
        }
      });
    } catch (error) {
      this._fail(error);
    }
  }

  _pumpPlayback() {
    if (this.cancelled || this.failed || this.currentChunk) return;
    const next = this.chunks.find(chunk => chunk.status === 'ready') || null;
    if (!next) return;
    void this._startPlayback(next);
  }

  async _startPlayback(chunk) {
    if (!chunk || this.currentChunk || this.cancelled || this.failed || chunk.status !== 'ready') return;
    this.currentChunk = chunk;
    chunk.status = 'playing';
    chunk.playbackStarted = true;
    try {
      await chunk.engine.play();
      if (this.cancelled || this.failed || chunk !== this.currentChunk) return;
      this._startPlaybackLevelMonitor();
      safeCall(this.onPlaybackStart, chunk);
      this._startHalfMonitor(chunk);
    } catch (error) {
      this._fail(error);
    }
  }

  _startPlaybackLevelMonitor() {
    if (this.playbackLevelFrame !== null || this.cancelled || this.failed) return;
    const sample = () => {
      this.playbackLevelFrame = null;
      if (this.cancelled || this.failed || !this.playbackAnalyser || !this.playbackSamples) return;
      this.playbackAnalyser.getFloatTimeDomainData(this.playbackSamples);
      let sumSquares = 0;
      for (let index = 0; index < this.playbackSamples.length; index += 1) {
        const value = this.playbackSamples[index];
        sumSquares += value * value;
      }
      const rms = Math.sqrt(sumSquares / Math.max(1, this.playbackSamples.length));
      const target = clamp01((rms - PLAYBACK_LEVEL_FLOOR) / (PLAYBACK_LEVEL_PEAK_REFERENCE - PLAYBACK_LEVEL_FLOOR));
      const smoothing = target > this.playbackLevel ? PLAYBACK_LEVEL_ATTACK : PLAYBACK_LEVEL_RELEASE;
      this.playbackLevel += (target - this.playbackLevel) * smoothing;
      if (this.playbackLevel < 0.002) this.playbackLevel = 0;
      safeCall(this.onPlaybackLevel, clamp01(this.playbackLevel));
      this.playbackLevelFrame = requestAnimationFrame(sample);
    };
    this.playbackLevelFrame = requestAnimationFrame(sample);
  }

  _stopPlaybackLevelMonitor() {
    if (this.playbackLevelFrame !== null) cancelAnimationFrame(this.playbackLevelFrame);
    this.playbackLevelFrame = null;
    this.playbackLevel = 0;
    safeCall(this.onPlaybackLevel, 0);
  }

  _disposePlaybackAnalyser() {
    if (this.playbackAnalyser) {
      try { this.playbackAnalyser.disconnect(); } catch (error) {}
    }
    this.playbackAnalyser = null;
    this.playbackSamples = null;
  }

  _startHalfMonitor(chunk) {
    this._stopHalfMonitor();
    this.halfTimer = window.setInterval(() => this._checkHalfCheckpoint(chunk), PLAYBACK_POLL_MS);
    this._checkHalfCheckpoint(chunk);
  }

  _stopHalfMonitor() {
    if (!this.halfTimer) return;
    window.clearInterval(this.halfTimer);
    this.halfTimer = null;
  }

  _checkHalfCheckpoint(chunk) {
    if (
      this.cancelled || this.failed ||
      !chunk || chunk !== this.currentChunk || chunk.halfReached ||
      !chunk.generationComplete || !chunk.engine
    ) return;

    const duration = chunk.engine.generatedDuration;
    if (!(duration > 0)) return;
    const fraction = chunk.engine.getCurrentTime() / duration;
    if (fraction < HALF_CHECKPOINT) return;

    chunk.halfReached = true;
    this._stopHalfMonitor();
    this._maybeCreateStreamingChunk();
    this._pump();
  }

  async _finishPlayback(chunk) {
    if (this.cancelled || this.failed || !chunk || chunk.status === 'done') return;
    if (chunk !== this.currentChunk) return;
    this._stopHalfMonitor();
    chunk.status = 'done';
    this.currentChunk = null;
    try { chunk.session?.close(1000, 'Live Voice playback finished'); } catch (error) {}
    chunk.session = null;
    if (chunk.engine) await chunk.engine.destroy();
    chunk.engine = null;
    this._maybeCreateStreamingChunk();
    this._pump();
    this._checkDrained();
  }

  _checkDrained() {
    if (!this.finalReceived || this.cancelled || this.failed) return;
    const unfinished = this.chunks.some(chunk => !['done', 'failed'].includes(chunk.status));
    if (unfinished || this.currentChunk || this.sentenceBuffer.hasPendingText) return;
    this._stopPlaybackLevelMonitor();
    this._disposePlaybackAnalyser();
    safeCall(this.onDrained);
  }

  _fail(error) {
    if (this.failed || this.cancelled) return;
    this.failed = true;
    this._stopHalfMonitor();
    this._stopPlaybackLevelMonitor();
    console.error('Live Voice speech queue failed:', error);
    safeCall(this.onError, error instanceof Error ? error : new Error(String(error || 'Unknown speech error')));
    void this.cancel({ preserveFailed: true });
  }

  async cancel({ preserveFailed = false } = {}) {
    if (this.cancelled) return;
    this.cancelled = true;
    this._stopHalfMonitor();
    this._stopPlaybackLevelMonitor();
    const cleanup = this.chunks.map(async chunk => {
      try { chunk.session?.close(1000, 'Live Voice speech cancelled'); } catch (error) {}
      chunk.session = null;
      if (chunk.engine) await chunk.engine.destroy();
      chunk.engine = null;
      if (!preserveFailed) chunk.status = 'done';
    });
    await Promise.allSettled(cleanup);
    this.currentChunk = null;
    this._disposePlaybackAnalyser();
  }
}
