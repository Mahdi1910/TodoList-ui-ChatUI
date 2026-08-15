/**
 * read-audio-engine.js — Streaming 24 kHz mono PCM playback, seeking, and WAV creation.
 */

import { LIVE_AUDIO_SAMPLE_RATE } from '../api/gemini-live-audio.js';

function concatBytes(chunks, totalBytes) {
  const merged = new Uint8Array(totalBytes);
  let offset = 0;
  chunks.forEach(chunk => {
    merged.set(chunk, offset);
    offset += chunk.byteLength;
  });
  return merged;
}

function pcmBytesToFloat32(bytes) {
  const sampleCount = Math.floor(bytes.byteLength / 2);
  const samples = new Float32Array(sampleCount);
  const view = new DataView(bytes.buffer, bytes.byteOffset, sampleCount * 2);
  for (let i = 0; i < sampleCount; i += 1) {
    const value = view.getInt16(i * 2, true);
    samples[i] = value < 0 ? value / 32768 : value / 32767;
  }
  return samples;
}

export class ReadAudioEngine {
  constructor({
    sampleRate = LIVE_AUDIO_SAMPLE_RATE,
    onPlaybackEnded = null,
    audioContext = null,
    ownsAudioContext = audioContext ? false : true,
    outputNode = null
  } = {}) {
    this.sampleRate = sampleRate;
    this.onPlaybackEnded = onPlaybackEnded;
    this.chunks = [];
    this.totalBytes = 0;
    this.audioContext = audioContext;
    this.ownsAudioContext = ownsAudioContext;
    this.outputNode = outputNode;
    this.sources = new Set();
    this.playing = false;
    this.playheadSamples = 0;
    this.baseSampleOffset = 0;
    this.baseContextTime = audioContext?.currentTime || 0;
    this.nextScheduleTime = audioContext?.currentTime || 0;
    this.generationComplete = false;
    this.destroyed = false;
  }

  get totalSamples() { return Math.floor(this.totalBytes / 2); }
  get generatedDuration() { return this.totalSamples / this.sampleRate; }
  _ensureContext() {
    if (this.audioContext) return this.audioContext;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API is not supported in this browser.');
    this.audioContext = new AudioContextClass({ sampleRate: this.sampleRate });
    this.ownsAudioContext = true;
    this.baseContextTime = this.audioContext.currentTime;
    this.nextScheduleTime = this.audioContext.currentTime;
    return this.audioContext;
  }

  _stopSources() {
    this.sources.forEach(source => {
      source.onended = null;
      try { source.stop(); } catch (error) {}
      try { source.disconnect(); } catch (error) {}
    });
    this.sources.clear();
  }

  _freezeAtGenerated() {
    if (!this.audioContext) return;
    this.playheadSamples = this.totalSamples;
    this.baseSampleOffset = this.playheadSamples;
    this.baseContextTime = this.audioContext.currentTime;
    this.nextScheduleTime = this.audioContext.currentTime;
  }

  getCurrentSample() {
    if (!this.audioContext || !this.playing) return Math.min(this.playheadSamples, this.totalSamples);
    const elapsed = Math.max(0, this.audioContext.currentTime - this.baseContextTime);
    const computed = Math.floor(this.baseSampleOffset + elapsed * this.sampleRate);
    return Math.min(computed, this.totalSamples);
  }

  getCurrentTime() {
    return this.getCurrentSample() / this.sampleRate;
  }

