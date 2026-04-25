import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
loadEnvFile(path.join(ROOT_DIR, '.env'));

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;
const seedEmail = process.env.HISTORYLENS_SEED_EMAIL || process.env.HISTORYLENS_SMOKE_OWNER_EMAIL;
const seedPassword = process.env.HISTORYLENS_SEED_PASSWORD || process.env.HISTORYLENS_SMOKE_OWNER_PASSWORD;
const projectName = process.env.HISTORYLENS_SEED_PROJECT_NAME || 'HistoryLens Demo Seed';
const shouldReset = isTruthy(process.env.HISTORYLENS_SEED_RESET);

const DEMO_PROJECT = {
    description: 'Repeatable demo data for local HistoryLens development and smoke testing.',
    centre_lat: 53.8175,
    centre_lng: -3.0530,
    default_zoom: 15,
    is_public: true
};

const DEMO_PLACES = [
    {
        name: 'Blackpool Tower',
        description: 'A seaside landmark opened in 1894 and built as a visible centrepiece for the resort.',
        lat: 53.815915,
        lng: -3.055921,
        category: 'landmark',
        aliases: [
            { alias: 'The Tower', start_year: 1894, end_year: null, note: 'Common shorthand used by visitors and residents.' }
        ],
        entries: [
            {
                year_start: 1894,
                year_end: null,
                title: 'Tower opens to visitors',
                summary: 'Blackpool Tower opened as one of the town landmark attractions, combining an observation tower, ballroom, and public entertainment spaces.',
                source: 'HistoryLens demo seed',
                source_type: 'archive',
                confidence: 'likely'
            },
            {
                year_start: 1956,
                year_end: 1965,
                title: 'Post-war resort landmark',
                summary: 'The tower remained a highly visible symbol of Blackpool during the post-war holiday boom.',
                source: 'HistoryLens demo seed',
                source_type: 'user',
                confidence: 'speculative'
            }
        ]
    },
    {
        name: 'North Pier',
        description: 'The earliest of Blackpool piers, extending the promenade experience out over the shore.',
        lat: 53.819355,
        lng: -3.055876,
        category: 'infrastructure',
        aliases: [
            { alias: 'Blackpool North Pier', start_year: 1863, end_year: null, note: 'Formal name used in many historic references.' }
        ],
        entries: [
            {
                year_start: 1863,
                year_end: null,
                title: 'Pier opens',
                summary: 'North Pier opened during Blackpool early growth as a seaside resort and became a promenade destination.',
                source: 'HistoryLens demo seed',
                source_type: 'archive',
                confidence: 'likely'
            },
            {
                year_start: 1938,
                year_end: 1945,
                title: 'Changing wartime use',
                summary: 'Like many coastal attractions, the pier operated in a different context during the Second World War years.',
                source: 'HistoryLens demo seed',
                source_type: 'user',
                confidence: 'speculative'
            }
        ]
    },
    {
        name: 'Winter Gardens',
        description: 'A large entertainment complex that helped anchor Blackpool civic and leisure life.',
        lat: 53.818352,
        lng: -3.052512,
        category: 'landmark',
        aliases: [
            { alias: 'Winter Gardens Blackpool', start_year: 1878, end_year: null, note: 'Long-form name for the venue complex.' }
        ],
        entries: [
            {
                year_start: 1878,
                year_end: null,
                title: 'Entertainment complex opens',
                summary: 'Winter Gardens opened as part of the expanding leisure infrastructure serving residents and visitors.',
                source: 'HistoryLens demo seed',
                source_type: 'archive',
                confidence: 'likely'
            },
            {
                year_start: 1920,
                year_end: 1939,
                title: 'Interwar events venue',
                summary: 'The complex hosted a wide range of entertainment and public events as the resort grew between the wars.',
                source: 'HistoryLens demo seed',
                source_type: 'user',
                confidence: 'speculative'
            }
        ]
    }
];

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to .env or your shell environment.');
    process.exit(1);
}

