/**
 * HistoryLens — Place Info Lookup
 *
 * Combines multiple free data sources to build a rich picture of any location:
 * 1. Nominatim (reverse geocode + extra tags)
 * 2. Overpass API (nearby named features, historic sites, buildings)
 * 3. Wikipedia Search (articles about the street, area, neighbourhood)
 * 4. Wikipedia Summary (for directly linked articles)
 * 5. Area context & building age estimation
 */

import { normalizePlaceCategory } from '../utils/category.js';

const SOURCE_OSM = 'OpenStreetMap';
const SOURCE_WIKIDATA = 'Wikidata';
const SOURCE_WIKIPEDIA = 'Wikipedia';
const SOURCE_BUILDING_ESTIMATE = 'HistoryLens — building age estimation';
const SOURCE_AREA_CONTEXT = 'HistoryLens — area context';
const SOURCE_RESEARCH_PROMPT = 'HistoryLens — research prompt';

// ── 0. Forward Address Search ─────────────────────────────

/**
 * Search for addresses by text query using Nominatim.
 * Returns an array of matching places with coordinates.
 */
export async function searchAddress(query, { limit = 8, bounded = false, viewbox = '' } = {}) {
    if (!query || query.length < 3) return [];
    try {
        let url = `https://nominatim.openstreetmap.org/search?format=jsonv2&q=${encodeURIComponent(query)}&addressdetails=1&extratags=1&namedetails=1&limit=${limit}`;
        if (bounded && viewbox) {
            url += `&viewbox=${viewbox}&bounded=1`;
        }
        const res = await fetch(url, {
            headers: { 'User-Agent': 'HistoryLens/1.0' }
        });
        if (!res.ok) return [];
        const data = await res.json();

        return data.map(item => {
            const addr = item.address || {};
            const extra = item.extratags || {};
            const names = item.namedetails || {};
            const parts = [];
            if (addr.house_number) parts.push(addr.house_number);
            if (addr.road) parts.push(addr.road);

            return {
                lat: parseFloat(item.lat),
                lng: parseFloat(item.lon),
                displayName: parts.length > 0 ? parts.join(' ') : item.display_name?.split(',').slice(0, 2).join(',').trim() || '',
                fullAddress: item.display_name || '',
                houseNumber: addr.house_number || '',
                road: addr.road || '',
                suburb: addr.suburb || addr.neighbourhood || '',
                city: addr.city || addr.town || addr.village || '',
                postcode: addr.postcode || '',
                type: item.type || '',
                category: item.category || '',
                importance: item.importance || 0,
                osmId: item.osm_id,
                osmType: item.osm_type,
                placeName: names.name || item.name || '',
                wikidata: extra.wikidata || '',
                wikipedia: extra.wikipedia || '',
                website: extra.website || extra.url || '',
                startDate: extra.start_date || '',
                openingDate: extra.opening_date || extra['opening:date'] || '',
                endDate: extra.end_date || extra.closing_date || '',
                architect: extra.architect || '',
                heritage: extra.heritage || '',
                historic: extra.historic || '',
                description: extra.description || '',
                building: extra.building || '',
                cuisine: extra.cuisine || '',
                operator: extra.operator || '',
                officialName: names.official_name || extra.official_name || '',
                oldNames: collectTagValues({ ...extra, ...names }, ['old_name', 'former_name', 'alt_name', 'loc_name', 'name:old', 'was:name']),
                allTags: extra,
                nameDetails: names
            };
        });
    } catch (err) {
        console.warn('Address search failed:', err);
        return [];
    }
}

// ── 1. Nominatim Reverse Geocode ──────────────────────────

