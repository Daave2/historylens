import {
    addImage,
    addPlaceNameAlias,
    createPlace,
    createTimeEntry,
    getImagesForEntry,
    getPlacesByProject,
    getProject,
    getTimeEntriesForPlace
} from './store.js';

/**
 * Export an entire project as a JSON bundle backed by live Supabase data.
 */
export async function exportProject(projectId) {
    const project = await getProject(projectId);
    if (!project) throw new Error('Project not found');

    const places = await getPlacesByProject(projectId);
    const bundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        project: {
            id: project.id,
            name: project.name,
            description: project.description || '',
            centre: project.centre,
            defaultZoom: project.defaultZoom,
            isPublic: project.isPublic
        },
        places: []
    };

    for (const place of places) {
        const entries = await getTimeEntriesForPlace(place.id);
        const exportedEntries = [];

        for (const entry of entries) {
            const images = await getImagesForEntry(entry.id, { includeUnapproved: true });
            const exportedImages = await Promise.all(images.map(async (image) => {
                const exported = {
                    id: image.id,
                    caption: image.caption || '',
                    yearTaken: image.yearTaken ?? null,
                    credit: image.credit || '',
                    moderationStatus: image.moderationStatus || 'approved',
                    publicUrl: image.publicUrl || ''
                };

                if (image.publicUrl) {
                    try {
                        exported.data = await urlToDataUrl(image.publicUrl);
                    } catch (err) {
                        console.warn('Could not inline image for export:', err);
                    }
                }

                return exported;
            }));

            exportedEntries.push({
                id: entry.id,
                yearStart: entry.yearStart,
                yearEnd: entry.yearEnd ?? null,
                title: entry.title || '',
                summary: entry.summary || '',
                source: entry.source || '',
                sourceType: entry.sourceType || 'user',
                confidence: entry.confidence || 'likely',
                images: exportedImages
            });
        }

        bundle.places.push({
            id: place.id,
            name: place.name || 'Unnamed Place',
            description: place.description || '',
            lat: place.lat,
            lng: place.lng,
            category: place.category || 'residential',
            aliases: (place.aliases || []).map((alias) => ({
                id: alias.id,
                alias: alias.alias,
                startYear: alias.startYear ?? null,
                endYear: alias.endYear ?? null,
                note: alias.note || ''
            })),
            entries: exportedEntries
        });
    }

    return bundle;
}

/**
 * Import a project bundle into a live Supabase-backed project.
 * Merges data conservatively and leaves existing records untouched.
 */
export async function importBundle(bundle, { targetProjectId = null } = {}) {
    if (!bundle || bundle.version !== 1) {
        throw new Error('Invalid or unsupported bundle format');
    }

    const destinationProjectId = targetProjectId || bundle.project?.id;
    if (!destinationProjectId) {
        throw new Error('No target project selected for import');
    }

    const destinationProject = await getProject(destinationProjectId);
    if (!destinationProject) {
        throw new Error('Target project not found');
    }

    const existingPlaces = await getPlacesByProject(destinationProjectId);
    let placesImported = 0;
    let entriesImported = 0;
    let aliasesImported = 0;
    let imagesImported = 0;

    for (const placeData of bundle.places || []) {
        const place = normalizeImportedPlace(placeData);
        if (!place) continue;

        let targetPlace = findMatchingPlace(existingPlaces, place);
        if (!targetPlace) {
            targetPlace = await createPlace({
                projectId: destinationProjectId,
                name: place.name,
                description: place.description,
                lat: place.lat,
                lng: place.lng,
                category: place.category
            });
            existingPlaces.push(targetPlace);
            placesImported += 1;
        }

        const knownAliases = [...(targetPlace.aliases || [])];
        for (const aliasData of place.aliases) {
            if (!aliasData.alias || findMatchingAlias(knownAliases, aliasData)) continue;
            try {
                const createdAlias = await addPlaceNameAlias({
                    placeId: targetPlace.id,
                    projectId: destinationProjectId,
                    alias: aliasData.alias,
                    startYear: aliasData.startYear,
                    endYear: aliasData.endYear,
                    note: aliasData.note
                });
                knownAliases.push(createdAlias);
                aliasesImported += 1;
            } catch (err) {
                if (!isDuplicateError(err)) throw err;
            }
        }

        const existingEntries = await getTimeEntriesForPlace(targetPlace.id);
        for (const entryData of place.entries) {
            const entry = normalizeImportedEntry(entryData);
            if (!entry) continue;

            let targetEntry = findMatchingEntry(existingEntries, entry);
            if (!targetEntry) {
                targetEntry = await createTimeEntry({
                    placeId: targetPlace.id,
                    yearStart: entry.yearStart,
                    yearEnd: entry.yearEnd,
                    title: entry.title,
                    summary: entry.summary,
                    source: entry.source,
                    sourceType: entry.sourceType,
                    confidence: entry.confidence
                });
                existingEntries.push(targetEntry);
                entriesImported += 1;
            }

            const existingImages = await getImagesForEntry(targetEntry.id, { includeUnapproved: true });
            for (const imageData of entry.images) {
                const image = normalizeImportedImage(imageData);
                if (!image || findMatchingImage(existingImages, image)) continue;

                const blob = image.data
                    ? base64ToBlob(image.data)
                    : await fetchImageBlob(image.publicUrl);
                if (!blob) continue;

                const createdImage = await addImage({
                    timeEntryId: targetEntry.id,
                    blob,
                    caption: image.caption,
                    yearTaken: image.yearTaken,
                    credit: image.credit,
                    moderationStatus: image.moderationStatus
                });
                existingImages.push(createdImage);
                imagesImported += 1;
            }
        }
    }

    const refreshedProject = await getPlaceImportSummary(destinationProjectId);
    return {
        projectId: destinationProjectId,
        projectName: destinationProject.name,
        placesImported,
        entriesImported,
        aliasesImported,
        imagesImported,
        totalPlaces: refreshedProject.totalPlaces
    };
}

