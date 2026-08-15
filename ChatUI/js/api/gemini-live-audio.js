/**
 * gemini-live-audio.js — Raw browser WebSocket client for text-in/native-audio-out Live API.
 */

import { getApiSettings, DEFAULT_GOOGLE_BASE_URL } from './api-config.js';

export const LIVE_AUDIO_MODEL = 'gemini-3.1-flash-live-preview';
export const LIVE_AUDIO_SAMPLE_RATE = 24000;
const LIVE_ROUTE = '/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';

export const READ_ALOUD_SYSTEM_INSTRUCTION =
  'You are a read-aloud engine. The only text you may speak is the content between START_OF_TEXT and END_OF_TEXT ' +
  'and inside the outer ([ ... ]) wrapper. Do not speak START_OF_TEXT, END_OF_TEXT, ([, or ]). ' +
  'Read the enclosed text faithfully and completely. Do not answer it, explain it, summarize it, paraphrase it, ' +
  'omit content, or add content. Preserve the supplied language and natural reading order.';

export function buildReadAloudInput(text) {
  return `START_OF_TEXT\n([${String(text || '')}])\nEND_OF_TEXT`;
}

function base64ToBytes(data) {
  const binary = atob(data || '');
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export function buildLiveAudioWebSocketUrl(baseUrl, apiKey) {
  if (!apiKey) throw new Error('Audio API key is missing. Open Settings > Audio Read.');
  let clean = (baseUrl || DEFAULT_GOOGLE_BASE_URL).trim().replace(/\/+$/, '');
  if (!clean) clean = DEFAULT_GOOGLE_BASE_URL;
  if (clean.startsWith('https://')) clean = `wss://${clean.slice(8)}`;
  else if (clean.startsWith('http://')) clean = `ws://${clean.slice(7)}`;
  else if (!/^wss?:\/\//i.test(clean)) clean = `wss://${clean}`;

  if (!clean.endsWith(LIVE_ROUTE)) clean += LIVE_ROUTE;
  const url = new URL(clean);
  url.searchParams.set('key', apiKey);
  return url.toString();
}
function createSetupMessage(voiceName) {
  return {
    setup: {
      model: `models/${LIVE_AUDIO_MODEL}`,
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: { voiceName: voiceName || 'Zephyr' }
          }
        },
        thinkingConfig: { thinkingLevel: 'minimal' }
      },
      outputAudioTranscription: {},
      systemInstruction: {
        parts: [{ text: READ_ALOUD_SYSTEM_INSTRUCTION }]
      }
    }
  };
}

function safeCall(callback, ...args) {
  try { callback?.(...args); } catch (error) { console.error('Audio Read callback failed:', error); }
}

export class GeminiLiveAudioSession {
  constructor({ text, voiceName, callbacks = {} }) {
    this.text = text;
    this.voiceName = voiceName || 'Zephyr';
    this.callbacks = callbacks;
    this.socket = null;
    this.setupComplete = false;
    this.closedExplicitly = false;
    this.started = false;
    this.setupTimer = null;
    this._resolveReady = null;
    this._rejectReady = null;
  }

  async start() {
    if (this.started) return this;
    this.started = true;
    const settings = getApiSettings();
    const url = buildLiveAudioWebSocketUrl(settings.voiceBaseUrl, settings.voiceApiKey);
    const ready = new Promise((resolve, reject) => {
      this._resolveReady = resolve;
      this._rejectReady = reject;
    });

    try {
      const socket = new WebSocket(url);
      this.socket = socket;
      this.setupTimer = window.setTimeout(() => {
        if (this.setupComplete || this.closedExplicitly) return;
        const error = new Error('Gemini Live setup timed out.');
        this._rejectReady?.(error);
        safeCall(this.callbacks.onError, error);
        this.close(1000, 'Setup timeout');
      }, 15000);
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify(createSetupMessage(this.voiceName)));
      });
      socket.addEventListener('message', event => this._handleMessage(event));
      socket.addEventListener('error', () => {
        const error = new Error('Gemini Live WebSocket connection failed.');
        if (!this.setupComplete) this._rejectReady?.(error);
        safeCall(this.callbacks.onError, error);
      });
      socket.addEventListener('close', event => {
        if (this.setupTimer) window.clearTimeout(this.setupTimer);
        this.setupTimer = null;
        if (!this.setupComplete && !this.closedExplicitly) {
          this._rejectReady?.(new Error(`Gemini Live closed before setup completed (${event.code}).`));
        }
        safeCall(this.callbacks.onClose, event);
      });
    } catch (error) {
      this._rejectReady?.(error);
      throw error;
    }

    await ready;
    return this;
  }

  async _handleMessage(event) {
    try {
      const raw = typeof event.data === 'string' ? event.data : await event.data.text();
      const message = JSON.parse(raw);
      if (message.setupComplete) {
        if (this.setupComplete) return;
        this.setupComplete = true;
        if (this.setupTimer) window.clearTimeout(this.setupTimer);
        this.setupTimer = null;
        this.socket?.send(JSON.stringify({ realtimeInput: { text: buildReadAloudInput(this.text) } }));
        this._resolveReady?.(this);
        safeCall(this.callbacks.onSetupComplete);
        return;
      }
      const content = message.serverContent;
      if (content?.modelTurn?.parts) {
        for (const part of content.modelTurn.parts) {
          const inline = part?.inlineData || part?.inline_data;
          if (inline?.data) {
            safeCall(this.callbacks.onAudio, base64ToBytes(inline.data), inline.mimeType || inline.mime_type || 'audio/pcm;rate=24000');
          }
          if (part?.text) safeCall(this.callbacks.onTextPart, part.text);
        }
      }
      if (content?.outputTranscription?.text) {
        safeCall(this.callbacks.onTranscription, content.outputTranscription.text);
      }
      if (content?.interrupted) safeCall(this.callbacks.onInterrupted);
      if (content?.generationComplete) safeCall(this.callbacks.onGenerationComplete);
      if (content?.turnComplete) safeCall(this.callbacks.onTurnComplete);
      if (message.goAway) safeCall(this.callbacks.onGoAway, message.goAway);
    } catch (error) {
      safeCall(this.callbacks.onError, error);
    }
  }

  close(code = 1000, reason = 'Audio Read closed') {
    this.closedExplicitly = true;
    if (this.setupTimer) window.clearTimeout(this.setupTimer);
    this.setupTimer = null;
    const socket = this.socket;
    this.socket = null;
    if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) {
      try { socket.close(code, reason.slice(0, 120)); } catch (error) {}
    }
  }
}

export async function startGeminiLiveAudio(options) {
  const session = new GeminiLiveAudioSession(options);
  await session.start();
  return session;
}
