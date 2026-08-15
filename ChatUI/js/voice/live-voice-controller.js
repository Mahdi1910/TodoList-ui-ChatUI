/**
 * live-voice-controller.js — Audio-reactive, interruptible turn-by-turn Voice Mode state machine.
 */

import { state, runtime, setRuntime } from '../state/store.js';
import { sendMessage } from '../chat/chat.js';
import { startAudioRecording, stopAudioRecording, cancelAudioRecording } from '../composer/recorder.js';
import { updateFilePreviewsUI } from '../composer/attachments.js';
import { VoiceSilenceDetector } from './voice-silence-detector.js';
import { LiveVoiceSpeechQueue, prepareLiveVoicePlaybackContext } from './voice-speech-queue.js';
import { VoiceProcessingSound } from './voice-processing-sound.js';
import { stopActiveReadAloud } from './read-aloud.js';

const EXISTING_GENERATION_RETRY_MS = 250;
const PENDING_TURN_RETRY_MS = 180;
const PROCESSING_STATES = new Set(['ending-user-turn', 'sending', 'waiting-for-response']);

let active = false;
let controllerState = 'closed';
let updateSidebarCallback = null;
let stateListener = null;
let levelListener = null;
let requestFailureListener = null;
let silenceDetector = null;
let processingSound = null;
let playbackContext = null;
let playbackResumePromise = null;
let speechDetected = false;
let autoDetectEnabled = true;
let voiceSessionId = 0;
let recordingTurnSequence = 0;
let activeRecordingTurnId = null;
let generationTurnSequence = 0;
let activeGeneration = null;
let pendingUserVoiceFile = null;
let listenRetryTimer = null;
let pendingTurnTimer = null;
let microphoneErrorShown = false;
let speechErrorShown = false;
let pagehideBound = false;

function currentStatePayload() {
  const userTurn = ['listening', 'speech-detected'].includes(controllerState);
  return {
    state: controllerState,
    muted: runtime.isVoiceMuted,
    active,
    autoDetectEnabled,
    canFinishTurn: userTurn && !autoDetectEnabled && !!activeRecordingTurnId,
    canInterrupt: controllerState === 'speaking' && !!activeGeneration?.queue
  };
}

function safeStateNotify() {
  try { stateListener?.(currentStatePayload()); }
  catch (error) { console.error('Live Voice state listener failed:', error); }
}

function safeLevelNotify(level) {
  const normalized = Math.max(0, Math.min(1, Number(level) || 0));
  try { levelListener?.(normalized); }
  catch (error) { console.error('Live Voice level listener failed:', error); }
}

function setControllerState(nextState) {
  const wasProcessing = PROCESSING_STATES.has(controllerState);
  const isProcessing = PROCESSING_STATES.has(nextState);
  controllerState = nextState;

  if (isProcessing) {
    if (!wasProcessing) safeLevelNotify(0);
    processingSound?.start();
  } else {
    if (wasProcessing) processingSound?.stop();
    else if (!['listening', 'speech-detected', 'speaking'].includes(nextState)) safeLevelNotify(0);
  }

  safeStateNotify();
}

function isSessionCurrent(sessionId) {
  return active && sessionId === voiceSessionId;
}

function clearListenRetry() {
  if (!listenRetryTimer) return;
  window.clearTimeout(listenRetryTimer);
  listenRetryTimer = null;
}

function clearPendingTurnRetry() {
  if (!pendingTurnTimer) return;
  window.clearTimeout(pendingTurnTimer);
  pendingTurnTimer = null;
}

async function stopSilenceDetector() {
  const detector = silenceDetector;
  silenceDetector = null;
  if (detector) await detector.stop();
}

function removeAttachedFile(file) {
  if (!file) return;
  const nextFiles = runtime.attachedFiles.filter(item => item !== file);
  if (nextFiles.length === runtime.attachedFiles.length) return;
  setRuntime({ attachedFiles: nextFiles });
  updateFilePreviewsUI();
}

function ownInterruptedGenerationIsRunning() {
  return !!activeGeneration?.requestPending && activeGeneration.speechInterrupted;
}

function scheduleListeningWhenAvailable() {
  if (!active || runtime.isVoiceMuted || pendingUserVoiceFile || runtime.isRecordingAudio) return;
  clearListenRetry();

  if (!runtime.isGenerating && !activeGeneration?.requestPending && !activeGeneration?.queue) {
    void beginListening();
    return;
  }

  if (ownInterruptedGenerationIsRunning()) {
    void beginListening({ allowDuringGeneration: true });
    return;
  }

  setControllerState('waiting-for-response');
  listenRetryTimer = window.setTimeout(scheduleListeningWhenAvailable, EXISTING_GENERATION_RETRY_MS);
}

