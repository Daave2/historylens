/**
 * OpenAI API client for HistoryLens
 * Calls are proxied through a Supabase Edge Function so the API key stays server-side.
 */

import { supabase } from '../data/supabaseClient.js';

// Check if the Supabase project has the Edge Function deployed
let _aiAvailable = null;

export function hasAiAccess() {
    if (_aiAvailable === false) return false;
    return Boolean(supabase);
}

/**
 * Call the OpenAI Chat Completions API via the Supabase Edge Function proxy.
 */
async function callOpenAI(systemPrompt, userPrompt, jsonSchema) {
    if (!supabase) {
        _aiAvailable = false;
        throw new Error('AI is not configured in this environment');
    }

    const { data: sessionData } = await supabase.auth.getSession();

    const res = await supabase.functions.invoke('ai-proxy', {
        body: {
            systemPrompt,
            userPrompt,
            jsonSchema,
            model: 'gpt-4o-mini'
        }
    });

    if (res.error) {
        const errMsg = res.error.message || 'AI proxy call failed';
        if (/function|not found|404|edge/i.test(errMsg)) {
            _aiAvailable = false;
        }
        throw new Error(errMsg);
    }

    const content = res.data?.content;
    if (!content) {
        throw new Error('No content in AI response');
    }

    if (jsonSchema) {
        try {
            return JSON.parse(content);
        } catch (e) {
            throw new Error('Failed to parse AI JSON response');
        }
    }

    return content;
}

/**
 * Summarise pasted research into a structured TimeEntry format.
 */
export async function autoSummariseResearch(pastedText, placeName = 'this location', currentYearHint = new Date().getFullYear()) {
    const schema = {
        type: 'object',
        properties: {
            title: {
                type: 'string',
                description: 'A punchy, newspaper-style headline for the event or period (e.g. "Royal Hotel Opens", "Victorian Terraces Built")'
            },
            summary: {
                type: 'string',
                description: 'A concise summary of the facts (1-3 paragraphs formatting with HTML <p> tags if needed). Focus purely on factual history, dates, and people involved.'
            },
            yearStart: {
                type: ['integer', 'null'],
                description: 'The year this event happened or period began. Null if unknown.'
            },
            yearEnd: {
                type: ['integer', 'null'],
                description: 'The year this period ended. Null if ongoing or a single event.'
            },
            confidence: {
                type: 'string',
                enum: ['verified', 'likely', 'speculative'],
                description: 'How certain are we based on the text? verified = primary source citations, likely = general article/book, speculative = rumors/unclear text.'
            }
        },
        required: ['title', 'summary', 'yearStart', 'yearEnd', 'confidence'],
        additionalProperties: false
    };

    const sys = `You are a professional local historian. Your job is to extract historical facts from pasted research text and format them into a structured database entry for a specific location.
Be objective, factual, and concise. Do not use flowery language.
If exact years are missing but context implies them (e.g. "during the war"), try to estimate yearStart/yearEnd and set confidence to 'likely' or 'speculative'.`;

    const user = `Location Context: ${placeName}
Current Year context: ${currentYearHint}

Research text to process:
"""
${pastedText}
"""`;

    return callOpenAI(sys, user, schema);
}

/**
 * Generate a smart speculative note for a place before any known history.
 */
export async function generateSpeculativeContext(placeName, firstKnownYear, areaContext) {
    const schema = {
        type: 'object',
        properties: {
            title: { type: 'string' },
            summary: { type: 'string' }
        },
        required: ['title', 'summary'],
        additionalProperties: false
    };

    const sys = `You are a local historian generating "before picture" context for an interactive map.
The user is looking at a location *before* any confirmed historical records exist for it in our database.
Write a speculative but historically grounded short summary of what this plot of land was likely used for or looked like, given the general history of the town/area.
Keep it under 3 sentences. Tone should be educational but clear that this is general context, not specific plot history.`;

    const user = `Location: ${placeName}
First confirmed record: ${firstKnownYear || 'Unknown'}
Area context / town history: ${areaContext}

Generate a title and summary describing this land before it was developed or before the first record.`;

    const res = await callOpenAI(sys, user, schema);

    return {
        ...res,
        yearStart: null,
        yearEnd: firstKnownYear ? firstKnownYear - 1 : null,
        confidence: 'speculative',
        source: 'AI Historical Context',
        sourceType: 'user'
    };
}

/**
 * Analyze an uploaded historical image to estimate its year and provide a caption.
 */
