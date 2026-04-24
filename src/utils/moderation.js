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