async function beginListening({ allowDuringGeneration = false } = {}) {
  if (!active || runtime.isVoiceMuted || pendingUserVoiceFile || runtime.isRecordingAudio) return;

  const backgroundAllowed = allowDuringGeneration && ownInterruptedGenerationIsRunning();
  if ((runtime.isGenerating || activeGeneration?.requestPending) && !backgroundAllowed) {
    scheduleListeningWhenAvailable();
    return;
  }
  if (activeGeneration?.queue && !activeGeneration.speechInterrupted) return;

  clearListenRetry();
  await stopSilenceDetector();
  if (runtime.isRecordingAudio) await cancelAudioRecording({ updateButton: false });

  const sessionId = voiceSessionId;
  const recordingId = ++recordingTurnSequence;
  activeRecordingTurnId = recordingId;
  speechDetected = false;
  safeLevelNotify(0);
  setControllerState('listening');

  try {
    const { stream } = await startAudioRecording({
      updateButton: false,
      showAlerts: false,
      showLimitAlert: false,
      onLimitReached: () => {
        if (!isSessionCurrent(sessionId) || recordingId !== activeRecordingTurnId) return;
        if (speechDetected) void finishRecordedTurn(recordingId);
        else void recycleSilentRecording(recordingId);
      }
    });

    if (!isSessionCurrent(sessionId) || recordingId !== activeRecordingTurnId) {
      await cancelAudioRecording({ updateButton: false });
      return;
    }

    silenceDetector = new VoiceSilenceDetector(stream, {
      onLevel: ({ normalizedLevel }) => {
        if (!isSessionCurrent(sessionId) || recordingId !== activeRecordingTurnId) return;
        if (['listening', 'speech-detected'].includes(controllerState)) safeLevelNotify(normalizedLevel);
      },
      onSpeechStart: () => {
        if (!isSessionCurrent(sessionId) || recordingId !== activeRecordingTurnId) return;
        speechDetected = true;
        setControllerState('speech-detected');
      },
      onSpeechActivity: () => {
        if (!isSessionCurrent(sessionId) || recordingId !== activeRecordingTurnId) return;
        if (controllerState !== 'speech-detected') setControllerState('speech-detected');
      },
      onSilenceEndTurn: () => {
        if (!isSessionCurrent(sessionId) || recordingId !== activeRecordingTurnId || !autoDetectEnabled) return;
        void finishRecordedTurn(recordingId);
      },
      onError: error => {
        console.error('Voice silence detection failed:', error);
        if (!isSessionCurrent(sessionId) || recordingId !== activeRecordingTurnId) return;
        void failMicrophone('Microphone speech detection failed.');
      }
    }, { autoEndTurn: autoDetectEnabled });
    silenceDetector.start();
  } catch (error) {
    if (!isSessionCurrent(sessionId) || recordingId !== activeRecordingTurnId) return;
    await failMicrophone('Microphone access was denied or audio recording is not supported in this browser.');
  }
}

async function recycleSilentRecording(recordingId) {
  if (!active || recordingId !== activeRecordingTurnId) return;
  activeRecordingTurnId = null;
  await stopSilenceDetector();
  await cancelAudioRecording({ updateButton: false });
  safeLevelNotify(0);
  if (active && !runtime.isVoiceMuted) {
    void beginListening({ allowDuringGeneration: ownInterruptedGenerationIsRunning() });
  }
}

async function failMicrophone(message) {
  activeRecordingTurnId = null;
  await stopSilenceDetector();
  if (runtime.isRecordingAudio) await cancelAudioRecording({ updateButton: false });
  safeLevelNotify(0);
  setRuntime({ isVoiceMuted: true });
  setControllerState('error');
  if (!microphoneErrorShown) {
    microphoneErrorShown = true;
    alert(message);
  }
  safeStateNotify();
}

function queuePendingUserTurn(file) {
  pendingUserVoiceFile = file;
  setControllerState('queued-user-turn');
  schedulePendingTurnFlush();
}

