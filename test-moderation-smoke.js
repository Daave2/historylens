import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { createClient } from '@supabase/supabase-js';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));
loadEnvFile(path.join(ROOT_DIR, '.env'));

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseKey = process.env.VITE_SUPABASE_ANON_KEY;

const ownerEmail = process.env.HISTORYLENS_SMOKE_OWNER_EMAIL;
const ownerPassword = process.env.HISTORYLENS_SMOKE_OWNER_PASSWORD;
const contributorEmail = process.env.HISTORYLENS_SMOKE_CONTRIBUTOR_EMAIL;
const contributorPassword = process.env.HISTORYLENS_SMOKE_CONTRIBUTOR_PASSWORD;
const configuredProjectId = process.env.HISTORYLENS_SMOKE_PROJECT_ID;

if (!supabaseUrl || !supabaseKey) {
    console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY. Add them to .env or your shell environment.');
    process.exit(1);
}

const missingAuthVars = [
    ['HISTORYLENS_SMOKE_OWNER_EMAIL', ownerEmail],
    ['HISTORYLENS_SMOKE_OWNER_PASSWORD', ownerPassword],
    ['HISTORYLENS_SMOKE_CONTRIBUTOR_EMAIL', contributorEmail],
    ['HISTORYLENS_SMOKE_CONTRIBUTOR_PASSWORD', contributorPassword]
].filter(([, value]) => !value).map(([name]) => name);

if (missingAuthVars.length > 0) {
    console.log('Skipping authenticated moderation smoke check.');
    console.log(`Set ${missingAuthVars.join(', ')} to run the full workflow.`);
    process.exit(0);
}

function createSmokeClient() {
    return createClient(supabaseUrl, supabaseKey, {
        auth: {
            persistSession: false,
            autoRefreshToken: false
        }
    });
}

async function run() {
    console.log('Running authenticated moderation smoke check...');

    const owner = await signIn('owner', ownerEmail, ownerPassword);
    const contributor = await signIn('contributor', contributorEmail, contributorPassword);

    if (owner.user.id === contributor.user.id) {
        throw new Error('Owner and contributor smoke accounts must be different users.');
    }

    await ensureProfile(owner.client, owner.user);
    await ensureProfile(contributor.client, contributor.user);

    const cleanup = {
        createdProjectId: null,
        createdRoleId: null,
        submissions: [],
        places: []
    };

    try {
        const project = configuredProjectId
            ? await loadProject(owner.client, configuredProjectId)
            : await createTempProject(owner.client, owner.user.id);
        cleanup.createdProjectId = configuredProjectId ? null : project.id;

        console.log(`Project under test: ${project.name || project.id}`);

        const role = await ensurePendingAccess(contributor.client, project.id, contributor.user.id);
        if (role.created) cleanup.createdRoleId = role.id;
        console.log(`Contributor access role: ${role.role}${role.created ? ' (created)' : ''}`);

        const rejectSubmission = await createPlaceSubmission(contributor.client, {
            projectId: project.id,
            submitterId: contributor.user.id,
            name: `Smoke Rejected Place ${Date.now()}`,
            description: 'Created by the authenticated moderation smoke test and rejected.',
            lat: 53.814,
            lng: -3.055,
            category: 'landmark'
        });
        cleanup.submissions.push(rejectSubmission.id);

        const rejectNote = `Smoke rejection note ${Date.now()}`;
        await reviewSubmission(owner.client, rejectSubmission.id, 'rejected', rejectNote);
        const rejected = await readSubmission(contributor.client, rejectSubmission.id);
        assertEqual(rejected.status, 'rejected', 'Contributor can read rejected status');
        assertEqual(rejected.reviewer_note, rejectNote, 'Contributor can read rejection note');
        console.log('Rejection decision visible to contributor.');

        const approveSubmission = await createPlaceSubmission(contributor.client, {
            projectId: project.id,
            submitterId: contributor.user.id,
            name: `Smoke Approved Place ${Date.now()}`,
            description: 'Created by the authenticated moderation smoke test and approved.',
            lat: 53.815,
            lng: -3.056,
            category: 'landmark',
            autoEntries: [{
                yearStart: 1901,
                title: 'Smoke Timeline Entry',
                summary: 'Approved through the authenticated moderation smoke test.',
                source: 'HistoryLens smoke test',
                sourceType: 'archive',
                confidence: 'likely'
            }]
        });
        cleanup.submissions.push(approveSubmission.id);

        const approveNote = `Smoke approval note ${Date.now()}`;
        const reviewResult = await reviewSubmission(owner.client, approveSubmission.id, 'approved', approveNote);
        const approved = await readSubmission(contributor.client, approveSubmission.id);
        assertEqual(approved.status, 'approved', 'Contributor can read approved status');
        assertEqual(approved.reviewer_note, approveNote, 'Contributor can read approval note');

        const publishedPlaceId = approved.target_place_id || reviewResult.target_place_id;
        if (!publishedPlaceId) throw new Error('Approved place submission did not publish a place id.');
        cleanup.places.push(publishedPlaceId);

        const publishedPlace = await readPlace(contributor.client, publishedPlaceId);
        assertEqual(publishedPlace.created_by, contributor.user.id, 'Published place preserves submitter attribution');

        const entryCount = await countEntriesForPlace(contributor.client, publishedPlaceId);
        if (entryCount < 1) throw new Error('Approved place submission did not publish its auto entry.');

        console.log('Approval decision, reviewer note, published place, and auto entry verified.');
        console.log('Authenticated moderation smoke check passed.');
    } finally {
        await cleanupSmokeData({ owner, contributor, cleanup });
        await owner.client.auth.signOut();
        await contributor.client.auth.signOut();
    }
}

