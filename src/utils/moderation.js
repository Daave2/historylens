function haversineDistanceMeters(lat1, lng1, lat2, lng2) {
    const toRad = (value) => value * (Math.PI / 180);
    const earthRadiusMeters = 6371000;
    const dLat = toRad(lat2 - lat1);
    const dLng = toRad(lng2 - lng1);
    const a = Math.sin(dLat / 2) ** 2
        + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return earthRadiusMeters * c;
}

function formatCoordinatePair(lat, lng) {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return 'Location pending';
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

export function formatModerationSubmissionType(type) {
    if (type === 'place_create') return 'New Place';
    if (type === 'entry_create') return 'Timeline Entry';
    if (type === 'place_move') return 'Location Correction';
    if (type === 'place_name_alias') return 'Historical Name';
    return type || 'Suggestion';
}

export function formatModerationStatusLabel(status) {
    if (status === 'approved') return 'Approved';
    if (status === 'rejected') return 'Declined';
    return 'Pending';
}

export function formatModerationSubmissionSummary(submission) {
    const payload = submission?.payload || {};

    if (submission?.submissionType === 'place_create') {
        const name = payload.name || 'Unnamed place';
        const coords = formatCoordinatePair(Number(payload.lat), Number(payload.lng));
        return coords === 'Location pending' ? name : `${name} at ${coords}`;
    }

    if (submission?.submissionType === 'entry_create') {
        const title = payload.title || 'Untitled';
        const yearStart = Number(payload.yearStart);
        const year = Number.isFinite(yearStart) ? ` (${yearStart})` : '';
        return `${title}${year}`;
    }

    if (submission?.submissionType === 'place_move') {
        const fromLat = Number(payload.fromLat);
        const fromLng = Number(payload.fromLng);
        const toLat = Number(payload.lat);
        const toLng = Number(payload.lng);
        const destination = formatCoordinatePair(toLat, toLng);

        if (destination === 'Location pending') return 'Move location';
        if (Number.isFinite(fromLat) && Number.isFinite(fromLng) && Number.isFinite(toLat) && Number.isFinite(toLng)) {
            const delta = haversineDistanceMeters(fromLat, fromLng, toLat, toLng);
            return `Move to ${destination} (${delta.toFixed(0)}m from current)`;
        }
        return `Move to ${destination}`;
    }

    if (submission?.submissionType === 'place_name_alias') {
        const alias = payload.alias || 'Unnamed alias';
        const startYear = Number(payload.startYear);
        const endYear = Number(payload.endYear);
        const start = Number.isFinite(startYear) ? `from ${startYear}` : '';
        const end = Number.isFinite(endYear) ? `until ${endYear}` : '';
        const when = [start, end].filter(Boolean).join(' ');
        return when ? `${alias} (${when})` : alias;
    }

    try {
        return JSON.stringify(payload);
    } catch (_) {
        return 'Submission details';
    }
}

const CATEGORY_COLOURS = {
    residential: '#a78bfa',
    commercial: '#f59e0b',
    landmark: '#f472b6',
    natural: '#34d399',
    infrastructure: '#60a5fa'
};

const SOURCE_TYPE_LABELS = {
    user: '👤 Personal',
    archive: '📚 Archive',
    newspaper: '📰 Newspaper',
    oral: '🗣️ Oral history',
    photo: '📷 Photograph',
    map: '🗺️ Map / Plan'
};

const CONFIDENCE_LABELS = {
    verified: '✅ Verified',
    likely: '📌 Likely',
    speculative: '❓ Speculative'
};

function escapePreview(str) {
    if (!str) return '';
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function truncate(str, maxLen = 120) {
    if (!str) return '';
    const clean = str.replace(/\s+/g, ' ').trim();
    return clean.length > maxLen ? clean.slice(0, maxLen).trim() + '…' : clean;
}

export function renderModerationDiffPreview(submission) {
    const payload = submission?.payload || {};
    const type = submission?.submissionType;

    if (type === 'place_create') {
        const name = escapePreview(payload.name || 'Unnamed place');
        const category = (payload.category || 'residential').toLowerCase();
        const catLabel = category.charAt(0).toUpperCase() + category.slice(1);
        const catColour = CATEGORY_COLOURS[category] || '#a78bfa';
        const lat = Number(payload.lat);
        const lng = Number(payload.lng);
        const coords = Number.isFinite(lat) && Number.isFinite(lng) ? `${lat.toFixed(5)}, ${lng.toFixed(5)}` : 'Not set';
        const seedCount = Array.isArray(payload.autoEntries) ? payload.autoEntries.length : 0;
        const desc = escapePreview(truncate(payload.description || '', 100));

        return `
          <div class="mod-diff-preview mod-diff-place-create">
            <div class="mod-diff-field"><span class="mod-diff-label">Name</span><span class="mod-diff-value">${name}</span></div>
            <div class="mod-diff-field"><span class="mod-diff-label">Category</span><span class="mod-diff-badge" style="background:${catColour}22; color:${catColour}; border: 1px solid ${catColour}44;">${escapePreview(catLabel)}</span></div>
            <div class="mod-diff-field"><span class="mod-diff-label">Location</span><span class="mod-diff-coord">${escapePreview(coords)}</span></div>
            ${desc ? `<div class="mod-diff-field"><span class="mod-diff-label">Description</span><span class="mod-diff-value mod-diff-truncated">${desc}</span></div>` : ''}
            ${seedCount > 0 ? `<div class="mod-diff-field"><span class="mod-diff-label">Seed entries</span><span class="mod-diff-value">${seedCount} timeline ${seedCount === 1 ? 'entry' : 'entries'} included</span></div>` : ''}
          </div>
        `;
    }

    if (type === 'entry_create') {
        const title = escapePreview(payload.title || 'Untitled');
        const yearStart = Number(payload.yearStart);
        const yearEnd = Number(payload.yearEnd);
        const yearLabel = Number.isFinite(yearStart)
            ? (Number.isFinite(yearEnd) ? `${yearStart} – ${yearEnd}` : `${yearStart} – present`)
            : 'No date';
        const source = escapePreview(payload.source || '');
        const sourceType = SOURCE_TYPE_LABELS[payload.sourceType] || '';
        const confidence = CONFIDENCE_LABELS[payload.confidence] || '';
        const summary = escapePreview(truncate(payload.summary || '', 140));

        return `
          <div class="mod-diff-preview mod-diff-entry-create">
            <div class="mod-diff-field"><span class="mod-diff-label">Title</span><span class="mod-diff-value">${title}</span></div>
            <div class="mod-diff-field"><span class="mod-diff-label">Period</span><span class="mod-diff-value">${escapePreview(yearLabel)}</span></div>
            ${summary ? `<div class="mod-diff-field"><span class="mod-diff-label">Summary</span><span class="mod-diff-value mod-diff-truncated">${summary}</span></div>` : ''}
            ${source ? `<div class="mod-diff-field"><span class="mod-diff-label">Source</span><span class="mod-diff-value">${source}</span></div>` : ''}
            ${sourceType ? `<div class="mod-diff-field"><span class="mod-diff-label">Type</span><span class="mod-diff-value">${sourceType}</span></div>` : ''}
            ${confidence ? `<div class="mod-diff-field"><span class="mod-diff-label">Confidence</span><span class="mod-diff-value">${confidence}</span></div>` : ''}
          </div>
        `;
    }

    if (type === 'place_move') {
        const fromLat = Number(payload.fromLat);
        const fromLng = Number(payload.fromLng);
        const toLat = Number(payload.lat);
        const toLng = Number(payload.lng);
        const fromCoords = Number.isFinite(fromLat) && Number.isFinite(fromLng) ? `${fromLat.toFixed(5)}, ${fromLng.toFixed(5)}` : 'Unknown';
        const toCoords = Number.isFinite(toLat) && Number.isFinite(toLng) ? `${toLat.toFixed(5)}, ${toLng.toFixed(5)}` : 'Unknown';
        let distanceLabel = '';
        if (Number.isFinite(fromLat) && Number.isFinite(fromLng) && Number.isFinite(toLat) && Number.isFinite(toLng)) {
            const delta = haversineDistanceMeters(fromLat, fromLng, toLat, toLng);
            distanceLabel = delta < 1000 ? `${delta.toFixed(0)} m` : `${(delta / 1000).toFixed(2)} km`;
        }
        const reason = escapePreview(payload.reason || '');

        return `
          <div class="mod-diff-preview mod-diff-place-move">
            <div class="mod-diff-coord-pair">
              <div class="mod-diff-coord-from"><span class="mod-diff-label">From</span><span class="mod-diff-coord">${escapePreview(fromCoords)}</span></div>
              <span class="mod-diff-arrow">→</span>
              <div class="mod-diff-coord-to"><span class="mod-diff-label">To</span><span class="mod-diff-coord">${escapePreview(toCoords)}</span></div>
              ${distanceLabel ? `<span class="mod-diff-distance-badge">${escapePreview(distanceLabel)}</span>` : ''}
            </div>
            ${reason ? `<div class="mod-diff-field"><span class="mod-diff-label">Reason</span><span class="mod-diff-value">${reason}</span></div>` : ''}
          </div>
        `;
    }

    if (type === 'place_name_alias') {
        const alias = escapePreview(payload.alias || 'Unnamed');
        const startYear = Number(payload.startYear);
        const endYear = Number(payload.endYear);
        const start = Number.isFinite(startYear) ? `${startYear}` : '';
        const end = Number.isFinite(endYear) ? `${endYear}` : '';
        const yearLabel = start && end ? `${start} – ${end}` : (start ? `From ${start}` : (end ? `Until ${end}` : ''));
        const note = escapePreview(truncate(payload.note || '', 100));

        return `
          <div class="mod-diff-preview mod-diff-alias">
            <div class="mod-diff-field"><span class="mod-diff-label">Name</span><span class="mod-diff-value" style="font-weight:600;">${alias}</span></div>
            ${yearLabel ? `<div class="mod-diff-field"><span class="mod-diff-label">Period</span><span class="mod-diff-value">${escapePreview(yearLabel)}</span></div>` : ''}
            ${note ? `<div class="mod-diff-field"><span class="mod-diff-label">Note</span><span class="mod-diff-value mod-diff-truncated">${note}</span></div>` : ''}
          </div>
        `;
    }

    return '';
}

/**
 * Check a submission for possible duplicates against existing places/entries.
 * Returns an array of warning strings (empty = no duplicates found).
 */
export function detectDuplicateWarnings(submission, existingPlaces = [], existingEntries = []) {
    const warnings = [];
    const payload = submission?.payload || {};
    const type = submission?.submissionType;

    if (type === 'place_create') {
        const lat = Number(payload.lat);
        const lng = Number(payload.lng);
        const name = (payload.name || '').toLowerCase().trim();

        if (Number.isFinite(lat) && Number.isFinite(lng)) {
            for (const place of existingPlaces) {
                const dist = haversineDistanceMeters(lat, lng, place.lat, place.lng);
                if (dist < 50) {
                    warnings.push(`Very close to "${place.name}" (${dist.toFixed(0)}m away)`);
                }
                if (name && place.name.toLowerCase().trim() === name && dist < 500) {
                    warnings.push(`Same name as existing place "${place.name}" (${dist.toFixed(0)}m away)`);
                }
            }
        }
    }

    if (type === 'entry_create') {
        const placeId = payload.placeId || submission?.placeId;
        const title = (payload.title || '').toLowerCase().trim();
        const yearStart = Number(payload.yearStart);

        if (placeId && (title || Number.isFinite(yearStart))) {
            const placeEntries = existingEntries.filter(e => e.placeId === placeId);
            for (const entry of placeEntries) {
                const sameYear = Number.isFinite(yearStart) && entry.yearStart === yearStart;
                const sameTitle = title && (entry.title || '').toLowerCase().trim() === title;
                if (sameYear && sameTitle) {
                    warnings.push(`Possible duplicate: "${entry.title}" (${entry.yearStart}) already exists on this place`);
                } else if (sameTitle) {
                    warnings.push(`Same title as existing entry: "${entry.title}"`);
                }
            }
        }
    }

    return warnings;
}
