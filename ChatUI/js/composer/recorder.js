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
import { remuxMp4AacToAdts } from './aac-remuxer.js';

const MIN_USEFUL_RECORDING_BYTES = 64 * 1024;
const AUTO_STOP_HEADROOM_BYTES = 128 * 1024;
const AAC_REMUX_OVERHEAD_RATIO = 0.10;
const DEFAULT_TIMESLICE_MS = 1000;
const AAC_LC_MP4_MIME = 'audio/mp4;codecs=mp4a.40.2';
const GENERIC_MP4_MIME = 'audio/mp4';

let activeRecordingOptions = null;
let activeStopPromise = null;

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

function normalizedMimeType(value = '') {
  return String(value || '').trim().toLowerCase();
}

function isMp4AudioMimeType(value = '') {
  return normalizedMimeType(value).split(';', 1)[0] === GENERIC_MP4_MIME;
}

export function getPreferredRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined' || typeof MediaRecorder.isTypeSupported !== 'function') return '';
  if (MediaRecorder.isTypeSupported(AAC_LC_MP4_MIME)) return AAC_LC_MP4_MIME;
  if (MediaRecorder.isTypeSupported(GENERIC_MP4_MIME)) return GENERIC_MP4_MIME;
  return '';
}

function createAudioMediaRecorder(stream) {
  const preferredMimeType = getPreferredRecordingMimeType();
  return preferredMimeType
    ? new MediaRecorder(stream, { mimeType: preferredMimeType })
    : new MediaRecorder(stream);
}

function recordingFileName(mimeType) {
  const type = normalizedMimeType(mimeType);
  const extension = type.split(';', 1)[0] === 'audio/aac' ? 'aac'
    : type.includes('mp4') ? 'm4a'
      : type.includes('ogg') ? 'ogg'
        : 'webm';
  return `recorded_audio_${Date.now()}.${extension}`;
}

function recordingHeadroomBytes(recorder, byteLimit) {
  if (!isMp4AudioMimeType(recorder?.mimeType)) return AUTO_STOP_HEADROOM_BYTES;
  return Math.max(AUTO_STOP_HEADROOM_BYTES, Math.ceil((Number(byteLimit) || 0) * AAC_REMUX_OVERHEAD_RATIO));
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
    const recorder = createAudioMediaRecorder(requestedStream);
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
        runtime.audioRecordingByteLimit - recordingHeadroomBytes(recorder, runtime.audioRecordingByteLimit)
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
  if (activeStopPromise) return activeStopPromise;

  const recordAudioBtn = options.recordAudioBtn || document.getElementById('record-audio-btn');
  const recorder = runtime.mediaRecorder;
  const startOptions = activeRecordingOptions || {};
  const shouldAttach = options.attach !== false;
  const shouldRefresh = options.refresh !== false;
  const updateButton = options.updateButton ?? startOptions.updateButton ?? true;
  const showLimitAlert = options.showLimitAlert ?? startOptions.showLimitAlert ?? true;

  if (!runtime.isRecordingAudio || !recorder || recorder.state === 'inactive') {
    stopMediaStream();
    resetRecordingState();
    if (updateButton) resetRecordButton(recordAudioBtn);
    updateComposerButtons();
    return Promise.resolve(null);
  }

  setRuntime({ isStoppingAudioRecording: true });

  const stopPromise = new Promise(resolve => {
    recorder.onstop = async () => {
      const mimeType = recorder.mimeType || 'audio/webm';
      const recordedChunks = [...runtime.audioChunks];
      const stoppedForLimit = runtime.audioRecordingLimitReached;
      let resultFile = null;

      // MediaRecorder is finished producing bytes. Release the microphone now,
      // before any potentially asynchronous parsing/remux work starts.
      stopMediaStream();

      try {
        const recordedBlob = new Blob(recordedChunks, { type: mimeType });
        let finalBlob = recordedBlob;
        let finalMimeType = mimeType;

        if (isMp4AudioMimeType(mimeType)) {
          finalBlob = await remuxMp4AacToAdts(recordedBlob);
          finalMimeType = 'audio/aac';
        }

        const audioFile = new File(
          [finalBlob],
          recordingFileName(finalMimeType),
          { type: finalMimeType }
        );

        if (shouldAttach && audioFile.size > 0) {
          const added = tryAddAttachmentFile(audioFile, {
            refresh: shouldRefresh,
            showAlert: startOptions.showAlerts !== false
          });
          resultFile = added ? audioFile : null;
          if (stoppedForLimit && added && showLimitAlert) {
            alert('Recording stopped automatically because it reached the available attachment size limit.');
          }
        } else if (!shouldAttach && audioFile.size > 0) {
          resultFile = audioFile;
        }
      } catch (error) {
        console.error('Failed to prepare recorded audio attachment:', error);
        showRecordingError('Recorded audio could not be prepared in a Gemini-compatible AAC format. Please try again.', startOptions);
        resultFile = null;
      } finally {
        resetRecordingState();
        if (updateButton) resetRecordButton(recordAudioBtn);
        updateComposerButtons();
        resolve(resultFile);
      }
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

  activeStopPromise = stopPromise;
  void stopPromise.finally(() => {
    if (activeStopPromise === stopPromise) activeStopPromise = null;
  });
  return stopPromise;
}

export function cancelAudioRecording(options = {}) {
  if (activeStopPromise) return activeStopPromise.then(() => undefined);

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
