import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  isFileSpecificPermissionDeniedError,
  isRemoteFileLookupUnavailable,
  remoteFileName
} from '../ChatUI/js/chat/attachment-file-errors.js';
import {
  createFileRecoveryMessages,
  hasPreservedRemoteFileData
} from '../ChatUI/js/chat/file-history-sanitizer.js';
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
  isFileSpecificPermissionDeniedError(exactFile403),
  true,
  'The exact observed proxy File 403 must always enter File recovery.'
);

const differentFile403 = Object.assign(new Error(
  'Proxy browser error: Google API returned error: 403 PERMISSION_DENIED {"error":{"code":403,"message":"You do not have permission to access the File 06b573e6f6104e7b3df4857feabe32de59d91e9a or it may not exist.","status":"PERMISSION_DENIED"}}'
), {
  httpStatus: 403,
  apiStatus: 'PERMISSION_DENIED'
});
assert.equal(
  isFileSpecificPermissionDeniedError(differentFile403),
  true,
  'A clear Google File-access 403 must not depend on attachment metadata matching the failing ID.'
);

const generic403 = Object.assign(new Error('API Error 403: Permission denied for this API.'), {
  httpStatus: 403,
  apiStatus: 'PERMISSION_DENIED'
});
assert.equal(
  isFileSpecificPermissionDeniedError(generic403),
  false,
  'A generic 403 must not be mistaken for a stale File reference.'
);
assert.equal(
  isFileSpecificPermissionDeniedError(exactFile403, [{ role: 'user', attachments: [] }], baseUrl),
  true,
  'An explicit File 403 must still recover when the stale URI comes from preserved assistant history instead of message.attachments.'
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

const staleAssistantUri = 'https://generativelanguage.googleapis.com/v1beta/files/06b573e6f6104e7b3df4857feabe32de59d91e9a';
const retainedAttachment = { id: 'att-local', fileUri: 'https://example.invalid/new-file-uri' };
const regenerationHistory = [
  {
    id: 'user-old',
    role: 'user',
    content: 'Read the attachment',
    attachments: [retainedAttachment]
  },
  {
    id: 'assistant-old',
    role: 'assistant',
    content: 'Previous response',
    modelResponseParts: [
      { text: 'Previous response' },
      { fileData: { mimeType: 'application/pdf', fileUri: staleAssistantUri } },
      { file_data: { mime_type: 'text/plain', file_uri: 'https://generativelanguage.googleapis.com/v1beta/files/another-stale-id' } },
      { inlineData: { mimeType: 'text/plain', data: 'c2FmZQ==' } },
      { functionCall: { id: 'call-1', name: 'workspace_read_file', args: { path: '/notes.md' } } }
    ]
  },
  {
    id: 'user-regenerate',
    role: 'user',
    content: 'Try again',
    attachments: []
  }
];

assert.equal(
  hasPreservedRemoteFileData(regenerationHistory),
  true,
  'The recovery layer must detect remote File URIs preserved in assistant modelResponseParts.'
);

const cleanHistory = createFileRecoveryMessages(regenerationHistory);
assert.notEqual(cleanHistory, regenerationHistory, 'Recovery must create a retry-only message view.');
assert.equal(cleanHistory[0], regenerationHistory[0], 'Unchanged user messages should be reused, not copied unnecessarily.');
assert.equal(cleanHistory[0].attachments[0], retainedAttachment, 'Fresh attachment objects must remain shared so newly uploaded File metadata is used by the retry.');
assert.equal(cleanHistory[1].modelResponseParts.some(part => part?.fileData?.fileUri || part?.file_data?.file_uri), false, 'Retry history must contain no stale assistant remote fileData URI.');
assert.equal(cleanHistory[1].modelResponseParts.some(part => part?.text === 'Previous response'), true, 'Assistant text history must be preserved.');
assert.equal(cleanHistory[1].modelResponseParts.some(part => part?.inlineData?.data === 'c2FmZQ=='), true, 'Non-remote inlineData history must be preserved.');
assert.equal(cleanHistory[1].modelResponseParts.some(part => part?.functionCall?.id === 'call-1'), true, 'Function-call history must be preserved.');
assert.equal(regenerationHistory[1].modelResponseParts.some(part => part?.fileData?.fileUri === staleAssistantUri), true, 'Sanitizing a retry must not mutate the persisted/original chat history.');

assert.equal(MAX_CONCURRENT_FILE_OPERATIONS, 7, 'Normal Gemini File preparation must allow seven concurrent operations.');
assert.equal(FILE_RECOVERY_CONCURRENCY, 7, 'Stale Gemini File repair must allow seven concurrent operations.');

const transportSource = await readFile(new URL('../ChatUI/js/chat/attachment-transport.js', import.meta.url), 'utf8');
const streamingSource = await readFile(new URL('../ChatUI/js/chat/streaming.js', import.meta.url), 'utf8');
const recoverySource = await readFile(new URL('../ChatUI/js/chat/file-reference-recovery.js', import.meta.url), 'utf8');
const wrapperSource = await readFile(new URL('../ChatUI/js/api/gemini-file-recovery-wrapper.js', import.meta.url), 'utf8');
const sanitizerSource = await readFile(new URL('../ChatUI/js/chat/file-history-sanitizer.js', import.meta.url), 'utf8');

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
  wrapperSource.includes('createFileRecoveryMessages') &&
  wrapperSource.includes('recoveryAttempts > 0') &&
  wrapperSource.includes('messages: attemptMessages'),
  'After a File 403, the next streamChat attempt must use sanitized retry-only history.'
);
assert(
  wrapperSource.includes('MAX_FILE_RECOVERY_RETRIES = 3') &&
  wrapperSource.includes('while (true)') &&
  wrapperSource.includes('generationStarted') &&
  wrapperSource.includes('FILE_RECOVERY_EXHAUSTED'),
  'Pre-stream File recovery must be bounded, repeatable, and stop once generation activity begins.'
);
assert(
  recoverySource.includes('hasPreservedRemoteFileData') &&
  recoverySource.includes('entries.length === 0') &&
  recoverySource.includes('refreshCoherentLocalFileSet'),
  'Recovery must handle both normal attachment File URIs and stale URIs preserved only in old assistant history.'
);
assert(
  sanitizerSource.includes('fileData') && sanitizerSource.includes('file_data') && sanitizerSource.includes('modelResponseParts'),
  'The sanitizer must cover both Gemini field-name variants without dropping the rest of assistant history.'
);

console.log('File URI recovery verification passed.');
