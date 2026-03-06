/**
 * OpenAI API client for HistoryLens
 * Calls are proxied through a Supabase Edge Function so the API key stays server-side.
 */

import { supabase } from '../data/supabaseClient.js';

// Check if the Supabase project has the Edge Function deployed
let _aiAvailable = null;

export function hasAiAccess() {
    // We assume AI is available if Supabase is configured.
    // The Edge Function will return an error if the key isn't set server-side.
    return true;
}

/**
 * Call the OpenAI Chat Completions API via the Supabase Edge Function proxy.
 */
async function callOpenAI(systemPrompt, userPrompt, jsonSchema) {
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
        throw new Error(res.error.message || 'AI proxy call failed');
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
