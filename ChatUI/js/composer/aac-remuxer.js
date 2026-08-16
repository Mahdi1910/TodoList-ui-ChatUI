/**
 * aac-remuxer.js — Lossless MP4/AAC -> ADTS AAC remuxing for voice recordings.
 *
 * The browser's MediaRecorder can encode AAC-LC inside an MP4 container even
 * when it cannot emit audio/aac directly. This module extracts those already
 * encoded AAC access units with MP4Box.js and prepends ADTS headers. No audio
 * decoding or re-encoding happens here.
 */

import { createFile as createMp4BoxFile } from '../vendor/mp4box/mp4box.all.mjs';

const AAC_LC_CODEC = 'mp4a.40.2';
const ADTS_HEADER_BYTES = 7;
const ADTS_MAX_FRAME_LENGTH = 0x1fff;
const ADTS_SAMPLE_RATES = [
  96000,
  88200,
  64000,
  48000,
  44100,
  32000,
  24000,
  22050,
  16000,
  12000,
  11025,
  8000,
  7350
];

function normalizedCodec(value = '') {
  return String(value || '').trim().toLowerCase();
}

function sampleRateIndex(sampleRate) {
  return ADTS_SAMPLE_RATES.indexOf(Number(sampleRate));
}

function encodedSampleBytes(sample) {
  const data = sample?.data;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  return null;
}

function createAdtsHeader(payloadLength, sampleRate, channelCount) {
  const frequencyIndex = sampleRateIndex(sampleRate);
  if (frequencyIndex < 0) {
    throw new Error(`AAC sample rate ${sampleRate} Hz cannot be represented by this ADTS writer.`);
  }

  const channels = Number(channelCount);
  if (!Number.isInteger(channels) || channels < 1 || channels > 7) {
    throw new Error(`AAC channel configuration ${channelCount} is not supported for ADTS output.`);
  }

  const frameLength = Number(payloadLength) + ADTS_HEADER_BYTES;
  if (!Number.isSafeInteger(frameLength) || frameLength <= ADTS_HEADER_BYTES || frameLength > ADTS_MAX_FRAME_LENGTH) {
    throw new Error(`AAC frame length ${frameLength} cannot be represented by a 7-byte ADTS header.`);
  }

  // ADTS stores profile as audioObjectType - 1. AAC-LC is object type 2,
  // therefore the two-bit ADTS profile value is 1.
  const adtsProfile = 1;
  const header = new Uint8Array(ADTS_HEADER_BYTES);
  header[0] = 0xff;
  header[1] = 0xf1; // MPEG-4, layer 0, no CRC.
  header[2] = ((adtsProfile & 0x03) << 6)
    | ((frequencyIndex & 0x0f) << 2)
    | ((channels >> 2) & 0x01);
  header[3] = ((channels & 0x03) << 6) | ((frameLength >> 11) & 0x03);
  header[4] = (frameLength >> 3) & 0xff;
  header[5] = ((frameLength & 0x07) << 5) | 0x1f;
  header[6] = 0xfc;
  return header;
}

function findAacAudioTrack(info) {
  const tracks = Array.isArray(info?.tracks) ? info.tracks : [];
  const audioTracks = tracks.filter(track => track?.audio || normalizedCodec(track?.codec).startsWith('mp4a.'));
  if (audioTracks.length === 0) throw new Error('Recorded MP4 does not contain an audio track.');

  const supportedTrack = audioTracks.find(track => normalizedCodec(track?.codec) === AAC_LC_CODEC);
  if (!supportedTrack) {
    const codecs = audioTracks.map(track => track?.codec || 'unknown').join(', ');
    throw new Error(`Recorded MP4 audio codec is not supported for lossless AAC remuxing (${codecs}).`);
  }
  return supportedTrack;
}

