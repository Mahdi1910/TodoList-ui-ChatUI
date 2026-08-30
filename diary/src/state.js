export let simulatedDateOffset = 0;
import { getEntriesByDate } from './features/database.js';
import { renderEntries } from './features/ui-renderer.js';

export function setSimulatedDateOffset(offset) {
    simulatedDateOffset = offset;
}

export const dateOptions = { weekday: 'long', month: 'short', day: 'numeric' };

export function getActiveDateString() {
    const simulatedDate = new Date();
    simulatedDate.setDate(simulatedDate.getDate() + simulatedDateOffset);
    const y = simulatedDate.getFullYear();
    const m = String(simulatedDate.getMonth() + 1).padStart(2, '0');
    const d = String(simulatedDate.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

export function updateDateDisplay() {
    const dateElement = document.getElementById('current-date');
    const nextBtn = document.getElementById('next-day');
    
    if (!dateElement) return;

    const simulatedDate = new Date();
    simulatedDate.setDate(simulatedDate.getDate() + simulatedDateOffset);
    
    const targetDateStr = getActiveDateString();

    if (simulatedDateOffset === 0) {
        dateElement.textContent = `Today, ${simulatedDate.toLocaleDateString('en-US', dateOptions)}`;
        if (nextBtn) {
            nextBtn.style.opacity = '0.3';
            nextBtn.style.pointerEvents = 'none';
        }
    } else {
        let prefix = simulatedDateOffset === -1 ? "Yesterday, " : "";
        dateElement.textContent = prefix + simulatedDate.toLocaleDateString('en-US', dateOptions);
        if (nextBtn) {
            nextBtn.style.opacity = '1';
            nextBtn.style.pointerEvents = 'auto';
        }
    }
    
    showEntriesForDate(targetDateStr);
}

export async function showEntriesForDate(dateStr) {
    const entries = await getEntriesByDate(dateStr);
    renderEntries(entries);
}

export function bindActionMenus() {
    document.querySelectorAll('.action-menu-trigger').forEach(btn => {
        const newBtn = btn.cloneNode(true);
        btn.parentNode.replaceChild(newBtn, btn);
        newBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // Close all other dropdowns
            document.querySelectorAll('.action-dropdown').forEach(drop => {
                if (drop !== newBtn.nextElementSibling) drop.classList.add('hidden');
            });
            const dropdown = newBtn.nextElementSibling;
            if (dropdown) dropdown.classList.toggle('hidden');
        });
    });
}