async function finishRecordedTurn(recordingId) {
  if (!active || recordingId !== activeRecordingTurnId || controllerState === 'ending-user-turn') return false;
  activeRecordingTurnId = null;
  setControllerState('ending-user-turn');
  await stopSilenceDetector();
  safeLevelNotify(0);

  if (!speechDetected) {
    await cancelAudioRecording({ updateButton: false });
    if (active && !runtime.isVoiceMuted) {
      void beginListening({ allowDuringGeneration: ownInterruptedGenerationIsRunning() });
    }
    return false;
  }

  const file = await stopAudioRecording({
    attach: true,
    refresh: false,
    updateButton: false,
    showLimitAlert: false
  });

  if (!active) {
    removeAttachedFile(file);
    return false;
  }
  if (!file) {
    setControllerState('error');
    if (!runtime.isVoiceMuted) {
      void beginListening({ allowDuringGeneration: ownInterruptedGenerationIsRunning() });
    }
    return false;
  }

  if (activeGeneration?.requestPending || runtime.isGenerating) {
    queuePendingUserTurn(file);
    return true;
  }

  return startVoiceGeneration(file);
}

function generationObserver(job) {
  return {
    onAssistantTextUpdate: fullText => {
      if (!isSessionCurrent(job.sessionId) || job.requestFailed || job.speechInterrupted || !job.queue) return;
      job.queue.updateAssistantText(fullText);
    },
    onAssistantComplete: fullText => {
      if (!isSessionCurrent(job.sessionId) || job.requestFailed) return;
      job.textFinal = true;
      if (!job.speechInterrupted && job.queue) job.queue.completeAssistantText(fullText);
      if (!job.firstPlaybackStarted && !runtime.isRecordingAudio && !pendingUserVoiceFile && !job.speechInterrupted) {
        setControllerState('waiting-for-response');
      }
    },
    onAssistantInterrupted: fullText => {
      if (!isSessionCurrent(job.sessionId) || job.requestFailed) return;
      job.textFinal = true;
      if (!job.speechInterrupted && job.queue) job.queue.completeAssistantText(fullText);
      if (!job.firstPlaybackStarted && !runtime.isRecordingAudio && !pendingUserVoiceFile && !job.speechInterrupted) {
        setControllerState('waiting-for-response');
      }
    },
    onAssistantError: error => {
      if (!isSessionCurrent(job.sessionId)) return;
      job.textFinal = true;
      job.requestFailed = true;
      job.requestError = error || new Error('Live Voice request failed.');
      console.error('Live Voice text generation failed:', error);
      const queue = job.queue;
      job.queue = null;
      processingSound?.stop();
      safeLevelNotify(0);
      void queue?.cancel();
    }
  };
}

function createSpeechQueue(job) {
  const queue = new LiveVoiceSpeechQueue({
    audioContext: playbackContext,
    voiceName: state.audioRead?.voiceName || 'Zephyr',
    onPlaybackStart: () => {
      if (!isSessionCurrent(job.sessionId) || job.requestFailed || job.speechInterrupted || job.queue !== queue) return;
      job.firstPlaybackStarted = true;
      if (!runtime.isRecordingAudio && !pendingUserVoiceFile) setControllerState('speaking');
    },
    onPlaybackLevel: level => {
      if (!isSessionCurrent(job.sessionId) || job.requestFailed || job.speechInterrupted || job.queue !== queue) return;
      if (job.firstPlaybackStarted && controllerState === 'speaking') safeLevelNotify(level);
    },
    onDrained: () => {
      if (!isSessionCurrent(job.sessionId) || job.queue !== queue) return;
      job.speechDrained = true;
      job.queue = null;
      safeLevelNotify(0);
      if (!job.requestPending) finishGenerationLifecycle(job);
    },
    onError: error => {
      if (!isSessionCurrent(job.sessionId) || job.queue !== queue) return;
      job.speechFailed = true;
      job.queue = null;
      safeLevelNotify(0);
      if (!speechErrorShown) {
        speechErrorShown = true;
        alert('Live Voice could not generate spoken audio: ' + (error?.message || 'Unknown audio error'));
      }
      if (!job.requestPending) finishGenerationLifecycle(job);
    }
  });
  job.queue = queue;
}

async function handleFatalVoiceRequestFailure(job, error = null) {
  if (!isSessionCurrent(job.sessionId) || activeGeneration !== job || job.failureHandled) return false;
  job.failureHandled = true;
  job.requestFailed = true;
  if (error && !job.requestError) job.requestError = error;

  clearListenRetry();
  clearPendingTurnRetry();
  processingSound?.stop();
  safeLevelNotify(0);

  const queue = job.queue;
  job.queue = null;
  await queue?.cancel();

  if (!isSessionCurrent(job.sessionId) || activeGeneration !== job) return true;

  try {
    requestFailureListener?.(job.requestError || error || null);
  } catch (callbackError) {
    console.error('Live Voice request failure listener failed:', callbackError);
  }
  return true;
}

