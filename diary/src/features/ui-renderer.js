import { bindCardActions } from './card-actions.js';
import { escapeHtml, safeFontAwesomeClass } from '../platform/html-safety.mjs';

export function generateCardHTML(entry) {
    const id = escapeHtml(entry.id || '');
    const localDate = escapeHtml(entry.local_date || '');
    const dirAttribute = entry.is_rtl === 1 ? 'dir="rtl"' : 'dir="ltr"';
    const disableLoc = localStorage.getItem('disable_location_weather') === 'true';

    let gpsTag = '';
    if (entry.location_city) {
        gpsTag = `<span class="tag gps-tag" id="gps-${id}"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(entry.location_city)}</span>`;
    } else if (!disableLoc) {
        gpsTag = `<span class="tag gps-tag placeholder" id="gps-${id}"><i class="fa-solid fa-location-dot"></i> Locating...</span>`;
    }

    let weatherTag = '';
    if (entry.weather_temp !== null && entry.weather_temp !== undefined && entry.weather_condition) {
        const iconClass = safeFontAwesomeClass(entry.weather_icon, 'fa-cloud');
        weatherTag = `<span class="tag weather-tag" id="weather-${id}"><i class="fa-solid ${iconClass}"></i> ${escapeHtml(entry.weather_temp)}°C ${escapeHtml(entry.weather_condition)}</span>`;
    } else if (!disableLoc) {
        weatherTag = `<span class="tag weather-tag placeholder" id="weather-${id}"><i class="fa-solid fa-cloud"></i> Weather</span>`;
    }

    const tags = Array.isArray(entry.tags) ? entry.tags : [];
    let tagsHTML = `<span class="tag placeholder" id="tags-${id}"><i class="fa-solid fa-circle-notch fa-spin"></i> Generating tags...</span>`;
    if (tags.length > 0) {
        tagsHTML = tags.map(tag => `<span class="tag content-tag"><i class="fa-solid fa-hashtag"></i> ${escapeHtml(tag)}</span>`).join(' ');
    } else if (entry.status === 'completed') {
        tagsHTML = '<span class="tag content-tag"><i class="fa-solid fa-note-sticky"></i> Note</span>';
    }

    let titleHTML = `<h3 class="placeholder" id="title-${id}">Enhancing title... <i class="fa-solid fa-spinner fa-spin"></i></h3>`;
    if (entry.title !== 'Untitled' && entry.status === 'completed') {
        titleHTML = `<h3 id="title-${id}" ${dirAttribute}>${escapeHtml(entry.title)}</h3>`;
    }

    let bodyHTML = `
        ${titleHTML}
        <p class="transcript-text" id="text-${id}" style="color: var(--text-body);" ${dirAttribute}>${escapeHtml(entry.content || '')}</p>
    `;

    if (entry.status === 'failed_transcription') {
        bodyHTML = `
            <div class="retry-container" style="padding: 15px; border: 1px dashed #ef4444; border-radius: 8px; margin-top: 10px;">
                <p style="color: #ef4444; margin-bottom: 10px; font-weight: 500;"><i class="fa-solid fa-triangle-exclamation"></i> Audio saved, but transcription failed.</p>
                <button class="retry-transcription-btn" data-id="${id}" style="background: #ef4444; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-family: 'Outfit';">
                    <i class="fa-solid fa-rotate-right"></i> Retry Transcription
                </button>
            </div>
        `;
    } else if (entry.status === 'failed_enhancement') {
        bodyHTML = `
            <h3 ${dirAttribute}>Original Transcription</h3>
            <p class="transcript-text" id="text-${id}" style="color: var(--text-body);" ${dirAttribute}>${escapeHtml(entry.content || '')}</p>
            <div class="retry-container" style="margin-top: 15px;">
                <button class="retry-enhancement-btn" data-id="${id}" style="background: #8b5cf6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-family: 'Outfit';">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> Retry Enhancement
                </button>
            </div>
        `;
    }

    return `
        <div class="diary-card" id="${id}" data-date="${localDate}">
            <div class="card-header">
                <div class="card-meta">
                    ${gpsTag}
                    ${weatherTag}
                    ${tagsHTML}
                    <span class="time">${escapeHtml(entry.time_string || '')}</span>
                </div>
                <div class="card-actions">
                    <button class="icon-btn action-menu-trigger" aria-label="Card actions menu"><i class="fa-solid fa-ellipsis"></i></button>
                    <div class="action-dropdown hidden">
                        <button class="edit-text-action"><i class="fa-solid fa-keyboard"></i> Edit by Text</button>
                        <button class="edit-voice-action"><i class="fa-solid fa-microphone-lines"></i> Edit by Voice</button>
                        <button class="delete-action"><i class="fa-solid fa-trash"></i> Delete</button>
                    </div>
                </div>
            </div>
            <div class="card-body">${bodyHTML}</div>
        </div>
    `;
}

export function renderEntries(entries, targetContainerId = 'entries-container') {
    const container = document.getElementById(targetContainerId);
    const emptyState = targetContainerId === 'entries-container' ? document.getElementById('empty-state') : null;
    if (!container) return;

    container.querySelectorAll('.diary-card').forEach(card => card.remove());
    if (!Array.isArray(entries) || entries.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        return;
    }
    if (emptyState) emptyState.style.display = 'none';

    container.insertAdjacentHTML('beforeend', entries.map(entry => generateCardHTML(entry)).join(''));
    bindCardActions();
}