function trackAudioConfiguration(track) {
  const sampleRate = Number(track?.audio?.sample_rate || track?.audio?.sampleRate || track?.timescale);
  const channelCount = Number(track?.audio?.channel_count || track?.audio?.channelCount);

  if (sampleRateIndex(sampleRate) < 0) {
    throw new Error(`Recorded AAC sample rate ${sampleRate || 'unknown'} Hz is not supported by ADTS.`);
  }
  if (!Number.isInteger(channelCount) || channelCount < 1 || channelCount > 7) {
    throw new Error(`Recorded AAC channel count ${channelCount || 'unknown'} is not supported by ADTS.`);
  }

  return { sampleRate, channelCount };
}

/**
 * Convert an MP4 Blob containing AAC-LC into an ADTS AAC Blob without
 * decoding/re-encoding the audio payload.
 */
export async function remuxMp4AacToAdts(blob) {
  if (!(blob instanceof Blob)) throw new TypeError('AAC remuxing requires an MP4 Blob.');
  if (blob.size <= 0) throw new Error('Cannot remux an empty MP4 recording.');

  const sourceBuffer = await blob.arrayBuffer();
  // MP4Box's progressive parser requires this custom absolute-offset property.
  sourceBuffer.fileStart = 0;

  return new Promise((resolve, reject) => {
    const mp4box = createMp4BoxFile();
    let settled = false;
    let ready = false;
    let audioTrack = null;
    let sampleRate = 0;
    let channelCount = 0;
    const samples = [];

    const fail = error => {
      if (settled) return;
      settled = true;
      try { mp4box.stop(); } catch (_) {}
      reject(error instanceof Error ? error : new Error(String(error || 'MP4 parsing failed.')));
    };

    const finish = () => {
      if (settled) return;
      try {
        if (!ready || !audioTrack) throw new Error('MP4Box did not expose a usable AAC audio track.');
        if (samples.length === 0) throw new Error('MP4Box did not extract any AAC audio samples.');

        const expectedSamples = Number(audioTrack.nb_samples);
        if (Number.isSafeInteger(expectedSamples) && expectedSamples > 0 && samples.length !== expectedSamples) {
          throw new Error(`AAC sample extraction was incomplete (${samples.length}/${expectedSamples}).`);
        }

        const outputParts = [];
        for (const sample of samples) {
          const payload = encodedSampleBytes(sample);
          if (!payload || payload.byteLength === 0) throw new Error('MP4Box returned an empty AAC sample.');
          outputParts.push(createAdtsHeader(payload.byteLength, sampleRate, channelCount), payload);
        }

        const output = new Blob(outputParts, { type: 'audio/aac' });
        if (output.size <= ADTS_HEADER_BYTES) throw new Error('AAC remuxing produced an empty output file.');

        settled = true;
        try { mp4box.stop(); } catch (_) {}
        resolve(output);
      } catch (error) {
        fail(error);
      }
    };

    mp4box.onError = error => fail(new Error(`MP4Box could not parse the recorded MP4: ${error}`));
    mp4box.onReady = info => {
      if (settled) return;
      try {
        audioTrack = findAacAudioTrack(info);
        ({ sampleRate, channelCount } = trackAudioConfiguration(audioTrack));
        ready = true;

        mp4box.onSamples = (trackId, _user, extractedSamples) => {
          if (settled || Number(trackId) !== Number(audioTrack.id)) return;
          samples.push(...(extractedSamples || []));
        };
        mp4box.setExtractionOptions(audioTrack.id, null, {
          nbSamples: 1000,
          rapAlignement: false
        });
        mp4box.start();
      } catch (error) {
        fail(error);
      }
    };

    try {
      mp4box.appendBuffer(sourceBuffer);
      mp4box.flush();
      // MP4Box extraction callbacks are synchronous with append/flush for a
      // complete in-memory file. Defer finalization one microtask so the final
      // onSamples callback can complete before we validate the sample count.
      queueMicrotask(finish);
    } catch (error) {
      fail(error);
    }
  });
}