function finishGenerationLifecycle(job) {
  if (!isSessionCurrent(job.sessionId) || activeGeneration !== job) return;

  if (job.requestFailed) {
    void handleFatalVoiceRequestFailure(job, job.requestError);
    return;
  }

  if (pendingUserVoiceFile) {
    activeGeneration = null;
    void flushPendingUserTurn();
    return;
  }

  if (job.speechInterrupted) {
    activeGeneration = null;
    if (!runtime.isRecordingAudio && !runtime.isVoiceMuted) void beginListening();
    else if (runtime.isVoiceMuted) setControllerState('muted');
    return;
  }

  if (job.speechFailed || job.speechDrained || !job.queue) {
    activeGeneration = null;
    if (runtime.isVoiceMuted) setControllerState('muted');
    else if (!runtime.isRecordingAudio) void beginListening();
    return;
  }

  // Text generation is finished, but queued speech is still preparing/playing.
  if (!job.firstPlaybackStarted) setControllerState('waiting-for-response');
}

async function runVoiceGeneration(job, file) {
  let sent = false;
  let sendError = null;
  try {
    sent = await sendMessage(updateSidebarCallback, {
      generationObserver: generationObserver(job)
    });
  } catch (error) {
    sendError = error;
    job.requestFailed = true;
    job.requestError = error;
    console.error('Live Voice send failed:', error);
  } finally {
    job.requestPending = false;
  }

  if (!isSessionCurrent(job.sessionId) || activeGeneration !== job) return sent;

  if (!sent) {
    removeAttachedFile(file);
    job.requestFailed = true;
    if (!job.requestError) {
      job.requestError = sendError || new Error('Live Voice request could not be submitted.');
    }
    const queue = job.queue;
    job.queue = null;
    await queue?.cancel();
  }

  finishGenerationLifecycle(job);
  return sent;
}

function startVoiceGeneration(file) {
  if (!active || !file) return false;
  if (activeGeneration?.requestPending || runtime.isGenerating) {
    queuePendingUserTurn(file);
    return false;
  }

  clearPendingTurnRetry();
  const job = {
    id: ++generationTurnSequence,
    sessionId: voiceSessionId,
    requestPending: true,
    requestFailed: false,
    requestError: null,
    failureHandled: false,
    queue: null,
    speechInterrupted: false,
    firstPlaybackStarted: false,
    textFinal: false,
    speechDrained: false,
    speechFailed: false
  };
  activeGeneration = job;
  createSpeechQueue(job);
  setControllerState('sending');
  void runVoiceGeneration(job, file);
  return true;
}

function schedulePendingTurnFlush() {
  clearPendingTurnRetry();
  if (!active || !pendingUserVoiceFile) return;
  pendingTurnTimer = window.setTimeout(() => {
    pendingTurnTimer = null;
    void flushPendingUserTurn();
  }, PENDING_TURN_RETRY_MS);
}

async function flushPendingUserTurn() {
  if (!active || !pendingUserVoiceFile) return false;
  if (runtime.isGenerating || activeGeneration?.requestPending) {
    schedulePendingTurnFlush();
    return false;
  }

  const file = pendingUserVoiceFile;
  pendingUserVoiceFile = null;
  if (activeGeneration?.speechInterrupted || activeGeneration?.speechFailed || activeGeneration?.speechDrained || !activeGeneration?.queue) {
    activeGeneration = null;
  }
  setControllerState('sending');
  const started = startVoiceGeneration(file);
  if (!started && active) {
    pendingUserVoiceFile = file;
    setControllerState('queued-user-turn');
    schedulePendingTurnFlush();
  }
  return started;
}

export async function finishLiveVoiceTurn() {
  if (!active || autoDetectEnabled || !['listening', 'speech-detected'].includes(controllerState)) return false;
  const recordingId = activeRecordingTurnId;
  if (!recordingId) return false;
  return finishRecordedTurn(recordingId);
}

export async function interruptLiveVoiceSpeech() {
  if (!active || controllerState !== 'speaking' || !activeGeneration?.queue) return false;
  const job = activeGeneration;
  job.speechInterrupted = true;
  const queue = job.queue;
  job.queue = null;
  safeLevelNotify(0);
  await queue.cancel();

  if (!job.requestPending) activeGeneration = null;
  if (runtime.isVoiceMuted) {
    setControllerState('muted');
    return true;
  }

  setControllerState('listening');
  void beginListening({ allowDuringGeneration: job.requestPending });
  return true;
}

export async function handleLiveVoiceOrbAction() {
  if (!active) return false;
  if (controllerState === 'speaking') return interruptLiveVoiceSpeech();
  if (!autoDetectEnabled && ['listening', 'speech-detected'].includes(controllerState)) {
    return finishLiveVoiceTurn();
  }
  return false;
}