export async function reverseGeocode(lat, lng) {
    try {
        const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}&addressdetails=1&extratags=1&namedetails=1&zoom=18`;
        const res = await fetch(url, {
            headers: { 'User-Agent': 'HistoryLens/1.0' }
        });
        if (!res.ok) return null;
        const data = await res.json();

        const addr = data.address || {};
        const extra = data.extratags || {};
        const names = data.namedetails || {};

        const parts = [];
        if (addr.house_number) parts.push(addr.house_number);
        if (addr.road) parts.push(addr.road);

        return {
            displayName: parts.length > 0
                ? parts.join(' ')
                : data.display_name?.split(',').slice(0, 2).join(',').trim() || '',
            fullAddress: data.display_name || '',
            houseNumber: addr.house_number || '',
            road: addr.road || '',
            suburb: addr.suburb || addr.neighbourhood || '',
            city: addr.city || addr.town || addr.village || '',
            county: addr.county || '',
            postcode: addr.postcode || '',
            country: addr.country || '',
            type: data.type || '',
            category: data.category || '',
            placeName: names.name || data.name || '',
            osmType: data.osm_type || '',
            osmId: data.osm_id || '',
            wikipedia: extra.wikipedia || '',
            wikidata: extra.wikidata || '',
            website: extra.website || extra.url || '',
            phone: extra.phone || '',
            openingHours: extra.opening_hours || '',
            startDate: extra['start_date'] || '',
            openingDate: extra.opening_date || extra['opening_date'] || extra['opening:date'] || '',
            endDate: extra.end_date || extra['end_date'] || extra.closing_date || '',
            architect: extra.architect || '',
            heritage: extra.heritage || '',
            historic: extra.historic || '',
            description: extra.description || '',
            building: addr.building || extra.building || '',
            cuisine: extra.cuisine || '',
            operator: extra.operator || '',
            officialName: names.official_name || extra.official_name || '',
            oldNames: collectTagValues({ ...extra, ...names }, ['old_name', 'former_name', 'alt_name', 'loc_name', 'name:old', 'was:name']),
            allTags: extra,
            nameDetails: names,
            raw: data
        };
    } catch (err) {
        console.warn('Reverse geocode failed:', err);
        return null;
    }
}

// ── 2. Overpass API ───────────────────────────────────────

export async function queryNearbyFeatures(lat, lng, radiusMetres = 30) {
    try {
        const query = `
      [out:json][timeout:10];
      (
        nwr(around:${radiusMetres},${lat},${lng})["name"];
        nwr(around:${radiusMetres},${lat},${lng})["wikidata"];
        nwr(around:${radiusMetres},${lat},${lng})["wikipedia"];
        nwr(around:${radiusMetres},${lat},${lng})["start_date"];
        nwr(around:${radiusMetres},${lat},${lng})["opening_date"];
        nwr(around:${radiusMetres},${lat},${lng})["old_name"];
        nwr(around:${radiusMetres},${lat},${lng})["building"]["building"!="yes"]["building"!="residential"];
        nwr(around:${radiusMetres},${lat},${lng})["historic"];
        nwr(around:${radiusMetres},${lat},${lng})["heritage"];
        nwr(around:${radiusMetres},${lat},${lng})["amenity"];
      );
      out tags center 10;
    `;
        const res = await fetch('https://overpass-api.de/api/interpreter', {
            method: 'POST',
            body: `data=${encodeURIComponent(query)}`
        });
        if (!res.ok) return [];
        const data = await res.json();

        return (data.elements || []).map(el => {
            const tags = el.tags || {};
            const featureLat = el.lat ?? el.center?.lat ?? null;
            const featureLng = el.lon ?? el.center?.lon ?? null;

            return {
                id: el.id,
                type: el.type,
                lat: featureLat,
                lng: featureLng,
                distanceMeters: distanceMetres(lat, lng, featureLat, featureLng),
                name: tags.name || '',
                amenity: tags.amenity || '',
                building: tags.building || '',
                historic: tags.historic || '',
                heritage: tags.heritage || '',
                description: tags.description || '',
                startDate: tags.start_date || '',
                openingDate: tags.opening_date || tags['opening:date'] || '',
                endDate: tags.end_date || tags.closing_date || '',
                architect: tags.architect || '',
                website: tags.website || tags.url || '',
                wikipedia: tags.wikipedia || '',
                wikidata: tags.wikidata || '',
                cuisine: tags.cuisine || '',
                operator: tags.operator || '',
                openingHours: tags.opening_hours || '',
                denomination: tags.denomination || '',
                religion: tags.religion || '',
                officialName: tags.official_name || '',
                oldNames: collectTagValues(tags, ['old_name', 'former_name', 'alt_name', 'loc_name', 'name:old', 'was:name']),
                style: tags['architect:style'] || tags['building:architecture'] || '',
                levels: tags['building:levels'] || '',
                material: tags['building:material'] || '',
                allTags: tags
            };
        });
    } catch (err) {
        console.warn('Overpass query failed:', err);
        return [];
    }
}

// ── 3. Wikipedia Search ───────────────────────────────────

/**
 * Search Wikipedia for articles related to a location.
 * Searches for street name, area, and neighbourhood.
 */
export async function searchWikipedia(queries) {
    const results = [];
    const seenTitles = new Set();

    for (const query of queries) {
        if (!query) continue;
        try {
            const url = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(query)}&srlimit=3&format=json&origin=*`;
            const res = await fetch(url);
            if (!res.ok) continue;
            const data = await res.json();

            for (const item of (data.query?.search || [])) {
                if (seenTitles.has(item.title)) continue;
                seenTitles.add(item.title);
                // Clean the snippet (remove HTML)
                const snippet = item.snippet?.replace(/<[^>]*>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&') || '';
                results.push({
                    title: item.title,
                    snippet,
                    pageid: item.pageid
                });
            }
        } catch (err) {
            console.warn('Wikipedia search failed for:', query, err);
        }
    }

    return results;
}

/**
 * Get a Wikipedia summary for a specific article.
 */
export async function getWikipediaSummary(wikiRef) {
    if (!wikiRef) return null;
    try {
        const parts = wikiRef.split(':');
        const lang = parts.length > 1 ? parts[0] : 'en';
        const title = parts.length > 1 ? parts.slice(1).join(':') : parts[0];

        const url = `https://${lang}.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(title)}`;
        const res = await fetch(url);
        if (!res.ok) return null;
        const data = await res.json();

        return {
            title: data.title || title,
            extract: data.extract || '',
            thumbnail: data.thumbnail?.source || null,
            url: data.content_urls?.desktop?.page || ''
        };
    } catch (err) {
        console.warn('Wikipedia summary failed:', err);
        return null;
    }
}

// ── 3b. Wikidata Evidence ──────────────────────────────────

