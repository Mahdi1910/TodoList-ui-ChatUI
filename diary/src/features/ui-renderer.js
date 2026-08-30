import { bindCardActions } from './card-actions.js';

/**
 * Generates the HTML for a single diary entry card.
 * @param {Object} entry - The entry object from Dexie.
 * @returns {string} The HTML string.
 */
export function generateCardHTML(entry) {
    const dirAttribute = entry.is_rtl === 1 ? 'dir="rtl"' : 'dir="ltr"';
    
    // GPS Tag
    let gpsTag = '';
    const disableLoc = localStorage.getItem('disable_location_weather') === 'true';
    if (entry.location_city) {
        gpsTag = `<span class="tag gps-tag" id="gps-${entry.id}"><i class="fa-solid fa-location-dot"></i> ${entry.location_city}</span>`;
    } else if (!disableLoc) {
        gpsTag = `<span class="tag gps-tag placeholder" id="gps-${entry.id}"><i class="fa-solid fa-location-dot"></i> Locating...</span>`;
    }

    // Weather Tag
    let weatherTag = '';
    if (entry.weather_temp !== null && entry.weather_condition) {
        const iconClass = entry.weather_icon || 'fa-cloud';
        weatherTag = `<span class="tag weather-tag" id="weather-${entry.id}"><i class="fa-solid ${iconClass}"></i> ${entry.weather_temp}°C ${entry.weather_condition}</span>`;
    } else if (!disableLoc) {
        weatherTag = `<span class="tag weather-tag placeholder" id="weather-${entry.id}"><i class="fa-solid fa-cloud"></i> Weather</span>`;
    }

    // Tags
    let tagsHTML = `<span class="tag placeholder" id="tags-${entry.id}"><i class="fa-solid fa-circle-notch fa-spin"></i> Generating tags...</span>`;
    if (entry.tags && entry.tags.length > 0) {
        tagsHTML = entry.tags.map(tag => `<span class="tag content-tag"><i class="fa-solid fa-hashtag"></i> ${tag}</span>`).join(' ');
    } else if (entry.status === 'completed' && entry.tags.length === 0) {
        tagsHTML = `<span class="tag content-tag"><i class="fa-solid fa-note-sticky"></i> Note</span>`;
    }

    // Title
    let titleHTML = `<h3 class="placeholder" id="title-${entry.id}">Enhancing title... <i class="fa-solid fa-spinner fa-spin"></i></h3>`;
    if (entry.title !== "Untitled" && entry.status === 'completed') {
        titleHTML = `<h3 id="title-${entry.id}" ${dirAttribute}>${entry.title}</h3>`;
    }

    let bodyHTML = `
        ${titleHTML}
        <p class="transcript-text" id="text-${entry.id}" style="color: var(--text-body);" ${dirAttribute}>${entry.content}</p>
    `;

    if (entry.status === 'failed_transcription') {
        bodyHTML = `
            <div class="retry-container" style="padding: 15px; border: 1px dashed #ef4444; border-radius: 8px; margin-top: 10px;">
                <p style="color: #ef4444; margin-bottom: 10px; font-weight: 500;"><i class="fa-solid fa-triangle-exclamation"></i> Audio saved, but transcription failed.</p>
                <button class="retry-transcription-btn" data-id="${entry.id}" style="background: #ef4444; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-family: 'Outfit';">
                    <i class="fa-solid fa-rotate-right"></i> Retry Transcription
                </button>
            </div>
        `;
    } else if (entry.status === 'failed_enhancement') {
        bodyHTML = `
            <h3 ${dirAttribute}>Original Transcription</h3>
            <p class="transcript-text" id="text-${entry.id}" style="color: var(--text-body);" ${dirAttribute}>${entry.content}</p>
            <div class="retry-container" style="margin-top: 15px;">
                <button class="retry-enhancement-btn" data-id="${entry.id}" style="background: #8b5cf6; color: white; border: none; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-family: 'Outfit';">
                    <i class="fa-solid fa-wand-magic-sparkles"></i> Retry Enhancement
                </button>
            </div>
        `;
    }

    return `
        <div class="diary-card" id="${entry.id}" data-date="${entry.local_date}">
            <div class="card-header">
                <div class="card-meta">
                    ${gpsTag}
                    ${weatherTag}
                    ${tagsHTML}
                    <span class="time">${entry.time_string}</span>
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
            <div class="card-body">
                ${bodyHTML}
            </div>
        </div>
    `;
}

/**
 * Renders an array of entries into a specific container.
 * @param {Array} entries - Array of entry objects from Dexie.
 * @param {string} targetContainerId - ID of the container to render into (defaults to 'entries-container').
 */
export function renderEntries(entries, targetContainerId = 'entries-container') {
    const container = document.getElementById(targetContainerId);
    
    // Only look for the empty state if we are rendering into the main feed
    const emptyState = targetContainerId === 'entries-container' 
        ? document.getElementById('empty-state') 
        : null;
    
    if (!container) return;
    
    // Clear existing cards, but preserve any headers/labels (like search labels)
    const existingCards = container.querySelectorAll('.diary-card');
    existingCards.forEach(card => card.remove());
    
    if (entries.length === 0) {
        if (emptyState) emptyState.style.display = 'block';
        return;
    }
    
    if (emptyState) emptyState.style.display = 'none';
    
    const html = entries.map(entry => generateCardHTML(entry)).join('');
    container.insertAdjacentHTML('beforeend', html);
    
    bindCardActions();
}