  _scheduleBytes(bytes, when = null) {
    if (!bytes?.byteLength) return;
    const context = this._ensureContext();
    const samples = pcmBytesToFloat32(bytes);
    if (!samples.length) return;
    const buffer = context.createBuffer(1, samples.length, this.sampleRate);
    buffer.copyToChannel(samples, 0);
    const source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.outputNode || context.destination);
    this.sources.add(source);
    const startAt = Math.max(context.currentTime, when ?? this.nextScheduleTime);
    source.start(startAt);
    this.nextScheduleTime = startAt + buffer.duration;
    source.onended = () => {
      this.sources.delete(source);
      try { source.disconnect(); } catch (error) {}
      if (this.sources.size === 0) {
        if (this.generationComplete && this.getCurrentSample() >= this.totalSamples) {
          this.playing = false;
          this.playheadSamples = this.totalSamples;
          this.onPlaybackEnded?.();
        } else if (!this.generationComplete && this.playing) {
          this._freezeAtGenerated();
        }
      }
    };
  }

  appendPcmBytes(inputBytes) {
    if (this.destroyed || !inputBytes?.byteLength) return;
    const evenLength = inputBytes.byteLength - (inputBytes.byteLength % 2);
    if (evenLength <= 0) return;
    const bytes = inputBytes.slice(0, evenLength);
    this.chunks.push(bytes);
    this.totalBytes += bytes.byteLength;

    if (this.audioContext || this.playing) {
      const context = this._ensureContext();
      if (this.sources.size === 0) {
        this.baseSampleOffset = this.playheadSamples;
        this.baseContextTime = context.currentTime;
        this.nextScheduleTime = context.currentTime;
      }
      if (this.playing) this._scheduleBytes(bytes);
    }
  }

  async play() {
    if (this.destroyed) return;
    const context = this._ensureContext();
    if (this.playing && context.state === 'running') return;
    this.playing = true;
    if (this.sources.size === 0 && this.playheadSamples < this.totalSamples) {
      this._restartFromSample(this.playheadSamples);
    } else {
      this.baseSampleOffset = this.playheadSamples;
      this.baseContextTime = context.currentTime;
    }
    await context.resume();
  }

  async pause() {
    if (this.destroyed || !this.audioContext) {
      this.playing = false;
      return;
    }
    this.playheadSamples = this.getCurrentSample();
    this.playing = false;
    if (this.ownsAudioContext) await this.audioContext.suspend();
    else this._stopSources();
  }

  _restartFromSample(sampleOffset) {
    const context = this._ensureContext();
    const clamped = Math.max(0, Math.min(Math.floor(sampleOffset), this.totalSamples));
    this._stopSources();
    this.playheadSamples = clamped;
    this.baseSampleOffset = clamped;
    this.baseContextTime = context.currentTime;
    this.nextScheduleTime = context.currentTime;

    if (clamped >= this.totalSamples) return;
    const allBytes = concatBytes(this.chunks, this.totalBytes);
    this._scheduleBytes(allBytes.slice(clamped * 2), context.currentTime);
  }

  async seek(seconds) {
    if (this.destroyed) return 0;
    const target = Math.max(0, Math.min(Number(seconds) || 0, this.generatedDuration));
    const wasPlaying = this.playing;
    this._ensureContext();
    this._restartFromSample(Math.floor(target * this.sampleRate));
    if (wasPlaying) await this.audioContext.resume();
    else if (this.ownsAudioContext) await this.audioContext.suspend();
    return target;
  }

  markGenerationComplete() {
    this.generationComplete = true;
    if (this.playing && this.sources.size === 0 && this.getCurrentSample() >= this.totalSamples) {
      this.playing = false;
      this.playheadSamples = this.totalSamples;
      this.onPlaybackEnded?.();
    }
  }

  getPcmBytes() {
    return concatBytes(this.chunks, this.totalBytes);
  }

  createWavBlob() {
    const pcm = this.getPcmBytes();
    const buffer = new ArrayBuffer(44 + pcm.byteLength);
    const view = new DataView(buffer);
    const writeText = (offset, text) => {
      for (let i = 0; i < text.length; i += 1) view.setUint8(offset + i, text.charCodeAt(i));
    };
    const channels = 1;
    const bitsPerSample = 16;
    const blockAlign = channels * bitsPerSample / 8;
    const byteRate = this.sampleRate * blockAlign;

    writeText(0, 'RIFF');
    view.setUint32(4, 36 + pcm.byteLength, true);
    writeText(8, 'WAVE');
    writeText(12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, this.sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, bitsPerSample, true);
    writeText(36, 'data');
    view.setUint32(40, pcm.byteLength, true);
    new Uint8Array(buffer, 44).set(pcm);
    return new Blob([buffer], { type: 'audio/wav' });
  }
  async destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.playing = false;
    this._stopSources();
    if (this.audioContext && this.ownsAudioContext) {
      try { await this.audioContext.close(); } catch (error) {}
    }
    this.audioContext = null;
    this.outputNode = null;
    this.chunks = [];
    this.totalBytes = 0;
    this.playheadSamples = 0;
  }
}
