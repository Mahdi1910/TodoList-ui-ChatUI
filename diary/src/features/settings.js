import { showToast } from './toast.js';
import { db } from './database.js';

export function initSettings() {
    function syncSettingsToNative() {
        if (window.AndroidBridge && window.AndroidBridge.syncSettings) {
            const apiKey = localStorage.getItem('gemini_api_key') || "";
            const disableAutoEnhance = localStorage.getItem('disable_auto_enhance') === 'true';
            const customPrompt = localStorage.getItem('custom_enhance_prompt') || "";
            window.AndroidBridge.syncSettings(apiKey, disableAutoEnhance, customPrompt);
        }
    }
    syncSettingsToNative();

    const saveBtn = document.getElementById('save-api-key-btn');
    const input = document.getElementById('api-key-input');
    const toggleBtn = document.getElementById('toggle-api-key-visibility');

    // Load saved API key
    const savedKey = localStorage.getItem('gemini_api_key');
    if (savedKey && input) {
        input.value = savedKey;
    }

    if (toggleBtn && input) {
        toggleBtn.addEventListener('click', () => {
            if (input.type === 'password') {
                input.type = 'text';
                toggleBtn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
            } else {
                input.type = 'password';
                toggleBtn.innerHTML = '<i class="fa-solid fa-eye"></i>';
            }
        });
    }

    if (saveBtn && input) {
        saveBtn.addEventListener('click', () => {
            const key = input.value.trim();
            if (key) {
                localStorage.setItem('gemini_api_key', key);
                syncSettingsToNative();
                showToast('<i class="fa-solid fa-check" style="color: #10b981;"></i> API Key Saved Successfully');
            } else {
                localStorage.removeItem('gemini_api_key');
                syncSettingsToNative();
                showToast('<i class="fa-solid fa-info-circle" style="color: #f59e0b;"></i> API Key Cleared');
            }
        });
    }

    // ================= Auto-Retry Toggle =================
    const autoRetryToggle = document.getElementById('toggle-auto-retry');
    if (autoRetryToggle) {
        // Load state, default to true
        const savedAutoRetry = localStorage.getItem('auto_retry_enabled');
        if (savedAutoRetry === 'false') {
            autoRetryToggle.checked = false;
        } else {
            autoRetryToggle.checked = true;
            localStorage.setItem('auto_retry_enabled', 'true');
        }

        autoRetryToggle.addEventListener('change', (e) => {
            localStorage.setItem('auto_retry_enabled', e.target.checked ? 'true' : 'false');
            if (e.target.checked) {
                showToast('<i class="fa-solid fa-rotate" style="color: #10b981;"></i> Auto-Retry Enabled');
            } else {
                showToast('<i class="fa-solid fa-pause" style="color: #f59e0b;"></i> Auto-Retry Disabled');
            }
        });
    }

    // ================= Save Audio Externally Toggle =================
    const saveAudioExternallyToggle = document.getElementById('toggle-save-audio-externally');
    if (saveAudioExternallyToggle) {
        const savedExternal = localStorage.getItem('save_audio_externally');
        saveAudioExternallyToggle.checked = savedExternal === 'true';

        saveAudioExternallyToggle.addEventListener('change', (e) => {
            if (e.target.checked) {
                if (window.AndroidBridge && window.AndroidBridge.checkStoragePermission) {
                    const hasPermission = window.AndroidBridge.checkStoragePermission();
                    if (hasPermission) {
                        localStorage.setItem('save_audio_externally', 'true');
                        showToast('<i class="fa-solid fa-folder-check" style="color: #10b981;"></i> Saving audio externally enabled');
                    } else {
                        // Revert visually, request permission
                        e.target.checked = false;
                        window.AndroidBridge.requestStoragePermission();
                        showToast('Please grant storage permissions and try again.');
                    }
                } else {
                    localStorage.setItem('save_audio_externally', 'true');
                }
            } else {
                localStorage.setItem('save_audio_externally', 'false');
                showToast('<i class="fa-solid fa-folder-xmark" style="color: #f59e0b;"></i> Saving audio externally disabled');
            }
        });
    }

    // ================= Quick Capture Toggle =================
    const quickCaptureToggle = document.getElementById('toggle-quick-capture');
    if (quickCaptureToggle) {
        // Load state, default to true on first run
        const savedQuickCapture = localStorage.getItem('quick_capture_enabled');
        if (savedQuickCapture === null) {
            quickCaptureToggle.checked = true;
            localStorage.setItem('quick_capture_enabled', 'true');
            if (window.AndroidBridge && window.AndroidBridge.toggleRecordingService) {
                window.AndroidBridge.toggleRecordingService(true);
            }
        } else if (savedQuickCapture === 'true') {
            quickCaptureToggle.checked = true;
        } else {
            quickCaptureToggle.checked = false;
        }

        quickCaptureToggle.addEventListener('change', (e) => {
            const isEnabled = e.target.checked;
            localStorage.setItem('quick_capture_enabled', isEnabled ? 'true' : 'false');
            if (window.AndroidBridge && window.AndroidBridge.toggleRecordingService) {
                window.AndroidBridge.toggleRecordingService(isEnabled);
            }
            if (isEnabled) {
                showToast('<i class="fa-solid fa-microphone" style="color: #10b981;"></i> Quick Capture Enabled');
            } else {
                showToast('<i class="fa-solid fa-microphone-slash" style="color: #f59e0b;"></i> Quick Capture Disabled');
            }
        });
    }

    const testNotificationBtn = document.getElementById('test-notification-btn');
    if (testNotificationBtn) {
        testNotificationBtn.addEventListener('click', () => {
            if (window.AndroidBridge && window.AndroidBridge.testNotification) {
                window.AndroidBridge.testNotification();
            } else {
                showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b;"></i> Android Bridge missing');
            }
        });
    }

    // ================= Auto-Backup UI Logic =================
    const autoBackupFreq = document.getElementById('auto-backup-frequency');
    const autoBackupDayContainer = document.getElementById('auto-backup-day-container');
    const autoBackupDay = document.getElementById('auto-backup-day');

    if (autoBackupFreq && autoBackupDayContainer && autoBackupDay) {
        // Load saved state
        const savedFreq = localStorage.getItem('auto_backup_frequency') || 'never';
        autoBackupFreq.value = savedFreq;
        
        const savedDay = localStorage.getItem('auto_backup_day') || '0';
        autoBackupDay.value = savedDay;

        // Toggle day selector visibility
        autoBackupDayContainer.style.display = (savedFreq === 'every_week') ? 'flex' : 'none';

        // Listeners
        autoBackupFreq.addEventListener('change', (e) => {
            const freq = e.target.value;
            localStorage.setItem('auto_backup_frequency', freq);
            autoBackupDayContainer.style.display = (freq === 'every_week') ? 'flex' : 'none';
            showToast('<i class="fa-solid fa-clock-rotate-left"></i> Auto-backup frequency updated');
        });

        autoBackupDay.addEventListener('change', (e) => {
            localStorage.setItem('auto_backup_day', e.target.value);
            showToast('<i class="fa-solid fa-calendar-day"></i> Auto-backup day updated');
        });
    }

    // ================= Export Logic =================
    const exportBtn = document.getElementById('export-btn');
    const exportModal = document.getElementById('export-modal');
    const closeExportModalBtn = document.getElementById('close-export-modal');
    const confirmExportBtn = document.getElementById('confirm-export-btn');
    
    let fromPicker, toPicker;

    if (exportBtn && exportModal) {
        exportBtn.addEventListener('click', () => {
            exportModal.classList.remove('hidden');
            exportModal.style.opacity = '1';
            exportModal.style.pointerEvents = 'auto';

            // Initialize Flatpickr if not already done
            if (!fromPicker && window.flatpickr) {
                fromPicker = flatpickr("#export-from-date", {
                    theme: "dark",
                    dateFormat: "Y-m-d"
                });
                toPicker = flatpickr("#export-to-date", {
                    theme: "dark",
                    dateFormat: "Y-m-d"
                });
            }
        });
    }

    const closeExportModal = () => {
        if (exportModal) {
            exportModal.style.opacity = '0';
            exportModal.style.pointerEvents = 'none';
            setTimeout(() => exportModal.classList.add('hidden'), 300);
        }
    };

    if (closeExportModalBtn) closeExportModalBtn.addEventListener('click', closeExportModal);
    
    // Close on click outside
    if (exportModal) {
        exportModal.addEventListener('click', (e) => {
            if (e.target === exportModal) closeExportModal();
        });
    }

    if (confirmExportBtn) {
        confirmExportBtn.addEventListener('click', async () => {
            await performBackup(false);
            closeExportModal();
        });
    }

    // ================= Import Logic =================
    const importBtn = document.getElementById('import-btn');
    const importFileInput = document.getElementById('import-file-input');

    if (importBtn && importFileInput) {
        importBtn.addEventListener('click', () => {
            importFileInput.click();
        });

        importFileInput.addEventListener('change', (e) => {
            const file = e.target.files[0];
            if (!file) return;

            const reader = new FileReader();
            reader.onload = async (event) => {
                try {
                    const importedData = JSON.parse(event.target.result);
                    if (!Array.isArray(importedData)) {
                        throw new Error("Invalid JSON format. Expected an array of entries.");
                    }

                    let addedCount = 0;
                    let skippedCount = 0;

                    for (const entry of importedData) {
                        // Check if exact ID already exists
                        const existing = await db.entries.get(entry.id);
                        if (existing) {
                            skippedCount++;
                        } else {
                            if (entry.audio_base64 && entry.audio_file_id) {
                                try {
                                    const base64Response = await fetch(entry.audio_base64);
                                    const blob = await base64Response.blob();
                                    await db.files.put({ id: entry.audio_file_id, blob: blob });
                                    delete entry.audio_base64;
                                } catch (e) {
                                    console.error("Failed to restore audio blob for entry", entry.id);
                                }
                            }
                            await db.entries.put(entry);
                            addedCount++;
                        }
                    }

                    showToast(`<i class="fa-solid fa-upload" style="color: #10b981;"></i> Import Complete: ${addedCount} added, ${skippedCount} skipped.`);
                    // Reset input so the same file can be selected again if needed
                    importFileInput.value = '';
                } catch (err) {
                    console.error("Import error:", err);
                    showToast('<i class="fa-solid fa-circle-exclamation" style="color: #ef4444;"></i> Failed to parse import file.');
                    importFileInput.value = '';
                }
            };
            reader.readAsText(file);
        });
    }

    // ================= Category 1: UI & Personalization =================
    
    // Theme
    const toggleDarkTheme = document.getElementById('toggle-dark-theme');
    if (toggleDarkTheme) {
        toggleDarkTheme.checked = localStorage.getItem('theme') !== 'light';
        toggleDarkTheme.addEventListener('change', (e) => {
            const newTheme = e.target.checked ? 'dark' : 'light';
            localStorage.setItem('theme', newTheme);
            applyVisualSettings();
            showToast(`<i class="fa-solid fa-moon"></i> Theme set to ${newTheme}`);
        });
    }

    // Accent Color (Swatches)
    const swatches = document.querySelectorAll('.color-swatch');
    const savedAccent = localStorage.getItem('accent_color') || 'default';
    
    // Set initial active state
    swatches.forEach(swatch => {
        if (swatch.dataset.value === savedAccent) {
            swatch.style.borderColor = 'var(--text-main)';
        }
        
        swatch.addEventListener('click', (e) => {
            const selectedAccent = e.target.dataset.value;
            localStorage.setItem('accent_color', selectedAccent);
            applyVisualSettings();
            
            // Update UI
            swatches.forEach(s => s.style.borderColor = 'transparent');
            e.target.style.borderColor = 'var(--text-main)';
        });
    });

    // Default Launch View
    const selectLaunchView = document.getElementById('select-launch-view');
    if (selectLaunchView) {
        selectLaunchView.value = localStorage.getItem('launch_view') || 'today';
        selectLaunchView.addEventListener('change', (e) => {
            localStorage.setItem('launch_view', e.target.value);
            showToast('<i class="fa-solid fa-rocket"></i> Default launch view saved');
        });
    }

    // Sidebar Visibility
    const tabs = ['today', 'calendar', 'search', 'notes'];
    tabs.forEach(tab => {
        const toggle = document.getElementById(`toggle-sidebar-${tab}`);
        if (toggle) {
            // Default to visible if null
            const isHidden = localStorage.getItem(`hide_sidebar_${tab}`) === 'true';
            toggle.checked = !isHidden;
            toggle.addEventListener('change', (e) => {
                localStorage.setItem(`hide_sidebar_${tab}`, !e.target.checked);
                applyVisualSettings();
            });
        }
    });

    // ================= Category 2: AI & Enhancements =================

    // Custom Enhancement Prompt
    const customPromptInput = document.getElementById('custom-prompt-input');
    const saveCustomPromptBtn = document.getElementById('save-custom-prompt-btn');
    if (customPromptInput && saveCustomPromptBtn) {
        customPromptInput.value = localStorage.getItem('custom_enhance_prompt') || 'Improve the grammar and clarity of the text while preserving the original meaning and language.';
        saveCustomPromptBtn.addEventListener('click', () => {
            localStorage.setItem('custom_enhance_prompt', customPromptInput.value.trim());
            showToast('<i class="fa-solid fa-wand-magic-sparkles"></i> Custom prompt saved');
        });
    }

    // Disable Auto-Enhance
    const toggleDisableEnhance = document.getElementById('toggle-disable-enhance');
    if (toggleDisableEnhance) {
        toggleDisableEnhance.checked = localStorage.getItem('disable_auto_enhance') === 'true';
        toggleDisableEnhance.addEventListener('change', (e) => {
            localStorage.setItem('disable_auto_enhance', e.target.checked);
        });
    }

    // Disable Title Generation
    const toggleDisableTitle = document.getElementById('toggle-disable-title');
    if (toggleDisableTitle) {
        toggleDisableTitle.checked = localStorage.getItem('disable_title_generation') === 'true';
        toggleDisableTitle.addEventListener('change', (e) => {
            localStorage.setItem('disable_title_generation', e.target.checked);
        });
    }

    // Disable Tag Generation
    const toggleDisableTags = document.getElementById('toggle-disable-tags');
    if (toggleDisableTags) {
        toggleDisableTags.checked = localStorage.getItem('disable_tag_generation') === 'true';
        toggleDisableTags.addEventListener('change', (e) => {
            localStorage.setItem('disable_tag_generation', e.target.checked);
        });
    }

    // ================= Category 3: Privacy & Storage =================

    // Disable Location & Weather
    const toggleDisableLocation = document.getElementById('toggle-disable-location');
    if (toggleDisableLocation) {
        toggleDisableLocation.checked = localStorage.getItem('disable_location_weather') === 'true';
        toggleDisableLocation.addEventListener('change', (e) => {
            localStorage.setItem('disable_location_weather', e.target.checked);
        });
    }

    // Audio Retention Policy
    const selectAudioRetention = document.getElementById('select-audio-retention');
    if (selectAudioRetention) {
        selectAudioRetention.value = localStorage.getItem('audio_retention_days') || 'forever';
        selectAudioRetention.addEventListener('change', (e) => {
            localStorage.setItem('audio_retention_days', e.target.value);
            showToast('<i class="fa-solid fa-hard-drive"></i> Audio retention policy saved');
        });
    }

    // ================= Category 4: Auto-Summarization =================

    const toggleEnableSummaries = document.getElementById('toggle-enable-summaries');
    if (toggleEnableSummaries) {
        // Default to true if null
        const isEnabled = localStorage.getItem('enable_auto_summaries') !== 'false';
        toggleEnableSummaries.checked = isEnabled;
        toggleEnableSummaries.addEventListener('change', (e) => {
            localStorage.setItem('enable_auto_summaries', e.target.checked);
        });
    }

    const selectEndOfWeek = document.getElementById('select-end-of-week');
    if (selectEndOfWeek) {
        selectEndOfWeek.value = localStorage.getItem('end_of_week_day') || '5'; // default Friday
        selectEndOfWeek.addEventListener('change', (e) => {
            localStorage.setItem('end_of_week_day', e.target.value);
            showToast('<i class="fa-regular fa-calendar-check"></i> End of week day saved');
        });
    }

    // Custom Summary Prompts
    const dailyPromptInput = document.getElementById('custom-prompt-daily');
    const weeklyPromptInput = document.getElementById('custom-prompt-weekly');
    const monthlyPromptInput = document.getElementById('custom-prompt-monthly');
    const yearlyPromptInput = document.getElementById('custom-prompt-yearly');
    const saveSummaryPromptsBtn = document.getElementById('save-summary-prompts-btn');

    if (saveSummaryPromptsBtn && dailyPromptInput) {
        const defDaily = `Write a warm, concise 3-sentence daily reflection summarizing what the user experienced, thought about, or accomplished today. Focus on the human element.`;
        const defWeekly = `Synthesize this into a cohesive weekly reflection (about 1 paragraph), highlighting major themes, emotional shifts, or continuous accomplishments over the week.`;
        const defMonthly = `Create a cohesive Monthly Reflection summarizing the broader themes, goals, and emotional journey of this month.`;
        const defYearly = `Create a comprehensive Yearly Reflection highlighting the massive milestones, personal growth, and overarching narrative of the entire year.`;

        dailyPromptInput.value = localStorage.getItem('custom_prompt_daily') || defDaily;
        weeklyPromptInput.value = localStorage.getItem('custom_prompt_weekly') || defWeekly;
        monthlyPromptInput.value = localStorage.getItem('custom_prompt_monthly') || defMonthly;
        yearlyPromptInput.value = localStorage.getItem('custom_prompt_yearly') || defYearly;

        saveSummaryPromptsBtn.addEventListener('click', () => {
            localStorage.setItem('custom_prompt_daily', dailyPromptInput.value);
            localStorage.setItem('custom_prompt_weekly', weeklyPromptInput.value);
            localStorage.setItem('custom_prompt_monthly', monthlyPromptInput.value);
            localStorage.setItem('custom_prompt_yearly', yearlyPromptInput.value);
            showToast('<i class="fa-solid fa-pen-nib"></i> Custom summary prompts saved');
        });
    }
}

