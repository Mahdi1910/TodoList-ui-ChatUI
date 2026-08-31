export const SHELL_CHANNEL = 'mahdi-app-shell';
export const SHELL_PROTOCOL_VERSION = 1;
export const APP_IDS = Object.freeze({ TODO: 'todo', CHAT: 'chat', DIARY: 'diary' });

export function createShellMessage(type, payload = {}) {
  return {
    channel: SHELL_CHANNEL,
    version: SHELL_PROTOCOL_VERSION,
    app: 'shell',
    type,
    payload
  };
}

export function isProtocolMessage(value) {
  return !!value && typeof value === 'object'
    && value.channel === SHELL_CHANNEL
    && value.version === SHELL_PROTOCOL_VERSION
    && typeof value.type === 'string'
    && value.type.length <= 80
    && (value.app === APP_IDS.TODO || value.app === APP_IDS.CHAT || value.app === APP_IDS.DIARY || value.app === 'shell');
}

export function safeRequestId(prefix = 'shell') {
  if (globalThis.crypto?.randomUUID) return `${prefix}:${crypto.randomUUID()}`;
  return `${prefix}:${Date.now()}:${Math.random().toString(36).slice(2)}`;
}
