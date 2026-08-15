/**
 * voice-processing-sound.js — Selected Tick Tock cue for the yellow Voice Mode state.
 *
 * This intentionally recreates the chosen 01_tick_tock sample with Web Audio
 * instead of shipping a binary MP3. The analyser sees the exact audible signal,
 * so the yellow orb can react to the real processing sound amplitude.
 */

const FIRST_TICK_DELAY_MS = 250;
const TICK_INTERVAL_MS = 500;
const TICK_FREQUENCY = 1500;
const TOCK_FREQUENCY = 850;
const BURST_DURATION_SECONDS = 0.09;
const BURST_START_GAIN = 0.42;
const BURST_DECAY_SECONDS = 0.025;
const MASTER_GAIN = 0.60;
const LEVEL_FLOOR = 0.0025;
const LEVEL_PEAK_REFERENCE = 0.16;
const LEVEL_ATTACK = 0.62;
const LEVEL_RELEASE = 0.18;

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function safeCall(callback, ...args) {
  try { callback?.(...args); }
  catch (error) { console.error('Voice processing sound callback failed:', error); }
}

export class VoiceProcessingSound {
  constructor({ audioContext, onLevel } = {}) {
    if (!audioContext) throw new Error('Voice processing sound requires an AudioContext.');
    this.audioContext = audioContext;
    this.onLevel = onLevel;
    this.active = false;
    this.destroyed = false;
    this.tickIndex = 0;
    this.firstTickTimer = null;
    this.tickTimer = null;
    this.levelFrame = null;
    this.level = 0;
    this.sources = new Set();

    this.analyser = audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0;
    this.samples = new Float32Array(this.analyser.fftSize);

    this.masterGain = audioContext.createGain();
    this.masterGain.gain.value = MASTER_GAIN;
    this.analyser.connect(this.masterGain);
    this.masterGain.connect(audioContext.destination);
  }

  start() {
    if (this.destroyed || this.active) return;
    this.active = true;
    this.tickIndex = 0;
    this.level = 0;
    safeCall(this.onLevel, 0);
    void this.audioContext.resume().catch(error => {
      console.warn('Voice processing AudioContext could not resume:', error);
    });
    this._startLevelMonitor();
    this.firstTickTimer = window.setTimeout(() => {
      this.firstTickTimer = null;
      if (!this.active || this.destroyed) return;
      this._emitTickTock();
      this.tickTimer = window.setInterval(() => this._emitTickTock(), TICK_INTERVAL_MS);
    }, FIRST_TICK_DELAY_MS);
  }

  _emitTickTock() {
    if (!this.active || this.destroyed || !this.analyser) return;
    const now = this.audioContext.currentTime;
    const oscillator = this.audioContext.createOscillator();
    const envelope = this.audioContext.createGain();
    const sourceEntry = { oscillator, envelope };
    const frequency = this.tickIndex % 2 === 0 ? TICK_FREQUENCY : TOCK_FREQUENCY;
    const endGain = Math.max(
      0.0001,
      BURST_START_GAIN * Math.exp(-BURST_DURATION_SECONDS / BURST_DECAY_SECONDS)
    );
    this.tickIndex += 1;

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(frequency, now);
    envelope.gain.setValueAtTime(BURST_START_GAIN, now);
    envelope.gain.exponentialRampToValueAtTime(endGain, now + BURST_DURATION_SECONDS);

    oscillator.connect(envelope);
    envelope.connect(this.analyser);
    this.sources.add(sourceEntry);

    oscillator.onended = () => {
      this.sources.delete(sourceEntry);
      try { oscillator.disconnect(); } catch (error) {}
      try { envelope.disconnect(); } catch (error) {}
    };

    oscillator.start(now);
    oscillator.stop(now + BURST_DURATION_SECONDS);
  }

  _startLevelMonitor() {
    if (this.levelFrame !== null || !this.active || this.destroyed) return;
    const sample = () => {
      this.levelFrame = null;
      if (!this.active || this.destroyed || !this.analyser || !this.samples) return;

      this.analyser.getFloatTimeDomainData(this.samples);
      let sumSquares = 0;
      for (let index = 0; index < this.samples.length; index += 1) {
        const value = this.samples[index];
        sumSquares += value * value;
      }

      const rms = Math.sqrt(sumSquares / Math.max(1, this.samples.length));
      const target = clamp01((rms - LEVEL_FLOOR) / (LEVEL_PEAK_REFERENCE - LEVEL_FLOOR));
      const smoothing = target > this.level ? LEVEL_ATTACK : LEVEL_RELEASE;
      this.level += (target - this.level) * smoothing;
      if (this.level < 0.002) this.level = 0;
      safeCall(this.onLevel, clamp01(this.level));
      this.levelFrame = requestAnimationFrame(sample);
    };
    this.levelFrame = requestAnimationFrame(sample);
  }

  stop() {
    if (!this.active && this.levelFrame === null && !this.firstTickTimer && !this.tickTimer) {
      safeCall(this.onLevel, 0);
      return;
    }
    this.active = false;
    if (this.firstTickTimer) window.clearTimeout(this.firstTickTimer);
    if (this.tickTimer) window.clearInterval(this.tickTimer);
    this.firstTickTimer = null;
    this.tickTimer = null;
    if (this.levelFrame !== null) cancelAnimationFrame(this.levelFrame);
    this.levelFrame = null;

    this.sources.forEach(({ oscillator, envelope }) => {
      oscillator.onended = null;
      try { oscillator.stop(); } catch (error) {}
      try { oscillator.disconnect(); } catch (error) {}
      try { envelope.disconnect(); } catch (error) {}
    });
    this.sources.clear();
    this.level = 0;
    safeCall(this.onLevel, 0);
  }

  destroy() {
    if (this.destroyed) return;
    this.stop();
    this.destroyed = true;
    try { this.analyser?.disconnect(); } catch (error) {}
    try { this.masterGain?.disconnect(); } catch (error) {}
    this.analyser = null;
    this.masterGain = null;
    this.samples = null;
    this.onLevel = null;
  }
}
