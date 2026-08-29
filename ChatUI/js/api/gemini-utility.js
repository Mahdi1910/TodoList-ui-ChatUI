/**
 * gemini-utility.js — Small non-stream Gemini calls for background UI tasks.
 *
 * Utility calls deliberately reuse the selected Text API profile and the same
 * key-pool failover/cooldown policy as normal chat generation. They never have
 * a separate credential or Base URL configuration.
 */

import { getApiSettings, getCleanBaseUrl } from './api-config.js';
import { runWithTextApiKeyFailover } from './text-api-key-pool.js';

async function parseApiError(response) {
  let text = '';
  try { text = await response.text(); } catch (_) {}
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) {}
  const bodyError = parsed?.error && typeof parsed.error === 'object' ? parsed.error : {};
  const error = new Error(`API Error ${response.status}: ${bodyError.message || text || response.statusText || 'Request failed.'}`);
  error.name = 'GeminiApiError';
  error.httpStatus = Number(response.status) || 0;
  error.apiStatus = String(bodyError.status || '');
  return error;
}

function visibleTextFromResponse(data) {
  const parts = data?.candidates?.[0]?.content?.parts || [];
  return parts
    .filter(part => part?.thought !== true && typeof part?.text === 'string')
    .map(part => part.text)
    .join('')
    .trim();
}

export async function generateGeminiUtilityText({
  modelId,
  prompt,
  signal = null,
  temperature = 0.2,
  maxOutputTokens = 80
}) {
  if (!modelId) throw new Error('Gemini utility request is missing a model ID.');
  if (!String(prompt || '').trim()) throw new Error('Gemini utility request is missing a prompt.');

  return runWithTextApiKeyFailover(async () => {
    const apiSettings = getApiSettings();
    if (!apiSettings.textApiKey) {
      throw new Error('Gemini API key is missing. Please enter one or more API keys in Settings > Gemini.');
    }
    const cleanBaseUrl = getCleanBaseUrl(apiSettings.textBaseUrl);
    const response = await fetch(`${cleanBaseUrl}/v1beta/models/${modelId}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiSettings.textApiKey
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: String(prompt) }] }],
        generationConfig: {
          temperature,
          maxOutputTokens,
          thinkingConfig: {
            thinkingLevel: 'minimal',
            includeThoughts: false
          }
        }
      }),
      signal
    });
    if (!response.ok) throw await parseApiError(response);
    const data = await response.json();
    const text = visibleTextFromResponse(data);
    if (!text) throw new Error('Gemini returned an empty utility response.');
    return text;
  }, { signal, canReplay: () => true });
}
