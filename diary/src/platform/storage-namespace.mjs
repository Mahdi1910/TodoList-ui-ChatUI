export const DIARY_STORAGE_PREFIX = 'aura-diary:';
export const DIARY_STORAGE_MIGRATION_KEY = `${DIARY_STORAGE_PREFIX}storage-migrated-v1`;

const LEGACY_KEYS = Object.freeze([
  'theme',
  'accent_color',
  'launch_view',
  'hide_sidebar_today',
  'hide_sidebar_calendar',
  'hide_sidebar_search',
  'hide_sidebar_notes',
  'gemini_api_key',
  'disable_auto_enhance',
  'custom_enhance_prompt',
  'auto_retry_enabled',
  'save_audio_externally',
  'quick_capture_enabled',
  'auto_backup_frequency',
  'auto_backup_day',
  'last_auto_backup_timestamp',
  'disable_title_generation',
  'disable_tag_generation',
  'disable_location_weather',
  'audio_retention_days',
  'enable_auto_summaries',
  'end_of_week_day',
  'custom_prompt_daily',
  'custom_prompt_weekly',
  'custom_prompt_monthly',
  'custom_prompt_yearly'
]);

const DIARY_EVIDENCE_KEYS = Object.freeze([
  'gemini_api_key',
  'quick_capture_enabled',
  'disable_auto_enhance',
  'custom_enhance_prompt',
  'auto_retry_enabled',
  'save_audio_externally',
  'auto_backup_frequency',
  'disable_location_weather',
  'audio_retention_days',
  'enable_auto_summaries'
]);

const AMBIGUOUS_VISUAL_KEYS = new Set([
  'theme',
  'accent_color',
  'launch_view',
  'hide_sidebar_today',
  'hide_sidebar_calendar',
  'hide_sidebar_search',
  'hide_sidebar_notes'
]);

const INSTALL_MARKER = '__auraDiaryStorageNamespaceV1';

function prefixedKey(key) {
  const raw = String(key);
  return raw.startsWith(DIARY_STORAGE_PREFIX) ? raw : `${DIARY_STORAGE_PREFIX}${raw}`;
}

export function migrateLegacyDiaryStorage(storage, native = {}) {
  if (!storage) return { migrated: false, copied: [] };
  const proto = Object.getPrototypeOf(storage);
  const getItem = native.getItem || proto?.getItem;
  const setItem = native.setItem || proto?.setItem;
  if (typeof getItem !== 'function' || typeof setItem !== 'function') return { migrated: false, copied: [] };

  if (getItem.call(storage, DIARY_STORAGE_MIGRATION_KEY) !== null) {
    return { migrated: false, copied: [] };
  }

  const hasDiaryEvidence = DIARY_EVIDENCE_KEYS.some(key => getItem.call(storage, key) !== null);
  const copied = [];
  for (const key of LEGACY_KEYS) {
    if (AMBIGUOUS_VISUAL_KEYS.has(key) && !hasDiaryEvidence) continue;
    const legacyValue = getItem.call(storage, key);
    if (legacyValue === null) continue;
    const targetKey = prefixedKey(key);
    if (getItem.call(storage, targetKey) !== null) continue;
    setItem.call(storage, targetKey, legacyValue);
    copied.push(key);
  }

  setItem.call(storage, DIARY_STORAGE_MIGRATION_KEY, JSON.stringify({ version: 1, copied }));
  return { migrated: true, copied };
}

export function installDiaryStorageNamespace(storage) {
  if (!storage) return false;
  const proto = Object.getPrototypeOf(storage);
  if (!proto || proto[INSTALL_MARKER]) return Boolean(proto?.[INSTALL_MARKER]);

  const native = {
    getItem: proto.getItem,
    setItem: proto.setItem,
    removeItem: proto.removeItem,
    clear: proto.clear,
    key: proto.key
  };
  if (Object.values(native).some(method => typeof method !== 'function')) return false;

  migrateLegacyDiaryStorage(storage, native);

  Object.defineProperty(proto, 'getItem', {
    configurable: true,
    writable: true,
    value(key) {
      if (this === storage) return native.getItem.call(this, prefixedKey(key));
      return native.getItem.call(this, key);
    }
  });
  Object.defineProperty(proto, 'setItem', {
    configurable: true,
    writable: true,
    value(key, value) {
      if (this === storage) return native.setItem.call(this, prefixedKey(key), value);
      return native.setItem.call(this, key, value);
    }
  });
  Object.defineProperty(proto, 'removeItem', {
    configurable: true,
    writable: true,
    value(key) {
      if (this === storage) return native.removeItem.call(this, prefixedKey(key));
      return native.removeItem.call(this, key);
    }
  });
  Object.defineProperty(proto, 'clear', {
    configurable: true,
    writable: true,
    value() {
      if (this !== storage) return native.clear.call(this);
      const ownedKeys = [];
      for (let index = 0; index < this.length; index += 1) {
        const key = native.key.call(this, index);
        if (key?.startsWith(DIARY_STORAGE_PREFIX)) ownedKeys.push(key);
      }
      ownedKeys.forEach(key => native.removeItem.call(this, key));
    }
  });
  Object.defineProperty(proto, 'key', {
    configurable: true,
    writable: true,
    value(index) {
      if (this !== storage) return native.key.call(this, index);
      const ownedKeys = [];
      for (let cursor = 0; cursor < this.length; cursor += 1) {
        const key = native.key.call(this, cursor);
        if (key?.startsWith(DIARY_STORAGE_PREFIX)) ownedKeys.push(key.slice(DIARY_STORAGE_PREFIX.length));
      }
      return ownedKeys[Number(index)] ?? null;
    }
  });
  Object.defineProperty(proto, INSTALL_MARKER, { configurable: false, value: true });
  return true;
}

try {
  if (typeof window !== 'undefined' && window.localStorage) {
    installDiaryStorageNamespace(window.localStorage);
  }
} catch (error) {
  console.warn('Aura Diary could not install its local storage namespace.', error);
}
