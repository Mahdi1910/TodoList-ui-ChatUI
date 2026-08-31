import { showToast } from './toast.js';
import { startRecording, stopRecording } from './microphone.js';
import { editTranscriptionWithGemma } from './gemini-rest.js';
import { isRTL } from './rtl-detect.js';
import { deleteEntry, updateEntry } from './database.js';
import { retryTranscription, retryEnhancement } from './retry-manager.js';
import { updateDateDisplay } from '../state.js';

function cloneAndBind(selector, container, handler) {
    container.querySelectorAll(selector).forEach(button => {
        const replacement = button.cloneNode(true);
        button.parentNode.replaceChild(replacement, button);
        replacement.addEventListener('click', handler.bind(null, replacement));
    });
}

function makeTextInput(className, value, placeholder, flex = '1') {
    const input = document.createElement('input');
    input.type = 'text';
    input.className = className;
    input.value = value;
    input.placeholder = placeholder;
    input.style.cssText = `flex:${flex}; min-width:120px; font-size:13px; font-family:inherit; background:rgb(0 0 0 / 20%); border:1px solid var(--accent); color:white; padding:6px; border-radius:6px; outline:none;`;
    return input;
}

function extractCardMeta(metaContainer) {
    if (!metaContainer) return { gps: '', weather: '', tags: [] };
    const gpsNode = metaContainer.querySelector('.gps-tag');
    const weatherNode = metaContainer.querySelector('.weather-tag');
    const tags = [...metaContainer.querySelectorAll('.content-tag')]
        .map(node => node.textContent.trim())
        .filter((text, index, all) => text && text !== 'Note' && all.indexOf(text) === index);
    return {
        gps: gpsNode?.textContent.trim() || '',
        weather: weatherNode?.textContent.trim() || '',
        tags
    };
}

function startTextEditing(card) {
    if (card.classList.contains('editing')) return;
    card.classList.add('editing');

    const heading = card.querySelector('h3');
    const paragraph = card.querySelector('p:not(.error-text)');
    const metaContainer = card.querySelector('.card-meta');
    if (!heading || !paragraph) {
        card.classList.remove('editing');
        return;
    }

    const originalTitle = heading.textContent || '';
    const originalText = paragraph.textContent || '';
    const originalMetaNodes = metaContainer ? [...metaContainer.childNodes].map(node => node.cloneNode(true)) : [];
    const { gps, weather, tags } = extractCardMeta(metaContainer);

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'edit-title-input';
    titleInput.value = originalTitle;
    titleInput.style.cssText = 'width:100%; font-size:1.25rem; font-weight:600; font-family:inherit; background:rgb(0 0 0 / 20%); border:1px solid var(--accent); color:white; padding:8px; border-radius:8px; outline:none; margin-bottom:8px;';
    heading.replaceChildren(titleInput);

    let gpsInput = null;
    let weatherInput = null;
    let tagsInput = null;
    if (metaContainer) {
        const row = document.createElement('div');
        row.style.cssText = 'display:flex; gap:8px; flex-wrap:wrap; width:100%; margin-bottom:12px;';
        gpsInput = makeTextInput('edit-gps-input', gps, 'Location');
        weatherInput = makeTextInput('edit-weather-input', weather, 'Weather');
        tagsInput = makeTextInput('edit-tags-input', tags.join(', '), 'Tags (comma separated)', '2');
        tagsInput.style.minWidth = '150px';
        row.append(gpsInput, weatherInput, tagsInput);
        metaContainer.replaceChildren(row);
    }

    const textInput = document.createElement('textarea');
    textInput.className = 'edit-text-input';
    textInput.value = originalText;
    textInput.style.cssText = 'width:100%; font-size:15px; font-family:inherit; background:rgb(0 0 0 / 20%); border:1px solid var(--accent); color:white; padding:12px; border-radius:8px; outline:none; resize:vertical; min-height:100px;';

    const actionRow = document.createElement('div');
    actionRow.style.cssText = 'display:flex; gap:8px; margin-top:12px; justify-content:flex-end;';
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'settings-btn cancel-edit-btn';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.style.cssText = 'padding:6px 12px; border:none;';
    const saveBtn = document.createElement('button');
    saveBtn.type = 'button';
    saveBtn.className = 'settings-btn save-edit-btn';
    saveBtn.textContent = 'Save';
    saveBtn.style.cssText = 'background:var(--accent); color:white; border:none; padding:6px 16px;';
    actionRow.append(cancelBtn, saveBtn);
    paragraph.replaceChildren(textInput, actionRow);

    cancelBtn.addEventListener('click', () => {
        heading.textContent = originalTitle;
        paragraph.textContent = originalText;
        if (metaContainer) metaContainer.replaceChildren(...originalMetaNodes.map(node => node.cloneNode(true)));
        card.classList.remove('editing');
    });

    saveBtn.addEventListener('click', async () => {
        const entryId = card.id;
        if (!entryId) return;
        const newTags = (tagsInput?.value || '').split(',').map(tag => tag.trim()).filter(Boolean);
        await updateEntry(entryId, {
            title: titleInput.value,
            content: textInput.value,
            location_city: gpsInput?.value || gps,
            weather_condition: weatherInput?.value || weather,
            tags: newTags,
            is_rtl: isRTL(textInput.value) ? 1 : 0
        });
        updateDateDisplay();
        showToast('<i class="fa-solid fa-check" style="color: #10b981;"></i> Changes saved successfully');
    });

    titleInput.focus();
}