async function getWikidataEntities(ids) {
    const qids = [...new Set((ids || []).map(normalizeWikidataId).filter(Boolean))].slice(0, 4);
    if (qids.length === 0) return [];

    try {
        const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids.join('|')}&props=claims|labels|descriptions|aliases|sitelinks&languages=en&sitefilter=enwiki&format=json&origin=*`;
        const res = await fetch(url);
        if (!res.ok) return [];
        const data = await res.json();

        return qids
            .map((qid) => data.entities?.[qid])
            .filter((entity) => entity && !entity.missing);
    } catch (err) {
        console.warn('Wikidata lookup failed:', err);
        return [];
    }
}

async function getWikidataLabels(ids) {
    const qids = [...new Set((ids || []).map(normalizeWikidataId).filter(Boolean))].slice(0, 30);
    if (qids.length === 0) return {};

    try {
        const url = `https://www.wikidata.org/w/api.php?action=wbgetentities&ids=${qids.join('|')}&props=labels&languages=en&format=json&origin=*`;
        const res = await fetch(url);
        if (!res.ok) return {};
        const data = await res.json();

        return Object.fromEntries(qids.map((qid) => [
            qid,
            data.entities?.[qid]?.labels?.en?.value || qid
        ]));
    } catch (err) {
        console.warn('Wikidata label lookup failed:', err);
        return {};
    }
}

function normalizeWikidataId(value) {
    const match = String(value || '').trim().match(/^Q\d+$/i);
    return match ? match[0].toUpperCase() : '';
}

function getWikidataLabel(entity) {
    return entity?.labels?.en?.value || entity?.id || '';
}

function getWikidataDescription(entity) {
    return entity?.descriptions?.en?.value || '';
}

function getWikidataUrl(entity) {
    return entity?.id ? `https://www.wikidata.org/wiki/${entity.id}` : '';
}

function getWikidataWikipediaRef(entity) {
    const title = entity?.sitelinks?.enwiki?.title;
    return title ? `en:${title}` : '';
}

function getClaimValues(entity, propertyId) {
    return entity?.claims?.[propertyId] || [];
}

function firstWikidataYear(entity, propertyIds) {
    for (const propertyId of propertyIds) {
        for (const claim of getClaimValues(entity, propertyId)) {
            const year = claimTimeYear(claim);
            if (year) return year;
        }
    }
    return null;
}

function claimTimeYear(claim) {
    const value = claim?.mainsnak?.datavalue?.value;
    if (!value || value.precision < 9 || typeof value.time !== 'string') return null;
    const match = value.time.match(/[+-](\d{4})-/);
    return match ? Number(match[1]) : null;
}

function claimStringValues(entity, propertyIds) {
    const values = [];
    for (const propertyId of propertyIds) {
        for (const claim of getClaimValues(entity, propertyId)) {
            const value = claim?.mainsnak?.datavalue?.value;
            if (typeof value === 'string' && value.trim()) values.push(value.trim());
            if (value?.text) values.push(value.text);
        }
    }
    return [...new Set(values)];
}

function claimEntityIds(entity, propertyIds) {
    const ids = [];
    for (const propertyId of propertyIds) {
        for (const claim of getClaimValues(entity, propertyId)) {
            const id = claim?.mainsnak?.datavalue?.value?.id;
            if (id) ids.push(id);
        }
    }
    return [...new Set(ids)];
}

function collectWikidataLabelIds(entities) {
    const properties = ['P31', 'P84', 'P1435', 'P112', 'P138', 'P127', 'P749'];
    return [...new Set(entities.flatMap((entity) => claimEntityIds(entity, properties)))];
}

function buildWikidataEntries(entity, labelMap = {}) {
    const label = getWikidataLabel(entity) || 'Linked place';
    const description = getWikidataDescription(entity);
    const url = getWikidataUrl(entity);
    const instanceLabels = labelEntities(entity, ['P31'], labelMap).slice(0, 2);
    const architectLabels = labelEntities(entity, ['P84'], labelMap).slice(0, 3);
    const heritageLabels = labelEntities(entity, ['P1435'], labelMap).slice(0, 3);
    const founderLabels = labelEntities(entity, ['P112'], labelMap).slice(0, 3);
    const namedAfterLabels = labelEntities(entity, ['P138'], labelMap).slice(0, 3);
    const officialNames = claimStringValues(entity, ['P1448', 'P1705', 'P2561']).slice(0, 4);
    const website = claimStringValues(entity, ['P856'])[0] || '';
    const inceptionYear = firstWikidataYear(entity, ['P571', 'P1619', 'P580']);
    const endYear = firstWikidataYear(entity, ['P576', 'P582']);

    const facts = [];
    if (description) facts.push(sentenceCase(description));
    if (instanceLabels.length) facts.push(`Type: ${instanceLabels.join(', ')}.`);
    if (officialNames.length) facts.push(`Recorded name${officialNames.length === 1 ? '' : 's'}: ${officialNames.join('; ')}.`);
    if (architectLabels.length) facts.push(`Architect: ${architectLabels.join(', ')}.`);
    if (founderLabels.length) facts.push(`Founder: ${founderLabels.join(', ')}.`);
    if (namedAfterLabels.length) facts.push(`Named after: ${namedAfterLabels.join(', ')}.`);
    if (heritageLabels.length) facts.push(`Heritage designation: ${heritageLabels.join(', ')}.`);
    if (website) facts.push(`Official website: ${website}.`);

    const entries = [];
    if (inceptionYear) {
        entries.push({
            title: `${label} — Wikidata inception`,
            summary: [`Wikidata records this place from ${inceptionYear}.`, ...facts].join(' '),
            source: SOURCE_WIKIDATA,
            sourceUrl: url,
            sourceType: 'archive',
            confidence: 'likely',
            yearStart: inceptionYear,
            yearEnd: endYear || null,
            preselected: true
        });
    } else if (facts.length > 0) {
        entries.push({
            title: `${label} — Wikidata facts`,
            summary: facts.join(' '),
            source: SOURCE_WIKIDATA,
            sourceUrl: url,
            sourceType: 'archive',
            confidence: 'likely',
            yearStart: null,
            yearEnd: null,
            preselected: false,
            saveable: false
        });
    }

    if (endYear && !inceptionYear) {
        entries.push({
            title: `${label} — Wikidata end date`,
            summary: `Wikidata records an end or closure date in ${endYear}.`,
            source: SOURCE_WIKIDATA,
            sourceUrl: url,
            sourceType: 'archive',
            confidence: 'likely',
            yearStart: endYear,
            yearEnd: null,
            preselected: true
        });
    }

    return entries;
}

