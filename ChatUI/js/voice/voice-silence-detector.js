/**
 * voice-silence-detector.js — Adaptive RMS speech/start/end detection for Voice Mode.
 */

const CALIBRATION_MS = 400;
const CALIBRATION_NOISE_CEILING = 0.025;
const SPEECH_CONFIRM_MS = 180;
const MIN_MEANINGFUL_TURN_MS = 350;
const TRAILING_SILENCE_MS = 950;
const ABSOLUTE_START_FLOOR = 0.012;
const ABSOLUTE_END_FLOOR = 0.007;
const START_NOISE_MULTIPLIER = 3.0;
const END_NOISE_MULTIPLIER = 1.8;
const NOISE_SMOOTHING = 0.94;
const LEVEL_NOISE_MULTIPLIER = 1.15;
const LEVEL_PEAK_REFERENCE = 0.11;
const LEVEL_ATTACK = 0.52;
const LEVEL_RELEASE = 0.16;

function safeCall(callback, ...args) {
  try { callback?.(...args); }
  catch (error) { console.error('Voice silence detector callback failed:', error); }
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

export class VoiceSilenceDetector {
  constructor(stream, callbacks = {}, options = {}) {
    this.stream = stream;
    this.callbacks = callbacks;
    this.autoEndTurnEnabled = options.autoEndTurn !== false;
    this.audioContext = null;
    this.source = null;
    this.analyser = null;
    this.samples = null;
    this.frameId = null;
    this.startedAt = 0;
    this.noiseFloor = 0.002;
    this.speechCandidateAt = 0;
    this.speechStartedAt = 0;
    this.lastSpeechAt = 0;
    this.speechDetected = false;
    this.endTurnFired = false;
    this.normalizedLevel = 0;
    this.stopped = false;
  }

  start() {
    if (this.stopped || this.frameId !== null) return this;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio API is not supported in this browser.');

    this.audioContext = new AudioContextClass();
    void this.audioContext.resume().catch(error => {
      console.warn('Voice analysis AudioContext could not resume immediately:', error);
    });
    this.source = this.audioContext.createMediaStreamSource(this.stream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0;
    this.samples = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
    this.startedAt = performance.now();
    this._schedule();
    return this;
  }

  setAutoEndTurnEnabled(enabled) {
    const next = !!enabled;
    if (this.autoEndTurnEnabled === next) return;
    this.autoEndTurnEnabled = next;
    this.endTurnFired = false;
    if (next) {
      // Require a fresh silence window after switching Auto Detect back on.
      this.lastSpeechAt = performance.now();
    }
  }

  _schedule() {
    if (this.stopped) return;
    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;
      try { this._sample(); }
      catch (error) {
        safeCall(this.callbacks.onError, error);
        void this.stop();
        return;
      }
      this._schedule();
    });
  }

  _updateNoiseFloor(rms) {
    this.noiseFloor = (this.noiseFloor * NOISE_SMOOTHING) + (rms * (1 - NOISE_SMOOTHING));
  }

  _updateNormalizedLevel(rms) {
    const baseline = Math.max(ABSOLUTE_END_FLOOR, this.noiseFloor * LEVEL_NOISE_MULTIPLIER);
    const target = clamp01((rms - baseline) / Math.max(0.001, LEVEL_PEAK_REFERENCE - baseline));
    const smoothing = target > this.normalizedLevel ? LEVEL_ATTACK : LEVEL_RELEASE;
    this.normalizedLevel += (target - this.normalizedLevel) * smoothing;
    if (this.normalizedLevel < 0.002) this.normalizedLevel = 0;
    safeCall(this.callbacks.onLevel, {
      rms,
      noiseFloor: this.noiseFloor,
      normalizedLevel: clamp01(this.normalizedLevel),
      speechDetected: this.speechDetected
    });
  }

  _sample() {
    if (!this.analyser || !this.samples) return;
    this.analyser.getFloatTimeDomainData(this.samples);

    let sumSquares = 0;
    for (let i = 0; i < this.samples.length; i += 1) {
      const value = this.samples[i];
      sumSquares += value * value;
    }
    const rms = Math.sqrt(sumSquares / Math.max(1, this.samples.length));
    const now = performance.now();
    const calibrating = now - this.startedAt < CALIBRATION_MS;

    this._updateNormalizedLevel(rms);

    if (!this.speechDetected) {
      if (calibrating) {
        // Avoid learning obvious immediate speech as the room's baseline noise.
        if (rms <= CALIBRATION_NOISE_CEILING) this._updateNoiseFloor(rms);
        return;
      }

      const startThreshold = Math.max(ABSOLUTE_START_FLOOR, this.noiseFloor * START_NOISE_MULTIPLIER);
      if (rms < startThreshold) this._updateNoiseFloor(rms);

      if (rms >= startThreshold) {
        if (!this.speechCandidateAt) this.speechCandidateAt = now;
        if (now - this.speechCandidateAt >= SPEECH_CONFIRM_MS) {
          this.speechDetected = true;
          this.speechStartedAt = this.speechCandidateAt;
          this.lastSpeechAt = now;
          safeCall(this.callbacks.onSpeechStart, { rms, noiseFloor: this.noiseFloor, threshold: startThreshold });
        }
      } else {
        this.speechCandidateAt = 0;
      }
      return;
    }

    const endThreshold = Math.max(ABSOLUTE_END_FLOOR, this.noiseFloor * END_NOISE_MULTIPLIER);
    if (rms >= endThreshold) {
      this.lastSpeechAt = now;
      safeCall(this.callbacks.onSpeechActivity, { rms, threshold: endThreshold });
      return;
    }

    if (!this.autoEndTurnEnabled || this.endTurnFired) return;

    const spokenLongEnough = now - this.speechStartedAt >= MIN_MEANINGFUL_TURN_MS;
    if (spokenLongEnough && now - this.lastSpeechAt >= TRAILING_SILENCE_MS) {
      this.endTurnFired = true;
      safeCall(this.callbacks.onSilenceEndTurn, {
        spokenMs: now - this.speechStartedAt,
        trailingSilenceMs: now - this.lastSpeechAt
      });
    }
  }

  async stop() {
    if (this.stopped) return;
    this.stopped = true;
    if (this.frameId !== null) cancelAnimationFrame(this.frameId);
    this.frameId = null;
    this.normalizedLevel = 0;
    safeCall(this.callbacks.onLevel, {
      rms: 0,
      noiseFloor: this.noiseFloor,
      normalizedLevel: 0,
      speechDetected: this.speechDetected
    });
    try { this.source?.disconnect(); } catch (error) {}
    try { this.analyser?.disconnect(); } catch (error) {}
    this.source = null;
    this.analyser = null;
    this.samples = null;
    if (this.audioContext) {
      try { await this.audioContext.close(); } catch (error) {}
    }
    this.audioContext = null;
  }
}