async function startVoiceEditing(card) {
    if (card.classList.contains('editing') || card.classList.contains('voice-editing')) return;
    const started = await startRecording();
    if (!started) return;

    card.classList.add('voice-editing');
    card.style.boxShadow = '0 0 20px #ef4444';
    card.style.borderColor = '#ef4444';

    let overlay = card.querySelector('.status-overlay');
    if (!overlay) {
        overlay = document.createElement('div');
        overlay.className = 'status-overlay';
        overlay.style.cssText = 'margin-top:16px; font-size:13px; color:#ef4444; font-weight:500; display:flex; align-items:center; gap:8px;';
        (card.querySelector('.card-body') || card).appendChild(overlay);
    }

    const row = document.createElement('div');
    row.style.cssText = 'display:flex; align-items:center; justify-content:space-between; width:100%;';
    const status = document.createElement('span');
    const icon = document.createElement('i');
    icon.className = 'fa-solid fa-microphone fa-beat-fade';
    status.append(icon, document.createTextNode(' Listening for your voice edits...'));
    const stopBtn = document.createElement('button');
    stopBtn.type = 'button';
    stopBtn.className = 'settings-btn stop-voice-edit-btn';
    stopBtn.textContent = 'Stop Recording';
    stopBtn.style.cssText = 'background:#ef4444; color:white; border:none; padding:4px 12px; font-size:12px; border-radius:6px;';
    row.append(status, stopBtn);
    overlay.replaceChildren(row);

    showToast('Speak now to dictate edits (e.g., "Change the title to X").', null, null, 2000);

    stopBtn.addEventListener('click', async event => {
        event.stopPropagation();
        if (!card.classList.contains('voice-editing')) return;

        overlay.textContent = '';
        const processing = document.createElement('span');
        const spinner = document.createElement('i');
        spinner.className = 'fa-solid fa-spinner fa-spin';
        processing.append(spinner, document.createTextNode(' Processing your instruction...'));
        overlay.appendChild(processing);
        card.style.boxShadow = '0 0 20px #f59e0b';
        card.style.borderColor = '#f59e0b';
        overlay.style.color = '#f59e0b';

        const stopResult = await stopRecording();
        const voiceInstruction = stopResult?.transcript || '';
        if (!voiceInstruction) {
            card.classList.remove('voice-editing');
            card.style.boxShadow = '';
            card.style.borderColor = '';
            overlay.remove();
            showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i> No instruction detected.');
            return;
        }

        overlay.textContent = '';
        const applying = document.createElement('span');
        const wand = document.createElement('i');
        wand.className = 'fa-solid fa-wand-magic-sparkles fa-shake';
        applying.append(wand, document.createTextNode(' Applying edits...'));
        overlay.appendChild(applying);

        const heading = card.querySelector('h3');
        const paragraph = card.querySelector('p:not(.error-text)');
        const originalTitle = heading?.textContent || '';
        const originalText = paragraph?.textContent || '';
        const originalTags = [...card.querySelectorAll('.card-meta .content-tag')]
            .map(node => node.textContent.trim())
            .filter(text => text && text !== 'Note');
        const apiKey = localStorage.getItem('gemini_api_key');

        try {
            if (!apiKey) {
                showToast('<i class="fa-solid fa-key" style="color: #ef4444;"></i> Please set your Gemini API key in Settings.');
                return;
            }
            const enhancedData = await editTranscriptionWithGemma(originalText, originalTitle, originalTags, voiceInstruction, apiKey);
            if (!enhancedData) {
                showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #ef4444;"></i> Edit failed.');
                return;
            }
            if (card.id) {
                await updateEntry(card.id, {
                    title: enhancedData.title,
                    content: enhancedData.improvedText,
                    tags: enhancedData.tags,
                    is_rtl: isRTL(enhancedData.improvedText) ? 1 : 0
                });
                updateDateDisplay();
            }
            showToast('<i class="fa-solid fa-check" style="color: #10b981;"></i> Voice edit applied!');
        } finally {
            card.classList.remove('voice-editing');
            card.style.boxShadow = '';
            card.style.borderColor = '';
            overlay.remove();
        }
    });
}