function labelEntities(entity, propertyIds, labelMap) {
    return claimEntityIds(entity, propertyIds).map((id) => labelMap[id] || id);
}

/**
 * Get full Wikipedia summaries for search results (first 3).
 */
async function getWikipediaSummaries(searchResults) {
    const summaries = [];
    for (const sr of searchResults.slice(0, 3)) {
        const summary = await getWikipediaSummary(sr.title);
        if (summary && summary.extract) {
            summaries.push(summary);
        }
    }
    return summaries;
}

// ── 4. Building Age Estimation ────────────────────────────

/**
 * Estimate the likely building period from specific street-name clues.
 * Broad city/area patterns are intentionally excluded because they create
 * repetitive timeline entries for unrelated places.
 */
function estimateBuildingPeriod(address) {
    const road = (address.road || '').toLowerCase();
    if (!road) return [];

    // Victorian naming patterns
    if (/victoria|albert|prince|princess|queen|king|coronation|jubilee|gladstone|disraeli|tennyson/.test(road)) {
        return [{ era: 'Victorian', yearStart: 1837, yearEnd: 1901, reason: `"${address.road}" is a typical Victorian-era street name` }];
    }

    // Edwardian/early 20th century
    if (/edward|alexandra|empire|windsor/.test(road)) {
        return [{ era: 'Edwardian', yearStart: 1901, yearEnd: 1914, reason: `"${address.road}" suggests Edwardian-era development` }];
    }

    // Georgian naming
    if (/george|regent|crescent|square|terrace|parade|place(?!$)/.test(road)) {
        return [{ era: 'Georgian/Regency', yearStart: 1714, yearEnd: 1837, reason: `"${address.road}" uses Georgian-era naming conventions` }];
    }

    // Post-war estate naming
    if (/close|drive|way|avenue|grove|gardens|rise|crescent|court/.test(road) && !/old|church|hall/.test(road)) {
        return [{ era: 'Post-war', yearStart: 1945, yearEnd: 1970, reason: `"${address.road}" uses naming common in post-war housing developments` }];
    }

    // 1960s-80s naming
    if (/green|meadow|field|heath|dale|vale|mead|lea|wood/.test(road)) {
        return [{ era: 'Mid-20th century', yearStart: 1960, yearEnd: 1985, reason: `"${address.road}" uses pastoral naming typical of 1960s-80s estates` }];
    }

    return [];
}

// ── 5. Area Context Generator ─────────────────────────────

/**
 * Generate contextual info about the area even when no specific data exists.
 */
function generateAreaContext(address, wikiArticles) {
    const contexts = [];
    const city = address.city || address.town || '';
    const road = address.road || '';
    const suburb = address.suburb || '';

    // Street-level context
    if (road) {
        contexts.push({
            title: `${road} — Street History`,
            summary: `${road}${suburb ? `, ${suburb}` : ''}${city ? `, ${city}` : ''}. ` +
                `Research this street in local archives, historic maps, and census records to uncover its development history. ` +
                `Check old Ordnance Survey maps to see when buildings first appeared on this street.`,
            source: SOURCE_AREA_CONTEXT,
            sourceType: 'user',
            confidence: 'speculative',
            preselected: false,
            yearStart: null,
            yearEnd: null
        });
    }

    // Area-level context from Wikipedia search results
    for (const article of wikiArticles) {
        if (article.extract) {
            contexts.push({
                title: article.title,
                summary: article.extract,
                source: `Wikipedia`,
                sourceUrl: article.url || '',
                sourceType: 'archive',
                confidence: 'likely',
                yearStart: extractEarliestYear(article.extract),
                yearEnd: null
            });
        }
    }

    return contexts;
}

/**
 * Extract the earliest 4-digit year from a text string.
 */
function extractEarliestYear(text) {
    if (!text) return null;
    const years = text.match(/\b(1[0-9]{3}|20[0-2][0-9])\b/g);
    if (!years || years.length === 0) return null;
    return Math.min(...years.map(Number));
}

// ── MAIN: Combined Lookup ─────────────────────────────────

/**
 * Combine all sources into a unified place info object.
 * Always returns something useful, even for an unremarkable house.
 */
