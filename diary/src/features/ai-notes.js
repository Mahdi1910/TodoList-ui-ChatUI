import { db, generateUUID } from './database.js';
import { renderEntries } from './ui-renderer.js';
import { filterEntriesForAINote } from './gemini-rest.js';
import { showToast } from './toast.js';
import { escapeHtml, safeFontAwesomeClass } from '../platform/html-safety.mjs';

let currentOpenNote = null;

export function initAiNotes() {
    const addBtn = document.getElementById('add-ai-note-btn');
    const modal = document.getElementById('add-note-modal');
    const cancelBtn = document.getElementById('cancel-add-note');
    const saveBtn = document.getElementById('save-add-note');
    const backBtn = document.getElementById('back-to-notes');
    const refreshBtn = document.getElementById('ai-refresh-note-btn');

    if (addBtn && modal) {
        addBtn.addEventListener('click', () => {
            const titleInput = document.getElementById('new-note-title');
            const descInput = document.getElementById('new-note-desc');
            if (titleInput) titleInput.value = '';
            if (descInput) descInput.value = '';
            modal.style.display = 'flex';
        });

        cancelBtn?.addEventListener('click', () => { modal.style.display = 'none'; });
        saveBtn?.addEventListener('click', async () => {
            const title = document.getElementById('new-note-title')?.value.trim() || '';
            const description = document.getElementById('new-note-desc')?.value.trim() || '';
            if (!title) {
                showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b;"></i> Title is required.');
                return;
            }

            await db.ai_notes.put({
                id: generateUUID(),
                title,
                description,
                linked_entry_ids: [],
                created_at: Date.now()
            });
            modal.style.display = 'none';
            showToast('<i class="fa-solid fa-check" style="color: #10b981;"></i> Note created!');
            await renderNotesList();
        });
    }

    backBtn?.addEventListener('click', () => {
        currentOpenNote = null;
        const detail = document.getElementById('note-detail-view');
        const main = document.getElementById('notes-main-view');
        if (detail) detail.style.display = 'none';
        if (main) main.style.display = 'block';
        void renderNotesList();
    });

    refreshBtn?.addEventListener('click', () => {
        if (currentOpenNote) void handleRefreshNote(currentOpenNote);
    });

    void renderNotesList();
}

