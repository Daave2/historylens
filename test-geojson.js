import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(ROOT_DIR, '.env'));

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to .env or your shell environment.');
    process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey, {
    auth: {
        persistSession: false,
        autoRefreshToken: false
    }
});

async function run() {
    console.log('Running Supabase smoke check...');

    const { data: projects, error: projectsError } = await supabase
        .from('projects')
        .select('id, name, is_public')
        .order('created_at', { ascending: false })
        .limit(5);

    if (projectsError) throw projectsError;

    console.log(`Visible projects: ${(projects || []).length}`);

    if (!projects || projects.length === 0) {
        console.log('No public or accessible projects found for this key.');
        return;
    }

    const project = projects[0];
    console.log(`Sample project: ${project.name} (${project.is_public ? 'public' : 'restricted'})`);

    const { data: places, error: placesError, count: placeCount } = await supabase
        .from('places')
        .select('id, name', { count: 'exact' })
        .eq('project_id', project.id)
        .limit(200);

    if (placesError) throw placesError;

    const placeIds = (places || []).map((place) => place.id);

    const entryCount = placeIds.length > 0
        ? await countRows(
            supabase
                .from('time_entries')
                .select('id', { count: 'exact', head: true })
                .in('place_id', placeIds)
        )
        : 0;

    const commentCount = await countRows(
        supabase.from('comments').select('id', { count: 'exact', head: true })
    );
    const aliasCount = await countRows(
        supabase.from('place_name_aliases').select('id', { count: 'exact', head: true })
    );
    const aliasHistoryCount = await countRows(
        supabase.from('place_name_alias_history').select('id', { count: 'exact', head: true })
    );

    console.log(`Places in sample project: ${placeCount || 0}`);
    console.log(`Timeline entries across visible sample places: ${entryCount}`);
    console.log(`Visible comments: ${commentCount}`);
    console.log(`Visible historic names: ${aliasCount}`);
    console.log(`Visible historic-name history rows: ${aliasHistoryCount}`);
}

async function countRows(query) {
    const { count, error } = await query;
    if (error) throw error;
    return count || 0;
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
    console.error('Smoke check failed:', error.message || error);
    process.exit(1);
});
