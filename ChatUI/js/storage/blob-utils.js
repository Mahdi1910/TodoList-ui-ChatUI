/**
 * blob-utils.js - Storage-safe Base64/Blob conversion helpers.
 */

export function base64ToBlob(base64Data, mimeType = 'application/octet-stream') {
  try {
    const cleanBase64 = base64Data.includes(',') ? base64Data.split(',')[1] : base64Data;
    const byteCharacters = atob(cleanBase64);
    const byteNumbers = new Array(byteCharacters.length);
    for (let i = 0; i < byteCharacters.length; i++) {
      byteNumbers[i] = byteCharacters.charCodeAt(i);
    }
    const byteArray = new Uint8Array(byteNumbers);
    return new Blob([byteArray], { type: mimeType });
  } catch (err) {
    console.warn('Failed to convert Base64 to Blob; attachment data is unavailable:', err);
    return null;
  }
}
