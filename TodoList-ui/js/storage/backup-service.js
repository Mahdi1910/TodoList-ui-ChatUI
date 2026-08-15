import { TodoDbSchema } from './db-schema.js';
import { TodoDb } from './db.js';
import { TodoRepositories } from './repositories.js';
import { AppDataService } from './data-service.js';
import { AppBackupValidation } from './backup-validation.js';

export const AppBackupService = (() => {
  const schema = () => TodoDbSchema;
  const repo = () => TodoRepositories;
  const validation = () => AppBackupValidation;
  const storeNames = () => Object.values(schema().STORES);

  async function readRawStores() {
    const names = storeNames();
    return TodoDb.withTransaction(names, 'readonly', async tx => {
      const rows = await Promise.all(names.map(name => repo().getAll(tx, name)));
      return Object.fromEntries(names.map((name, index) => [name, rows[index]]));
    });
  }

  function storedTheme() {
    return localStorage.getItem('theme') === 'light' ? 'light' : 'dark';
  }

  async function createSnapshot() {
    await AppDataService.whenIdle();
    const stores = await readRawStores();
    const dataVersionRow = stores[schema().STORES.APP_META]
      .find(row => row.key === 'dataVersion');
    return {
      format: validation().FORMAT,
      formatVersion: validation().FORMAT_VERSION,
      createdAt: new Date().toISOString(),
      database: {
        name: schema().NAME,
        schemaVersion: schema().VERSION,
        dataVersion: Number.isInteger(dataVersionRow?.value)
          ? dataVersionRow.value
          : validation().DATA_VERSION
      },
      preferences: { theme: storedTheme() },
      stores
    };
  }

  function serializeSnapshot(snapshot) {
    return JSON.stringify(snapshot, null, 2);
  }

  function fileTimestamp(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
  }

  async function downloadBackup() {
    const snapshot = await createSnapshot();
    const blob = new Blob([serializeSnapshot(snapshot)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `todolist-backup-${fileTimestamp()}.json`;
    anchor.hidden = true;
    document.body.appendChild(anchor);
    try {
      anchor.click();
    } finally {
      anchor.remove();
      URL.revokeObjectURL(url);
    }
    return snapshot;
  }

  async function parseBackupFile(file) {
    if (!file || typeof file.text !== 'function') throw new Error('Choose a JSON backup file.');
    let parsed;
    try {
      parsed = JSON.parse(await file.text());
    } catch (_) {
      throw new Error('The selected file is not valid JSON.');
    }
    return validation().validate(parsed);
  }

  function validateBackup(snapshot) {
    return validation().validate(snapshot);
  }

  function getRestoreSummary(snapshot) {
    return validation().summary(validateBackup(snapshot));
  }

  function normalizedMetaRows(snapshot) {
    const storeName = schema().STORES.APP_META;
    const imported = snapshot.stores[storeName]
      .filter(row => row.key !== 'initialized' && row.key !== 'dataVersion');
    return [
      ...imported,
      { key: 'dataVersion', value: validation().DATA_VERSION },
      { key: 'initialized', value: true }
    ];
  }

  async function restoreBackup(input) {
    const snapshot = validateBackup(input);
    await AppDataService.whenIdle();
    const names = storeNames();
    const metaStore = schema().STORES.APP_META;
    const restoredStores = { ...snapshot.stores, [metaStore]: normalizedMetaRows(snapshot) };

    await TodoDb.withTransaction(names, 'readwrite', async tx => {
      await Promise.all(names.map(name => repo().clear(tx, name)));
      for (const name of names) {
        await repo().putMany(tx, name, restoredStores[name]);
      }
    });

    localStorage.setItem('theme', snapshot.preferences.theme === 'light' ? 'light' : 'dark');
    window.location.reload();
  }

  return {
    createSnapshot,
    serializeSnapshot,
    downloadBackup,
    parseBackupFile,
    validateBackup,
    getRestoreSummary,
    restoreBackup
  };
})();
