/**
 * file-history-sanitizer.js — Removes expired remote File pointers from replayed
 * assistant history without mutating the persisted chat state.
 *
 * User attachments are rebuilt separately from their permanent local Blobs by
 * the attachment transport. Old assistant modelResponseParts must therefore not
 * be allowed to re-inject a stale File API URI during Regenerate/retry.
 */

function remoteFileDataUri(part) {
  const data = part?.fileData || part?.file_data;
  const value = data?.fileUri || data?.file_uri;
  return typeof value === 'string' ? value.trim() : '';
}

export function hasPreservedRemoteFileData(messages = []) {
  return (messages || []).some(message =>
    message?.role === 'assistant' &&
    Array.isArray(message.modelResponseParts) &&
    message.modelResponseParts.some(part => !!remoteFileDataUri(part))
  );
}

export function createFileRecoveryMessages(messages = []) {
  return (messages || []).map(message => {
    if (message?.role !== 'assistant' || !Array.isArray(message.modelResponseParts)) {
      return message;
    }

    const filteredParts = message.modelResponseParts.filter(part => !remoteFileDataUri(part));
    if (filteredParts.length === message.modelResponseParts.length) return message;

    // Keep attachments and every other message field by reference/value exactly
    // as they were. Only the retry-only API view of modelResponseParts changes.
    return {
      ...message,
      modelResponseParts: filteredParts
    };
  });
}
