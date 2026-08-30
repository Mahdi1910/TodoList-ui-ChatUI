import { getSummariesByType } from './database.js';

export function initSummariesUi() {
    const tabButtons = document.querySelectorAll('#view-summaries .summary-tabs .action-btn');
    const container = document.getElementById('summaries-container');

    if (!tabButtons || !container) return;

    tabButtons.forEach(btn => {
        btn.addEventListener('click', async (e) => {
            // Update active state
            tabButtons.forEach(b => b.classList.remove('active'));
            e.target.classList.add('active');

            const type = e.target.getAttribute('data-summary-type');
            await loadSummaries(type, container);
        });
    });

    // Load default (daily)
    loadSummaries('daily', container);
}

async function loadSummaries(type, container) {
    container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>';
    
    try {
        const summaries = await getSummariesByType(type);
        container.innerHTML = ''; // clear

        if (!summaries || summaries.length === 0) {
            container.innerHTML = `
                <div class="empty-state" style="text-align: center; padding: 40px 20px;">
                    <i class="fa-solid fa-ghost" style="font-size: 48px; color: var(--card-border); margin-bottom: 16px;"></i>
                    <h3 style="color: var(--text-main); margin-bottom: 8px;">No ${type} summaries yet</h3>
                    <p style="color: var(--text-muted); font-size: 14px;">The AI will automatically generate these based on your entries as time passes.</p>
                </div>
            `;
            return;
        }

        summaries.forEach(sum => {
            const dateStr = new Date(sum.created_at).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric'
            });

            const card = document.createElement('div');
            card.className = 'summary-card';
            card.innerHTML = `
                <div class="summary-card-header" style="position: relative;">
                    <div class="summary-icon"><i class="fa-solid fa-sparkles"></i></div>
                    <div style="flex: 1;">
                        <h4 class="summary-title">${sum.period_id}</h4>
                        <span class="summary-date">Generated on ${dateStr}</span>
                    </div>
                    <button class="action-btn menu-btn" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer;"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                    <div class="action-dropdown hidden" style="position:absolute; right:0; top:40px; background:var(--sidebar-bg); border:1px solid var(--card-border); border-radius:8px; z-index:10; box-shadow:var(--shadow-md); min-width: 150px; overflow:hidden;">
                        <button class="dropdown-item edit-btn" style="width:100%; padding:10px 16px; text-align:left; background:transparent; border:none; color:var(--text-main); cursor:pointer; font-family:inherit;"><i class="fa-solid fa-pen" style="margin-right:8px; width:16px;"></i>Edit</button>
                        <button class="dropdown-item regen-btn" style="width:100%; padding:10px 16px; text-align:left; background:transparent; border:none; color:var(--text-main); cursor:pointer; font-family:inherit;"><i class="fa-solid fa-rotate-right" style="margin-right:8px; width:16px;"></i>Regenerate</button>
                        <div style="height:1px; background:var(--card-border); margin:4px 0;"></div>
                        <button class="dropdown-item delete-btn" style="width:100%; padding:10px 16px; text-align:left; background:transparent; border:none; color:#ef4444; cursor:pointer; font-family:inherit;"><i class="fa-solid fa-trash" style="margin-right:8px; width:16px;"></i>Delete</button>
                    </div>
                </div>
                <div class="summary-content">
                    <p>${formatText(sum.content)}</p>
                </div>
            `;

            // Toggle Dropdown
            const menuBtn = card.querySelector('.menu-btn');
            const dropdown = card.querySelector('.action-dropdown');
            menuBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close others
                document.querySelectorAll('.action-dropdown').forEach(d => {
                    if(d !== dropdown) d.classList.add('hidden');
                });
                dropdown.classList.toggle('hidden');
            });

            // Edit
            card.querySelector('.edit-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                dropdown.classList.add('hidden');
                const newText = prompt(`Edit summary for ${sum.period_id}:`, sum.content);
                if (newText !== null && newText.trim() !== '') {
                    const { updateSummary } = await import('./database.js');
                    await updateSummary(sum.id, { content: newText });
                    loadSummaries(type, container); // reload
                }
            });

            // Regenerate
            card.querySelector('.regen-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                dropdown.classList.add('hidden');
                
                // Show loading state
                card.querySelector('.summary-content').innerHTML = '<div style="color: var(--accent-light);"><i class="fa-solid fa-circle-notch fa-spin"></i> Regenerating...</div>';
                
                try {
                    const { forceRegenerateSummary } = await import('./summarization-engine.js');
                    await forceRegenerateSummary(type, sum.period_id);
                    await loadSummaries(type, container); // reload
                } catch (error) {
                    console.error(error);
                    card.querySelector('.summary-content').innerHTML = '<div style="color: red;">Failed to regenerate.</div>';
                }
            });

            // Delete
            card.querySelector('.delete-btn').addEventListener('click', async (e) => {
                e.stopPropagation();
                dropdown.classList.add('hidden');
                if (confirm(`Are you sure you want to delete the summary for ${sum.period_id}? It will not be automatically regenerated unless you do it manually.`)) {
                    const { deleteSummary } = await import('./database.js');
                    await deleteSummary(sum.id);
                    
                    // We don't un-flag the children on manual delete because the user explicitly wanted it gone
                    // Wait, actually, if they delete it, it will stay "summarized" so it doesn't auto-generate again tomorrow!
                    // This is good behavior.

                    loadSummaries(type, container);
                }
            });

            container.appendChild(card);
        });
    } catch (err) {
        console.error("Failed to load summaries", err);
        container.innerHTML = `<div style="color: red; padding: 20px;">Failed to load summaries.</div>`;
    }
}

function formatText(text) {
    // Basic markdown bolding for UI
    return text.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
}
