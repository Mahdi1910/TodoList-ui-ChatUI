import { transcribeAudioFile, enhanceTranscription } from './gemini-rest.js';
import { saveEntry, updateEntry, saveAudioFile } from './database.js';
import { isRTL } from './rtl-detect.js';
import { attachMetadataToEntry } from './metadata-fetcher.js';
import { processRetryQueue } from './retry-manager.js';
import { updateDateDisplay } from '../state.js';
import { showToast } from './toast.js';

window.processPendingBackgroundRecordings = async function() {
    return processPendingBackgroundRecordings();
};

export async function processPendingBackgroundRecordings() {
    if (!window.AndroidBridge || !window.AndroidBridge.getPendingRecordings || !window.AndroidBridge.deletePendingRecording) {
        return;
    }
    
    try {
        const pendingFilesStr = window.AndroidBridge.getPendingRecordings();
        const pendingFiles = JSON.parse(pendingFilesStr);

        for (const filename of pendingFiles) {
            try {
                const response = await fetch(`https://appassets.androidplatform.net/recordings/${filename}`);
                if (!response.ok) {
                    console.error("Failed to fetch recording json", response.status);
                    continue;
                }
                const data = await response.json();
                
                showToast('<i class="fa-solid fa-cloud-arrow-up"></i> Processing Background Recording...');
                await processOfflineJSON(data);
                
                window.AndroidBridge.deletePendingRecording(filename);
            } catch (err) {
                console.error(`Failed to process recording ${filename}`, err);
            }
        }
    } catch (e) {
        console.error("Error with pending background recordings", e);
    }
}

async function processOfflineJSON(data) {
    const entryId = crypto.randomUUID();
    const timestamp = data.timestamp || Date.now();
    const recordedDate = new Date(timestamp);
    const localDateString = `${recordedDate.getFullYear()}-${String(recordedDate.getMonth() + 1).padStart(2, '0')}-${String(recordedDate.getDate()).padStart(2, '0')}`;
    const timeString = recordedDate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    if (!data.status || data.status === 'failed') {
        await saveEntry({
            id: entryId,
            title: "Failed Transcription (Background)",
            content: "",
            local_date: localDateString,
            time_string: timeString,
            status: "failed_transcription"
        });
        updateDateDisplay();
        attachMetadataToEntry(entryId);
        return;
    }

    const entry = await saveEntry({
        id: entryId,
        title: data.enhanced_title || "Background Capture",
        tags: data.enhanced_tags || [],
        content: data.enhanced_content || data.transcript,
        is_rtl: isRTL(data.enhanced_content || data.transcript) ? 1 : 0,
        local_date: localDateString,
        time_string: timeString,
        status: data.enhanced_content ? "completed" : "failed_enhancement"
    });

    // Trigger Auto-Backup 10 seconds after transcription saves
    const autoBackupFreq = localStorage.getItem('auto_backup_frequency');
    if (autoBackupFreq === '10s_after_transcription') {
        setTimeout(() => {
            import('./settings.js').then(module => {
                module.performBackup(true).catch(err => console.error("Auto backup after 10s failed:", err));
            });
        }, 10000);
    }

    updateDateDisplay();
    attachMetadataToEntry(entry.id);
    processRetryQueue();
}