/**
 * Applies saved themes, accent colors, and sidebar visibility globally.
 * Intended to be called on page load.
 */
export function applyVisualSettings() {
    // Apply Theme
    const theme = localStorage.getItem('theme') || 'dark';
    if (theme === 'light') {
        document.documentElement.setAttribute('data-theme', 'light');
    } else {
        document.documentElement.removeAttribute('data-theme');
    }

    // Apply Accent
    const accent = localStorage.getItem('accent_color') || 'default';
    if (accent !== 'default') {
        document.documentElement.setAttribute('data-accent', accent);
    } else {
        document.documentElement.removeAttribute('data-accent');
    }

    // Apply Sidebar Visibility
    const tabs = ['today', 'calendar', 'search', 'notes'];
    tabs.forEach(tab => {
        const navLink = document.getElementById(`nav-${tab}`);
        if (navLink) {
            const isHidden = localStorage.getItem(`hide_sidebar_${tab}`) === 'true';
            navLink.style.display = isHidden ? 'none' : 'flex';
        }
    });
}

/**
 * Extracts the database contents, encodes audio blobs as Base64 strings,
 * and securely saves the JSON payload to the user's local Downloads folder.
 */
export async function performBackup(isAutoBackup = false) {
    try {
        let allEntries = await db.entries.toArray();

        // Filter if dates are provided (only for manual)
        if (!isAutoBackup) {
            const fromDate = document.getElementById('export-from-date')?.value;
            const toDate = document.getElementById('export-to-date')?.value;
            if (fromDate || toDate) {
                allEntries = allEntries.filter(entry => {
                    const entryDate = entry.local_date; // Format is 'YYYY-MM-DD'
                    if (fromDate && entryDate < fromDate) return false;
                    if (toDate && entryDate > toDate) return false;
                    return true;
                });
            }
        }

        if (allEntries.length === 0 && !isAutoBackup) {
            showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b;"></i> No entries found for selected dates.');
            return;
        }
        if (allEntries.length === 0) return; // Silent return for autobackup

        // Attach audio files as Base64 strings
        for (let entry of allEntries) {
            if (entry.audio_file_id) {
                const fileRecord = await db.files.get(entry.audio_file_id);
                if (fileRecord && fileRecord.blob) {
                    entry.audio_base64 = await new Promise((resolve) => {
                        const reader = new FileReader();
                        reader.onload = () => resolve(reader.result);
                        reader.readAsDataURL(fileRecord.blob);
                    });
                }
            }
        }

        const jsonData = JSON.stringify(allEntries, null, 2);
        const dateStr = new Date().toISOString().split('T')[0];
        const filename = isAutoBackup ? `autobackup_${dateStr}.json` : `diary_export_${dateStr}.json`;

        if (window.AndroidBridge && window.AndroidBridge.exportData) {
            window.AndroidBridge.exportData(jsonData, filename);
        } else {
            const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(jsonData);
            const downloadAnchorNode = document.createElement('a');
            downloadAnchorNode.setAttribute("href", dataStr);
            downloadAnchorNode.setAttribute("download", filename);
            document.body.appendChild(downloadAnchorNode); // required for firefox
            downloadAnchorNode.click();
            downloadAnchorNode.remove();
        }
        
        if (!isAutoBackup) {
            showToast(`<i class="fa-solid fa-check" style="color: #10b981;"></i> Successfully exported ${allEntries.length} entries. Check your Downloads folder.`);
        }
    } catch (err) {
        console.error("Export error:", err);
        if (!isAutoBackup) {
            showToast('<i class="fa-solid fa-circle-exclamation" style="color: #ef4444;"></i> Failed to export diary.');
        }
    }
}
