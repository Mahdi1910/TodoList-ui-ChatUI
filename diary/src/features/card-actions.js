import { showToast } from './toast.js';
import { startRecording, stopRecording } from './microphone.js';
import { editTranscriptionWithGemma } from './gemini-rest.js';
import { applyTextDirection, isRTL } from './rtl-detect.js';
import { deleteEntry, updateEntry } from './database.js';
import { retryTranscription, retryEnhancement } from './retry-manager.js';
import { updateDateDisplay } from '../state.js';

export function bindCardActions(container = document) {
    // Re-bind action menus
    container.querySelectorAll('.action-menu-trigger').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.action-dropdown').forEach(drop => {
                if (drop !== newBtn.nextElementSibling) drop.classList.add('hidden');
            });
            const dropdown = newBtn.nextElementSibling;
            if (dropdown) dropdown.classList.toggle('hidden');
        });
    });

    // Delete Action
    container.querySelectorAll('.delete-action').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const card = newBtn.closest('.diary-card, .note-profile-card');
            if (!card) return;
            
            // Hide dropdown
            const dropdown = newBtn.closest('.action-dropdown');
            if (dropdown) dropdown.classList.add('hidden');

            const entryId = card.id;
            if (entryId) {
                await deleteEntry(entryId);
                updateDateDisplay();
            }
            
            showToast('Entry deleted.', null, null, 3000);
        });
    });

    // Edit by Text Action
    container.querySelectorAll('.edit-text-action').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            const card = newBtn.closest('.diary-card, .note-profile-card');
            if (!card) return;

            const dropdown = newBtn.closest('.action-dropdown');
            if (dropdown) dropdown.classList.add('hidden');

            if (card.classList.contains('editing')) return;
            card.classList.add('editing');

            const h3 = card.querySelector('h3');
            const p = card.querySelector('p:not(.error-text)');
            const metaContainer = card.querySelector('.card-meta');
            
            const originalTitle = h3 ? h3.textContent : '';
            const originalText = p ? p.textContent : '';
            const originalMetaHTML = metaContainer ? metaContainer.innerHTML : '';

            // Extract text from tags if possible
            let originalGps = "";
            let originalWeather = "";
            let originalTags = [];
            
            if (metaContainer) {
                const locDot = metaContainer.querySelector('.fa-location-dot');
                const gpsNode = metaContainer.querySelector('.gps-tag') || (locDot ? locDot.parentNode : null);
                const cloudSun = metaContainer.querySelector('.fa-cloud-sun');
                const cloud = metaContainer.querySelector('.fa-cloud');
                const weatherNode = metaContainer.querySelector('.weather-tag') || (cloudSun ? cloudSun.parentNode : null) || (cloud ? cloud.parentNode : null);
                const tagNodes = metaContainer.querySelectorAll('.content-tag, .fa-hashtag');
                
                if (gpsNode) originalGps = gpsNode.textContent.trim();
                if (weatherNode) originalWeather = weatherNode.textContent.trim();
                
                tagNodes.forEach(n => {
                    let text = n.textContent ? n.textContent.trim() : n.parentNode.textContent.trim();
                    if (text && !originalTags.includes(text)) originalTags.push(text);
                });
            }

            if (h3) {
                h3.innerHTML = `<input type="text" class="edit-title-input" value="${originalTitle}" style="width: 100%; font-size: 1.25rem; font-weight: 600; font-family: inherit; background: rgb(0 0 0 / 20%); border: 1px solid var(--accent); color: white; padding: 8px; border-radius: 8px; outline: none; margin-bottom: 8px;">`;
            }

            if (metaContainer) {
                metaContainer.innerHTML = `
                    <div style="display: flex; gap: 8px; flex-wrap: wrap; width: 100%; margin-bottom: 12px;">
                        <input type="text" class="edit-gps-input" value="${originalGps}" placeholder="Location" style="flex: 1; min-width: 120px; font-size: 13px; font-family: inherit; background: rgb(0 0 0 / 20%); border: 1px solid var(--accent); color: white; padding: 6px; border-radius: 6px; outline: none;">
                        <input type="text" class="edit-weather-input" value="${originalWeather}" placeholder="Weather" style="flex: 1; min-width: 100px; font-size: 13px; font-family: inherit; background: rgb(0 0 0 / 20%); border: 1px solid var(--accent); color: white; padding: 6px; border-radius: 6px; outline: none;">
                        <input type="text" class="edit-tags-input" value="${originalTags.join(', ')}" placeholder="Tags (comma separated)" style="flex: 2; min-width: 150px; font-size: 13px; font-family: inherit; background: rgb(0 0 0 / 20%); border: 1px solid var(--accent); color: white; padding: 6px; border-radius: 6px; outline: none;">
                    </div>
                `;
            }
            
            if (p) {
                p.innerHTML = `<textarea class="edit-text-input" style="width: 100%; font-size: 15px; font-family: inherit; background: rgb(0 0 0 / 20%); border: 1px solid var(--accent); color: white; padding: 12px; border-radius: 8px; outline: none; resize: vertical; min-height: 100px;">${originalText}</textarea>
                <div style="display: flex; gap: 8px; margin-top: 12px; justify-content: flex-end;">
                    <button class="settings-btn cancel-edit-btn" style="padding: 6px 12px; border: none;">Cancel</button>
                    <button class="settings-btn save-edit-btn" style="background: var(--accent); color: white; border: none; padding: 6px 16px;">Save</button>
                </div>`;
            }

            const cancelBtn = card.querySelector('.cancel-edit-btn');
            if (cancelBtn) {
                cancelBtn.addEventListener('click', () => {
                    if (h3) h3.textContent = originalTitle;
                    if (p) p.textContent = originalText;
                    if (metaContainer) metaContainer.innerHTML = originalMetaHTML;
                    card.classList.remove('editing');
                });
            }

            const saveBtn = card.querySelector('.save-edit-btn');
            if (saveBtn) {
                saveBtn.addEventListener('click', async () => {
                    const titleInput = card.querySelector('.edit-title-input');
                    const textInput = card.querySelector('.edit-text-input');
                    const gpsInput = card.querySelector('.edit-gps-input');
                    const weatherInput = card.querySelector('.edit-weather-input');
                    const tagsInput = card.querySelector('.edit-tags-input');

                    const newTitle = titleInput ? titleInput.value : originalTitle;
                    const newText = textInput ? textInput.value : originalText;
                    const newGps = gpsInput ? gpsInput.value : originalGps;
                    const newWeather = weatherInput ? weatherInput.value : originalWeather;
                    const newTags = ((tagsInput ? tagsInput.value : '') || '').split(',').map(t => t.trim()).filter(t => t);

                const entryId = card.id;
                if (entryId) {
                    await updateEntry(entryId, {
                        title: newTitle,
                        content: newText,
                        location_city: newGps,
                        weather_condition: newWeather,
                        tags: newTags,
                        is_rtl: isRTL(newText) ? 1 : 0
                    });
                    
                    
                    updateDateDisplay();
                }
                showToast('<i class="fa-solid fa-check" style="color: #10b981;"></i> Changes saved successfully');
                });
            }
        });
    });

    // Edit by Voice Action
    container.querySelectorAll('.edit-voice-action').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const card = newBtn.closest('.diary-card, .note-profile-card');
            if (!card) return;

            const dropdown = newBtn.closest('.action-dropdown');
            if (dropdown) dropdown.classList.add('hidden');

            if (card.classList.contains('editing') || card.classList.contains('voice-editing')) return;

            // Start Recording Voice Instruction
            const started = await startRecording();
            if (!started) return;

            // Trigger animation
            card.classList.add('voice-editing');
            card.style.boxShadow = '0 0 20px #ef4444';
            card.style.borderColor = '#ef4444';
            
            // Add status overlay
            let overlay = card.querySelector('.status-overlay');
            if (!overlay) {
                overlay = document.createElement('div');
                overlay.className = 'status-overlay';
                overlay.style = 'margin-top: 16px; font-size: 13px; color: #ef4444; font-weight: 500; display: flex; align-items: center; gap: 8px;';
                
                const cardBody = card.querySelector('.card-body') || card;
                cardBody.appendChild(overlay);
            }
            overlay.innerHTML = `
                <div style="display: flex; align-items: center; justify-content: space-between; width: 100%;">
                    <span><i class="fa-solid fa-microphone fa-beat-fade"></i> Listening for your voice edits...</span>
                    <button class="settings-btn stop-voice-edit-btn" style="background: #ef4444; color: white; border: none; padding: 4px 12px; font-size: 12px; border-radius: 6px;">Stop Recording</button>
                </div>
            `;
            
            showToast('Speak now to dictate edits (e.g., "Change the title to X").', null, null, 2000);

            const stopBtn = overlay.querySelector('.stop-voice-edit-btn');
            stopBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                if (card.classList.contains('voice-editing')) {
                    
                    // Change UI to Processing
                    overlay.innerHTML = `<span><i class="fa-solid fa-spinner fa-spin"></i> Processing your instruction...</span>`;
                    stopBtn.remove();
                    card.style.boxShadow = '0 0 20px #f59e0b';
                    card.style.borderColor = '#f59e0b';
                    overlay.style.color = '#f59e0b';

                    // Stop recording and get the instruction
                    const stopResult = await stopRecording();
                    const voiceInstruction = stopResult.transcript;

                    if (!voiceInstruction) {
                        card.classList.remove('voice-editing');
                        card.style.boxShadow = '';
                        card.style.borderColor = '';
                        overlay.remove();
                        showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i> No instruction detected.');
                        return;
                    }

                    overlay.innerHTML = `<span><i class="fa-solid fa-wand-magic-sparkles fa-shake"></i> Applying edits...</span>`;
                    
                    // Extract original data from card
                    const h3 = card.querySelector('h3');
                    const p = card.querySelector('p:not(.error-text)');
                    const metaContainer = card.querySelector('.card-meta');
                    
                    const originalTitle = h3 ? h3.textContent : '';
                    const originalText = p ? p.textContent : '';
                    const originalTags = [];
                    if (metaContainer) {
                        metaContainer.querySelectorAll('.content-tag, .fa-hashtag').forEach(n => {
                            let text = n.textContent ? n.textContent.trim() : n.parentNode.textContent.trim();
                            if (text && !originalTags.includes(text)) originalTags.push(text);
                        });
                    }

                    const apiKey = localStorage.getItem('gemini_api_key');
                    if (apiKey) {
                        const enhancedData = await editTranscriptionWithGemma(originalText, originalTitle, originalTags, voiceInstruction, apiKey);
                        
                        card.classList.remove('voice-editing');
                        card.style.boxShadow = '';
                        card.style.borderColor = '';
                        overlay.remove();

                        if (enhancedData) {
                            const entryId = card.id;
                            if (entryId) {
                                await updateEntry(entryId, {
                                    title: enhancedData.title,
                                    content: enhancedData.improvedText,
                                    tags: enhancedData.tags,
                                    is_rtl: isRTL(enhancedData.improvedText) ? 1 : 0
                                });
                                updateDateDisplay();
                            }
                            showToast('<i class="fa-solid fa-check" style="color: #10b981;"></i> Voice edit applied!');
                        } else {
                            showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i> Edit failed.');
                        }
                    } else {
                        card.classList.remove('voice-editing');
                        overlay.remove();
                    }
                }
            });
        });
    });

    // Retry Transcription Action
    container.querySelectorAll('.retry-transcription-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const entryId = newBtn.getAttribute('data-id');
            if (entryId) {
                // UI feedback
                newBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Retrying...';
                newBtn.style.opacity = '0.7';
                newBtn.style.pointerEvents = 'none';
                
                await retryTranscription(entryId);
            }
        });
    });

    // Retry Enhancement Action
    container.querySelectorAll('.retry-enhancement-btn').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const entryId = newBtn.getAttribute('data-id');
            if (entryId) {
                // UI feedback
                newBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Retrying...';
                newBtn.style.opacity = '0.7';
                newBtn.style.pointerEvents = 'none';

                await retryEnhancement(entryId);
            }
        });
    });
}
