import assert from 'node:assert/strict';
import { normalizePlaceCategory } from './src/utils/category.js';

const selectedResult = {
    lat: 53.815915,
    lng: -3.055921,
    displayName: 'Blackpool Tower',
    fullAddress: 'Blackpool Tower, Bank Hey Street, Blackpool',
    houseNumber: '',
    road: 'Bank Hey Street',
    suburb: '',
    city: 'Blackpool',
    postcode: 'FY1 4BJ',
    type: 'tower',
    category: 'man_made',
    osmId: 12345,
    osmType: 'way',
    placeName: 'Blackpool Tower',
    wikidata: 'Q880905',
    wikipedia: 'en:Blackpool Tower',
    website: 'https://www.theblackpooltower.com/',
    oldNames: ['Tower Buildings'],
    allTags: {
        wikidata: 'Q880905',
        wikipedia: 'en:Blackpool Tower',
        website: 'https://www.theblackpooltower.com/',
        tourism: 'attraction',
        man_made: 'tower',
        old_name: 'Tower Buildings'
    }
};

const calls = [];

globalThis.fetch = async (url, options = {}) => {
    const href = String(url);
    calls.push({ href, method: options.method || 'GET' });

    if (href.startsWith('https://nominatim.openstreetmap.org/reverse')) {
        return jsonResponse({
            display_name: '50a Promenade, Blackpool, FY1 4BJ, United Kingdom',
            osm_type: 'node',
            osm_id: 98765,
            type: 'miniature_golf',
            category: 'leisure',
            name: 'Hole In Wand',
            address: {
                house_number: '50a',
                road: 'Promenade',
                town: 'Blackpool',
                postcode: 'FY1 4BJ',
                country: 'United Kingdom'
            },
            extratags: {
                fee: 'yes'
            },
            namedetails: {
                name: 'Hole In Wand'
            }
        });
    }

    if (href.startsWith('https://overpass-api.de/api/interpreter')) {
        return jsonResponse({ elements: [] });
    }

    if (href.includes('wikidata.org/w/api.php') && href.includes('props=claims')) {
        return jsonResponse({
            entities: {
                Q880905: {
                    id: 'Q880905',
                    labels: {
                        en: { value: 'Blackpool Tower' }
                    },
                    descriptions: {
                        en: { value: 'tourist attraction in Blackpool, Lancashire, England' }
                    },
                    aliases: {
                        en: [
                            { value: 'The Blackpool Tower' },
                            { value: 'Tower Buildings' }
                        ]
                    },
                    sitelinks: {
                        enwiki: { title: 'Blackpool Tower' }
                    },
                    claims: {
                        P31: [entityClaim('Q12518')],
                        P571: [timeClaim('+1894-05-14T00:00:00Z')],
                        P84: [entityClaim('Q999')],
                        P1435: [entityClaim('Q15700834')]
                    }
                }
            }
        });
    }

    if (href.includes('wikidata.org/w/api.php') && href.includes('props=labels')) {
        return jsonResponse({
            entities: {
                Q12518: { labels: { en: { value: 'tower' } } },
                Q999: { labels: { en: { value: 'Maxwell and Tuke' } } },
                Q15700834: { labels: { en: { value: 'Grade I listed building' } } }
            }
        });
    }

    if (href.startsWith('https://en.wikipedia.org/api/rest_v1/page/summary/Blackpool%20Tower')) {
        return jsonResponse({
            title: 'Blackpool Tower',
            extract: 'Blackpool Tower is a tourist attraction in Blackpool, Lancashire, England, opened to the public on 14 May 1894.',
            content_urls: {
                desktop: {
                    page: 'https://en.wikipedia.org/wiki/Blackpool_Tower'
                }
            }
        });
    }

    throw new Error(`Unexpected fetch: ${href}`);
};

const { lookupPlaceInfo } = await import('./src/data/geocode.js');
const { default: PlaceForm } = await import('./src/components/PlaceForm.js');
const { extractResearchLinksFromSummary } = await import('./src/utils/researchLinks.js');

const info = await lookupPlaceInfo(
    selectedResult.lat,
    selectedResult.lng,
    selectedResult.placeName,
    selectedResult
);

