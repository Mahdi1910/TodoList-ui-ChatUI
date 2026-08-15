import { TodoStorageMappers } from './mappers.js';
import { TodoRepositories } from './repositories.js';
import { TodoDb } from './db.js';
import { TodoDbSchema } from './db-schema.js';
import { AppState } from '../state.js';
import { AppStateSync } from '../state-sync.js';
export const DataServiceReminderMethods = {
  resolveReminders(reminders = []) {
    const ids = [...new Set(reminders)].filter(id => id && id !== 'none');
    const builtin = new Set(TodoStorageMappers.BUILTIN_REMINDERS.map(item => item.id));
    const definitions = [];

    for (const id of ids) {
      if (builtin.has(id)) continue;

      const stored = AppState.getReminderDefinition(id);
      if (stored && !stored.isBuiltin) {
        definitions.push({ ...stored });
        continue;
      }

      const match = id.match(/^custom-(\d+)d-(\d+)h-(\d+)m$/);
      if (!match) throw new Error(`Unknown reminder: ${id}`);
      const day = Number(match[1]);
      const hr = Number(match[2]);
      const min = Number(match[3]);
      const parts = [];
      if (day) parts.push(`${day}d`);
      if (hr) parts.push(`${hr}h`);
      if (min) parts.push(`${min}m`);
      const definition = TodoStorageMappers.customReminderToDefinition({
        id,
        day,
        hr,
        min,
        label: `${parts.join(' ')} before`
      });
      if (definition) definitions.push(definition);
    }

    return { ids, definitions };
  },

  saveReminderDefinition(custom) {
    return this.enqueue(async () => {
      const builtinIds = new Set(TodoStorageMappers.BUILTIN_REMINDERS.map(item => item.id));
      if (builtinIds.has(custom?.id)) throw new Error('Built-in reminders cannot be replaced.');
      const definition = TodoStorageMappers.customReminderToDefinition(custom);
      if (!definition) throw new Error('Invalid custom reminder.');
      const S = TodoDbSchema.STORES;
      await TodoDb.withTransaction(S.REMINDER_DEFINITIONS, 'readwrite', tx =>
        TodoRepositories.put(tx, S.REMINDER_DEFINITIONS, definition)
      );
      AppStateSync.upsertReminderDefinitions([definition]);
      return definition;
    });
  },

  deleteReminderDefinition(reminderId) {
    return this.enqueue(async () => {
      const S = TodoDbSchema.STORES;
      const deleted = await TodoDb.withTransaction(
        [S.REMINDER_DEFINITIONS, S.TASK_REMINDERS],
        'readwrite',
        async tx => {
          const definition = await TodoRepositories.get(tx, S.REMINDER_DEFINITIONS, reminderId);
          if (!definition || definition.isBuiltin) return false;
          await TodoRepositories.deleteByIndex(tx, S.TASK_REMINDERS, 'by_reminder_id', reminderId);
          await TodoRepositories.remove(tx, S.REMINDER_DEFINITIONS, reminderId);
          return true;
        }
      );
      if (!deleted) return false;
      AppStateSync.removeReminderDefinition(reminderId);
      AppStateSync.removeReminderFromTasks(reminderId);
      return true;
    });
  }
};