export function setLiveVoiceAutoDetect(enabled) {
  autoDetectEnabled = !!enabled;
  silenceDetector?.setAutoEndTurnEnabled(autoDetectEnabled);
  safeStateNotify();
  return autoDetectEnabled;
}

export function toggleLiveVoiceAutoDetect() {
  return setLiveVoiceAutoDetect(!autoDetectEnabled);
}

export async function setLiveVoiceMuted(muted) {
  const nextMuted = !!muted;
  setRuntime({ isVoiceMuted: nextMuted });
  safeStateNotify();
  if (!active) return;

  if (nextMuted) {
    if (runtime.isRecordingAudio || activeRecordingTurnId) {
      activeRecordingTurnId = null;
      await stopSilenceDetector();
      if (runtime.isRecordingAudio) await cancelAudioRecording({ updateButton: false });
      speechDetected = false;
      safeLevelNotify(0);
      setControllerState('muted');
    } else if (controllerState !== 'speaking') {
      setControllerState('muted');
    }
    return;
  }

  microphoneErrorShown = false;
  if (controllerState === 'speaking' || pendingUserVoiceFile) {
    safeStateNotify();
    return;
  }
  if (!runtime.isRecordingAudio) {
    void beginListening({ allowDuringGeneration: ownInterruptedGenerationIsRunning() });
  }
}

export async function toggleLiveVoiceMuted() {
  await setLiveVoiceMuted(!runtime.isVoiceMuted);
  return runtime.isVoiceMuted;
}

export async function startLiveVoiceMode({ onStateChange, onLevelChange, onRequestFailure, sidebarCallback } = {}) {
  if (active) return;
  active = true;
  voiceSessionId += 1;
  updateSidebarCallback = sidebarCallback || null;
  stateListener = typeof onStateChange === 'function' ? onStateChange : null;
  levelListener = typeof onLevelChange === 'function' ? onLevelChange : null;
  requestFailureListener = typeof onRequestFailure === 'function' ? onRequestFailure : null;
  autoDetectEnabled = true;
  pendingUserVoiceFile = null;
  activeGeneration = null;
  activeRecordingTurnId = null;
  speechDetected = false;
  setRuntime({ isVoiceModeActive: true, isVoiceMuted: false });
  microphoneErrorShown = false;
  speechErrorShown = false;
  clearListenRetry();
  clearPendingTurnRetry();
  safeLevelNotify(0);

  let prepared;
  try {
    prepared = prepareLiveVoicePlaybackContext();
    playbackContext = prepared.context;
    playbackResumePromise = prepared.resumePromise;
    processingSound = new VoiceProcessingSound({
      audioContext: playbackContext,
      onLevel: level => {
        if (!active || !PROCESSING_STATES.has(controllerState)) return;
        safeLevelNotify(level);
      }
    });
  } catch (error) {
    active = false;
    processingSound?.destroy();
    processingSound = null;
    setRuntime({ isVoiceModeActive: false });
    setControllerState('error');
    alert('Voice playback is not supported in this browser.');
    return;
  }

  setControllerState('listening');
  await stopActiveReadAloud();
  await playbackResumePromise;
  playbackResumePromise = null;

  if (!pagehideBound) {
    pagehideBound = true;
    window.addEventListener('pagehide', () => { void stopLiveVoiceMode(); });
  }

  if (runtime.isGenerating) scheduleListeningWhenAvailable();
  else void beginListening();
}

export async function stopLiveVoiceMode() {
  if (!active && controllerState === 'closed') return;
  active = false;
  voiceSessionId += 1;
  setRuntime({ isVoiceModeActive: false });
  clearListenRetry();
  clearPendingTurnRetry();
  activeRecordingTurnId = null;
  await stopSilenceDetector();
  if (runtime.isRecordingAudio) await cancelAudioRecording({ updateButton: false });
  if (pendingUserVoiceFile) removeAttachedFile(pendingUserVoiceFile);
  pendingUserVoiceFile = null;
  const queue = activeGeneration?.queue;
  if (activeGeneration) activeGeneration.queue = null;
  await queue?.cancel();
  activeGeneration = null;
  speechDetected = false;
  autoDetectEnabled = true;
  processingSound?.destroy();
  processingSound = null;
  safeLevelNotify(0);
  if (playbackContext) {
    try { await playbackContext.close(); } catch (error) {}
  }
  playbackContext = null;
  playbackResumePromise = null;
  updateSidebarCallback = null;
  setControllerState('closed');
  stateListener = null;
  levelListener = null;
  requestFailureListener = null;
}

export function getLiveVoiceState() {
  return currentStatePayload();
}