import { getEntriesByDateRange, getSummary, saveSummary, getSummariesByType } from './database.js';
import { generateGeminiContent } from './gemini-rest.js';

/**
 * Main entry point called on app boot.
 * Determines what summaries need to be generated based on the current date.
 */
export async function checkAndGenerateSummaries() {
    const isEnabled = localStorage.getItem('enable_auto_summaries') !== 'false';
    if (!isEnabled) return;

    const apiKey = localStorage.getItem('gemini_api_key');
    if (!apiKey) return;

    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    
    // 1. Check/Generate Daily Summary for Yesterday
    await processDailySummary(yesterday);

    // 2. Check/Generate Weekly Summary
    const endOfWeekDay = parseInt(localStorage.getItem('end_of_week_day') || '5'); 
    if (yesterday.getDay() === endOfWeekDay) {
        await processWeeklySummary(yesterday);
    }

    // 3. Check/Generate Monthly Summary (if yesterday was last day of month)
    if (today.getDate() === 1) {
        await processMonthlySummary(yesterday);
    }

    // 4. Check/Generate Yearly Summary (if yesterday was Dec 31st)
    if (today.getMonth() === 0 && today.getDate() === 1) {
        await processYearlySummary(yesterday);
    }
}

async function processDailySummary(dateObj) {
    const periodId = formatDate(dateObj);
    const existing = await getSummary('daily', periodId);
    if (existing) return;

    const entries = await getEntriesByDateRange(periodId, periodId);
    if (!entries || entries.length === 0) return;

    let contentToSummarize = `Diary Entries for ${periodId}:\n\n`;
    let entryIds = [];
    entries.forEach(e => {
        if (e.is_summarized_daily !== 1) {
            entryIds.push(e.id);
            contentToSummarize += `Title: ${e.title || 'Untitled'}\nTags: ${(e.tags || []).join(', ')}\n`;
            if (e.ai_tested_notes && e.ai_tested_notes.length > 0) {
                contentToSummarize += `AI Notes: ${e.ai_tested_notes.map(n => n.title).join(', ')}\n`;
            }
            contentToSummarize += `---\n`;
        }
    });

    if (entryIds.length === 0) return;

    const customPrompt = localStorage.getItem('custom_prompt_daily');
    const instruction = customPrompt ? customPrompt : `Write a warm, concise 3-sentence daily reflection summarizing what the user experienced, thought about, or accomplished today. Focus on the human element.`;

    const prompt = `You are a thoughtful AI assistant summarizing a user's diary.
Review the following diary entry metadata for ${periodId}.
${instruction}

${contentToSummarize}`;

    await executeAndSave('daily', periodId, prompt, 'entries', entryIds, 'is_summarized_daily');
}

async function processWeeklySummary(endOfWeekDate) {
    const periodId = `Week ending ${formatDate(endOfWeekDate)}`;
    const existing = await getSummary('weekly', periodId);
    if (existing) return;

    let contentToSummarize = "";
    let summaryIds = [];
    for (let i = 6; i >= 0; i--) {
        const d = new Date(endOfWeekDate);
        d.setDate(d.getDate() - i);
        const dayStr = formatDate(d);
        const dailySum = await getSummary('daily', dayStr);
        if (dailySum && dailySum.is_rolled_up !== 1) {
            summaryIds.push(dailySum.id);
            contentToSummarize += `${dayStr}:\n${dailySum.content}\n\n`;
        }
    }

    if (!contentToSummarize.trim()) return;

    const customPrompt = localStorage.getItem('custom_prompt_weekly');
    const instruction = customPrompt ? customPrompt : `Synthesize this into a cohesive weekly reflection (about 1 paragraph), highlighting major themes, emotional shifts, or continuous accomplishments over the week.`;

    const prompt = `You are a thoughtful AI assistant summarizing a user's diary.
Review the following daily summaries for the week ending ${formatDate(endOfWeekDate)}.
${instruction}

${contentToSummarize}`;

    await executeAndSave('weekly', periodId, prompt, 'summaries', summaryIds, 'is_rolled_up');
}

async function processMonthlySummary(endOfMonthDate) {
    const periodId = `${endOfMonthDate.getFullYear()}-${String(endOfMonthDate.getMonth() + 1).padStart(2, '0')}`;
    const existing = await getSummary('monthly', periodId);
    if (existing) return;

    const allWeekly = await getSummariesByType('weekly');
    const monthPrefix = periodId; 
    let contentToSummarize = "";
    let summaryIds = [];
    allWeekly.forEach(w => {
        if (w.period_id.includes(`Week ending ${monthPrefix}`) && w.is_rolled_up !== 1) {
            summaryIds.push(w.id);
            contentToSummarize += `${w.period_id}:\n${w.content}\n\n`;
        }
    });

    if (!contentToSummarize.trim()) return;

    const customPrompt = localStorage.getItem('custom_prompt_monthly');
    const instruction = customPrompt ? customPrompt : `Create a cohesive Monthly Reflection summarizing the broader themes, goals, and emotional journey of this month.`;

    const prompt = `You are an AI assistant. Review these weekly summaries for ${periodId}.
${instruction}

${contentToSummarize}`;

    await executeAndSave('monthly', periodId, prompt, 'summaries', summaryIds, 'is_rolled_up');
}

