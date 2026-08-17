import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isFileSpecificPermissionDeniedError,
  isRemoteFileLookupUnavailable,
  remoteFileName
} from '../ChatUI/js/chat/attachment-file-errors.js';
import { MAX_CONCURRENT_FILE_OPERATIONS } from '../ChatUI/js/chat/attachment-transport.js';
import { FILE_RECOVERY_CONCURRENCY } from '../ChatUI/js/chat/file-reference-recovery.js';

const baseUrl = 'http://192.168.8.109:7860';
const fileId = '71fff4041f8bfe42e1e65e151b244ee593c21436';
const messages = [{
  id: 'user-1',
  role: 'user',
  attachments: [{
    id: 'att-1',
    fileApiName: `files/${fileId}`,
    fileUri: `https://generativelanguage.googleapis.com/v1beta/files/${fileId}`,
    fileApiBaseUrl: baseUrl
  }]
}];

const exactFile403 = Object.assign(new Error(
  `API Error 403: Proxy browser error: Google API returned error: 403 PERMISSION_DENIED {"error":{"code":403,"message":"You do not have permission to access the File ${fileId} or it may not exist.","status":"PERMISSION_DENIED"}}`
), {
  httpStatus: 403,
  apiStatus: 'PERMISSION_DENIED',
  responseText: JSON.stringify({
    error: {
      code: 403,
      status: 'PERMISSION_DENIED',
      message: `You do not have permission to access the File ${fileId} or it may not exist.`
    }
  })
});
assert.equal(
  isFileSpecificPermissionDeniedError(exactFile403, messages, baseUrl),
  true,
  'The exact observed proxy File 403 must be recoverable.'
);

// Regression for the real failure: the File ID in Google's error does not have
// to match complete saved metadata. Older records can have only fileUri and no
// fileApiName/fileApiBaseUrl, while the error still clearly identifies a File.
const legacyMessages = [{
  id: 'user-legacy',
  role: 'user',
  attachments: [{
    id: 'att-legacy',
    fileUri: 'https://generativelanguage.googleapis.com/v1beta/files/old-local-metadata-id'
  }]
}];
const differentFile403 = Object.assign(new Error(
  'Proxy browser error: Google API returned error: 403 PERMISSION_DENIED {"error":{"code":403,"message":"You do not have permission to access the File 06b573e6f6104e7b3df4857feabe32de59d91e9a or it may not exist.","status":"PERMISSION_DENIED"}}'
), {
  httpStatus: 403,
  apiStatus: 'PERMISSION_DENIED'
});
assert.equal(
  isFileSpecificPermissionDeniedError(differentFile403, legacyMessages, baseUrl),
  true,
  'A clear Google File-access 403 must recover even when legacy metadata cannot provide an exact ID match.'
);

const generic403 = Object.assign(new Error('API Error 403: Permission denied for this API.'), {
  httpStatus: 403,
  apiStatus: 'PERMISSION_DENIED'
});
assert.equal(
  isFileSpecificPermissionDeniedError(generic403, messages, baseUrl),
  false,
  'A generic 403 must not be mistaken for a stale File reference.'
);
assert.equal(
  isFileSpecificPermissionDeniedError(exactFile403, [{ role: 'user', attachments: [] }], baseUrl),
  false,
  'A File-looking 403 without any remote attachments must not start File recovery.'
);

assert.equal(remoteFileName(`files/${fileId}`), `files/${fileId}`);
assert.equal(
  remoteFileName(`https://generativelanguage.googleapis.com/v1beta/files/${fileId}`),
  `files/${fileId}`,
  'Recovery must derive files/<id> from a legacy URI when fileApiName is missing.'
);

assert.equal(isRemoteFileLookupUnavailable({ httpStatus: 404 }), true);
assert.equal(isRemoteFileLookupUnavailable({ httpStatus: 403, apiStatus: 'PERMISSION_DENIED' }), true);
assert.equal(isRemoteFileLookupUnavailable({ httpStatus: 403, apiStatus: 'OTHER_REASON' }), false);
assert.equal(isRemoteFileLookupUnavailable({ httpStatus: 401, apiStatus: 'UNAUTHENTICATED' }), false);

assert.equal(MAX_CONCURRENT_FILE_OPERATIONS, 7, 'Normal Gemini File preparation must allow seven concurrent operations.');
assert.equal(FILE_RECOVERY_CONCURRENCY, 7, 'Stale Gemini File repair must allow seven concurrent operations.');

const transportSource = await readFile(new URL('../ChatUI/js/chat/attachment-transport.js', import.meta.url), 'utf8');
const streamingSource = await readFile(new URL('../ChatUI/js/chat/streaming.js', import.meta.url), 'utf8');
const recoverySource = await readFile(new URL('../ChatUI/js/chat/file-reference-recovery.js', import.meta.url), 'utf8');
const wrapperSource = await readFile(new URL('../ChatUI/js/api/gemini-file-recovery-wrapper.js', import.meta.url), 'utf8');

assert(
  transportSource.includes('MAX_CONCURRENT_FILE_OPERATIONS = 7') &&
  transportSource.includes('mapEntriesWithConcurrency'),
  'Both normal preparation and legacy 404 recovery must use the seven-operation concurrency policy.'
);
assert(
  transportSource.includes('await invalidateAttachmentRemoteMetadata(attachment);') &&
  transportSource.includes('await uploadAndActivateAttachment(attachment, context);'),
  'Unavailable File metadata must be invalidated before the local Blob is re-uploaded.'
);
assert(
  transportSource.includes('if (isAuthenticationOrPermissionError(error)) throw error;'),
  'Upload authentication/permission failures must stay fatal instead of looping.'
);
assert(
  transportSource.includes('The local copy of') && recoverySource.includes('LOCAL_ATTACHMENT_MISSING'),
  'Missing local Blob errors must say that the local copy is missing instead of exposing a misleading remote permission error.'
);
assert(
  streamingSource.includes('streamChatWithFileRecovery as streamChat'),
  'Normal send and Regenerate must both use the File-recovery wrapper through the shared streaming path.'
);
assert(
  wrapperSource.includes('MAX_FILE_RECOVERY_RETRIES = 3') &&
  wrapperSource.includes('while (true)') &&
  wrapperSource.includes('generationStarted') &&
  wrapperSource.includes('FILE_RECOVERY_EXHAUSTED'),
  'Pre-stream File recovery must be bounded, repeatable, and stop once generation activity begins.'
);
assert(
  recoverySource.includes('forceRefreshAllLocalFiles') &&
  recoverySource.includes('FILE_RECOVERY_CONCURRENCY') &&
  recoverySource.includes('mapWithConcurrency'),
  'A clear File-access failure must validate/repair the whole attachment set in parallel and force-refresh it when proxy account routing races files.get.'
);

console.log('File URI recovery verification passed.');
