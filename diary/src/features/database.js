import Dexie from '../dexie.min.mjs';

export const db = new Dexie('AuraDiaryDB');

/**
 * @typedef {Object} DiaryEntry
 * @property {string} id - UUID
 * @property {string} local_date - e.g., '2026-06-10'
 * @property {number} created_at - Timestamp
 * @property {string} status - 'completed', 'pending_transcription', 'failed_transcription', etc.
 * @property {string} location_city - e.g., 'Erbil'
 * @property {number} is_rtl - 1 for RTL, 0 for LTR
 * @property {string[]} tags - Array of tags
 * @property {string} title
 * @property {string} content
 * @property {string} time_string - e.g., '2:30 PM'
 * @property {number|null} location_lat
 * @property {number|null} location_lon
 * @property {number|null} weather_temp
 * @property {string} weather_condition
 * @property {string|null} audio_file_id
 * @property {number} updated_at
 * @property {string[]} ai_tested_notes - Array of AI Note IDs that this entry has already been tested against.
 */

/**
 * @typedef {Object} AINote
 * @property {string} id - UUID
 * @property {string} title
 * @property {string} description
 * @property {string[]} linked_entry_ids - Array of entry IDs that belong to this note.
 * @property {number} created_at
 */

/**
 * @typedef {Object} AudioFile
 * @property {string} id - UUID corresponding to the entry
 * @property {Blob} blob - The raw WebM audio blob
 */

/**
 * @typedef {Object} AppSettings
 * @property {string} id - The setting key
 * @property {any} value - The setting value
 */

// v1 Schema (Historical for Migrations)
db.version(1).stores({
    entries: 'id, local_date, created_at, status, *tags',
    ai_notes: 'id, title, *linked_entry_ids',

    files: 'id',
    settings: 'id'
});

// v2 Schema (Historical)
db.version(2).stores({
    entries: 'id, local_date, created_at, status, location_city, is_rtl, *tags',
    ai_notes: null, // Dropped

    files: 'id',
    settings: 'id'
}).upgrade(tx => {
    return tx.entries.toCollection().modify(entry => {
        if (entry.is_rtl === undefined) entry.is_rtl = 0;
        if (entry.location_city === undefined) entry.location_city = "";
    });
});

// v3 Schema (Current: AI Notes Relevance Engine)
db.version(3).stores({
    entries: 'id, local_date, created_at, status, location_city, is_rtl, *tags, *ai_tested_notes',
    ai_notes: 'id, title',
    files: 'id',
    settings: 'id'
}).upgrade(tx => {
    return tx.entries.toCollection().modify(entry => {
        if (!entry.ai_tested_notes) entry.ai_tested_notes = [];
    });
});

// v4 Schema (Hierarchical Summaries)
db.version(4).stores({
    entries: 'id, local_date, created_at, status, location_city, is_rtl, *tags, *ai_tested_notes',
    ai_notes: 'id, title',
    summaries: 'id, type, period_id, created_at', 
    files: 'id',
    settings: 'id'
});

// v5 Schema (Summary Rollup Tracking & Compound Index)
db.version(5).stores({
    entries: 'id, local_date, created_at, status, location_city, is_rtl, *tags, *ai_tested_notes, is_summarized_daily',
    ai_notes: 'id, title',
    summaries: 'id, [type+period_id], type, period_id, created_at, is_rolled_up', 
    files: 'id',
    settings: 'id'
}).upgrade(tx => {
    tx.entries.toCollection().modify(entry => {
        if (entry.is_summarized_daily === undefined) entry.is_summarized_daily = 0;
    });
    tx.summaries.toCollection().modify(summary => {
        if (summary.is_rolled_up === undefined) summary.is_rolled_up = 0;
    });
});

// Cascade Deletion Hook
db.entries.hook('deleting', function(primKey, obj, transaction) {
    if (obj && obj.audio_file_id) {
        // Automatically delete associated audio blob
        db.files.delete(obj.audio_file_id).catch(err => {
            console.error("Cascade delete failed for audio file:", obj.audio_file_id, err);
        });
    }
});

// ==========================================
// HELPER FUNCTIONS (Entries)
// ==========================================

export function generateUUID() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
        return crypto.randomUUID();
    }
    // Fallback for older WebViews or insecure file:// origins
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = (typeof crypto !== 'undefined' && crypto.getRandomValues) 
            ? crypto.getRandomValues(new Uint8Array(1))[0] % 16 
            : Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

/**
 * Save a new entry to the database.
 * @param {Object} entryData - Partial entry data to be merged with defaults.
 */
export async function saveEntry(entryData) {
    const now = Date.now();
    const defaultEntry = {
        id: generateUUID(),
        title: "Untitled",
        content: "",
        status: "completed",
        local_date: "", // e.g. "2026-06-10"
        time_string: "", // e.g. "2:30 PM"
        is_rtl: 0,
        location_city: "",
        location_lat: null,
        location_lon: null,
        weather_temp: null,
        weather_condition: "",
        tags: [],
        audio_file_id: null,
        created_at: now,
        updated_at: now
    };

    const entry = { ...defaultEntry, ...entryData };
    
    // Ensure ID exists
    if (!entry.id) entry.id = generateUUID();

    await db.entries.put(entry);
    return entry;
}

/**
 * Update an existing entry by ID.
 * @param {string} id - The UUID of the entry.
 * @param {Object} updates - The fields to update.
 */
export async function updateEntry(id, updates) {
    updates.updated_at = Date.now();
    await db.entries.update(id, updates);
}

/**
 * Delete an entry.
 * @param {string} id - The UUID of the entry.
 */
export async function deleteEntry(id) {
    // If we have an audio file linked, we should eventually clean that up too
    await db.entries.delete(id);
}