/**
 * Export the current project as CSV from live Supabase data.
 */
export async function exportCSV(projectId) {
    const places = await getPlacesByProject(projectId);
    const rows = [[
        'Place',
        'Category',
        'Lat',
        'Lng',
        'Year Start',
        'Year End',
        'Title',
        'Summary',
        'Source',
        'Confidence'
    ]];

    for (const place of places) {
        const entries = await getTimeEntriesForPlace(place.id);
        if (entries.length === 0) {
            rows.push([
                place.name,
                place.category,
                place.lat,
                place.lng,
                '',
                '',
                '',
                '',
                '',
                ''
            ]);
            continue;
        }

        for (const entry of entries) {
            rows.push([
                place.name,
                place.category,
                place.lat,
                place.lng,
                entry.yearStart,
                entry.yearEnd || '',
                entry.title,
                entry.summary,
                entry.source,
                entry.confidence
            ]);
        }
    }

    return rows
        .map((row) => row.map((cell) => `"${String(cell ?? '').replace(/"/g, '""')}"`).join(','))
        .join('\n');
}

/**
 * Trigger a file download in the browser.
 */
export function downloadFile(content, filename, type = 'application/json') {
    const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
}

/**
 * Read a file chosen by the user and parse it as JSON.
 */
export function readFileAsJSON() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.historylens.json';
        input.onchange = async (event) => {
            const file = event.target.files?.[0];
            if (!file) return reject(new Error('No file selected'));
            try {
                const text = await file.text();
                resolve(JSON.parse(text));
            } catch (err) {
                reject(new Error(`Failed to parse file: ${err.message}`));
            }
        };
        input.click();
    });
}

async function getPlaceImportSummary(projectId) {
    const places = await getPlacesByProject(projectId);
    return { totalPlaces: places.length };
}