async function signIn(label, email, password) {
    const client = createSmokeClient();
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw new Error(`${label} sign-in failed: ${error.message}`);
    if (!data?.user) throw new Error(`${label} sign-in did not return a user.`);
    return { client, user: data.user };
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

async function loadProject(client, projectId) {
    const { data, error } = await client
        .from('projects')
        .select('id, name, owner_id, is_public')
        .eq('id', projectId)
        .single();
    if (error) throw error;
    return data;
}

async function createTempProject(client, ownerId) {
    const { data, error } = await client
        .from('projects')
        .insert({
            name: `HistoryLens Moderation Smoke ${new Date().toISOString()}`,
            description: 'Temporary project created by npm run smoke:moderation.',
            centre_lat: 53.814,
            centre_lng: -3.055,
            default_zoom: 15,
            is_public: true,
            owner_id: ownerId
        })
        .select('id, name, owner_id, is_public')
        .single();
    if (error) throw error;
    return data;
}

async function ensurePendingAccess(client, projectId, contributorId) {
    const { data: existing, error: existingError } = await client
        .from('project_roles')
        .select('id, role')
        .eq('project_id', projectId)
        .eq('user_id', contributorId)
        .maybeSingle();

    if (existingError) throw existingError;
    if (existing) {
        if (existing.role === 'banned') {
            throw new Error('Contributor smoke account is banned on the project under test.');
        }
        return { ...existing, created: false };
    }

    const { data, error } = await client
        .from('project_roles')
        .insert({
            project_id: projectId,
            user_id: contributorId,
            role: 'pending'
        })
        .select('id, role')
        .single();
    if (error) throw error;
    return { ...data, created: true };
}

async function createPlaceSubmission(client, { projectId, submitterId, name, description, lat, lng, category, autoEntries = [] }) {
    const { data, error } = await client
        .from('moderation_submissions')
        .insert({
            project_id: projectId,
            submitter_id: submitterId,
            submission_type: 'place_create',
            payload: {
                name,
                description,
                lat,
                lng,
                category,
                autoEntries
            }
        })
        .select('id, status, reviewer_note, reviewed_by, reviewed_at, target_place_id')
        .single();
    if (error) throw error;
    assertEqual(data.status, 'pending', 'New moderation submission starts pending');
    return data;
}

async function reviewSubmission(client, submissionId, decision, note) {
    const { data, error } = await client.rpc('review_moderation_submission', {
        p_submission_id: submissionId,
        p_decision: decision,
        p_note: note
    });
    if (error) throw error;
    return data || {};
}

async function readSubmission(client, submissionId) {
    const { data, error } = await client
        .from('moderation_submissions')
        .select('id, status, reviewer_note, reviewed_by, reviewed_at, target_place_id')
        .eq('id', submissionId)
        .single();
    if (error) throw error;
    return data;
}

async function readPlace(client, placeId) {
    const { data, error } = await client
        .from('places')
        .select('id, name, created_by')
        .eq('id', placeId)
        .single();
    if (error) throw error;
    return data;
}

async function countEntriesForPlace(client, placeId) {
    const { count, error } = await client
        .from('time_entries')
        .select('id', { count: 'exact', head: true })
        .eq('place_id', placeId);
    if (error) throw error;
    return count || 0;
}

async function cleanupSmokeData({ owner, contributor, cleanup }) {
    const cleanupErrors = [];

    if (cleanup.createdProjectId) {
        await captureCleanupError(cleanupErrors, async () => {
            const { error } = await owner.client.from('projects').delete().eq('id', cleanup.createdProjectId);
            if (error) throw error;
        });
    } else {
        for (const placeId of cleanup.places) {
            await captureCleanupError(cleanupErrors, async () => {
                const { error } = await owner.client.from('places').delete().eq('id', placeId);
                if (error) throw error;
            });
        }

        for (const submissionId of cleanup.submissions) {
            await captureCleanupError(cleanupErrors, async () => {
                const { error } = await owner.client.from('moderation_submissions').delete().eq('id', submissionId);
                if (error) throw error;
            });
        }

        if (cleanup.createdRoleId) {
            await captureCleanupError(cleanupErrors, async () => {
                const { error } = await contributor.client.from('project_roles').delete().eq('id', cleanup.createdRoleId);
                if (error) throw error;
            });
        }
    }

    if (cleanupErrors.length > 0) {
        console.warn(`Smoke cleanup had ${cleanupErrors.length} warning${cleanupErrors.length === 1 ? '' : 's'}:`);
        cleanupErrors.forEach((error) => console.warn(`- ${error.message || error}`));
    }
}

async function captureCleanupError(errors, action) {
    try {
        await action();
    } catch (error) {
        errors.push(error);
    }
}

function assertEqual(actual, expected, label) {
    if (actual !== expected) {
        throw new Error(`${label}: expected ${expected}, got ${actual}`);
    }
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
    console.error('Moderation smoke check failed:', error.message || error);
    process.exit(1);
});
