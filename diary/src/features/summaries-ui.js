import { getSummariesByType } from './database.js';
import { escapeHtml, renderBasicBoldHtml } from '../platform/html-safety.mjs';

export function initSummariesUi() {
    const tabButtons = document.querySelectorAll('#view-summaries .summary-tabs .action-btn');
    const container = document.getElementById('summaries-container');
    if (!container) return;

    tabButtons.forEach(btn => {
        btn.addEventListener('click', async event => {
            tabButtons.forEach(button => button.classList.remove('active'));
            const button = event.currentTarget;
            button.classList.add('active');
            await loadSummaries(button.getAttribute('data-summary-type') || 'daily', container);
        });
    });

    void loadSummaries('daily', container);
}

async function loadSummaries(type, container) {
    container.innerHTML = '<div style="text-align:center; padding: 20px; color: var(--text-muted);"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading...</div>';
    try {
        const summaries = await getSummariesByType(type);
        container.innerHTML = '';

        if (!summaries?.length) {
            container.innerHTML = `
                <div class="empty-state" style="text-align: center; padding: 40px 20px;">
                    <i class="fa-solid fa-ghost" style="font-size: 48px; color: var(--card-border); margin-bottom: 16px;"></i>
                    <h3 style="color: var(--text-main); margin-bottom: 8px;">No ${escapeHtml(type)} summaries yet</h3>
                    <p style="color: var(--text-muted); font-size: 14px;">The AI will automatically generate these based on your entries as time passes.</p>
                </div>`;
            return;
        }

        summaries.forEach(summary => {
            const dateStr = new Date(summary.created_at).toLocaleDateString(undefined, {
                year: 'numeric', month: 'short', day: 'numeric'
            });
            const periodId = String(summary.period_id || 'Unknown period');
            const card = document.createElement('div');
            card.className = 'summary-card';
            card.innerHTML = `
                <div class="summary-card-header" style="position: relative;">
                    <div class="summary-icon"><i class="fa-solid fa-sparkles"></i></div>
                    <div style="flex: 1;">
                        <h4 class="summary-title">${escapeHtml(periodId)}</h4>
                        <span class="summary-date">Generated on ${escapeHtml(dateStr)}</span>
                    </div>
                    <button class="action-btn menu-btn" style="background:transparent; border:none; color:var(--text-muted); cursor:pointer;"><i class="fa-solid fa-ellipsis-vertical"></i></button>
                    <div class="action-dropdown hidden" style="position:absolute; right:0; top:40px; background:var(--sidebar-bg); border:1px solid var(--card-border); border-radius:8px; z-index:10; box-shadow:var(--shadow-md); min-width: 150px; overflow:hidden;">
                        <button class="dropdown-item edit-btn" style="width:100%; padding:10px 16px; text-align:left; background:transparent; border:none; color:var(--text-main); cursor:pointer; font-family:inherit;"><i class="fa-solid fa-pen" style="margin-right:8px; width:16px;"></i>Edit</button>
                        <button class="dropdown-item regen-btn" style="width:100%; padding:10px 16px; text-align:left; background:transparent; border:none; color:var(--text-main); cursor:pointer; font-family:inherit;"><i class="fa-solid fa-rotate-right" style="margin-right:8px; width:16px;"></i>Regenerate</button>
                        <div style="height:1px; background:var(--card-border); margin:4px 0;"></div>
                        <button class="dropdown-item delete-btn" style="width:100%; padding:10px 16px; text-align:left; background:transparent; border:none; color:#ef4444; cursor:pointer; font-family:inherit;"><i class="fa-solid fa-trash" style="margin-right:8px; width:16px;"></i>Delete</button>
                    </div>
                </div>
                <div class="summary-content"><p>${renderBasicBoldHtml(summary.content || '')}</p></div>`;

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
                const newText = prompt(`Edit summary for ${periodId}:`, summary.content || '');
                if (newText === null || !newText.trim()) return;
                const { updateSummary } = await import('./database.js');
                await updateSummary(summary.id, { content: newText });
                await loadSummaries(type, container);
            });

            card.querySelector('.regen-btn')?.addEventListener('click', async event => {
                event.stopPropagation();
                dropdown?.classList.add('hidden');
                const content = card.querySelector('.summary-content');
                if (content) content.innerHTML = '<div style="color: var(--accent-light);"><i class="fa-solid fa-circle-notch fa-spin"></i> Regenerating...</div>';
                try {
                    const { forceRegenerateSummary } = await import('./summarization-engine.js');
                    await forceRegenerateSummary(type, summary.period_id);
                    await loadSummaries(type, container);
                } catch (error) {
                    console.error(error);
                    if (content) content.innerHTML = '<div style="color: red;">Failed to regenerate.</div>';
                }
            });

            card.querySelector('.delete-btn')?.addEventListener('click', async event => {
                event.stopPropagation();
                dropdown?.classList.add('hidden');
                if (!confirm(`Are you sure you want to delete the summary for ${periodId}? It will not be automatically regenerated unless you do it manually.`)) return;
                const { deleteSummary } = await import('./database.js');
                await deleteSummary(summary.id);
                await loadSummaries(type, container);
            });

            container.appendChild(card);
        });
    } catch (error) {
        console.error('Failed to load summaries', error);
        container.innerHTML = '<div style="color: red; padding: 20px;">Failed to load summaries.</div>';
    }
}
