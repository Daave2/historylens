/**
 * AI Helper — builds structured prompts for summarising pasted research.
 * Phase 1: prompt-builder only (no API calls). User copies the prompt to their preferred AI tool.
 */

/**
 * Build a prompt that asks an AI to summarise pasted research into a structured historical entry.
 */
export function buildSummaryPrompt(pastedText, place, existingEntries) {
    const existingContext = existingEntries.length > 0
        ? `\n\nExisting entries for this place:\n${existingEntries.map(e =>
            `- ${e.yearStart}${e.yearEnd ? '–' + e.yearEnd : ''}: ${e.title}`
        ).join('\n')}`
        : '';

    return `You are a local history researcher helping to document the history of "${place.name}" (${place.category}) located at coordinates ${place.lat.toFixed(5)}, ${place.lng.toFixed(5)}.
${existingContext}

I have the following research text that I'd like you to analyse and structure into a historical entry:

---
${pastedText}
---

Please extract and return the following fields as a structured response:

1. **Year Start**: The earliest year mentioned or inferred
2. **Year End**: The latest year (leave blank if the information is current/ongoing)
3. **Title**: A concise title for this historical period (e.g. "Murray's Grocery Store")
4. **Summary**: A well-written 2-4 paragraph summary suitable for a local history archive. Write in past tense for historical periods. Include key facts, names, and dates. Make it engaging for community readers.
5. **Source suggestion**: What type of source this appears to be (archive, newspaper, oral history, photograph, map)
6. **Confidence level**: How reliable this information seems (verified, likely, speculative)

If the text doesn't contain clear dates, make reasonable estimates and note the uncertainty.
If text mentions multiple time periods, focus on the most prominent one and note the others.`;
}

/**
 * Generate a speculative note for a place before its known history.
 */
export function generateSpeculativeNote(place, earliestYear) {
    const notes = {
        residential: `Before ${earliestYear}, this plot was likely undeveloped or part of a larger estate. Urban residential development in this area appears to have begun around ${earliestYear}.`,
        commercial: `Prior to ${earliestYear}, this site was likely not commercially developed. The commercial character of this area seems to have emerged around that time.`,
        landmark: `Before ${earliestYear}, this landmark did not yet exist. The site may have been open land or had a different use.`,
        natural: `Before ${earliestYear}, this natural feature may have been part of the original landscape — potentially coastal land, farmland, or marshland depending on the local geography.`,
        infrastructure: `Before ${earliestYear}, this infrastructure did not yet exist. The development of this area's infrastructure began around ${earliestYear}.`
    };

    return notes[place.category] || `No historical records found before ${earliestYear}. This area was likely undeveloped land.`;
}

/**
 * Attempt to parse a structured AI response into entry fields.
 * This is a best-effort parser for common AI output formats.
 */
export function parseAiResponse(text) {
    const result = {
        yearStart: null,
        yearEnd: null,
        title: '',
        summary: '',
        sourceType: 'user',
        confidence: 'likely'
    };

    // Try to extract year start
    const yearStartMatch = text.match(/year\s*start[:\s]*(\d{4})/i);
    if (yearStartMatch) result.yearStart = parseInt(yearStartMatch[1]);

    // Try to extract year end
    const yearEndMatch = text.match(/year\s*end[:\s]*(\d{4})/i);
    if (yearEndMatch) result.yearEnd = parseInt(yearEndMatch[1]);

    // Try to extract title
    const titleMatch = text.match(/title[:\s]*(?:\*\*)?(.+?)(?:\*\*)?$/im);
    if (titleMatch) result.title = titleMatch[1].trim().replace(/"/g, '');

    // Try to extract summary
    const summaryMatch = text.match(/summary[:\s]*([\s\S]+?)(?=(?:\d+\.\s*\*\*|source|confidence|$))/i);
    if (summaryMatch) result.summary = summaryMatch[1].trim();

    // Try to extract confidence
    const confMatch = text.match(/confidence[:\s]*(verified|likely|speculative)/i);
    if (confMatch) result.confidence = confMatch[1].toLowerCase();

    return result;
}