function normalizeImportedPlace(placeData) {
    if (!placeData) return null;

    const lat = toFiniteNumber(placeData.lat);
    const lng = toFiniteNumber(placeData.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;

    return {
        id: placeData.id || '',
        name: String(placeData.name || 'Unnamed Place').trim() || 'Unnamed Place',
        description: String(placeData.description || '').trim(),
        lat,
        lng,
        category: String(placeData.category || 'residential').trim() || 'residential',
        aliases: (placeData.aliases || []).map(normalizeImportedAlias).filter(Boolean),
        entries: (placeData.entries || []).map(normalizeImportedEntry).filter(Boolean)
    };
}

function normalizeImportedAlias(aliasData) {
    if (!aliasData) return null;
    const alias = String(aliasData.alias || aliasData.name || '').trim();
    if (!alias) return null;

    return {
        alias,
        startYear: toOptionalInt(aliasData.startYear ?? aliasData.start_year),
        endYear: toOptionalInt(aliasData.endYear ?? aliasData.end_year),
        note: String(aliasData.note || '').trim()
    };
}

function normalizeImportedEntry(entryData) {
    if (!entryData) return null;
    const yearStart = toOptionalInt(entryData.yearStart ?? entryData.year_start);
    if (!Number.isFinite(yearStart)) return null;

    return {
        id: entryData.id || '',
        yearStart,
        yearEnd: toOptionalInt(entryData.yearEnd ?? entryData.year_end),
        title: String(entryData.title || '').trim(),
        summary: String(entryData.summary || '').trim(),
        source: String(entryData.source || '').trim(),
        sourceType: String(entryData.sourceType || entryData.source_type || 'user').trim() || 'user',
        confidence: String(entryData.confidence || 'likely').trim() || 'likely',
        images: (entryData.images || []).map(normalizeImportedImage).filter(Boolean)
    };
}

function normalizeImportedImage(imageData) {
    if (!imageData) return null;

    return {
        id: imageData.id || '',
        caption: String(imageData.caption || '').trim(),
        yearTaken: toOptionalInt(imageData.yearTaken ?? imageData.year_taken),
        credit: String(imageData.credit || '').trim(),
        moderationStatus: String(imageData.moderationStatus || imageData.moderation_status || 'approved').trim() || 'approved',
        publicUrl: String(imageData.publicUrl || imageData.url || '').trim(),
        data: typeof imageData.data === 'string' ? imageData.data : ''
    };
}

function findMatchingPlace(existingPlaces, importedPlace) {
    return existingPlaces.find((place) => {
        if (place.id && importedPlace.id && place.id === importedPlace.id) return true;
        const sameName = normalizeText(place.name) === normalizeText(importedPlace.name);
        const sameCoords = approxEqual(place.lat, importedPlace.lat) && approxEqual(place.lng, importedPlace.lng);
        return sameName && sameCoords;
    }) || null;
}

function findMatchingAlias(existingAliases, importedAlias) {
    return existingAliases.find((alias) => (
        normalizeText(alias.alias) === normalizeText(importedAlias.alias)
        && toOptionalInt(alias.startYear) === toOptionalInt(importedAlias.startYear)
        && toOptionalInt(alias.endYear) === toOptionalInt(importedAlias.endYear)
    )) || null;
}

function findMatchingEntry(existingEntries, importedEntry) {
    return existingEntries.find((entry) => (
        toOptionalInt(entry.yearStart) === toOptionalInt(importedEntry.yearStart)
        && toOptionalInt(entry.yearEnd) === toOptionalInt(importedEntry.yearEnd)
        && normalizeText(entry.title) === normalizeText(importedEntry.title)
        && normalizeText(entry.summary) === normalizeText(importedEntry.summary)
        && normalizeText(entry.source) === normalizeText(importedEntry.source)
    )) || null;
}

function findMatchingImage(existingImages, importedImage) {
    return existingImages.find((image) => (
        normalizeText(image.caption) === normalizeText(importedImage.caption)
        && toOptionalInt(image.yearTaken) === toOptionalInt(importedImage.yearTaken)
        && normalizeText(image.credit) === normalizeText(importedImage.credit)
    )) || null;
}

function isDuplicateError(error) {
    return error?.code === '23505' || /duplicate/i.test(error?.message || '');
}

function toFiniteNumber(value) {
    const number = Number(value);
    return Number.isFinite(number) ? number : Number.NaN;
}

function toOptionalInt(value) {
    if (value === null || value === undefined || value === '') return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : null;
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function approxEqual(a, b, tolerance = 0.000001) {
    return Math.abs(Number(a) - Number(b)) <= tolerance;
}

async function fetchImageBlob(url) {
    if (!url) return null;
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`Failed to fetch image: ${response.status}`);
    }
    return response.blob();
}

async function urlToDataUrl(url) {
    const blob = await fetchImageBlob(url);
    return blobToBase64(blob);
}

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function base64ToBlob(dataUrl) {
    const parts = String(dataUrl || '').split(',');
    if (parts.length < 2) return null;

    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
    const b64 = atob(parts[1]);
    const bytes = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i += 1) {
        bytes[i] = b64.charCodeAt(i);
    }
    return new Blob([bytes], { type: mime });
}