const missingAuthVars = [
    ['HISTORYLENS_SEED_EMAIL or HISTORYLENS_SMOKE_OWNER_EMAIL', seedEmail],
    ['HISTORYLENS_SEED_PASSWORD or HISTORYLENS_SMOKE_OWNER_PASSWORD', seedPassword]
].filter(([, value]) => !value).map(([name]) => name);

if (missingAuthVars.length > 0) {
    console.error('Missing demo seed credentials.');
    console.error(`Set ${missingAuthVars.join(', ')} to seed demo data through normal Supabase auth.`);
    process.exit(1);
}

function createSeedClient() {
    return createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });
}

async function run() {
    console.log('Seeding HistoryLens demo data...');

    const client = createSeedClient();
    const { data, error } = await client.auth.signInWithPassword({
        email: seedEmail,
        password: seedPassword
    });

    if (error) throw new Error(`Seed sign-in failed: ${error.message}`);
    if (!data?.user) throw new Error('Seed sign-in did not return a user.');

    try {
        await ensureProfile(client, data.user);

        if (shouldReset) {
            const deleted = await deleteExistingSeedProjects(client, data.user.id);
            console.log(`Reset removed ${deleted} existing seed project${deleted === 1 ? '' : 's'}.`);
        }

        const project = await ensureProject(client, data.user.id);
        const result = await ensureDemoContent(client, project.id, data.user.id);

        console.log(`Seed project: ${project.name} (${project.id})`);
        console.log(`Places: ${result.createdPlaces} created, ${result.updatedPlaces} refreshed`);
        console.log(`Entries: ${result.createdEntries} created, ${result.updatedEntries} refreshed`);
        console.log(`Historic names: ${result.createdAliases} created, ${result.updatedAliases} refreshed`);
        console.log('Demo seed complete.');
    } finally {
        await client.auth.signOut();
    }
}

async function ensureProfile(client, user) {
    const { error } = await client
        .from('profiles')
        .upsert({
            id: user.id,
            email: user.email || '',
            display_name: user.email ? user.email.split('@')[0] : null
        }, { onConflict: 'id' });

    if (error) {
        console.warn(`Could not ensure profile for ${user.email || user.id}: ${error.message}`);
    }
}

async function deleteExistingSeedProjects(client, ownerId) {
    const { data, error } = await client
        .from('projects')
        .select('id')
        .eq('owner_id', ownerId)
        .eq('name', projectName);

    if (error) throw error;

    let deleted = 0;
    for (const project of data || []) {
        const { error: deleteError } = await client
            .from('projects')
            .delete()
            .eq('id', project.id);
        if (deleteError) throw deleteError;
        deleted += 1;
    }
    return deleted;
}

async function ensureProject(client, ownerId) {
    const { data: existing, error: existingError } = await client
        .from('projects')
        .select('id, name')
        .eq('owner_id', ownerId)
        .eq('name', projectName)
        .order('created_at', { ascending: false })
        .limit(1);

    if (existingError) throw existingError;

    const update = {
        name: projectName,
        ...DEMO_PROJECT,
        owner_id: ownerId
    };

    if (existing?.length) {
        const { data, error } = await client
            .from('projects')
            .update(update)
            .eq('id', existing[0].id)
            .select('id, name')
            .single();
        if (error) throw error;
        return data;
    }

    const { data, error } = await client
        .from('projects')
        .insert(update)
        .select('id, name')
        .single();
    if (error) throw error;
    return data;
}

async function ensureDemoContent(client, projectId, userId) {
    const result = {
        createdPlaces: 0,
        updatedPlaces: 0,
        createdEntries: 0,
        updatedEntries: 0,
        createdAliases: 0,
        updatedAliases: 0
    };

    for (const place of DEMO_PLACES) {
        const placeResult = await ensurePlace(client, projectId, userId, place);
        result[placeResult.created ? 'createdPlaces' : 'updatedPlaces'] += 1;

        for (const entry of place.entries) {
            const entryResult = await ensureEntry(client, placeResult.place.id, userId, entry);
            result[entryResult.created ? 'createdEntries' : 'updatedEntries'] += 1;
        }

        for (const alias of place.aliases) {
            const aliasResult = await ensureAlias(client, projectId, placeResult.place.id, userId, alias);
            result[aliasResult.created ? 'createdAliases' : 'updatedAliases'] += 1;
        }
    }

    return result;
}

