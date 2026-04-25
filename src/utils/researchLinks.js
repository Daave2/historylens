import { safeUrl } from './sanitize.js';

const RESEARCH_LINKS_MARKER = /(?:^|\s)Research links:\s*/i;

export function extractResearchLinksFromSummary(summary) {
  const raw = String(summary || '').trim();
  if (!raw) return { summary: '', links: [] };

  const markerMatch = raw.match(RESEARCH_LINKS_MARKER);
  if (!markerMatch || markerMatch.index === undefined) {
    return { summary: raw, links: [] };
  }

  const summaryText = raw.slice(0, markerMatch.index).trim();
  const trail = raw.slice(markerMatch.index + markerMatch[0].length).trim();

  return {
    summary: summaryText,
    links: parseResearchLinksTrail(trail)
  };
}

export function parseResearchLinksTrail(trail) {
  return String(trail || '')
    .split(/;\s*/)
    .map((chunk) => chunk.trim().replace(/\s*\.$/, ''))
    .map((chunk) => {
      const match = chunk.match(/^(.+?):\s*(https?:\/\/\S+)$/i);
      if (!match) return null;
      const url = safeUrl(match[2]);
      if (!url) return null;
      return {
        label: match[1].trim(),
        url
      };
    })
    .filter(Boolean)
    .slice(0, 4);
}
