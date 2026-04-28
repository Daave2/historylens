export const STANDARD_PLACE_CATEGORIES = ['residential', 'commercial', 'landmark', 'natural', 'infrastructure'];

export const PLACE_CATEGORY_LABELS = {
    residential: 'Residential',
    commercial: 'Commercial',
    landmark: 'Landmark',
    natural: 'Natural Feature',
    infrastructure: 'Infrastructure',
    other: 'Other'
};

export const PLACE_CATEGORY_ICONS = {
    residential: '🏠',
    commercial: '🏪',
    landmark: '⭐',
    natural: '🌳',
    infrastructure: '🏗️',
    other: '📍'
};

export function normalizePlaceCategory(category) {
    const raw = (category || '').toString().trim().toLowerCase();
    if (!raw) return 'residential';

    const text = raw
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[_/.-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (STANDARD_PLACE_CATEGORIES.includes(text)) return text;
    if (text === 'other') return 'other';

    if (/\b(park|garden|wood|woods|forest|river|lake|beach|natural|meadow|common|green|grass|water|pond|canal)\b/.test(text)) {
        return 'natural';
    }

    if (/\b(station|rail|railway|tram|bus|transport|bridge|road|street|highway|footway|pedestrian|path|parking|car park|school|hospital|infrastructure)\b/.test(text)) {
        return 'infrastructure';
    }

    if (/\b(church|chapel|cathedral|mosque|synagogue|temple|museum|monument|historic|heritage|listed|landmark|memorial|castle|tower|pier|theatre|cinema|ballroom|attraction|gallery|arts centre|place of worship)\b/.test(text)) {
        return 'landmark';
    }

    if (/\b(commercial|comercial|retail|business|office|industrial|warehouse|factory|shop|store|supermarket|convenience|market|mall|boutique|bakery|butcher|chemist|pharmacy|hairdresser|salon|beauty|charity|clothes|florist|bookshop|bank|atm|post office|pub|bar|restaurant|cafe|coffee|fast food|takeaway|food|hotel|guest|guest house|inn|hostel|b&b|bed and breakfast|accommodation|leisure|miniature golf|amusement|arcade|bowling|casino|club|gym)\b/.test(text)) {
        return 'commercial';
    }

    if (/\b(house|home|residential|flat|flats|apartment|apartments|dwelling|terrace|detached|semi detached|bungalow)\b/.test(text)) {
        return 'residential';
    }

    return 'other';
}