export async function renderNotesList() {
    const container = document.getElementById('notes-grid-container');
    if (!container) return;

    const notes = await db.ai_notes.toArray();
    container.innerHTML = '';

    if (notes.length === 0) {
        container.innerHTML = `
            <div style="grid-column: 1/-1; text-align: center; padding: 60px 20px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: 20px; margin-top: 20px;">
                <div style="font-size: 3rem; margin-bottom: 15px; opacity: 0.5;"><i class="fa-solid fa-folder-open"></i></div>
                <h3 style="color: var(--text-light); font-weight: 500; font-size: 1.2rem; margin-bottom: 8px;">No AI Notes Yet</h3>
                <p style="color: var(--text-muted); font-size: 0.95rem;">Create a custom entity and let Gemma analyze your diary.</p>
            </div>`;
        return;
    }

    const gradients = [
        'linear-gradient(135deg, #3b82f6, #6366f1)',
        'linear-gradient(135deg, #10b981, #059669)',
        'linear-gradient(135deg, #f59e0b, #d97706)',
        'linear-gradient(135deg, #ec4899, #be185d)',
        'linear-gradient(135deg, #8b5cf6, #6d28d9)',
        'linear-gradient(135deg, #06b6d4, #0369a1)',
        'linear-gradient(135deg, #f43f5e, #be123c)'
    ];
    const icons = ['fa-brain', 'fa-lightbulb', 'fa-user', 'fa-book-open', 'fa-layer-group', 'fa-bolt', 'fa-compass'];

    notes.forEach(note => {
        const title = String(note.title || 'Untitled Note');
        const description = String(note.description || 'No description provided.');
        let hash = 0;
        for (let index = 0; index < title.length; index += 1) hash = title.charCodeAt(index) + ((hash << 5) - hash);
        hash = Math.abs(hash);
        const gradient = gradients[hash % gradients.length];
        const icon = safeFontAwesomeClass(icons[hash % icons.length], 'fa-brain');
        const colors = gradient.match(/#[0-9a-f]{6}/gi) || [];
        const shadowColor = colors[1] || colors[0] || '#6366f1';

        const card = document.createElement('div');
        card.className = 'note-profile-card';
        card.style.position = 'relative';
        card.innerHTML = `
            <div class="profile-header" style="position: relative; padding-right: 24px;">
                <div class="profile-icon" style="background: ${gradient}; box-shadow: 0 4px 15px ${shadowColor}40;">
                    <i class="fa-solid ${icon}"></i>
                </div>
                <h3>${escapeHtml(title)}</h3>
                <button class="action-btn menu-btn" style="position: absolute; right: -10px; top: 0; background:transparent; border:none; color:var(--text-muted); cursor:pointer;"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                <div class="action-dropdown hidden" style="position:absolute; right:-10px; top:30px; background:var(--sidebar-bg); border:1px solid var(--card-border); border-radius:8px; z-index:10; box-shadow:var(--shadow-md); min-width: 150px; overflow:hidden;">
                    <button class="dropdown-item edit-btn" style="width:100%; padding:10px 16px; text-align:left; background:transparent; border:none; color:var(--text-main); cursor:pointer; font-family:inherit;"><i class="fa-solid fa-pen" style="margin-right:8px; width:16px;"></i>Edit</button>
                    <div style="height:1px; background:var(--card-border); margin:4px 0;"></div>
                    <button class="dropdown-item delete-btn" style="width:100%; padding:10px 16px; text-align:left; background:transparent; border:none; color:#ef4444; cursor:pointer; font-family:inherit;"><i class="fa-solid fa-trash" style="margin-right:8px; width:16px;"></i>Delete</button>
                </div>
            </div>
            <p>${escapeHtml(description)}</p>
            <div class="profile-footer"><i class="fa-solid fa-link"></i> ${Array.isArray(note.linked_entry_ids) ? note.linked_entry_ids.length : 0} entries linked</div>`;

        const menuBtn = card.querySelector('.menu-btn');
        const dropdown = card.querySelector('.action-dropdown');
        menuBtn?.addEventListener('click', event => {
            event.stopPropagation();
            document.querySelectorAll('.action-dropdown').forEach(other => {
                if (other !== dropdown) other.classList.add('hidden');
            });
            dropdown?.classList.toggle('hidden');
        });

        card.querySelector('.edit-btn')?.addEventListener('click', async event => {
            event.stopPropagation();
            dropdown?.classList.add('hidden');
            const newTitle = prompt('Edit title for AI Note:', title);
            if (newTitle === null || !newTitle.trim()) return;
            const newDescription = prompt('Edit description for AI Note:', String(note.description || ''));
            if (newDescription === null) return;
            await db.ai_notes.update(note.id, { title: newTitle.trim(), description: newDescription.trim() });
            showToast('<i class="fa-solid fa-check"></i> Note updated');
            await renderNotesList();
        });

        card.querySelector('.delete-btn')?.addEventListener('click', async event => {
            event.stopPropagation();
            dropdown?.classList.add('hidden');
            if (!confirm(`Are you sure you want to delete the AI Note '${title}'? This will also remove the note from all linked diary entries.`)) return;
            await db.ai_notes.delete(note.id);
            showToast('<i class="fa-solid fa-trash"></i> Note deleted');
            await renderNotesList();
        });

        card.addEventListener('click', () => {
            document.querySelectorAll('.action-dropdown').forEach(drop => drop.classList.add('hidden'));
            void openNoteDetail(note, gradient, icon, shadowColor);
        });
        container.appendChild(card);
    });
}

async function openNoteDetail(note, gradient, icon, shadowColor) {
    currentOpenNote = note;
    const title = document.getElementById('detail-title-text');
    const description = document.getElementById('detail-desc');
    if (title) title.textContent = note.title || 'Untitled Note';
    if (description) description.textContent = note.description || 'No description provided.';

    const detailIcon = document.getElementById('detail-icon');
    if (detailIcon) {
        detailIcon.innerHTML = `<i class="fa-solid ${safeFontAwesomeClass(icon, 'fa-brain')}"></i>`;
        detailIcon.style.background = gradient;
        detailIcon.style.boxShadow = `0 4px 15px ${shadowColor}40`;
    }

    const main = document.getElementById('notes-main-view');
    const detailView = document.getElementById('note-detail-view');
    if (main) main.style.display = 'none';
    if (detailView) detailView.style.display = 'block';
    await renderLinkedEntries(note);
}

async function renderLinkedEntries(note) {
    const containerId = 'note-entries-container';
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!Array.isArray(note.linked_entry_ids) || note.linked_entry_ids.length === 0) {
        container.innerHTML = `
            <h4 class="search-results-label">Linked Entries</h4>
            <p id="note-empty-msg" style="color: var(--text-muted); text-align: center; margin-top: 40px;">No entries linked yet. Click "AI Refresh" to find matches.</p>`;
        return;
    }

    container.innerHTML = '<h4 class="search-results-label">Linked Entries</h4>';
    const entries = await db.entries.where('id').anyOf(note.linked_entry_ids).toArray();
    renderEntries(entries, containerId);
}

