/*
 * text-api-profiles.js — Two persistent Gemini Text API credential/base-URL profiles.
 *
 * The rest of ChatUI keeps using the legacy active aliases (textApiKey,
 * textApiKeys, textApiKeyIndex, textBaseUrl). This module mirrors those aliases
 * to the selected profile so existing request/failover code remains compatible.
 */

import { state, setState } from '../state/store.js';

export const TEXT_API_PROFILE_DEFINITIONS = Object.freeze([
  Object.freeze({ id: 'mode-1', name: 'Mode 1' }),
  Object.freeze({ id: 'mode-2', name: 'Mode 2' })
]);

function definitionFor(id) {
  return TEXT_API_PROFILE_DEFINITIONS.find(profile => profile.id === id) || TEXT_API_PROFILE_DEFINITIONS[0];
}

function normalizeProfile(raw = {}, definition) {
  return {
    id: definition.id,
    name: definition.name,
    textApiKey: String(raw.textApiKey || ''),
    textApiKeys: Array.isArray(raw.textApiKeys) ? raw.textApiKeys : [],
    textApiKeyIndex: Number.isInteger(Number(raw.textApiKeyIndex)) ? Number(raw.textApiKeyIndex) : 0,
    textBaseUrl: String(raw.textBaseUrl || '')
  };
}

function profilesFromApi(api = {}) {
  const stored = Array.isArray(api.textProfiles) ? api.textProfiles : [];
  return TEXT_API_PROFILE_DEFINITIONS.map((definition, index) => {
    const match = stored.find(profile => profile?.id === definition.id);
    if (match) return normalizeProfile(match, definition);
    // Existing installations migrate their one legacy pool into Mode 1 only.
    if (index === 0 && stored.length === 0) {
      return normalizeProfile({
        textApiKey: api.textApiKey || '',
        textApiKeys: Array.isArray(api.textApiKeys) ? api.textApiKeys : [],
        textApiKeyIndex: api.textApiKeyIndex,
        textBaseUrl: api.textBaseUrl || ''
      }, definition);
    }
    return normalizeProfile({}, definition);
  });
}

function activeIdFor(api, profiles) {
  return profiles.some(profile => profile.id === api.activeTextProfileId)
    ? api.activeTextProfileId
    : TEXT_API_PROFILE_DEFINITIONS[0].id;
}

function withActiveAliases(api, profiles, activeTextProfileId) {
  const active = profiles.find(profile => profile.id === activeTextProfileId) || profiles[0];
  return {
    ...api,
    textProfiles: profiles,
    activeTextProfileId,
    textApiKey: active?.textApiKey || '',
    textApiKeys: Array.isArray(active?.textApiKeys) ? active.textApiKeys : [],
    textApiKeyIndex: Number.isInteger(Number(active?.textApiKeyIndex)) ? Number(active.textApiKeyIndex) : 0,
    textBaseUrl: active?.textBaseUrl || ''
  };
}

export function ensureTextApiProfilesState() {
  const api = state.api || {};
  const profiles = profilesFromApi(api);
  const activeTextProfileId = activeIdFor(api, profiles);
  const next = withActiveAliases(api, profiles, activeTextProfileId);

  const currentProfiles = Array.isArray(api.textProfiles) ? api.textProfiles : [];
  const changed = api.activeTextProfileId !== next.activeTextProfileId ||
    currentProfiles.length !== next.textProfiles.length ||
    api.textApiKey !== next.textApiKey ||
    api.textApiKeys !== next.textApiKeys ||
    api.textApiKeyIndex !== next.textApiKeyIndex ||
    api.textBaseUrl !== next.textBaseUrl;
  if (changed) setState({ api: next });
  return changed ? next : api;
}

export function getActiveTextApiProfile() {
  const api = ensureTextApiProfilesState();
  return api.textProfiles.find(profile => profile.id === api.activeTextProfileId) || api.textProfiles[0];
}

export function commitActiveTextApiState(patch = {}) {
  const api = ensureTextApiProfilesState();
  const activeId = api.activeTextProfileId;
  const textFields = {
    textApiKey: patch.textApiKey !== undefined ? patch.textApiKey : api.textApiKey,
    textApiKeys: patch.textApiKeys !== undefined ? patch.textApiKeys : api.textApiKeys,
    textApiKeyIndex: patch.textApiKeyIndex !== undefined ? patch.textApiKeyIndex : api.textApiKeyIndex,
    textBaseUrl: patch.textBaseUrl !== undefined ? patch.textBaseUrl : api.textBaseUrl
  };
  const profiles = api.textProfiles.map(profile => profile.id === activeId
    ? { ...profile, ...textFields }
    : profile
  );
  const next = {
    ...api,
    ...patch,
    ...textFields,
    textProfiles: profiles,
    activeTextProfileId: activeId
  };
  setState({ api: next });
  return next;
}

export function selectTextApiProfile(profileId) {
  const api = ensureTextApiProfilesState();
  const definition = definitionFor(profileId);
  const next = withActiveAliases(api, api.textProfiles, definition.id);
  setState({ api: next });
  return next;
}

export function getTextApiProfileSnapshot(profileId = null) {
  const api = ensureTextApiProfilesState();
  const requestedId = profileId || api.activeTextProfileId;
  const profile = api.textProfiles.find(item => item.id === requestedId) || api.textProfiles[0];
  return profile ? {
    ...profile,
    textApiKeys: Array.isArray(profile.textApiKeys) ? profile.textApiKeys.map(entry => ({ ...entry })) : []
  } : null;
}
