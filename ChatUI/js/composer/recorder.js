/**
 * recorder.js — Reusable MediaRecorder audio capture + composer button lifecycle.
 */

import { runtime, setRuntime } from '../state/store.js';
import {
  MAX_ATTACHMENT_FILE_SIZE_BYTES,
  getRemainingAttachmentBytes,
  tryAddAttachmentFile
} from './attachments.js';
import { updateComposerButtons } from './composer.js';

const MIN_USEFUL_RECORDING_BYTES = 64 * 1024;
const AUTO_STOP_HEADROOM_BYTES = 128 * 1024;
const DEFAULT_TIMESLICE_MS = 1000;

let activeRecordingOptions = null;

function resetRecordButton(recordAudioBtn = document.getElementById('record-audio-btn')) {
  if (!recordAudioBtn) return;
  recordAudioBtn.innerHTML = '<i data-lucide="mic"></i>';
  recordAudioBtn.classList.remove('recording');
  recordAudioBtn.title = 'Record Voice Message';
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function setRecordButtonActive(recordAudioBtn = document.getElementById('record-audio-btn')) {
  if (!recordAudioBtn) return;
  recordAudioBtn.innerHTML = '<i data-lucide="square" class="recording-icon"></i>';
  recordAudioBtn.classList.add('recording');
  recordAudioBtn.title = 'Stop Recording Voice Message';
  if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
}

function stopMediaStream() {
  if (!runtime.mediaStreamTrack) return;
  runtime.mediaStreamTrack.getTracks().forEach(track => track.stop());
}

function resetRecordingState() {
  activeRecordingOptions = null;
  setRuntime({
    isRecordingAudio: false,
    mediaRecorder: null,
    audioChunks: [],
    audioRecordedBytes: 0,
    audioRecordingByteLimit: 0,
    isStoppingAudioRecording: false,
    audioRecordingLimitReached: false,
    mediaStreamTrack: null
  });
}

function showRecordingError(message, options = {}) {
  if (options.showAlerts !== false) alert(message);
}

function recordingFileName(mimeType) {
  const type = String(mimeType || '').toLowerCase();
  const extension = type.includes('mp4') || type.includes('aac') ? 'm4a'
    : type.includes('ogg') ? 'ogg'
      : 'webm';
  return `recorded_audio_${Date.now()}.${extension}`;
}

export async function startAudioRecording(options = {}) {
  if (runtime.isRecordingAudio && runtime.mediaRecorder) {
    return { recorder: runtime.mediaRecorder, stream: runtime.mediaStreamTrack };
  }

  const remainingBytes = getRemainingAttachmentBytes(runtime.attachedFiles);
  if (remainingBytes < MIN_USEFUL_RECORDING_BYTES) {
    const error = new Error('There is not enough attachment space to start a recording. Remove an attachment and try again.');
    showRecordingError(error.message, options);
    throw error;
  }

  const recordingByteLimit = Math.min(MAX_ATTACHMENT_FILE_SIZE_BYTES, remainingBytes);
  let requestedStream = null;

  try {
    requestedStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(requestedStream);
    activeRecordingOptions = { ...options };
    setRuntime({
      mediaStreamTrack: requestedStream,
      mediaRecorder: recorder,
      audioChunks: [],
      audioRecordedBytes: 0,
      audioRecordingByteLimit: recordingByteLimit,
      isStoppingAudioRecording: false,
      audioRecordingLimitReached: false,
      isRecordingAudio: true
    });

    recorder.ondataavailable = (event) => {
      if (!event.data || event.data.size <= 0) return;

      const nextBytes = runtime.audioRecordedBytes + event.data.size;
      setRuntime({
        audioChunks: [...runtime.audioChunks, event.data],
        audioRecordedBytes: nextBytes
      });

      const stopThreshold = Math.max(
        MIN_USEFUL_RECORDING_BYTES,
        runtime.audioRecordingByteLimit - AUTO_STOP_HEADROOM_BYTES
      );
      if (
        nextBytes >= stopThreshold &&
        !runtime.isStoppingAudioRecording &&
        !runtime.audioRecordingLimitReached
      ) {
        setRuntime({ audioRecordingLimitReached: true });
        if (typeof activeRecordingOptions?.onLimitReached === 'function') {
          try { activeRecordingOptions.onLimitReached(); }
          catch (error) { console.error('Recording limit callback failed:', error); }
        } else {
          void stopAudioRecording();
        }
      }
    };

    recorder.start(Number(options.timesliceMs) > 0 ? Number(options.timesliceMs) : DEFAULT_TIMESLICE_MS);
    if (options.updateButton !== false) setRecordButtonActive(options.recordAudioBtn);
    updateComposerButtons();
    try { options.onStream?.(requestedStream); }
    catch (error) { console.error('Recording stream callback failed:', error); }
    return { recorder, stream: requestedStream };
  } catch (error) {
    requestedStream?.getTracks().forEach(track => track.stop());
    stopMediaStream();
    resetRecordingState();
    if (options.updateButton !== false) resetRecordButton(options.recordAudioBtn);
    updateComposerButtons();
    showRecordingError('Microphone access denied or not supported in browser.', options);
    throw error;
  }
}

export function stopAudioRecording(options = {}) {
  const recordAudioBtn = options.recordAudioBtn || document.getElementById('record-audio-btn');
  const recorder = runtime.mediaRecorder;
  const startOptions = activeRecordingOptions || {};
  const shouldAttach = options.attach !== false;
  const shouldRefresh = options.refresh !== false;
  const updateButton = options.updateButton ?? startOptions.updateButton ?? true;
  const showLimitAlert = options.showLimitAlert ?? startOptions.showLimitAlert ?? true;

  if (runtime.isStoppingAudioRecording && recorder) {
    return new Promise(resolve => {
      recorder.addEventListener('stop', () => resolve(null), { once: true });
    });
  }

  if (!runtime.isRecordingAudio || !recorder || recorder.state === 'inactive') {
    stopMediaStream();
    resetRecordingState();
    if (updateButton) resetRecordButton(recordAudioBtn);
    updateComposerButtons();
    return Promise.resolve(null);
  }

  setRuntime({ isStoppingAudioRecording: true });

  return new Promise(resolve => {
    recorder.onstop = () => {
      const mimeType = recorder.mimeType || 'audio/webm';
      const audioBlob = new Blob(runtime.audioChunks, { type: mimeType });
      const audioFile = new File([audioBlob], recordingFileName(mimeType), { type: mimeType });
      const stoppedForLimit = runtime.audioRecordingLimitReached;
      const added = shouldAttach && audioFile.size > 0
        ? tryAddAttachmentFile(audioFile, { refresh: shouldRefresh, showAlert: startOptions.showAlerts !== false })
        : false;

      stopMediaStream();
      resetRecordingState();
      if (updateButton) resetRecordButton(recordAudioBtn);
      updateComposerButtons();

      if (stoppedForLimit && added && showLimitAlert) {
        alert('Recording stopped automatically because it reached the available attachment size limit.');
      }
      resolve(shouldAttach ? (added ? audioFile : null) : (audioFile.size > 0 ? audioFile : null));
    };

    try {
      recorder.stop();
    } catch (error) {
      stopMediaStream();
      resetRecordingState();
      if (updateButton) resetRecordButton(recordAudioBtn);
      updateComposerButtons();
      console.error('Failed to stop audio recording:', error);
      resolve(null);
    }
  });
}

export function cancelAudioRecording(options = {}) {
  const recorder = runtime.mediaRecorder;
  const recordAudioBtn = options.recordAudioBtn || document.getElementById('record-audio-btn');
  // If Voice Mode takes over while the normal composer recorder is active, always
  // clear the composer's visible recording state. Voice-owned recordings opt out.
  const updateButton = activeRecordingOptions?.updateButton === true
    ? true
    : (options.updateButton ?? activeRecordingOptions?.updateButton ?? true);

  if (!recorder || recorder.state === 'inactive') {
    stopMediaStream();
    resetRecordingState();
    if (updateButton) resetRecordButton(recordAudioBtn);
    updateComposerButtons();
    return Promise.resolve();
  }

  setRuntime({ isStoppingAudioRecording: true });
  activeRecordingOptions = null;

  return new Promise(resolve => {
    recorder.onstop = () => {
      stopMediaStream();
      resetRecordingState();
      if (updateButton) resetRecordButton(recordAudioBtn);
      updateComposerButtons();
      resolve();
    };

    try { recorder.stop(); }
    catch (error) {
      stopMediaStream();
      resetRecordingState();
      if (updateButton) resetRecordButton(recordAudioBtn);
      updateComposerButtons();
      resolve();
    }
  });
}

export function initRecorderListeners(recordAudioBtn) {
  if (!recordAudioBtn) return;

  recordAudioBtn.addEventListener('click', async () => {
    if (!runtime.isRecordingAudio) {
      try {
        await startAudioRecording({ recordAudioBtn, updateButton: true, showAlerts: true });
      } catch (error) {
        console.warn('Audio recording did not start:', error);
      }
    } else {
      await stopAudioRecording({ recordAudioBtn, updateButton: true });
    }
  });
}
