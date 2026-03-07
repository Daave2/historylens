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
                osmType: item.osm_type
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
            architect: extra.architect || '',
            heritage: extra.heritage || '',
            description: extra.description || '',
            building: addr.building || extra.building || '',
            cuisine: extra.cuisine || '',
            operator: extra.operator || '',
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

        return (data.elements || []).map(el => ({
            id: el.id,
            type: el.type,
            name: el.tags?.name || '',
            amenity: el.tags?.amenity || '',
            building: el.tags?.building || '',
            historic: el.tags?.historic || '',
            heritage: el.tags?.heritage || '',
            description: el.tags?.description || '',
            startDate: el.tags?.['start_date'] || '',
            endDate: el.tags?.['end_date'] || '',
            architect: el.tags?.architect || '',
            website: el.tags?.website || '',
            wikipedia: el.tags?.wikipedia || '',
            wikidata: el.tags?.wikidata || '',
            cuisine: el.tags?.cuisine || '',
            operator: el.tags?.operator || '',
            openingHours: el.tags?.opening_hours || '',
            denomination: el.tags?.denomination || '',
            religion: el.tags?.religion || '',
            style: el.tags?.['architect:style'] || el.tags?.['building:architecture'] || '',
            levels: el.tags?.['building:levels'] || '',
            material: el.tags?.['building:material'] || '',
            allTags: el.tags || {}
        }));
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
 * Estimate the likely building period based on UK patterns.
 * Uses street name style, postcode area, and typical development patterns.
 * Returns only the single most specific estimation.
 */
