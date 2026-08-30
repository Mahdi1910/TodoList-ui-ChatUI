import { initNavigation } from './features/navigation.js';
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

document.addEventListener('DOMContentLoaded', () => {
    // 1. Initialize global UI listeners (e.g. dropdowns clicking outside)
    document.addEventListener('click', () => {
        document.querySelectorAll('.action-dropdown').forEach(drop => drop.classList.add('hidden'));
        document.querySelectorAll('.chat-popup').forEach(popup => popup.classList.add('hidden'));
    });
    bindCardActions();

    // 1.2. Handle App Resuming from Background
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') {
            processPendingBackgroundRecordings();
            updateDateDisplay();
        }
    });

    // 1.5. Fix for Android WebView double-tap keyboard issue
    document.addEventListener('focus', (e) => {
        const isTextInput = e.target.tagName === 'INPUT' && ['text', 'search', 'password', 'email', 'number'].includes(e.target.type);
        const isTextarea = e.target.tagName === 'TEXTAREA';
        
        if (isTextInput || isTextarea) {
            if(window.AndroidBridge && window.AndroidBridge.showKeyboard) {
                window.AndroidBridge.showKeyboard();
            }
        }
    }, true);

    // 2. Initialize modular features
    initNavigation();
    initCalendar();
    initMicrophone();

    initAiNotes();
    initSettings();
    initSearch();
    initSummariesUi();

    // 2.5 Apply UI & Personalization Settings
    applyVisualSettings();
    const launchView = localStorage.getItem('launch_view') || 'today';
    const navBtn = document.getElementById(`nav-${launchView}`);
    if (navBtn) navBtn.click();

    // 3. Background maintenance
    cleanupOldAudioFiles();
    checkAndGenerateSummaries(); // Automatically summarize past days
    processPendingBackgroundRecordings();

    // 4. Check Auto-Backup Triggers
    const freq = localStorage.getItem('auto_backup_frequency');
    if (freq === 'every_open' || freq === 'every_day' || freq === 'every_week') {
        const lastBackupStr = localStorage.getItem('last_auto_backup_timestamp');
        const now = new Date();
        const todayStr = now.toISOString().split('T')[0];

        let shouldBackup = false;

        if (freq === 'every_open') {
            shouldBackup = true;
        } else if (freq === 'every_day') {
            if (lastBackupStr !== todayStr) shouldBackup = true;
        } else if (freq === 'every_week') {
            const targetDay = parseInt(localStorage.getItem('auto_backup_day') || '0', 10);
            if (now.getDay() === targetDay && lastBackupStr !== todayStr) {
                shouldBackup = true;
            }
        }

        if (shouldBackup) {
            performBackup(true).then(() => {
                localStorage.setItem('last_auto_backup_timestamp', todayStr);
            }).catch(err => console.error("Auto backup failed on launch:", err));
        }
    }
});
