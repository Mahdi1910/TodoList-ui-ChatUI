/**
 * file-reference-recovery.js — One-shot recovery for generation-time File access failures.
 */

import { getApiSettings, getCleanBaseUrl } from '../api/api-config.js';
import { getBackendModelId } from '../models/models.js';
import {
  createAttachmentPreparationContext,
  recoverMissingRemoteAttachments
} from './attachment-transport.js';
import { isFileSpecificPermissionDeniedError } from './attachment-file-errors.js';

export async function recoverGenerationFilePermissionFailure({
  error,
  messages,
  model,
  signal
}) {
  if (error?.name === 'AbortError') return false;

  const apiSettings = getApiSettings();
  const cleanBaseUrl = getCleanBaseUrl(apiSettings.textBaseUrl);
  if (!isFileSpecificPermissionDeniedError(error, messages, cleanBaseUrl)) return false;

  const modelId = getBackendModelId(model);
  if (!modelId) return false;

  const context = createAttachmentPreparationContext({
    apiSettings,
    cleanBaseUrl,
    modelId,
    signal
  });

  return recoverMissingRemoteAttachments(messages, context);
}
