import './platform/storage-namespace.mjs';
import { initNavigation, activateDiaryView } from './features/navigation.js';
import { initCalendar } from './features/calendar.js';
import { initMicrophone } from './features/microphone.js';
import { initAiNotes } from './features/ai-notes.js';
import { initSettings, applyVisualSettings, performBackup } from './features/settings.js';
import { initSearch } from './features/search.js';
import { bindCardActions } from './features/card-actions.js';
import { cleanupOldAudioFiles } from './features/database.js';
import { checkAndGenerateSummaries } from './features/summarization-engine.js';
import { initSummariesUi } from './features/summaries-ui.js';
import { processPendingBackgroundRecordings } from './features/background-recordings.js';
import { updateDateDisplay } from './state.js';
import { initDiaryEmbeddedBridge } from './embedded/shell-bridge.js';

async function resumeDiary() {
    updateDateDisplay();
    await processPendingBackgroundRecordings();
}

async function runAutoBackupCheck() {
    const freq = localStorage.getItem('auto_backup_frequency');
    if (!['every_open', 'every_day', 'every_week'].includes(freq)) return;

    const lastBackupStr = localStorage.getItem('last_auto_backup_timestamp');
    const now = new Date();
    const todayStr = now.toISOString().split('T')[0];
    let shouldBackup = false;

    if (freq === 'every_open') {
        shouldBackup = true;
    } else if (freq === 'every_day') {
        shouldBackup = lastBackupStr !== todayStr;
    } else if (freq === 'every_week') {
        const targetDay = parseInt(localStorage.getItem('auto_backup_day') || '0', 10);
        shouldBackup = now.getDay() === targetDay && lastBackupStr !== todayStr;
    }

    if (!shouldBackup) return;
    await performBackup(true);
    localStorage.setItem('last_auto_backup_timestamp', todayStr);
}

document.addEventListener('DOMContentLoaded', () => {
    const embeddedBridge = initDiaryEmbeddedBridge({
        openSettings: () => activateDiaryView('view-settings'),
        onActive: resumeDiary
    });

    try {
        document.addEventListener('click', () => {
            document.querySelectorAll('.action-dropdown').forEach(drop => drop.classList.add('hidden'));
            document.querySelectorAll('.chat-popup').forEach(popup => popup.classList.add('hidden'));
        });
        bindCardActions();

        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') void resumeDiary();
        });

        // Preserve the native Android WebView single-tap keyboard workaround.
        document.addEventListener('focus', event => {
            const isTextInput = event.target.tagName === 'INPUT' && ['text', 'search', 'password', 'email', 'number'].includes(event.target.type);
            const isTextarea = event.target.tagName === 'TEXTAREA';
            if ((isTextInput || isTextarea) && window.AndroidBridge?.showKeyboard) {
                window.AndroidBridge.showKeyboard();
            }
        }, true);

        initNavigation();
        initCalendar();
        initMicrophone();
        initAiNotes();
        initSettings();
        initSearch();
        initSummariesUi();

        applyVisualSettings();
        const launchView = localStorage.getItem('launch_view') || 'today';
        const navBtn = document.getElementById(`nav-${launchView}`);
        if (navBtn) navBtn.click();

        // The Shell may use Diary as soon as essential UI/settings initialization is complete.
        embeddedBridge?.reportReady();

        // Non-blocking maintenance must never delay app:ready.
        void cleanupOldAudioFiles().catch(error => console.error('Audio cleanup failed:', error));
        void checkAndGenerateSummaries().catch(error => console.error('Summary maintenance failed:', error));
        void processPendingBackgroundRecordings().catch(error => console.error('Background recording import failed:', error));
        void runAutoBackupCheck().catch(error => console.error('Auto backup failed on launch:', error));
    } catch (error) {
        console.error('Aura Diary startup failed:', error);
        embeddedBridge?.reportError(error);
    }
});