const entries = info.autoEntries;
const wikidataEntry = entries.find((entry) => entry.source === 'Wikidata' && entry.yearStart === 1894);
const wikipediaEntry = entries.find((entry) => entry.source === 'Wikipedia' && entry.yearStart === 1894);
const researchLeads = entries.filter((entry) => entry.source === 'HistoryLens — research prompt');
const researchLeadWithLinks = researchLeads.find((entry) => entry.researchLinks?.length >= 2);
const broadEstimate = entries.find((entry) => /Victorian resort|Blackpool development/.test(`${entry.title} ${entry.summary}`));

assert.ok(info.suggestedNames.includes('Blackpool Tower'), 'selected search result name should survive reverse geocode');
assert.ok(info.suggestedNames.includes('The Blackpool Tower'), 'Wikidata aliases should be suggested as names');
assert.equal(info.suggestedCategories[0], 'landmark', 'selected landmark search result should drive the suggested category');
assert.equal(normalizePlaceCategory('comercial'), 'commercial', 'common commercial misspelling should not fall back to residential');
assert.equal(normalizePlaceCategory('retail shop'), 'commercial', 'retail/shop categories should save as commercial');
assert.equal(normalizePlaceCategory('leisure miniature_golf'), 'commercial', 'commercial leisure venues should save as commercial');
assert.equal(normalizePlaceCategory('highway residential'), 'infrastructure', 'residential road OSM tags should save as infrastructure');
assert.equal(normalizePlaceCategory('unknown niche category'), 'other', 'unknown explicit categories should not silently become residential');
assert.ok(wikidataEntry, 'Wikidata inception entry should be produced');
assert.equal(wikidataEntry.preselected, true, 'dated Wikidata evidence should be preselected');
assert.notEqual(wikidataEntry.saveable, false, 'dated Wikidata evidence should be saveable');
assert.ok(wikipediaEntry, 'direct Wikipedia summary should be produced');
assert.equal(wikipediaEntry.saveable, true, 'dated direct Wikipedia evidence should be saveable');
assert.ok(researchLeads.length >= 1, 'research leads should be produced');
assert.ok(researchLeads.every((entry) => entry.preselected === false && entry.yearStart === new Date().getFullYear()), 'research leads should be current-year notes and not preselected');
assert.ok(researchLeads.every((entry) => entry.saveable !== false), 'research leads should be saveable when explicitly ticked');
assert.ok(researchLeadWithLinks, 'research leads should include launch links');
assert.ok(researchLeads.some((entry) => /Research links:/.test(entry.summary)), 'saved research leads should retain link trail in the summary');
const savedResearchTrail = extractResearchLinksFromSummary(researchLeadWithLinks.summary);
assert.ok(!/Research links:/.test(savedResearchTrail.summary), 'timeline display summary should omit saved link trail text');
assert.ok(savedResearchTrail.links.some((link) => link.label === 'Historic maps'), 'saved research link trail should parse into timeline chips');
assert.equal(broadEstimate, undefined, 'broad Blackpool/Victorian estimates should not be produced');
assert.ok(calls.some((call) => call.href.includes('wikidata.org')), 'Wikidata should be queried');
assert.ok(calls.some((call) => call.href.includes('wikipedia.org')), 'direct Wikipedia should be queried');

const renderer = {
    renderGroup: PlaceForm.prototype.renderGroup
};
const html = PlaceForm.prototype.renderDiscoveredInfo.call(renderer, info);
assert.match(html, /Wikidata Evidence/, 'rendered enrichment UI should group Wikidata evidence');
assert.match(html, /Research Leads/, 'rendered enrichment UI should group research leads');
assert.match(html, /research lead/, 'research leads should be visibly labelled');
assert.ok(/Research Leads[\s\S]*auto-entry-check/.test(html), 'research leads should render save checkboxes');
assert.ok(!/Research Leads[\s\S]*auto-entry-check[^>]*checked/.test(html), 'research leads should start unchecked');
assert.ok(/Research Leads[\s\S]*Historic maps/.test(html), 'research lead cards should render launch links');
assert.ok(/Wikidata Evidence[\s\S]*auto-entry-check[\s\S]*checked/.test(html), 'saveable dated evidence should render as checked');

console.log('Place enrichment smoke check passed.');

function jsonResponse(body) {
    return {
        ok: true,
        status: 200,
        async json() {
            return body;
        }
    };
}

function entityClaim(id) {
    return {
        mainsnak: {
            datavalue: {
                value: { id }
            }
        }
    };
}

function timeClaim(time) {
    return {
        mainsnak: {
            datavalue: {
                value: {
                    time,
                    precision: 11
                }
            }
        }
    };
}