/**
 * Fetch entries that fall within a specific local_date string range.
 * @param {string} startDate - e.g. "2026-06-10"
 * @param {string} endDate - e.g. "2026-06-10"
 */
export async function getEntriesByDateRange(startDate, endDate) {
    return await db.entries
        .where('local_date')
        .between(startDate, endDate, true, true)
        .toArray();
}

/**
 * Get all entries for a specific local date string (e.g., '2026-06-10')
 * Sorted by created_at descending (newest first).
 */
export async function getEntriesByDate(localDateStr) {
    return await db.entries
        .where('local_date').equals(localDateStr)
        .reverse()
        .sortBy('created_at');
}

/**
 * Get an array of distinct local_date strings that have at least one entry.
 * Used for highlighting the calendar grid.
 */
export async function getActiveDates() {
    // We can extract unique local_dates from the entries
    const dates = new Set();
    await db.entries.each(entry => {
        if (entry.local_date) {
            dates.add(entry.local_date);
        }
    });
    return Array.from(dates);
}

/**
 * Get an entry by ID.
 */
export async function getEntryById(id) {
    return await db.entries.get(id);
}

// ==========================================
// HELPER FUNCTIONS (Files & Audio)
// ==========================================

/**
 * Save an audio Blob to the files store.
 * @param {string} id - The UUID (usually matches the entry ID)
 * @param {Blob} blob - The raw audio data
 */
export async function saveAudioFile(id, blob) {
    if (localStorage.getItem('save_audio_externally') === 'true' && window.AndroidBridge && window.AndroidBridge.saveAudioToExternal) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.readAsDataURL(blob);
            reader.onloadend = () => {
                const base64data = reader.result;
                const success = window.AndroidBridge.saveAudioToExternal(`${id}.webm`, base64data);
                if (success) {
                    resolve();
                } else {
                    console.error("Failed to save audio externally, falling back to internal DB.");
                    db.files.put({ id, blob }).then(resolve).catch(reject);
                }
            };
            reader.onerror = () => reject(new Error("Failed to read audio blob"));
        });
    } else {
        await db.files.put({ id, blob });
    }
}

/**
 * Retrieve an audio Blob by ID.
 * @param {string} id - The UUID
 */
export async function getAudioFile(id) {
    if (localStorage.getItem('save_audio_externally') === 'true') {
        try {
            const response = await fetch(`https://appassets.androidplatform.net/external-audio/${id}.webm`);
            if (response.ok) {
                return await response.blob();
            }
        } catch (err) {
            console.error("Failed to fetch external audio blob:", err);
        }
    }
    const fileRecord = await db.files.get(id);
    return fileRecord ? fileRecord.blob : null;
}

/**
 * Delete an audio Blob.
 * @param {string} id - The UUID
 */
export async function deleteAudioFile(id) {
    if (localStorage.getItem('save_audio_externally') === 'true' && window.AndroidBridge && window.AndroidBridge.deleteAudioFromExternal) {
        window.AndroidBridge.deleteAudioFromExternal(`${id}.webm`);
    }
    await db.files.delete(id);
}

/**
 * Cleanup old audio files every new day.
 * Only deletes audio for entries that are older than today AND NOT 'failed_transcription'.
 */
export async function cleanupOldAudioFiles() {
    const retentionSetting = localStorage.getItem('audio_retention_days') || 'forever';
    
    if (retentionSetting === 'forever') {
        return; // Do nothing
    }

    const daysToKeep = parseInt(retentionSetting, 10);
    if (isNaN(daysToKeep) || daysToKeep <= 0) return;

    // Calculate cutoff timestamp
    const cutoffTimestamp = Date.now() - (daysToKeep * 24 * 60 * 60 * 1000);

    const oldEntries = await db.entries
        .where('created_at')
        .below(cutoffTimestamp)
        .toArray();

    for (const entry of oldEntries) {
        // Keep audio if transcription failed (so we can retry)
        if (entry.status !== 'failed_transcription' && entry.audio_file_id) {
            await deleteAudioFile(entry.audio_file_id);
            
            // Unlink audio from entry to indicate it has been purged
            await updateEntry(entry.id, { audio_file_id: null });
        }
    }
}

// ==========================================
// HELPER FUNCTIONS (Summaries)
// ==========================================

/**
 * Save a new summary to the database.
 * @param {Object} summary - The summary object.
 */
export async function saveSummary(summary) {
    if (!summary.id) summary.id = generateUUID();
    if (!summary.created_at) summary.created_at = Date.now();
    await db.summaries.put(summary);
}

/**
 * Get a specific summary by type and period ID.
 * @param {string} type - 'daily', 'weekly', 'monthly', 'yearly'
 * @param {string} period_id - The period identifier
 * @returns {Promise<Object|undefined>}
 */
export async function getSummary(type, period_id) {
    return await db.summaries.where('[type+period_id]').equals([type, period_id]).first();
}

/**
 * Get all summaries of a specific type.
 * @param {string} type - 'daily', 'weekly', 'monthly', 'yearly'
 * @returns {Promise<Array>}
 */
export async function getSummariesByType(type) {
    return await db.summaries.where('type').equals(type).reverse().sortBy('created_at');
}

/**
 * Update an existing summary.
 */
export async function updateSummary(id, updates) {
    await db.summaries.update(id, updates);
}

/**
 * Delete a summary.
 */
export async function deleteSummary(id) {
    await db.summaries.delete(id);
}

/**
 * Mark an array of records with a boolean flag.
 * @param {string} table - 'entries' or 'summaries'
 * @param {Array<string>} ids - Array of UUIDs
 * @param {string} field - The boolean field to set
 * @param {number} value - 0 or 1
 */
export async function setFlag(table, ids, field, value) {
    await db[table].where('id').anyOf(ids).modify({ [field]: value });
}
