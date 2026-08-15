/**
 * read-audio-cache.js — Validation and persistence of completed Read Aloud WAV audio.
 */

import { LIVE_AUDIO_MODEL, LIVE_AUDIO_SAMPLE_RATE } from '../api/gemini-live-audio.js';
import {
  getReadAudio,
  putReadAudio,
  deleteReadAudio,
  cleanupExpiredReadAudio,
  buildReadAudioExpiresAt
} from '../storage/storage.js';

export async function loadValidReadAudio(messageId, sourceUpdatedAt, sourceText) {
  let cached = null;
  try { cached = await getReadAudio(messageId); } catch (error) {
    console.warn('Read Aloud cache lookup failed:', error);
    return null;
  }
  if (!cached) return null;

  const expired = cached.expiresAt != null && Number(cached.expiresAt) <= Date.now();
  const valid = !expired && cached.sourceUpdatedAt === sourceUpdatedAt && cached.sourceText === sourceText;
  if (valid && cached.data instanceof Blob) return cached;
  await deleteReadAudio(messageId).catch(() => undefined);
  return null;
}
export async function persistReadAudioJob(job, retentionDays) {
  const generatedAt = Date.now();
  const record = {
    messageId: job.messageId,
    chatId: job.chatId,
    sourceUpdatedAt: job.sourceUpdatedAt,
    sourceText: job.sourceText,
    model: LIVE_AUDIO_MODEL,
    voiceName: job.voiceName,
    generatedAt,
    expiresAt: buildReadAudioExpiresAt(generatedAt, retentionDays),
    durationMs: Math.round(job.engine.generatedDuration * 1000),
    mimeType: 'audio/wav',
    sampleRate: LIVE_AUDIO_SAMPLE_RATE,
    channels: 1,
    bitsPerSample: 16,
    data: job.engine.createWavBlob()
  };

  try {
    try {
      await putReadAudio(record);
    } catch (firstError) {
      await cleanupExpiredReadAudio().catch(() => undefined);
      await putReadAudio(record);
    }
    if (Number(retentionDays) === 0) await cleanupExpiredReadAudio().catch(() => undefined);
    return true;
  } catch (error) {
    console.error('Read Aloud audio finished but could not be cached:', error);
    return false;
  }
}