export async function analyzeImage(base64DataUrl, placeName) {
    const schema = {
        type: 'object',
        properties: {
            caption: { type: 'string', description: 'A descriptive caption for the image mentioning the place name.' },
            summary: { type: 'string', description: 'A short historical summary of what is visible in the photo.' },
            yearTaken: { type: ['integer', 'null'], description: 'Estimated year the photo was taken, based on style, vehicles, fashion, architecture, or photo quality. Null if impossible to guess.' }
        },
        required: ['caption', 'summary', 'yearTaken'],
        additionalProperties: false
    };

    const sys = `You are a professional local historian and archivist. You are analyzing an old photograph of a place.
Analyze the photo and provide a descriptive caption, an estimated year it was taken (look at fashion, vehicles, photo quality, architecture), and a short summary of what is happening or visible.`;

    const user = [
        { type: "text", text: `This is an image related to ${placeName || 'a historical location'}. Extract its details.` },
        { type: "image_url", image_url: { url: base64DataUrl } }
    ];

    return callOpenAI(sys, user, schema);
}

/**
 * Generate an editable wiki-style overview from place timeline entries.
 * Falls back to a deterministic summary if AI is unavailable/fails.
 */
export async function generatePlaceOverview(place, entries = []) {
    const sorted = [...entries].sort((a, b) => (a.yearStart || 0) - (b.yearStart || 0));
    if (sorted.length === 0) {
        return place?.description?.trim() || '';
    }

    if (!hasAiAccess()) {
        return buildFallbackOverview(place, sorted);
    }

    const timelineText = sorted.map((entry, idx) => {
        const span = entry.yearEnd ? `${entry.yearStart}-${entry.yearEnd}` : `${entry.yearStart}-present`;
        const title = entry.title || `Entry ${idx + 1}`;
        const summary = (entry.summary || '').replace(/\s+/g, ' ').trim();
        const source = entry.source ? ` Source: ${entry.source}.` : '';
        return `- ${span}: ${title}. ${summary}${source}`;
    }).join('\n');

    const schema = {
        type: 'object',
        properties: {
            overview: { type: 'string' }
        },
        required: ['overview'],
        additionalProperties: false
    };

    const sys = `You are a local historian writing a concise encyclopedia-style place overview.
Write 2-5 short paragraphs in plain text (no markdown headings).
Requirements:
- Be factual and neutral.
- Prefer timeline-backed facts from the provided entries.
- Mention uncertainty briefly when entries are speculative.
- Keep it readable for the public; avoid bullet lists.
- Do not invent facts that are not in the timeline text.`;

    const user = `Place: ${place?.name || 'Unknown place'}
Category: ${place?.category || 'unknown'}
Current overview (if any): ${place?.description || 'None'}

Timeline entries:
${timelineText}

Return an updated overview text.`;

    try {
        const res = await callOpenAI(sys, user, schema);
        const overview = (res?.overview || '').trim();
        if (overview) return overview;
    } catch (err) {
        console.warn('AI overview generation failed, using fallback:', err);
    }

    return buildFallbackOverview(place, sorted);
}

function buildFallbackOverview(place, sortedEntries) {
    if (!sortedEntries || sortedEntries.length === 0) return place?.description || '';

    const placeName = place?.name || 'This place';
    const placeType = place?.category ? place.category.replace(/_/g, ' ') : 'place';
    const first = sortedEntries[0];
    const latest = sortedEntries[sortedEntries.length - 1];
    const count = sortedEntries.length;
    const intro = `${placeName} is documented as a ${placeType} with ${count} recorded timeline entr${count === 1 ? 'y' : 'ies'}.`;

    const firstSummary = summariseEntry(first);
    const firstSentence = `${intro} The earliest entry is ${formatEntryRange(first)}: ${first.title || 'an early recorded phase'}.`;

    if (latest === first) {
        return [firstSentence, firstSummary].filter(Boolean).join(' ');
    }

    const middleTitles = sortedEntries
        .slice(1, -1)
        .map((entry) => entry.title)
        .filter(Boolean)
        .slice(0, 2);
    const middleSentence = middleTitles.length > 0
        ? `Other documented periods include ${middleTitles.join(' and ')}.`
        : '';

    const latestSummary = summariseEntry(latest);
    const latestSentence = `The most recent documented period is ${formatEntryRange(latest)}: ${latest.title || 'the latest recorded phase'}.`;

    return [firstSentence, firstSummary, middleSentence, latestSentence, latestSummary]
        .filter(Boolean)
        .join('\n\n');
}

function formatEntryRange(entry) {
    if (!entry?.yearStart && !entry?.yearEnd) return 'an undated period';
    if (entry?.yearStart && entry?.yearEnd) return `${entry.yearStart}-${entry.yearEnd}`;
    if (entry?.yearStart) return `${entry.yearStart}-present`;
    return `until ${entry.yearEnd}`;
}

function summariseEntry(entry) {
    const plain = String(entry?.summary || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    if (!plain) return '';
    return plain.length > 220 ? `${plain.slice(0, 217).trim()}...` : plain;
}