export function bindCardActions(container = document) {
    cloneAndBind('.action-menu-trigger', container, (button, event) => {
        event.stopPropagation();
        document.querySelectorAll('.action-dropdown').forEach(drop => {
            if (drop !== button.nextElementSibling) drop.classList.add('hidden');
        });
        button.nextElementSibling?.classList.toggle('hidden');
    });

    cloneAndBind('.delete-action', container, async (button, event) => {
        event.stopPropagation();
        const card = button.closest('.diary-card, .note-profile-card');
        button.closest('.action-dropdown')?.classList.add('hidden');
        if (card?.id) {
            await deleteEntry(card.id);
            updateDateDisplay();
        }
        showToast('Entry deleted.', null, null, 3000);
    });

    cloneAndBind('.edit-text-action', container, (button, event) => {
        event.stopPropagation();
        button.closest('.action-dropdown')?.classList.add('hidden');
        const card = button.closest('.diary-card, .note-profile-card');
        if (card) startTextEditing(card);
    });

    cloneAndBind('.edit-voice-action', container, (button, event) => {
        event.stopPropagation();
        button.closest('.action-dropdown')?.classList.add('hidden');
        const card = button.closest('.diary-card, .note-profile-card');
        if (card) void startVoiceEditing(card);
    });

    cloneAndBind('.retry-transcription-btn', container, async (button, event) => {
        event.stopPropagation();
        const entryId = button.getAttribute('data-id');
        if (!entryId) return;
        button.textContent = 'Retrying...';
        button.style.opacity = '0.7';
        button.style.pointerEvents = 'none';
        await retryTranscription(entryId);
    });

    cloneAndBind('.retry-enhancement-btn', container, async (button, event) => {
        event.stopPropagation();
        const entryId = button.getAttribute('data-id');
        if (!entryId) return;
        button.textContent = 'Retrying...';
        button.style.opacity = '0.7';
        button.style.pointerEvents = 'none';
        await retryEnhancement(entryId);
    });
}
