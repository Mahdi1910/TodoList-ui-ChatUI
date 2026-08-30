import { db } from './database.js';
import { renderEntries } from './ui-renderer.js';
import { expandSearchQuery } from './gemini-rest.js';
import { showToast } from './toast.js';

let searchDebounceTimeout = null;

export function initSearch() {
    const searchInput = document.getElementById('search-input');
    const aiSearchBtn = document.getElementById('ai-search-btn');

    if (!searchInput) return;

    // Trigger initial empty search to load all entries or recent ones
    executeSearch('');

    searchInput.addEventListener('input', (e) => {
        clearTimeout(searchDebounceTimeout);
        const query = e.target.value;
        searchDebounceTimeout = setTimeout(() => {
            executeSearch(query);
        }, 300);
    });

    if (aiSearchBtn) {
        aiSearchBtn.addEventListener('click', async () => {
            const query = searchInput.value.trim();
            if (!query) {
                showToast('<i class="fa-solid fa-triangle-exclamation" style="color: #f59e0b;"></i> Please type something to AI search.');
                return;
            }

            const apiKey = localStorage.getItem('gemini_api_key');
            if (!apiKey) {
                showToast('<i class="fa-solid fa-key" style="color: #ef4444;"></i> Please set your Gemini API key in Settings.');
                return;
            }

            // UI Loading State
            const originalText = aiSearchBtn.innerHTML;
            aiSearchBtn.innerHTML = '<i class="fa-solid fa-spinner fa-spin"></i> Thinking...';
            aiSearchBtn.style.pointerEvents = 'none';

            try {
                // Fetch synonyms from Gemma
                const terms = await expandSearchQuery(query, apiKey);
                
                if (terms && terms.length > 0) {
                    // Prepend the original query to the terms array if it isn't already there
                    const allTerms = [query, ...terms.filter(t => t.toLowerCase() !== query.toLowerCase())];
                    
                    // Format into the // OR syntax
                    const newQueryString = allTerms.join(' // ');
                    
                    // Update input box and trigger search
                    searchInput.value = newQueryString;
                    executeSearch(newQueryString);
                    showToast('<i class="fa-solid fa-wand-magic-sparkles" style="color: #8b5cf6;"></i> AI expanded your search!');
                } else {
                    showToast('<i class="fa-solid fa-circle-info" style="color: #3b82f6;"></i> AI couldn\'t find alternative terms.');
                }
            } catch (err) {
                console.error("AI Search failed:", err);
                showToast('<i class="fa-solid fa-circle-xmark" style="color: #ef4444;"></i> AI Search failed.');
            } finally {
                // Restore Button State
                aiSearchBtn.innerHTML = originalText;
                aiSearchBtn.style.pointerEvents = 'auto';
            }
        });
    }
}

/**
 * Parses the search query and filters Dexie entries.
 * Evaluates `//` as an OR operator.
 */
async function executeSearch(queryString) {
    // 1. Fetch all entries. In a massive production DB, this should use Dexie indexing,
    // but for our prototype local memory, filtering an array is perfectly fast and accurate.
    const allEntries = await db.entries.reverse().sortBy('created_at');

    if (!queryString || !queryString.trim()) {
        // If empty, do not show any entries.
        renderEntries([], 'search-results-container');
        return;
    }

    // 2. Parse the OR terms
    const rawTerms = queryString.split('//').map(t => t.trim().toLowerCase()).filter(t => t.length > 0);
    
    // 3. Filter entries
    const matchedEntries = allEntries.filter(entry => {
        const title = (entry.title || "").toLowerCase();
        const content = (entry.content || "").toLowerCase();
        const tags = (entry.tags || []).join(' ').toLowerCase();
        
        // Match if ANY of the OR terms are found in title, content, or tags
        return rawTerms.some(term => {
            return title.includes(term) || content.includes(term) || tags.includes(term);
        });
    });

    // 4. Render
    renderEntries(matchedEntries, 'search-results-container');
}
