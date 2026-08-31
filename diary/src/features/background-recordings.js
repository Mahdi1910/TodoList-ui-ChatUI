import { db, saveEntry } from './database.js';
import { isRTL } from './rtl-detect.js';
import { attachMetadataToEntry } from './metadata-fetcher.js';
import { processRetryQueue } from './retry-manager.js';
import { updateDateDisplay } from '../state.js';
import { showToast } from './toast.js';

let pendingProcessingPromise = null;

window.processPendingBackgroundRecordings = function() {
    return processPendingBackgroundRecordings();
};

export function processPendingBackgroundRecordings() {
    if (pendingProcessingPromise) return pendingProcessingPromise;
    pendingProcessingPromise = processPendingBackgroundRecordingsOnce()
        .finally(() => { pendingProcessingPromise = null; });
    return pendingProcessingPromise;
}

async function processPendingBackgroundRecordingsOnce() {
    if (!window.AndroidBridge?.getPendingRecordings || !window.AndroidBridge?.deletePendingRecording) return;

    try {
        const pendingFilesStr = window.AndroidBridge.getPendingRecordings();
        const pendingFiles = JSON.parse(pendingFilesStr || '[]');
        if (!Array.isArray(pendingFiles)) return;

        for (const rawFilename of pendingFiles) {
            const filename = String(rawFilename || '').trim();
            if (!filename) continue;
            try {
                const existing = await db.entries.filter(entry => entry.background_source === filename).first();
                if (existing) {
                    window.AndroidBridge.deletePendingRecording(filename);
                    continue;
                }

                const response = await fetch(`https://appassets.androidplatform.net/recordings/${encodeURIComponent(filename)}`);
                if (!response.ok) {
                    console.error('Failed to fetch recording json', response.status);
                    continue;
                }
                const data = await response.json();

                showToast('<i class="fa-solid fa-cloud-arrow-up"></i> Processing Background Recording...');
                await processOfflineJSON(data, filename);
                window.AndroidBridge.deletePendingRecording(filename);
            } catch (error) {
                console.error(`Failed to process recording ${filename}`, error);
            }
        }
    } catch (error) {
        console.error('Error with pending background recordings', error);
    }
}

async function processOfflineJSON(data, backgroundSource) {
    const entryId = crypto.randomUUID();
    const timestamp = data.timestamp || Date.now();
    const recordedDate = new Date(timestamp);
    const localDateString = `${recordedDate.getFullYear()}-${String(recordedDate.getMonth() + 1).padStart(2, '0')}-${String(recordedDate.getDate()).padStart(2, '0')}`;
    const timeString = recordedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!data.status || data.status === 'failed') {
        await saveEntry({
            id: entryId,
            title: 'Failed Transcription (Background)',
            content: '',
            local_date: localDateString,
            time_string: timeString,
            status: 'failed_transcription',
            background_source: backgroundSource
        });
        updateDateDisplay();
        attachMetadataToEntry(entryId);
        return;
    }

    const content = data.enhanced_content || data.transcript || '';
    const entry = await saveEntry({
        id: entryId,
        title: data.enhanced_title || 'Background Capture',
        tags: Array.isArray(data.enhanced_tags) ? data.enhanced_tags : [],
        content,
        is_rtl: isRTL(content) ? 1 : 0,
        local_date: localDateString,
        time_string: timeString,
        status: data.enhanced_content ? 'completed' : 'failed_enhancement',
        background_source: backgroundSource
    });

    if (localStorage.getItem('auto_backup_frequency') === '10s_after_transcription') {
        setTimeout(() => {
            import('./settings.js').then(module => {
                module.performBackup(true).catch(error => console.error('Auto backup after 10s failed:', error));
            });
        }, 10000);
    }

    updateDateDisplay();
    attachMetadataToEntry(entry.id);
    processRetryQueue();
}
