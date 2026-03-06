import db from './db.js';

/**
 * Export entire project as a JSON bundle (places, entries, images as base64).
 */
export async function exportProject(projectId) {
    const project = await db.projects.get(projectId);
    if (!project) throw new Error('Project not found');

    const places = await db.places.where('projectId').equals(projectId).toArray();
    const bundle = {
        version: 1,
        exportedAt: new Date().toISOString(),
        project,
        places: []
    };

    for (const place of places) {
        const entries = await db.timeEntries.where('placeId').equals(place.id).toArray();
        const entriesWithImages = [];

        for (const entry of entries) {
            const images = await db.images.where('timeEntryId').equals(entry.id).toArray();
            const imagesBase64 = [];

            for (const img of images) {
                let base64 = null;
                if (img.blob) {
                    base64 = await blobToBase64(img.blob);
                }
                imagesBase64.push({
                    id: img.id,
                    caption: img.caption,
                    yearTaken: img.yearTaken,
                    credit: img.credit,
                    data: base64
                });
            }

            entriesWithImages.push({
                ...entry,
                images: imagesBase64
            });
        }

        bundle.places.push({
            ...place,
            entries: entriesWithImages
        });
    }

    return bundle;
}

/**
 * Import a project bundle (merges data — does not overwrite existing).
 */
export async function importBundle(bundle) {
    if (!bundle || bundle.version !== 1) {
        throw new Error('Invalid or unsupported bundle format');
    }

    // Upsert project
    const existing = await db.projects.get(bundle.project.id);
    if (!existing) {
        await db.projects.add(bundle.project);
    }

    let placesImported = 0;
    let entriesImported = 0;

    for (const placeData of bundle.places) {
        const { entries, ...place } = placeData;
        const existingPlace = await db.places.get(place.id);
        if (!existingPlace) {
            await db.places.add(place);
            placesImported++;
        }

        for (const entryData of entries) {
            const { images, ...entry } = entryData;
            const existingEntry = await db.timeEntries.get(entry.id);
            if (!existingEntry) {
                await db.timeEntries.add(entry);
                entriesImported++;
            }

            for (const imgData of images) {
                const existingImg = await db.images.get(imgData.id);
                if (!existingImg) {
                    let blob = null;
                    if (imgData.data) {
                        blob = base64ToBlob(imgData.data);
                    }
                    await db.images.add({
                        id: imgData.id,
                        timeEntryId: entry.id,
                        blob,
                        caption: imgData.caption || '',
                        yearTaken: imgData.yearTaken,
                        credit: imgData.credit || ''
                    });
                }
            }
        }
    }

    return { projectId: bundle.project.id, placesImported, entriesImported };
}

/**
 * Export as CSV (flat summary — no images).
 */
export async function exportCSV(projectId) {
    const places = await db.places.where('projectId').equals(projectId).toArray();
    const rows = [['Place', 'Category', 'Lat', 'Lng', 'Year Start', 'Year End', 'Title', 'Summary', 'Source', 'Confidence']];

    for (const place of places) {
        const entries = await db.timeEntries.where('placeId').equals(place.id).toArray();
        if (entries.length === 0) {
            rows.push([place.name, place.category, place.lat, place.lng, '', '', '', '', '', '']);
        } else {
            for (const e of entries) {
                rows.push([
                    place.name, place.category, place.lat, place.lng,
                    e.yearStart, e.yearEnd || '', e.title, e.summary, e.source, e.confidence
                ]);
            }
        }
    }

    return rows.map(r => r.map(cell => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n');
}

/**
 * Trigger a file download in the browser.
 */
export function downloadFile(content, filename, type = 'application/json') {
    const blob = new Blob([typeof content === 'string' ? content : JSON.stringify(content, null, 2)], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Read a file chosen by the user and parse as JSON.
 */
export function readFileAsJSON() {
    return new Promise((resolve, reject) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.accept = '.json,.historylens.json';
        input.onchange = async (e) => {
            const file = e.target.files[0];
            if (!file) return reject(new Error('No file selected'));
            try {
                const text = await file.text();
                resolve(JSON.parse(text));
            } catch (err) {
                reject(new Error('Failed to parse file: ' + err.message));
            }
        };
        input.click();
    });
}

// ── Helpers ───────────────────────────────────────────────

function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

function base64ToBlob(dataUrl) {
    const parts = dataUrl.split(',');
    const mime = parts[0].match(/:(.*?);/)?.[1] || 'image/png';
    const b64 = atob(parts[1]);
    const arr = new Uint8Array(b64.length);
    for (let i = 0; i < b64.length; i++) arr[i] = b64.charCodeAt(i);
    return new Blob([arr], { type: mime });
}
