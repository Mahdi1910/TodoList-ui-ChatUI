import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isFileSpecificPermissionDeniedError,
  isRemoteFileLookupUnavailable
} from '../ChatUI/js/chat/attachment-file-errors.js';

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
  `API Error 403: You do not have permission to access the File ${fileId} or it may not exist.`
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
  'The observed File-specific 403 must be recoverable.'
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

const otherFile403 = Object.assign(new Error('You do not have permission to access the File another-file-id.'), {
  httpStatus: 403,
  apiStatus: 'PERMISSION_DENIED'
});
assert.equal(
  isFileSpecificPermissionDeniedError(otherFile403, messages, baseUrl),
  false,
  'A 403 naming a different File must not recover this request.'
);

assert.equal(isRemoteFileLookupUnavailable({ httpStatus: 404 }), true);
assert.equal(isRemoteFileLookupUnavailable({ httpStatus: 403, apiStatus: 'PERMISSION_DENIED' }), true);
assert.equal(isRemoteFileLookupUnavailable({ httpStatus: 403, apiStatus: 'OTHER_REASON' }), false);
assert.equal(isRemoteFileLookupUnavailable({ httpStatus: 401, apiStatus: 'UNAUTHENTICATED' }), false);

const transportSource = await readFile(new URL('../ChatUI/js/chat/attachment-transport.js', import.meta.url), 'utf8');
const streamingSource = await readFile(new URL('../ChatUI/js/chat/streaming.js', import.meta.url), 'utf8');
const recoverySource = await readFile(new URL('../ChatUI/js/chat/file-reference-recovery.js', import.meta.url), 'utf8');
const wrapperSource = await readFile(new URL('../ChatUI/js/api/gemini-file-recovery-wrapper.js', import.meta.url), 'utf8');

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
  streamingSource.includes('streamChatWithFileRecovery as streamChat'),
  'Normal send and Regenerate must both use the File-recovery wrapper through the shared streaming path.'
);
assert(
  wrapperSource.includes('generationStarted') &&
  wrapperSource.includes('recoverGenerationFilePermissionFailure') &&
  wrapperSource.includes('return streamChat(options);'),
  'Generation retry must happen once and only before text/thinking/tool activity starts.'
);
assert(
  recoverySource.includes('isFileSpecificPermissionDeniedError'),
  'Generation recovery must use the narrow File-specific 403 classifier.'
);

console.log('File URI 403 recovery verification passed.');
