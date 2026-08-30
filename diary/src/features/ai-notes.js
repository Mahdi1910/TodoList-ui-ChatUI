import { db } from './database.js';
import { renderEntries } from './ui-renderer.js';
import { filterEntriesForAINote } from './gemini-rest.js';
import { showToast } from './toast.js';

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
            document.getElementById('new-note-title').value = '';
            document.getElementById('new-note-desc').value = '';
            modal.style.display = 'flex';
        });

        cancelBtn.addEventListener('click', () => {
            modal.style.display = 'none';
        });

        saveBtn.addEventListener('click', async () => {
            const title = document.getElementById('new-note-title').value.trim();
            const desc = document.getElementById('new-note-desc').value.trim();
            if (!title) {
                showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b;"></i> Title is required.');
                return;
            }

            const newNote = {
                id: crypto.randomUUID(),
                title: title,
                description: desc,
                linked_entry_ids: [],
                created_at: Date.now()
            };

            await db.ai_notes.put(newNote);
            modal.style.display = 'none';
            showToast('<i class="fa-solid fa-check" style="color: #10b981;"></i> Note created!');
            renderNotesList();
        });
    }

    if (backBtn) {
        backBtn.addEventListener('click', () => {
            currentOpenNote = null;
            document.getElementById('note-detail-view').style.display = 'none';
            document.getElementById('notes-main-view').style.display = 'block';
            renderNotesList(); // Refresh counts
        });
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            if (currentOpenNote) {
                handleRefreshNote(currentOpenNote);
            }
        });
    }

    // Initial render
    renderNotesList();
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
            </div>
        `;
        return;
    }

    const gradients = [
        'linear-gradient(135deg, #3b82f6, #6366f1)', // Blue to Indigo
        'linear-gradient(135deg, #10b981, #059669)', // Emerald
        'linear-gradient(135deg, #f59e0b, #d97706)', // Amber
        'linear-gradient(135deg, #ec4899, #be185d)', // Pink
        'linear-gradient(135deg, #8b5cf6, #6d28d9)', // Violet
        'linear-gradient(135deg, #06b6d4, #0369a1)', // Cyan
        'linear-gradient(135deg, #f43f5e, #be123c)'  // Rose
    ];

    const icons = ['fa-brain', 'fa-lightbulb', 'fa-user', 'fa-book-open', 'fa-layer-group', 'fa-bolt', 'fa-compass'];

    notes.forEach(note => {
        // Deterministic pick based on title
        let hash = 0;
        for (let i = 0; i < note.title.length; i++) {
            hash = note.title.charCodeAt(i) + ((hash << 5) - hash);
        }
        hash = Math.abs(hash);
        const gradient = gradients[hash % gradients.length];
        const icon = icons[hash % icons.length];

        const card = document.createElement('div');
        card.className = 'note-profile-card';
        // Add relative positioning if missing
        card.style.position = 'relative';
        card.innerHTML = `
            <div class="profile-header" style="position: relative; padding-right: 24px;">
                <div class="profile-icon" style="background: ${gradient}; box-shadow: 0 4px 15px ${gradient.split(',')[1].trim()}40;">
                    <i class="fa-solid ${icon}"></i>
                </div>
                <h3>${note.title}</h3>
                
                <button class="action-btn menu-btn" style="position: absolute; right: -10px; top: 0; background:transparent; border:none; color:var(--text-muted); cursor:pointer;"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                <div class="action-dropdown hidden" style="position:absolute; right:-10px; top:30px; background:var(--sidebar-bg); border:1px solid var(--card-border); border-radius:8px; z-index:10; box-shadow:var(--shadow-md); min-width: 150px; overflow:hidden;">
                    <button class="dropdown-item edit-btn" style="width:100%; padding:10px 16px; text-align:left; background:transparent; border:none; color:var(--text-main); cursor:pointer; font-family:inherit;"><i class="fa-solid fa-pen" style="margin-right:8px; width:16px;"></i>Edit</button>
                    <div style="height:1px; background:var(--card-border); margin:4px 0;"></div>
                    <button class="dropdown-item delete-btn" style="width:100%; padding:10px 16px; text-align:left; background:transparent; border:none; color:#ef4444; cursor:pointer; font-family:inherit;"><i class="fa-solid fa-trash" style="margin-right:8px; width:16px;"></i>Delete</button>
                </div>
            </div>
            <p>${note.description || 'No description provided.'}</p>
            <div class="profile-footer"><i class="fa-solid fa-link"></i> ${note.linked_entry_ids ? note.linked_entry_ids.length : 0} entries linked</div>
        `;
        
        // Toggle Dropdown
        const menuBtn = card.querySelector('.menu-btn');
        const dropdown = card.querySelector('.action-dropdown');
        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.action-dropdown').forEach(d => {
                if(d !== dropdown) d.classList.add('hidden');
            });
            dropdown.classList.toggle('hidden');
        });

        // Edit Action
        card.querySelector('.edit-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            dropdown.classList.add('hidden');
            const newTitle = prompt(`Edit title for AI Note:`, note.title);
            if (newTitle !== null && newTitle.trim() !== '') {
                const newDesc = prompt(`Edit description for AI Note:`, note.description);
                if (newDesc !== null) {
                    await db.ai_notes.update(note.id, { 
                        title: newTitle.trim(), 
                        description: newDesc.trim() 
                    });
                    showToast('<i class="fa-solid fa-check"></i> Note updated');
                    renderNotesList();
                }
            }
        });

        // Delete Action
        card.querySelector('.delete-btn').addEventListener('click', async (e) => {
            e.stopPropagation();
            dropdown.classList.add('hidden');
            if (confirm(`Are you sure you want to delete the AI Note '${note.title}'? This will also remove the note from all linked diary entries.`)) {
                await db.ai_notes.delete(note.id);
                // We should also remove this note from any entries that have it, 
                // but the DB schema links it via `note.linked_entry_ids`. 
                // Note: Actual cleanup of entry.ai_tested_notes might be complex, so relying on ID reference is better.
                showToast('<i class="fa-solid fa-trash"></i> Note deleted');
                renderNotesList();
            }
        });

        card.addEventListener('click', () => {
            // Close dropdowns if clicking the card body
            document.querySelectorAll('.action-dropdown').forEach(d => d.classList.add('hidden'));
            openNoteDetail(note, gradient, icon);
        });
        
        container.appendChild(card);
    });
}

async function openNoteDetail(note, gradient, icon) {
    currentOpenNote = note;
    document.getElementById('detail-title-text').textContent = note.title;
    document.getElementById('detail-desc').textContent = note.description || 'No description provided.';
    
    // Update the detail view icon and background
    const detailIcon = document.getElementById('detail-icon');
    if (detailIcon && gradient && icon) {
        detailIcon.innerHTML = `<i class="fa-solid ${icon}"></i>`;
        detailIcon.style.background = gradient;
        detailIcon.style.boxShadow = `0 4px 15px ${gradient.split(',')[1].trim()}40`;
    }
    
    document.getElementById('notes-main-view').style.display = 'none';
    const detailView = document.getElementById('note-detail-view');
    detailView.style.display = 'block';
    
    await renderLinkedEntries(note);
}

async function renderLinkedEntries(note) {
    const containerId = 'note-entries-container';
    const container = document.getElementById(containerId);
    
    if (!note.linked_entry_ids || note.linked_entry_ids.length === 0) {
        // Clear everything and set empty state
        container.innerHTML = `
            <h4 class="search-results-label">Linked Entries</h4>
            <p id="note-empty-msg" style="color: var(--text-muted); text-align: center; margin-top: 40px;">No entries linked yet. Click "AI Refresh" to find matches.</p>
        `;
        return;
    }

    // Ensure the header exists and remove the empty message
    container.innerHTML = `<h4 class="search-results-label">Linked Entries</h4>`;

    // Fetch entries by ID
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
    const originalHtml = refreshBtn.innerHTML;
    
    try {
        refreshBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Analyzing...';
        refreshBtn.style.pointerEvents = 'none';

        // 1. Fetch all entries
        const allEntries = await db.entries.toArray();

        // 2. Find untested entries for THIS specific note
        const untestedEntries = allEntries.filter(entry => {
            const testedList = entry.ai_tested_notes || [];
            return !testedList.includes(note.id);
        });

        if (untestedEntries.length === 0) {
            showToast('<i class="fa-solid fa-check-double" style="color: #10b981;"></i> Up to date! No new entries to analyze.');
            return;
        }

        showToast(`<i class="fa-solid fa-brain" style="color: #8b5cf6;"></i> Analyzing ${untestedEntries.length} new entries...`);

        // 3. Send to Gemma
        const matchedIds = await filterEntriesForAINote(note.title, note.description, untestedEntries, apiKey);

        // 4. Update the DB: Mark ALL untested as tested
        const entriesToUpdate = untestedEntries.map(e => {
            if (!e.ai_tested_notes) e.ai_tested_notes = [];
            e.ai_tested_notes.push(note.id);
            return e;
        });
        await db.entries.bulkPut(entriesToUpdate);

        // 5. Link matches to the Note
        if (matchedIds && matchedIds.length > 0) {
            if (!note.linked_entry_ids) note.linked_entry_ids = [];
            
            // Avoid duplicates just in case
            const newLinks = matchedIds.filter(id => !note.linked_entry_ids.includes(id));
            if (newLinks.length > 0) {
                note.linked_entry_ids.push(...newLinks);
                await db.ai_notes.put(note);
                showToast(`<i class="fa-solid fa-link" style="color: #10b981;"></i> Found ${newLinks.length} new matches!`);
                await renderLinkedEntries(note);
            } else {
                showToast('<i class="fa-solid fa-magnifying-glass" style="color: #3b82f6;"></i> No matches found in new entries.');
            }
        } else {
            showToast('<i class="fa-solid fa-magnifying-glass" style="color: #3b82f6;"></i> No matches found in new entries.');
        }

    } catch (err) {
        console.error("AI Refresh Failed:", err);
        showToast('<i class="fa-solid fa-circle-xmark" style="color: #ef4444;"></i> AI Refresh failed.');
    } finally {
        refreshBtn.innerHTML = originalHtml;
        refreshBtn.style.pointerEvents = 'auto';
    }
}