async function handleRefreshNote(note) {
    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) {
        showToast('<i class="fa-solid fa-key" style="color: #ef4444;"></i> Please set your Gemini API key in Settings.');
        return;
    }

    const refreshBtn = document.getElementById('ai-refresh-note-btn');
    if (!refreshBtn) return;
    const originalHtml = refreshBtn.innerHTML;

    try {
        refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
        refreshBtn.style.pointerEvents = 'none';
        const allEntries = await db.entries.toArray();
        const untestedEntries = allEntries.filter(entry => !(entry.ai_tested_notes || []).includes(note.id));

        if (untestedEntries.length === 0) {
            showToast('<i class="fa-solid fa-check-double" style="color: #10b981;"></i> Up to date! No new entries to analyze.');
            return;
        }

        showToast(`<i class="fa-solid fa-brain" style="color: #8b5cf6;"></i> Analyzing ${untestedEntries.length} new entries...`);
        const matchedIds = await filterEntriesForAINote(note.title, note.description, untestedEntries, apiKey);
        await db.entries.bulkPut(untestedEntries.map(entry => ({
            ...entry,
            ai_tested_notes: [...(entry.ai_tested_notes || []), note.id]
        })));

        if (matchedIds?.length) {
            if (!Array.isArray(note.linked_entry_ids)) note.linked_entry_ids = [];
            const newLinks = matchedIds.filter(id => !note.linked_entry_ids.includes(id));
            if (newLinks.length > 0) {
                note.linked_entry_ids.push(...newLinks);
                await db.ai_notes.put(note);
                showToast(`<i class="fa-solid fa-link" style="color: #10b981;"></i> Found ${newLinks.length} new matches!`);
                await renderLinkedEntries(note);
                return;
            }
        }
        showToast('<i class="fa-solid fa-magnifying-glass" style="color: #3b82f6;"></i> No matches found in new entries.');
    } catch (error) {
        console.error('AI Refresh Failed:', error);
        showToast('<i class="fa-solid fa-circle-xmark" style="color: #ef4444;"></i> AI Refresh failed.');
    } finally {
        refreshBtn.innerHTML = originalHtml;
        refreshBtn.style.pointerEvents = 'auto';
    }
}