export async function lookupPlaceInfo(lat, lng, customName = '', selectedResult = null) {
    // Phase 1: Geocode + Overpass (parallel)
    const [geocode, nearby] = await Promise.all([
        reverseGeocode(lat, lng),
        queryNearbyFeatures(lat, lng)
    ]);

    const info = {
        address: geocode,
        features: nearby,
        suggestedName: '',
        suggestedNames: [],
        suggestedCategories: [],
        autoEntries: [],
        wikiSummary: null,
        wikiArticles: [],
        buildingClues: [],
        isLoading: false
    };

    if (!geocode) return info;

    // Determine the best name and alternative names
    const selectedSubject = normalizeSelectedResult(selectedResult);
    const names = [];
    if (customName) names.push(customName);
    if (selectedSubject?.placeName) names.push(selectedSubject.placeName);
    if (selectedSubject?.displayName) names.push(selectedSubject.displayName);

    const namedFeature = nearby.find(f => f.name);
    if (namedFeature?.name) names.push(namedFeature.name);

    if (geocode.placeName) names.push(geocode.placeName);

    // Address-based names
    if (geocode.road) {
        if (geocode.houseNumber) {
            names.push(`${geocode.houseNumber} ${geocode.road}`);
        }
        names.push(geocode.road);
    }

    // Short display name fallback
    if (geocode.displayName) {
        const parts = geocode.displayName.split(',').map(p => p.trim());
        if (parts.length > 0) names.push(parts.slice(0, 3).join(', '));
    }

    // Clean up and deduplicate names
    info.suggestedNames = [...new Set(names.filter(n => n && n.length > 0))];
    info.suggestedName = info.suggestedNames[0] || '';

    // Categories
    info.suggestedCategories = detectCategory(geocode, nearby, selectedSubject);

    // Build entries from direct OSM/Overpass evidence.
    info.autoEntries = buildAutoEntries(geocode, nearby, customName, selectedSubject);

    // Always include one deterministic seed entry from the exact selected location.
    const seedEntry = buildSeedEntry(geocode, customName, info.suggestedCategories[0] || '');
    if (seedEntry) {
        info.autoEntries.unshift(seedEntry);
    }

    const linkedSubjects = getLinkedSubjects(geocode, nearby, customName, selectedSubject);
    const wikidataEntities = await getWikidataEntities(linkedSubjects.map((subject) => subject.wikidata));
    const wikidataLabels = await getWikidataLabels(collectWikidataLabelIds(wikidataEntities));

    for (const entity of wikidataEntities) {
        const wikidataName = getWikidataLabel(entity);
        if (wikidataName) info.suggestedNames.push(wikidataName);
        const aliases = (entity.aliases?.en || []).map((alias) => alias.value).filter(Boolean);
        info.suggestedNames.push(...aliases.slice(0, 4));
        info.autoEntries.push(...buildWikidataEntries(entity, wikidataLabels));
    }

    // Only use direct Wikipedia links explicitly attached to OSM/Wikidata objects.
    // Avoid open Wikipedia search because it introduces high-noise, non-local matches.
    const directWikiRefs = [
        ...linkedSubjects.map((subject) => subject.wikipedia),
        ...wikidataEntities.map(getWikidataWikipediaRef)
    ].filter(Boolean);
    const wikiSummaries = [];
    for (const wikiRef of [...new Set(directWikiRefs)].slice(0, 3)) {
        const summary = await getWikipediaSummary(wikiRef);
        if (summary?.extract) wikiSummaries.push(summary);
    }

    info.wikiArticles = wikiSummaries;
    info.wikiSummary = wikiSummaries[0] || null;

    for (const summary of wikiSummaries) {
        info.autoEntries.push({
            title: summary.title,
            summary: summary.extract,
            source: SOURCE_WIKIPEDIA,
            sourceUrl: summary.url,
            sourceType: 'archive',
            confidence: 'likely',
            yearStart: extractEarliestYear(summary.extract),
            yearEnd: null,
            preselected: Boolean(extractEarliestYear(summary.extract)),
            saveable: Boolean(extractEarliestYear(summary.extract))
        });
    }

    // Building age estimation
    info.buildingClues = estimateBuildingPeriod(geocode);

    // Add building age entries
    for (const clue of info.buildingClues) {
        info.autoEntries.push({
            title: `Estimated: ${clue.era} development`,
            summary: clue.reason + '. This is an estimate based on local development patterns — verify with historic maps and local records.',
            source: SOURCE_BUILDING_ESTIMATE,
            sourceType: 'user',
            confidence: 'speculative',
            preselected: false,
            yearStart: clue.yearStart,
            yearEnd: clue.yearEnd
        });
    }

    info.autoEntries.push(...buildResearchPrompts(geocode, nearby, info.suggestedCategories[0] || ''));

    // De-duplicate entries by title
    const seen = new Set();
    info.autoEntries = info.autoEntries.filter(e => {
        const key = `${e.source || ''}|${e.title || ''}|${e.yearStart || ''}|${e.yearEnd || ''}`.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    info.suggestedNames = [...new Set(info.suggestedNames.filter(n => n && n.length > 0))];

    return info;
}

function buildSeedEntry(geocode, customName = '', category = '') {
    if (!geocode) return null;

    const addressParts = [
        geocode.houseNumber && geocode.road ? `${geocode.houseNumber} ${geocode.road}` : '',
        geocode.suburb || '',
        geocode.city || '',
        geocode.postcode || ''
    ].filter(Boolean);

    const placeLabel = customName || geocode.placeName || geocode.displayName || 'This location';
    const lines = [];
    if (addressParts.length > 0) {
        lines.push(`Address: ${addressParts.join(', ')}.`);
    } else if (geocode.fullAddress) {
        lines.push(`Address: ${geocode.fullAddress}.`);
    }
    if (category) {
        lines.push(`Current type: ${category}.`);
    }
    if (geocode.oldNames?.length) lines.push(`Also recorded as: ${geocode.oldNames.join('; ')}.`);
    if (geocode.officialName) lines.push(`Official name: ${geocode.officialName}.`);
    if (geocode.operator) lines.push(`Operator: ${geocode.operator}.`);
    if (geocode.website) lines.push(`Website: ${geocode.website}.`);
    if (geocode.wikidata) lines.push(`Wikidata: ${geocode.wikidata}.`);

    lines.push('Seed entry created from map/address data. Add dated historical evidence to refine this timeline.');

    return {
        title: `${placeLabel} — Current record`,
        summary: lines.join(' '),
        source: SOURCE_OSM,
        sourceUrl: geocode.website || '',
        sourceType: 'archive',
        confidence: 'likely',
        yearStart: new Date().getFullYear(),
        yearEnd: null
    };
}

// ── Helpers ───────────────────────────────────────────────

function detectCategory(geocode, nearby, selectedSubject = null) {
    const subjects = [selectedSubject, geocode, ...(nearby || [])].filter(Boolean);
    const categories = [];

    for (const subject of subjects) {
        const rawParts = [
            subject.category,
            subject.type,
            subject.amenity,
            subject.shop,
            subject.building,
            subject.tourism,
            subject.leisure,
            subject.historic,
            subject.heritage,
            subject.manMade,
            subject.man_made,
            subject.office,
            subject.highway,
            ...Object.entries(subject.allTags || {})
                .filter(([key]) => ['amenity', 'shop', 'building', 'tourism', 'leisure', 'historic', 'heritage', 'man_made', 'office', 'highway'].includes(key))
                .flatMap(([key, value]) => [key, value])
        ];
        const rawText = rawParts
            .filter(value => value && typeof value === 'string' && value !== 'yes' && value.toLowerCase() !== 'unclassified')
            .join(' ');
        if (!rawText.trim()) continue;

        const normalized = normalizePlaceCategory(rawText);
        if (normalized && normalized !== 'other') categories.push(normalized);
    }

    return [...new Set(categories)];
}

function buildAutoEntries(geocode, nearby, customName = '', selectedSubject = null) {
    const entries = [];
    const subjects = getEvidenceSubjects(geocode, nearby, customName, selectedSubject);

    for (const subject of subjects) {
        const entry = buildOsmEvidenceEntry(subject, customName);
        if (entry) {
            entries.push(entry);
        }
    }

    return entries;
}

function getEvidenceSubjects(geocode, nearby, customName = '', selectedSubject = null) {
    const subjects = [selectedSubject, geocode];
    for (const feature of nearby || []) {
        if (isRelevantNearbyFeature(feature, geocode, customName)) {
            subjects.push(feature);
        }
    }
    return dedupeSubjects(subjects);
}

function getLinkedSubjects(geocode, nearby, customName = '', selectedSubject = null) {
    return getEvidenceSubjects(geocode, nearby, customName, selectedSubject)
        .filter((subject) => subject?.wikidata || subject?.wikipedia);
}

function dedupeSubjects(subjects) {
    const seen = new Set();
    return subjects.filter((subject) => {
        if (!subject) return false;
        const key = `${subject.osmType || subject.type || 'item'}:${subject.osmId || subject.id || subject.name || subject.displayName || subject.wikidata || subject.wikipedia}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function isRelevantNearbyFeature(feature, geocode, customName = '') {
    if (!feature) return false;

    const featureName = normalizeName(feature.name || feature.officialName || '');
    const candidates = [
        customName,
        geocode.placeName,
        geocode.displayName,
        geocode.officialName,
        ...(geocode.oldNames || [])
    ].map(normalizeName).filter(Boolean);

    if (featureName && candidates.some((candidate) => namesLikelyMatch(featureName, candidate))) return true;
    if ((feature.wikidata || feature.wikipedia) && Number.isFinite(feature.distanceMeters) && feature.distanceMeters <= 12) return true;
    return false;
}

function buildOsmEvidenceEntry(subject, customName = '') {
    const label = customName || subject.name || subject.placeName || subject.displayName || subject.officialName || 'This location';
    const startDate = firstValue(subject.startDate, subject.openingDate, subject.allTags?.['building:start_date'], subject.allTags?.['construction:date']);
    const endDate = firstValue(subject.endDate, subject.allTags?.['demolished:date'], subject.allTags?.['disused:date']);
    const startYear = parseYear(startDate);
    const endYear = parseYear(endDate);
    const sourceUrl = subject.website || wikidataUrlFromId(subject.wikidata) || wikipediaUrlFromRef(subject.wikipedia) || '';
    const facts = [];

    if (startDate) facts.push(`OSM records start/opening date: ${startDate}.`);
    if (endDate) facts.push(`OSM records end/closure date: ${endDate}.`);
    if (subject.description) facts.push(sentenceCase(subject.description));
    if (subject.historic) facts.push(`Historic tag: ${subject.historic}.`);
    if (subject.heritage) facts.push(`Heritage tag: ${subject.heritage}.`);
    if (subject.architect) facts.push(`Architect: ${subject.architect}.`);
    if (subject.style) facts.push(`Architectural style: ${subject.style}.`);
    if (subject.denomination) facts.push(`${subject.denomination} ${subject.religion || ''}.`.trim());
    if (subject.building && subject.building !== 'yes') facts.push(`Building type: ${subject.building}.`);
    if (subject.levels) facts.push(`${subject.levels} storey(s).`);
    if (subject.material) facts.push(`Built with ${subject.material}.`);
    if (subject.cuisine) facts.push(`Cuisine: ${subject.cuisine}.`);
    if (subject.operator) facts.push(`Operator: ${subject.operator}.`);
    if (subject.officialName) facts.push(`Official name: ${subject.officialName}.`);
    if (subject.oldNames?.length) facts.push(`Alternate or former name${subject.oldNames.length === 1 ? '' : 's'}: ${subject.oldNames.join('; ')}.`);
    if (subject.wikidata) facts.push(`Linked Wikidata item: ${subject.wikidata}.`);
    if (subject.wikipedia) facts.push(`Linked Wikipedia article: ${subject.wikipedia}.`);

    if (facts.length === 0) return null;

    return {
        title: startYear ? `${label} — OSM dated evidence` : `${label} — OSM evidence`,
        summary: facts.join(' '),
        source: SOURCE_OSM,
        sourceUrl,
        sourceType: subject.historic || subject.heritage || startYear ? 'archive' : 'user',
        confidence: subject.historic || subject.heritage ? 'verified' : 'likely',
        yearStart: startYear || null,
        yearEnd: endYear || null,
        preselected: Boolean(startYear),
        saveable: Boolean(startYear)
    };
}

function normalizeSelectedResult(result) {
    if (!result) return null;
    return {
        ...result,
        name: result.placeName || result.displayName || '',
        distanceMeters: 0
    };
}

function buildSummary(geocode) {
    const parts = [];
    if (geocode.description) parts.push(geocode.description);
    if (geocode.architect) parts.push(`Designed by ${geocode.architect}.`);
    if (geocode.heritage) parts.push(`Heritage designation: ${geocode.heritage}.`);
    if (geocode.building && geocode.building !== 'yes') parts.push(`Building type: ${geocode.building}.`);
    if (geocode.cuisine) parts.push(`Cuisine: ${geocode.cuisine}.`);
    if (geocode.operator) parts.push(`Operated by ${geocode.operator}.`);
    if (geocode.openingHours) parts.push(`Hours: ${geocode.openingHours}.`);
    if (geocode.website) parts.push(`Website: ${geocode.website}`);
    return parts.join(' ') || `Located at ${geocode.fullAddress || geocode.displayName}.`;
}

function parseYear(dateStr) {
    if (!dateStr) return null;
    const match = dateStr.match(/\d{4}/);
    return match ? parseInt(match[0]) : null;
}

function buildResearchPrompts(geocode, nearby, category = '') {
    const prompts = [];
    const city = geocode.city || '';
    const road = geocode.road || '';
    const typeText = getPlaceTypeText(geocode, nearby, category);

    if (road) {
        const links = buildCommonResearchLinks(geocode, 'maps');
        prompts.push({
            title: `${road} — map and directory check`,
            summary: `Check old Ordnance Survey maps, street directories, census returns, and electoral registers to establish when this site first appears and how its use changed.`,
            links
        });
    }

    if (/blackpool/i.test(city)) {
        const links = [
            { label: 'History Centre', url: 'https://www.blackpool.gov.uk/Residents/Libraries-arts-and-heritage/History-centre/History-Centre.aspx' },
            ...buildCommonResearchLinks(geocode, 'blackpool')
        ];
        prompts.push({
            title: 'Blackpool local sources',
            summary: 'Useful next checks: Blackpool local studies collections, Lancashire Archives, British Newspaper Archive, historic OS maps, Kelly directories, and planning/listed-building records.',
            links
        });
    }

    if (/heritage|historic|monument|memorial|castle|listed/.test(typeText)) {
        const links = [
            { label: 'Historic England', url: 'https://historicengland.org.uk/listing/the-list/' },
            ...buildCommonResearchLinks(geocode, 'heritage')
        ];
        prompts.push({
            title: 'Heritage listing check',
            summary: 'Look for a statutory listing, local heritage record, Historic England entry, conservation-area note, or local Historic Environment Record reference.',
            links
        });
    }

    if (/pub|bar|hotel|guest house|restaurant|cafe|commercial|shop|retail/.test(typeText)) {
        prompts.push({
            title: 'Trade and licence records',
            summary: 'Check trade directories, licensing registers, newspaper adverts, and historic photographs for business names, licensees, owners, and name changes.',
            links: buildCommonResearchLinks(geocode, 'trade directories')
        });
    }

    if (/church|chapel|place of worship|religion|religious/.test(typeText)) {
        prompts.push({
            title: 'Church and chapel records',
            summary: 'Check foundation or consecration dates, denomination archives, parish magazines, registers, architects, and any war memorial or rebuilding records.',
            links: buildCommonResearchLinks(geocode, 'church records')
        });
    }

    if (/school|college|education/.test(typeText)) {
        prompts.push({
            title: 'School records',
            summary: 'Check local education authority records, school log books, admission registers, newspaper opening reports, and map evidence for later extensions.',
            links: buildCommonResearchLinks(geocode, 'school records')
        });
    }

    if (/station|railway|tram|transport|bus/.test(typeText)) {
        prompts.push({
            title: 'Transport records',
            summary: 'Check opening and closure dates in railway or tramway histories, timetables, company records, newspaper reports, and OS map revisions.',
            links: buildCommonResearchLinks(geocode, 'transport history')
        });
    }

    if (/cinema|theatre|music venue|arts centre|entertainment/.test(typeText)) {
        prompts.push({
            title: 'Entertainment venue records',
            summary: 'Check opening programmes, newspaper adverts, architects, ownership changes, seating capacity, closure dates, and later reuse of the building.',
            links: buildCommonResearchLinks(geocode, 'cinema theatre history')
        });
    }

    if (/factory|works|mill|warehouse|industrial|manufacturing/.test(typeText)) {
        prompts.push({
            title: 'Industrial site records',
            summary: 'Check trade directories, insurance maps, company records, planning files, newspaper reports, and OS maps for changes in buildings and use.',
            links: buildCommonResearchLinks(geocode, 'industrial history')
        });
    }

    if (/residential|house|apartments|terrace|detached|semi/.test(typeText)) {
        prompts.push({
            title: 'Residential history checks',
            summary: 'Check census returns, electoral registers, street directories, probate notices, deeds, and OS maps to build a resident and building chronology.',
            links: buildCommonResearchLinks(geocode, 'residential history')
        });
    }

    const currentYear = new Date().getFullYear();

    return dedupePromptSpecs(prompts).map((prompt) => {
        const researchLinks = dedupeResearchLinks(prompt.links || buildCommonResearchLinks(geocode));
        const sourceUrl = researchLinks[0]?.url || '';
        const savedLinks = researchLinks.length > 0
            ? ` Research links: ${researchLinks.map((link) => `${link.label}: ${link.url}`).join('; ')}.`
            : '';

        return {
            title: `Research lead: ${prompt.title}`,
            summary: `${prompt.summary} Saved as a working research note; replace it with dated evidence once confirmed.${savedLinks}`,
            source: SOURCE_RESEARCH_PROMPT,
            sourceUrl,
            researchLinks,
            sourceType: 'user',
            confidence: 'speculative',
            yearStart: currentYear,
            yearEnd: null,
            preselected: false
        };
    });
}

function getPlaceTypeText(geocode, nearby, category = '') {
    const tokens = [
        category,
        geocode.category,
        geocode.type,
        geocode.building,
        geocode.historic,
        geocode.heritage,
        ...(nearby || []).flatMap((feature) => [
            feature.amenity,
            feature.building,
            feature.historic,
            feature.heritage,
            feature.type,
            feature.name
        ])
    ];

    return tokens.filter(Boolean).join(' ').replace(/_/g, ' ').toLowerCase();
}

function dedupePromptSpecs(prompts) {
    const seen = new Set();
    return prompts.filter((prompt) => {
        const key = prompt.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function buildCommonResearchLinks(geocode, focus = '') {
    const placeQuery = researchQuery(geocode);
    const focusedQuery = [placeQuery, focus].filter(Boolean).join(' ');
    const links = [];

    if (placeQuery) {
        links.push({ label: 'Historic maps', url: historicMapSearchUrl(geocode) });
        links.push({ label: 'Newspapers', url: `https://www.britishnewspaperarchive.co.uk/search/results?basicsearch=${encodeURIComponent(placeQuery)}` });
        links.push({ label: 'Web search', url: `https://www.google.com/search?q=${encodeURIComponent(focusedQuery || placeQuery)}` });
    }

    if (/blackpool/i.test(geocode.city || geocode.town || '')) {
        links.push({ label: 'Lancashire Archives', url: `https://archivecat.lancashire.gov.uk/calmview/Overview.aspx` });
    }

    return dedupeResearchLinks(links);
}

function dedupeResearchLinks(links) {
    const seen = new Set();
    return (links || [])
        .filter((link) => link?.label && link?.url)
        .filter((link) => {
            const key = `${link.label}|${link.url}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        })
        .slice(0, 4);
}

function researchQuery(geocode) {
    return [
        geocode.placeName,
        geocode.officialName,
        geocode.houseNumber && geocode.road ? `${geocode.houseNumber} ${geocode.road}` : geocode.road,
        geocode.city,
        geocode.postcode
    ].filter(Boolean).join(' ');
}

function historicMapSearchUrl(geocode) {
    const query = researchQuery(geocode);
    return query ? `https://maps.nls.uk/geo/find/#q=${encodeURIComponent(query)}` : 'https://maps.nls.uk/geo/find/';
}

function collectTagValues(tags, keys) {
    const values = [];
    for (const key of keys) {
        const value = tags?.[key];
        if (!value) continue;
        values.push(...String(value).split(';').map((part) => part.trim()).filter(Boolean));
    }
    return [...new Set(values)];
}

function firstValue(...values) {
    return values.find((value) => value !== undefined && value !== null && String(value).trim() !== '') || '';
}

function normalizeName(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/&/g, 'and')
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

function namesLikelyMatch(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    if (a.length < 4 || b.length < 4) return false;
    return a.includes(b) || b.includes(a);
}

function distanceMetres(latA, lngA, latB, lngB) {
    if (![latA, lngA, latB, lngB].every(Number.isFinite)) return null;

    const earthRadius = 6371000;
    const toRad = (deg) => deg * Math.PI / 180;
    const dLat = toRad(latB - latA);
    const dLng = toRad(lngB - lngA);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(latA)) * Math.cos(toRad(latB)) * Math.sin(dLng / 2) ** 2;
    return earthRadius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function wikidataUrlFromId(id) {
    const qid = normalizeWikidataId(id);
    return qid ? `https://www.wikidata.org/wiki/${qid}` : '';
}

function wikipediaUrlFromRef(ref) {
    if (!ref) return '';
    const parts = String(ref).split(':');
    const lang = parts.length > 1 ? parts[0] : 'en';
    const title = parts.length > 1 ? parts.slice(1).join(':') : parts[0];
    return `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/\s+/g, '_'))}`;
}

function sentenceCase(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return '';
    const sentence = trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
    return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}