async function ensurePlace(client, projectId, userId, place) {
    const { data: existing, error: existingError } = await client
        .from('places')
        .select('id')
        .eq('project_id', projectId)
        .eq('name', place.name)
        .limit(1);

    if (existingError) throw existingError;

    const payload = {
        project_id: projectId,
        name: place.name,
        description: place.description,
        lat: place.lat,
        lng: place.lng,
        category: place.category,
        created_by: userId
    };

    if (existing?.length) {
        const { data, error } = await client
            .from('places')
            .update(payload)
            .eq('id', existing[0].id)
            .select('id')
            .single();
        if (error) throw error;
        return { place: data, created: false };
    }

    const { data, error } = await client
        .from('places')
        .insert(payload)
        .select('id')
        .single();
    if (error) throw error;
    return { place: data, created: true };
}

async function ensureEntry(client, placeId, userId, entry) {
    const { data: existing, error: existingError } = await client
        .from('time_entries')
        .select('id')
        .eq('place_id', placeId)
        .eq('year_start', entry.year_start)
        .eq('title', entry.title)
        .limit(1);

    if (existingError) throw existingError;

    const payload = {
        place_id: placeId,
        year_start: entry.year_start,
        year_end: entry.year_end,
        title: entry.title,
        summary: entry.summary,
        source: entry.source,
        source_type: entry.source_type,
        confidence: entry.confidence,
        created_by: userId
    };

    if (existing?.length) {
        const { data, error } = await client
            .from('time_entries')
            .update(payload)
            .eq('id', existing[0].id)
            .select('id')
            .single();
        if (error) throw error;
        return { entry: data, created: false };
    }

    const { data, error } = await client
        .from('time_entries')
        .insert(payload)
        .select('id')
        .single();
    if (error) throw error;
    return { entry: data, created: true };
}

async function ensureAlias(client, projectId, placeId, userId, alias) {
    let query = client
        .from('place_name_aliases')
        .select('id')
        .eq('project_id', projectId)
        .eq('place_id', placeId)
        .eq('alias', alias.alias);

    query = addNullableFilter(query, 'start_year', alias.start_year);
    query = addNullableFilter(query, 'end_year', alias.end_year);

    const { data: existing, error: existingError } = await query.limit(1);
    if (existingError) throw existingError;

    const payload = {
        project_id: projectId,
        place_id: placeId,
        alias: alias.alias,
        start_year: alias.start_year,
        end_year: alias.end_year,
        note: alias.note,
        created_by: userId
    };

    if (existing?.length) {
        const { data, error } = await client
            .from('place_name_aliases')
            .update(payload)
            .eq('id', existing[0].id)
            .select('id')
            .single();
        if (error) throw error;
        return { alias: data, created: false };
    }

    const { data, error } = await client
        .from('place_name_aliases')
        .insert(payload)
        .select('id')
        .single();
    if (error) throw error;
    return { alias: data, created: true };
}

function addNullableFilter(query, column, value) {
    return value === null || value === undefined
        ? query.is(column, null)
        : query.eq(column, value);
}

function isTruthy(value) {
    return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function loadEnvFile(envPath) {
    if (!fs.existsSync(envPath)) return;

    const raw = fs.readFileSync(envPath, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;

        const separator = trimmed.indexOf('=');
        if (separator === -1) continue;

        const key = trimmed.slice(0, separator).trim();
        if (!key || process.env[key]) continue;

        let value = trimmed.slice(separator + 1).trim();
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
            value = value.slice(1, -1);
        }
        process.env[key] = value;
    }
}

run().catch((error) => {
    console.error('Demo seed failed:', error.message || error);
    process.exit(1);
});