async function processYearlySummary(endOfYearDate) {
    const periodId = `${endOfYearDate.getFullYear()}`;
    const existing = await getSummary('yearly', periodId);
    if (existing) return;

    const allMonthly = await getSummariesByType('monthly');
    let contentToSummarize = "";
    let summaryIds = [];
    allMonthly.forEach(m => {
        if (m.period_id.startsWith(periodId) && m.is_rolled_up !== 1) {
            summaryIds.push(m.id);
            contentToSummarize += `${m.period_id}:\n${m.content}\n\n`;
        }
    });

    if (!contentToSummarize.trim()) return;

    const customPrompt = localStorage.getItem('custom_prompt_yearly');
    const instruction = customPrompt ? customPrompt : `Create a comprehensive Yearly Reflection highlighting the massive milestones, personal growth, and overarching narrative of the entire year.`;

    const prompt = `You are an AI assistant. Review these monthly summaries for the year ${periodId}.
${instruction}

${contentToSummarize}`;

    await executeAndSave('yearly', periodId, prompt, 'summaries', summaryIds, 'is_rolled_up');
}

async function executeAndSave(type, periodId, prompt, targetTable, targetIds, targetField) {
    try {
        const summaryText = await generateGeminiContent(prompt);
        if (summaryText) {
            await saveSummary({ type, period_id: periodId, content: summaryText, created_at: Date.now() });
            
            if (targetTable && targetIds.length > 0) {
                const { setFlag } = await import('./database.js');
                await setFlag(targetTable, targetIds, targetField, 1);
            }
            
            console.log(`[Summarization Engine] Generated ${type} Summary for ${periodId}`);
        }
    } catch (err) {
        console.error(`Failed to generate ${type} summary`, err);
        throw err;
    }
}

/**
 * Regenerates a specific summary by unflagging its children and re-running the engine.
 */
export async function forceRegenerateSummary(type, periodId) {
    const { getSummary, deleteSummary, setFlag, getEntriesByDateRange, getSummariesByType } = await import('./database.js');
    
    // 1. Delete existing summary so it bypasses the "already exists" check
    const existing = await getSummary(type, periodId);
    if (existing) {
        await deleteSummary(existing.id);
    }

    // 2. Unflag the children so they get pulled in again
    if (type === 'daily') {
        const entries = await getEntriesByDateRange(periodId, periodId);
        const ids = entries.map(e => e.id);
        if (ids.length > 0) await setFlag('entries', ids, 'is_summarized_daily', 0);
        // Re-run
        await processDailySummary(new Date(periodId + 'T12:00:00'));
    } 
    else if (type === 'weekly') {
        const dateStr = periodId.replace('Week ending ', ''); // e.g. "2026-06-12"
        // Find the 7 days of daily summaries and unflag them
        let summaryIds = [];
        for (let i = 6; i >= 0; i--) {
            const d = new Date(dateStr + 'T12:00:00');
            d.setDate(d.getDate() - i);
            const dailySum = await getSummary('daily', formatDate(d));
            if (dailySum) summaryIds.push(dailySum.id);
        }
        if (summaryIds.length > 0) await setFlag('summaries', summaryIds, 'is_rolled_up', 0);
        // Re-run
        await processWeeklySummary(new Date(dateStr + 'T12:00:00'));
    }
    else if (type === 'monthly') {
        // periodId is YYYY-MM
        const allWeekly = await getSummariesByType('weekly');
        const ids = allWeekly.filter(w => w.period_id.includes(`Week ending ${periodId}`)).map(w => w.id);
        if (ids.length > 0) await setFlag('summaries', ids, 'is_rolled_up', 0);
        await processMonthlySummary(new Date(`${periodId}-01T12:00:00`));
    }
    else if (type === 'yearly') {
        // periodId is YYYY
        const allMonthly = await getSummariesByType('monthly');
        const ids = allMonthly.filter(m => m.period_id.startsWith(periodId)).map(m => m.id);
        if (ids.length > 0) await setFlag('summaries', ids, 'is_rolled_up', 0);
        await processYearlySummary(new Date(`${periodId}-01-01T12:00:00`));
    }
}

function formatDate(dateObj) {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
}