function estimateBuildingPeriod(address) {
    const road = (address.road || '').toLowerCase();
    const suburb = (address.suburb || '').toLowerCase();
    const city = (address.city || '').toLowerCase();

    // Blackpool-specific development (most specific regional rules first)
    if (city.includes('blackpool')) {
        if (/promenade|north shore|south shore|claremont|dickson|talbot/.test(`${road} ${suburb}`)) {
            return [{ era: 'Victorian resort', yearStart: 1860, yearEnd: 1910, reason: 'This area of Blackpool was developed during the Victorian seaside resort boom' }];
        }
        if (road) {
            return [{ era: 'Blackpool development', yearStart: 1850, yearEnd: 1920, reason: 'Blackpool grew rapidly as a seaside resort from the 1850s onwards, with most residential streets built between 1870-1920' }];
        }
    }

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

    // Default: estimate from typical UK suburban patterns
    return [{ era: 'Estimated', yearStart: 1880, yearEnd: 1930, reason: 'Typical UK terraced/semi-detached housing from this period' }];
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
            source: 'HistoryLens — area context',
            sourceType: 'user',
            confidence: 'speculative',
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
export async function lookupPlaceInfo(lat, lng, customName = '') {
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
    const names = [];
    if (customName) names.push(customName);

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
    info.suggestedCategories = detectCategory(geocode, nearby);

    // Build entries from OSM/Overpass (filtered by customName to reduce noise)
    info.autoEntries = buildAutoEntries(geocode, nearby, customName);

    // Phase 2: Wikipedia + building estimation (parallel)
    // Build search queries from location context. Keep it highly specific to avoid generic city-wide noise.
    const searchQueries = [];
    const targetName = customName || info.suggestedName;

    if (targetName && geocode.city) searchQueries.push(`${targetName} ${geocode.city}`);
    if (targetName && geocode.suburb) searchQueries.push(`${targetName} ${geocode.suburb}`);
    if (geocode.road && geocode.city && !targetName.includes(geocode.road)) searchQueries.push(`${geocode.road} ${geocode.city}`);

    // Linked Wikipedia article (direct link from OSM)
    const directWikiRef = geocode.wikipedia || nearby.find(f => f.wikipedia)?.wikipedia;

    const [wikiSearchResults, directSummary] = await Promise.all([
        searchWikipedia(searchQueries),
        directWikiRef ? getWikipediaSummary(directWikiRef) : Promise.resolve(null)
    ]);

    // Get full summaries for the most relevant search results
    const wikiSummaries = await getWikipediaSummaries(
        wikiSearchResults.filter(r =>
            // Filter for relevant results (must match city/road/name to avoid random noise)
            r.snippet.toLowerCase().includes((geocode.city || '').toLowerCase()) ||
            r.snippet.toLowerCase().includes((geocode.road || '').toLowerCase()) ||
            r.snippet.toLowerCase().includes((geocode.suburb || '').toLowerCase()) ||
            r.snippet.toLowerCase().includes((targetName || '').toLowerCase())
        )
    );

    info.wikiArticles = wikiSummaries;

    // Direct Wikipedia link gets priority
    if (directSummary) {
        info.wikiSummary = directSummary;
        info.autoEntries.push({
            title: directSummary.title,
            summary: directSummary.extract,
            source: 'Wikipedia',
            sourceUrl: directSummary.url,
            sourceType: 'archive',
            confidence: 'likely',
            yearStart: extractEarliestYear(directSummary.extract),
            yearEnd: null
        });
    }

    // Building age estimation
    info.buildingClues = estimateBuildingPeriod(geocode);

    // Add building age entries
    for (const clue of info.buildingClues) {
        info.autoEntries.push({
            title: `Estimated: ${clue.era} development`,
            summary: clue.reason + '. This is an estimate based on local development patterns — verify with historic maps and local records.',
            source: 'HistoryLens — building age estimation',
            sourceType: 'user',
            confidence: 'speculative',
            yearStart: clue.yearStart,
            yearEnd: clue.yearEnd
        });
    }

    // Add highly specific Wikipedia search results (if any matched our strict filters)
    for (const article of wikiSummaries) {
        if (article.extract && article.title.length > 0) {
            info.autoEntries.push({
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

    // De-duplicate entries by title
    const seen = new Set();
    info.autoEntries = info.autoEntries.filter(e => {
        const key = e.title.toLowerCase();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });

    return info;
}

// ── Helpers ───────────────────────────────────────────────

function detectCategory(geocode, nearby) {
    // Collect all raw types/amenities related to this location
    const rawTypes = [
        geocode.type,
        geocode.category,
        ...nearby.map(f => f.amenity),
        ...nearby.map(f => f.building)
    ];

    const cleanTypes = rawTypes
        .filter(t => t && typeof t === 'string' && t !== 'yes' && t.toLowerCase() !== 'unclassified')
        .map(t => t.replace(/_/g, ' ')) // Convert guest_house to guest house
        .map(t => t.charAt(0).toUpperCase() + t.slice(1).toLowerCase()); // Title case

    // Remove duplicates
    return [...new Set(cleanTypes)].filter(t => t.length > 2);
}

function buildAutoEntries(geocode, nearby, customName = '') {
    const entries = [];

    // The target name to match against (either user-provided or from geocode)
    const targetName = (customName || geocode.placeName || '').toLowerCase().trim();

    // From geocode extra data (this is the specific property we clicked on)
    if (geocode.description || geocode.startDate) {
        entries.push({
            title: customName || geocode.placeName || geocode.displayName || 'This location',
            summary: buildSummary(geocode),
            source: geocode.website || 'OpenStreetMap',
            sourceType: 'archive',
            confidence: 'likely',
            yearStart: parseYear(geocode.startDate) || null,
            yearEnd: null
        });
    }

    // From nearby features — ONLY include if it matches the target name exactly 
    // This removes the "90% irrelevant spam" (bus stops, other random shops)
    if (targetName) {
        for (const feat of nearby) {
            if (!feat.name) continue;

            // Skip if it's literally the geocode object we already processed above
            if (feat.name === geocode.placeName) continue;

            // Only include if the name is a very close match
            if (feat.name.toLowerCase().trim().includes(targetName) || targetName.includes(feat.name.toLowerCase().trim())) {
                const summary = [];
                if (feat.description) summary.push(feat.description);
                if (feat.historic) summary.push(`Historic ${feat.historic}.`);
                if (feat.architect) summary.push(`Designed by ${feat.architect}.`);
                if (feat.style) summary.push(`Architectural style: ${feat.style}.`);
                if (feat.denomination) summary.push(`${feat.denomination} ${feat.religion || ''}.`.trim());
                if (feat.building && feat.building !== 'yes') summary.push(`Building type: ${feat.building}.`);
                if (feat.levels) summary.push(`${feat.levels} storey(s).`);
                if (feat.material) summary.push(`Built with ${feat.material}.`);
                if (feat.cuisine) summary.push(`Cuisine: ${feat.cuisine}.`);
                if (feat.operator) summary.push(`Operated by ${feat.operator}.`);

                if (summary.length > 0 || feat.name) {
                    entries.push({
                        title: feat.name,
                        summary: summary.join(' ') || `${feat.name} located at this site.`,
                        source: feat.website || feat.wikipedia || 'OpenStreetMap',
                        sourceType: feat.historic ? 'archive' : 'user',
                        confidence: feat.historic || feat.heritage ? 'verified' : 'likely',
                        yearStart: parseYear(feat.startDate) || null,
                        yearEnd: parseYear(feat.endDate) || null
                    });
                }
            }
        }
    }

    return entries;
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
