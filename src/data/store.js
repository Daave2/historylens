import { supabase } from './supabaseClient.js';

// If Supabase isn't available, the app will break gracefully (expected if misconfigured, but we know it's there)

// ── Auth ──────────────────────────────────────────────────

export async function getSession() {
    const { data: { session }, error } = await supabase.auth.getSession();
    if (error) console.error(error);
    return session;
}

export async function signOut() {
    await supabase.auth.signOut();
}

export function onAuthStateChange(callback) {
    return supabase.auth.onAuthStateChange(callback);
}

const mapProject = (row) => ({
    id: row.id,
    name: row.name,
    description: row.description,
    centre: { lat: row.centre_lat, lng: row.centre_lng },
    defaultZoom: row.default_zoom,
    ownerId: row.owner_id,
    isPublic: row.is_public,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
});

const mapAlias = (row) => ({
    id: row.id,
    placeId: row.place_id,
    projectId: row.project_id,
    alias: row.alias,
    startYear: row.start_year,
    endYear: row.end_year,
    note: row.note || '',
    createdBy: row.created_by,
    createdAt: new Date(row.created_at)
});

const mapAliasHistory = (row) => ({
    id: row.id,
    aliasId: row.alias_id,
    placeId: row.place_id,
    projectId: row.project_id,
    action: row.action,
    previousAlias: row.previous_alias || '',
    previousStartYear: row.previous_start_year,
    previousEndYear: row.previous_end_year,
    previousNote: row.previous_note || '',
    newAlias: row.new_alias || '',
    newStartYear: row.new_start_year,
    newEndYear: row.new_end_year,
    newNote: row.new_note || '',
    changedBy: row.changed_by,
    createdAt: new Date(row.created_at)
});

const mapPlace = (row, aliases = []) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    lat: row.lat,
    lng: row.lng,
    category: row.category,
    createdBy: row.created_by,
    pinnedImageId: row.pinned_image_id || null,
    aliases,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
});

const mapEntry = (row) => ({
    id: row.id,
    placeId: row.place_id,
    yearStart: row.year_start,
    yearEnd: row.year_end,
    title: row.title,
    summary: row.summary,
    source: row.source,
    sourceType: row.source_type,
    confidence: row.confidence,
    createdBy: row.created_by,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
});

const mapImage = (row) => ({
    id: row.id,
    timeEntryId: row.time_entry_id,
    storagePath: row.storage_path,
    caption: row.caption,
    yearTaken: row.year_taken,
    credit: row.credit,
    moderationStatus: row.moderation_status || 'approved',
    createdBy: row.created_by,
    createdAt: new Date(row.created_at)
});

const mapOverviewRevision = (row) => ({
    id: row.id,
    placeId: row.place_id,
    projectId: row.project_id,
    previousDescription: row.previous_description || '',
    newDescription: row.new_description || '',
    reason: row.reason || 'update',
    createdBy: row.created_by,
    createdAt: new Date(row.created_at)
});

const mapSubmission = (row) => ({
    id: row.id,
    projectId: row.project_id,
    submitterId: row.submitter_id,
    submissionType: row.submission_type,
    targetPlaceId: row.target_place_id,
    payload: row.payload || {},
    status: row.status,
    reviewerNote: row.reviewer_note || '',
    reviewedBy: row.reviewed_by || null,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : null,
    assignedTo: row.assigned_to || null,
    priority: row.priority || 'normal',
    reviewStartedAt: row.review_started_at ? new Date(row.review_started_at) : null,
    internalNote: row.internal_note || '',
    hasQueueFields: Object.prototype.hasOwnProperty.call(row, 'priority'),
    createdAt: new Date(row.created_at)
});

const mapProjectRoleEvent = (row) => ({
    id: row.id,
    projectId: row.project_id,
    roleId: row.role_id || null,
    targetUserId: row.target_user_id,
    actorId: row.actor_id || null,
    action: row.action,
    previousRole: row.previous_role || null,
    newRole: row.new_role || null,
    note: row.note || '',
    createdAt: new Date(row.created_at)
});

const PRIMARY_IMAGE_BUCKET = 'entry_images';
const FALLBACK_IMAGE_BUCKET = 'place-images';

const SUBMISSION_TYPES = new Set(['place_create', 'entry_create', 'place_move', 'place_name_alias']);
const REVIEW_QUEUE_SELECT = 'id, project_id, submitter_id, submission_type, target_place_id, payload, status, reviewer_note, reviewed_by, reviewed_at, assigned_to, priority, review_started_at, internal_note, created_at';

function encodeStoragePath(bucket, path) {
    return bucket === PRIMARY_IMAGE_BUCKET ? path : `${bucket}::${path}`;
}

function decodeStoragePath(storagePath) {
    if (!storagePath) return { bucket: PRIMARY_IMAGE_BUCKET, path: '' };
    const sep = storagePath.indexOf('::');
    if (sep === -1) return { bucket: PRIMARY_IMAGE_BUCKET, path: storagePath };
    return {
        bucket: storagePath.slice(0, sep),
        path: storagePath.slice(sep + 2)
    };
}

function normalizePlaceCategory(category) {
    const raw = (category || '').toString().trim().toLowerCase();
    if (!raw) return 'residential';

    const standard = new Set(['residential', 'commercial', 'landmark', 'natural', 'infrastructure']);
    if (standard.has(raw)) return raw;

    if (/(guest|hotel|inn|pub|shop|store|market|cafe|restaurant|bar|commercial)/.test(raw)) return 'commercial';
    if (/(church|chapel|museum|monument|historic|landmark|memorial|castle|heritage|tower|pier|theatre|cinema|ballroom|attraction)/.test(raw)) return 'landmark';
    if (/(park|wood|forest|garden|river|lake|beach|natural|meadow|common|green)/.test(raw)) return 'natural';
    if (/(station|rail|railway|bridge|road|school|hospital|infrastructure|transport|tram|bus)/.test(raw)) return 'infrastructure';
    if (/(house|home|residential|flat|apartment|dwelling)/.test(raw)) return 'residential';

    // Safe fallback for legacy DB constraints.
    return 'residential';
}

// Helper for generating public URLs
const getImageUrl = (path) => {
    const { bucket, path: objectPath } = decodeStoragePath(path);
    const { data } = supabase.storage.from(bucket).getPublicUrl(objectPath);
    return data.publicUrl;
};

function isMissingSchemaError(error) {
    const message = (error?.message || '').toLowerCase();
    return error?.code === '42P01' || error?.code === '42703' || message.includes('does not exist');
}

function safeInt(value, fallback = null) {
    if (value === null || value === undefined || value === '') return fallback;
    const parsed = Number.parseInt(value, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function imageQualityScore(image) {
    let score = 0;
    if ((image.caption || '').trim().length >= 16) score += 1.2;
    if ((image.credit || '').trim().length > 0) score += 0.7;
    if (Number.isFinite(image.yearTaken)) score += 0.35;
    return score;
}

function scoreImageForYear(image, year, voteScore = 0) {
    const targetYear = Number.isFinite(year) ? year : new Date().getFullYear();
    const effectiveYear = Number.isFinite(image.effectiveYear) ? image.effectiveYear : targetYear;
    const temporalWeight = 1 / (1 + Math.abs(effectiveYear - targetYear));
    return (voteScore * 1.7) + imageQualityScore(image) + temporalWeight;
}

function collectPlaceTimelineImages(entries = [], imagesByEntryId = {}) {
    const allImages = [];
    for (const entry of entries) {
        const images = imagesByEntryId[entry.id] || [];
        for (const image of images) {
            if (image.moderationStatus !== 'approved') continue;
            allImages.push({
                ...image,
                entryYearStart: entry.yearStart,
                effectiveYear: image.yearTaken || entry.yearStart
            });
        }
    }
    return allImages;
}

function pickPrimaryPlaceImage(place, allImages, voteMap = {}) {
    if (allImages.length === 0) return null;

    if (place?.pinnedImageId) {
        const pinned = allImages.find((image) => image.id === place.pinnedImageId);
        if (pinned) return { ...pinned, isPinned: true };
    }

    allImages.sort((a, b) => {
        const aScore = (voteMap[a.id]?.score || 0) * 1.8 + imageQualityScore(a);
        const bScore = (voteMap[b.id]?.score || 0) * 1.8 + imageQualityScore(b);
        return bScore - aScore;
    });
    return { ...allImages[0], isPinned: false };
}

function pickBestImageForYear(place, allImages, voteMap = {}, year) {
    if (allImages.length === 0) return null;

    if (place?.pinnedImageId) {
        const pinned = allImages.find((image) => image.id === place.pinnedImageId);
        if (pinned) return { ...pinned, isPinned: true };
    }

    allImages.sort((a, b) => {
        const aScore = scoreImageForYear(a, year, voteMap[a.id]?.score || 0);
        const bScore = scoreImageForYear(b, year, voteMap[b.id]?.score || 0);
        return bScore - aScore;
    });
    return { ...allImages[0], isPinned: false };
}

async function getAliasesForPlaceIds(placeIds) {
    const ids = [...new Set((placeIds || []).filter(Boolean))];
    const aliasMap = {};
    if (ids.length === 0) return aliasMap;

    try {
        const { data, error } = await supabase
            .from('place_name_aliases')
            .select('*')
            .in('place_id', ids)
            .order('start_year', { ascending: true, nullsFirst: true });
        if (error) throw error;
        for (const row of data || []) {
            if (!aliasMap[row.place_id]) aliasMap[row.place_id] = [];
            aliasMap[row.place_id].push(mapAlias(row));
        }
    } catch (err) {
        if (!isMissingSchemaError(err)) {
            console.warn('Could not fetch place aliases:', err);
        }
    }

    return aliasMap;
}

// ── Projects ──────────────────────────────────────────────

export async function createProject({ name, description, centre, defaultZoom, isPublic = true }) {
    const session = await getSession();
    if (!session) throw new Error("Must be signed in to create a project");

    const { data, error } = await supabase.from('projects').insert({
        name: name || 'Untitled Project',
        description: description || '',
        centre_lat: centre?.lat || 53.814,
        centre_lng: centre?.lng || -3.055,
        default_zoom: defaultZoom || 15,
        is_public: isPublic,
        owner_id: session.user.id
    }).select().single();
    if (error) { console.error(error); throw error; }
    return mapProject(data);
}

export async function updateProject(id, changes) {
    const update = {};
    if (changes.name !== undefined) update.name = changes.name;
    if (changes.description !== undefined) update.description = changes.description;
    if (changes.centre !== undefined) {
        update.centre_lat = changes.centre.lat;
        update.centre_lng = changes.centre.lng;
    }
    if (changes.defaultZoom !== undefined) update.default_zoom = changes.defaultZoom;
    if (changes.isPublic !== undefined) update.is_public = changes.isPublic;

    const { data, error } = await supabase.from('projects').update(update).eq('id', id).select().single();
    if (error) { console.error(error); throw error; }
    return mapProject(data);
}

export async function getProject(id) {
    const { data, error } = await supabase.from('projects').select('*').eq('id', id).single();
    if (error) { console.error(error); return null; }
    return mapProject(data);
}

export async function getAllProjects() {
    const { data, error } = await supabase.from('projects').select('*').order('created_at', { ascending: false });
    if (error) { console.error(error); return []; }
    return data.map(mapProject);
}

export async function getOrCreateDefaultProject() {
    const projects = await getAllProjects();
    if (projects.length > 0) return projects[0];
    return createProject({
        name: 'Local History Project',
        description: 'Click the map to start adding places and their history.'
    });
}

// ── Project Roles (Collaboration) ─────────────────────────

export async function getUserRole(projectId) {
    const session = await getSession();
    if (!session) return null;

    // Check if owner first
    const { data: project } = await supabase.from('projects').select('owner_id').eq('id', projectId).single();
    if (project && project.owner_id === session.user.id) return 'owner';

    // Check roles
    const { data, error } = await supabase.from('project_roles')
        .select('role')
        .eq('project_id', projectId)
        .eq('user_id', session.user.id)
        .maybeSingle();

    if (error) { console.error(error); return null; }
    return data ? data.role : null;
}

export async function getProfiles(userIds) {
    if (!userIds || userIds.length === 0) return {};
    const uniqueIds = [...new Set(userIds.filter(Boolean))];
    const { data } = await supabase.from('profiles').select('id, email, display_name, avatar_url').in('id', uniqueIds);
    const map = {};
    (data || []).forEach(p => {
        map[p.id] = {
            email: p.email,
            display_name: p.display_name,
            avatar_url: p.avatar_url
        };
    });
    return map;
}

export async function updateProfile(updates) {
    const session = await getSession();
    if (!session) throw new Error("Must be signed in");

    const { error } = await supabase.from('profiles')
        .update(updates)
        .eq('id', session.user.id);

    if (error) { console.error(error); throw error; }
}

export async function getProjectRoles(projectId) {
    const { data: roles, error } = await supabase.from('project_roles')
        .select('id, project_id, user_id, role, created_at')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });

    if (error) { console.error(error); throw error; }

    // Look up emails separately to avoid FK join issues
    const userIds = roles.map(r => r.user_id);
    const emailMap = await getProfiles(userIds);

    return roles.map(r => ({
        ...r,
        email: emailMap[r.user_id] || { email: 'Unknown User', display_name: null, avatar_url: null }
    }));
}

export async function getProjectRoleEvents(projectId, { limit = 40 } = {}) {
    const { data, error } = await supabase
        .from('project_role_events')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) {
        if (isMissingSchemaError(error)) return [];
        console.error(error);
        throw error;
    }

    return (data || []).map(mapProjectRoleEvent);
}

export async function getAssignableReviewers(projectId) {
    const [project, roles] = await Promise.all([
        getProject(projectId),
        getProjectRoles(projectId)
    ]);
    const adminRoles = roles.filter((role) => role.role === 'admin');
    const reviewerIds = [...new Set([
        project?.ownerId,
        ...adminRoles.map((role) => role.user_id)
    ].filter(Boolean))];
    const profiles = await getProfiles(reviewerIds);

    return reviewerIds.map((userId) => {
        const profile = profiles[userId] || {};
        return {
            userId,
            role: userId === project?.ownerId ? 'owner' : 'admin',
            email: profile.email || '',
            displayName: profile.display_name || (profile.email ? profile.email.split('@')[0] : 'Unknown user'),
            avatarUrl: profile.avatar_url || null
        };
    });
}

export async function requestAccess(projectId) {
    const session = await getSession();
    if (!session) throw new Error("Must be signed in");

    const { data: existingRole, error: existingRoleError } = await supabase
        .from('project_roles')
        .select('id, project_id, user_id, role, created_at')
        .eq('project_id', projectId)
        .eq('user_id', session.user.id)
        .maybeSingle();

    if (existingRoleError) {
        console.error(existingRoleError);
        throw existingRoleError;
    }

    if (existingRole) {
        return { ...existingRole, status: 'existing' };
    }

    const { data, error } = await supabase.from('project_roles').insert({
        project_id: projectId,
        user_id: session.user.id,
        role: 'pending'
    }).select().single();

    if (error?.code === '23505') {
        // Race-safe fallback if request was created in another tab/session.
        const { data: raceRole, error: raceRoleError } = await supabase
            .from('project_roles')
            .select('id, project_id, user_id, role, created_at')
            .eq('project_id', projectId)
            .eq('user_id', session.user.id)
            .maybeSingle();

        if (!raceRoleError && raceRole) {
            return { ...raceRole, status: 'existing' };
        }
    }

    if (error) { console.error(error); throw error; }
    return { ...data, status: 'created' };
}

export async function updateRole(roleId, newRole) {
    const { data, error } = await supabase.from('project_roles')
        .update({ role: newRole })
        .eq('id', roleId)
        .select().single();
    if (error) { console.error(error); throw error; }
    return data;
}

export async function removeRole(roleId) {
    const { error } = await supabase.from('project_roles').delete().eq('id', roleId);
    if (error) { console.error(error); throw error; }
    return true;
}

export async function banUser(projectId, userId) {
    const session = await getSession();
    if (!session) throw new Error("Must be signed in");

    const { data, error } = await supabase.from('project_roles').upsert({
        project_id: projectId,
        user_id: userId,
        role: 'banned'
    }, { onConflict: 'project_id, user_id' }).select().single();

    if (error) { console.error(error); throw error; }
    return data;
}

export async function wipeUserContributions(projectId, userId) {
    const { error } = await supabase.rpc('delete_user_contributions', {
        p_project_id: projectId,
        p_user_id: userId
    });
    if (error) { console.error(error); throw error; }
    return true;
}

export async function deleteProject(projectId) {
    const { error } = await supabase.from('projects').delete().eq('id', projectId);
    if (error) { console.error(error); throw error; }
    return true;
}

// ── Moderation Submissions ─────────────────────────────────

export async function createModerationSubmission({ projectId, submissionType, targetPlaceId = null, payload = {} }) {
    if (!SUBMISSION_TYPES.has(submissionType)) {
        throw new Error(`Unsupported submission type: ${submissionType}`);
    }

    const session = await getSession();
    if (!session) throw new Error('Must be signed in to submit for review');

    const { data, error } = await supabase
        .from('moderation_submissions')
        .insert({
            project_id: projectId,
            submitter_id: session.user.id,
            submission_type: submissionType,
            target_place_id: targetPlaceId,
            payload
        })
        .select()
        .single();

    if (error) { console.error(error); throw error; }
    return mapSubmission(data);
}

export async function submitPlaceSuggestion({ projectId, name, description, category, lat, lng, autoEntries = [] }) {
    return createModerationSubmission({
        projectId,
        submissionType: 'place_create',
        payload: {
            name: name || 'Unnamed Place',
            description: description || '',
            category: normalizePlaceCategory(category),
            lat,
            lng,
            autoEntries: Array.isArray(autoEntries) ? autoEntries : []
        }
    });
}

export async function submitEntrySuggestion({ projectId, placeId, yearStart, yearEnd, title, summary, source, sourceType, confidence }) {
    return createModerationSubmission({
        projectId,
        submissionType: 'entry_create',
        targetPlaceId: placeId,
        payload: {
            placeId,
            yearStart: safeInt(yearStart, new Date().getFullYear()),
            yearEnd: safeInt(yearEnd),
            title: title || '',
            summary: summary || '',
            source: source || '',
            sourceType: sourceType || 'user',
            confidence: confidence || 'likely'
        }
    });
}

export async function submitPlaceMoveSuggestion({ projectId, placeId, fromLat, fromLng, lat, lng, reason = '' }) {
    return createModerationSubmission({
        projectId,
        submissionType: 'place_move',
        targetPlaceId: placeId,
        payload: {
            placeId,
            fromLat,
            fromLng,
            lat,
            lng,
            reason: reason || ''
        }
    });
}

export async function submitPlaceNameSuggestion({ projectId, placeId, alias, startYear = null, endYear = null, note = '' }) {
    return createModerationSubmission({
        projectId,
        submissionType: 'place_name_alias',
        targetPlaceId: placeId,
        payload: {
            placeId,
            alias: (alias || '').trim(),
            startYear: safeInt(startYear),
            endYear: safeInt(endYear),
            note: note || ''
        }
    });
}

export async function getModerationSubmissions(projectId, { limit = 100, statuses = [] } = {}) {
    let query = supabase
        .from('moderation_submissions')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (Array.isArray(statuses) && statuses.length > 0) {
        query = query.in('status', statuses);
    }

    const { data, error } = await query;
    if (error) {
        if (isMissingSchemaError(error)) return [];
        console.error(error);
        throw error;
    }
    return (data || []).map(mapSubmission);
}

export async function getReviewQueue(projectId, { limit = 40, status = 'pending', type = 'all', priority = 'all', cursor = null } = {}) {
    let query = supabase
        .from('moderation_submissions')
        .select(REVIEW_QUEUE_SELECT)
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(limit + 1);

    if (status && status !== 'all') {
        query = query.eq('status', status);
    }

    if (type && type !== 'all') {
        query = query.eq('submission_type', type);
    }

    if (priority && priority !== 'all') {
        query = query.eq('priority', priority);
    }

    if (cursor?.createdAt) {
        query = query.lt('created_at', cursor.createdAt);
    }

    const { data, error } = await query;
    if (error) {
        if (isMissingSchemaError(error)) {
            const fallback = await getModerationSubmissions(projectId, {
                limit,
                statuses: status && status !== 'all' ? [status] : []
            });
            const filtered = fallback.filter((submission) => (
                (!type || type === 'all' || submission.submissionType === type)
                && (!priority || priority === 'all' || submission.priority === priority)
            ));
            return {
                items: filtered.slice(0, limit),
                nextCursor: null,
                schemaReady: false
            };
        }
        console.error(error);
        throw error;
    }

    const rows = data || [];
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(mapSubmission);
    const last = hasMore ? items[items.length - 1] : null;

    return {
        items,
        nextCursor: last ? { createdAt: last.createdAt.toISOString(), id: last.id } : null,
        schemaReady: true
    };
}

export async function updateModerationQueueMeta(submissionId, { assignedTo, priority, reviewStartedAt, internalNote } = {}) {
    const update = {};
    if (assignedTo !== undefined) update.assigned_to = assignedTo || null;
    if (priority !== undefined) update.priority = priority || 'normal';
    if (reviewStartedAt !== undefined) update.review_started_at = reviewStartedAt || null;
    if (internalNote !== undefined) update.internal_note = internalNote || '';

    if (Object.keys(update).length === 0) return null;

    const { data, error } = await supabase
        .from('moderation_submissions')
        .update(update)
        .eq('id', submissionId)
        .select()
        .single();

    if (error) {
        if (isMissingSchemaError(error)) {
            throw new Error('The Phase 24 collaboration scale migration has not been applied yet.');
        }
        console.error(error);
        throw error;
    }
    return mapSubmission(data);
}

export async function getMyModerationSubmissions(projectId, { limit = 20, statuses = [] } = {}) {
    const session = await getSession();
    if (!session) return [];

    let query = supabase
        .from('moderation_submissions')
        .select('*')
        .eq('project_id', projectId)
        .eq('submitter_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (Array.isArray(statuses) && statuses.length > 0) {
        query = query.in('status', statuses);
    }

    const { data, error } = await query;
    if (error) {
        if (isMissingSchemaError(error)) return [];
        console.error(error);
        throw error;
    }
    return (data || []).map(mapSubmission);
}

export async function getMySubmissionSummary(projectId) {
    const session = await getSession();
    if (!session) return { pending: 0, approved: 0, rejected: 0, total: 0 };

    const { data, error } = await supabase
        .from('moderation_submissions')
        .select('status')
        .eq('project_id', projectId)
        .eq('submitter_id', session.user.id);

    if (error) {
        if (isMissingSchemaError(error)) return { pending: 0, approved: 0, rejected: 0, total: 0 };
        console.error(error);
        return { pending: 0, approved: 0, rejected: 0, total: 0 };
    }

    const summary = { pending: 0, approved: 0, rejected: 0, total: 0 };
    for (const row of data || []) {
        summary.total += 1;
        if (row.status === 'approved') summary.approved += 1;
        else if (row.status === 'rejected') summary.rejected += 1;
        else summary.pending += 1;
    }
    return summary;
}

export async function getProjectInboxCounts(projectId) {
    let pendingAccess = 0;
    let pendingSubmissions = 0;

    const { count: accessCount, error: accessError } = await supabase
        .from('project_roles')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('role', 'pending');

    if (accessError) {
        console.error(accessError);
        throw accessError;
    }
    pendingAccess = accessCount || 0;

    const { count: submissionCount, error: submissionError } = await supabase
        .from('moderation_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('status', 'pending');

    if (submissionError) {
        if (isMissingSchemaError(submissionError)) {
            pendingSubmissions = 0;
        } else {
            console.error(submissionError);
            throw submissionError;
        }
    } else {
        pendingSubmissions = submissionCount || 0;
    }

    return {
        pendingAccess,
        pendingSubmissions,
        total: pendingAccess + pendingSubmissions
    };
}

export async function reviewModerationSubmission(submissionId, { decision, note = '' }) {
    const normalized = (decision || '').toLowerCase();
    if (!['approved', 'rejected'].includes(normalized)) {
        throw new Error('Decision must be approved or rejected');
    }

    const { data, error } = await supabase.rpc('review_moderation_submission', {
        p_submission_id: submissionId,
        p_decision: normalized,
        p_note: note || ''
    });
    if (error) { console.error(error); throw error; }
    return data;
}

// ── Places ────────────────────────────────────────────────

export async function createPlace({ projectId, name, description, lat, lng, category, createdBy = null }) {
    const normalizedCategory = normalizePlaceCategory(category);
    const insert = {
        project_id: projectId,
        name: name || 'Unnamed Place',
        description: description || null,
        lat,
        lng,
        category: normalizedCategory
    };
    if (createdBy) insert.created_by = createdBy;

    const { data, error } = await supabase.from('places').insert({
        ...insert
    }).select().single();
    if (error) { console.error(error); throw error; }
    const aliases = await getAliasesForPlaceIds([data.id]);
    return mapPlace(data, aliases[data.id] || []);
}

export async function updatePlace(id, changes) {
    const update = { ...changes };
    if (changes.projectId) { update.project_id = changes.projectId; delete update.projectId; }
    if (changes.description !== undefined) { update.description = changes.description || null; }
    if (changes.category !== undefined) { update.category = normalizePlaceCategory(changes.category); }
    if (changes.pinnedImageId !== undefined) { update.pinned_image_id = changes.pinnedImageId; delete update.pinnedImageId; }

    const { data, error } = await supabase.from('places').update(update).eq('id', id).select().single();
    if (error) { console.error(error); throw error; }
    const aliases = await getAliasesForPlaceIds([data.id]);
    return mapPlace(data, aliases[data.id] || []);
}

export async function deletePlace(id) {
    // Best-effort media cleanup to avoid orphaned storage objects.
    try {
        const entries = await getTimeEntriesForPlace(id);
        for (const entry of entries) {
            await deleteTimeEntry(entry.id);
        }
    } catch (cleanupErr) {
        console.warn('Place media cleanup failed before delete:', cleanupErr);
    }

    const { error } = await supabase.from('places').delete().eq('id', id);
    if (error) console.error(error);
}

export async function getPlacesByProject(projectId) {
    const { data, error } = await supabase.from('places').select('*').eq('project_id', projectId);
    if (error) { console.error(error); return []; }
    const ids = (data || []).map(row => row.id);
    const aliasMap = await getAliasesForPlaceIds(ids);
    return (data || []).map(row => mapPlace(row, aliasMap[row.id] || []));
}

export async function getPlace(id) {
    const { data, error } = await supabase.from('places').select('*').eq('id', id).single();
    if (error) { console.error(error); return null; }
    const aliasMap = await getAliasesForPlaceIds([data.id]);
    return mapPlace(data, aliasMap[data.id] || []);
}

export async function getPlaceNameAliases(placeId) {
    const { data, error } = await supabase
        .from('place_name_aliases')
        .select('*')
        .eq('place_id', placeId)
        .order('start_year', { ascending: true, nullsFirst: true });
    if (error) {
        if (isMissingSchemaError(error)) return [];
        console.error(error);
        throw error;
    }
    return (data || []).map(mapAlias);
}

export async function addPlaceNameAlias({ placeId, projectId, alias, startYear = null, endYear = null, note = '' }) {
    const cleaned = (alias || '').trim();
    if (!cleaned) throw new Error('Historical name cannot be empty');

    const { data, error } = await supabase
        .from('place_name_aliases')
        .insert({
            place_id: placeId,
            project_id: projectId,
            alias: cleaned,
            start_year: safeInt(startYear),
            end_year: safeInt(endYear),
            note: note || ''
        })
        .select()
        .single();
    if (error) { console.error(error); throw error; }
    return mapAlias(data);
}

export async function updatePlaceNameAlias(aliasId, changes = {}) {
    const cleaned = (changes.alias || '').trim();
    if (!cleaned) throw new Error('Historical name cannot be empty');

    const { data, error } = await supabase
        .from('place_name_aliases')
        .update({
            alias: cleaned,
            start_year: safeInt(changes.startYear),
            end_year: safeInt(changes.endYear),
            note: changes.note || ''
        })
        .eq('id', aliasId)
        .select()
        .single();
    if (error) { console.error(error); throw error; }
    return mapAlias(data);
}

export async function deletePlaceNameAlias(aliasId) {
    const { error } = await supabase
        .from('place_name_aliases')
        .delete()
        .eq('id', aliasId);
    if (error) { console.error(error); throw error; }
    return true;
}

export async function getPlaceNameAliasHistory(placeId, limit = 40) {
    const { data, error } = await supabase
        .from('place_name_alias_history')
        .select('*')
        .eq('place_id', placeId)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) {
        if (isMissingSchemaError(error)) return [];
        console.error(error);
        return [];
    }
    return (data || []).map(mapAliasHistory);
}

export async function getPlaceLocationHistory(placeId, limit = 15) {
    const { data, error } = await supabase
        .from('place_location_history')
        .select('*')
        .eq('place_id', placeId)
        .order('created_at', { ascending: false })
        .limit(limit);
    if (error) {
        if (isMissingSchemaError(error)) return [];
        console.error(error);
        return [];
    }
    return data || [];
}

export async function setPlacePinnedImage(placeId, imageId = null) {
    const { data, error } = await supabase
        .from('places')
        .update({ pinned_image_id: imageId || null })
        .eq('id', placeId)
        .select()
        .single();
    if (error) { console.error(error); throw error; }
    const aliasMap = await getAliasesForPlaceIds([data.id]);
    return mapPlace(data, aliasMap[data.id] || []);
}

// ── Time Entries ──────────────────────────────────────────

export async function createTimeEntry({ placeId, yearStart, yearEnd, title, summary, source, sourceType, confidence, createdBy = null }) {
    const insert = {
        place_id: placeId,
        year_start: yearStart || new Date().getFullYear(),
        year_end: yearEnd || null,
        title: title || '',
        summary: summary || '',
        source: source || '',
        source_type: sourceType || 'user',
        confidence: confidence || 'likely'
    };
    if (createdBy) insert.created_by = createdBy;

    const { data, error } = await supabase.from('time_entries').insert({
        ...insert
    }).select().single();
    if (error) { console.error(error); throw error; }
    return mapEntry(data);
}

export async function updateTimeEntry(id, changes) {
    const update = { ...changes };
    if (changes.yearStart !== undefined) { update.year_start = changes.yearStart; delete update.yearStart; }
    if (changes.yearEnd !== undefined) { update.year_end = changes.yearEnd; delete update.yearEnd; }
    if (changes.sourceType !== undefined) { update.source_type = changes.sourceType; delete update.sourceType; }
    if (changes.placeId !== undefined) { update.place_id = changes.placeId; delete update.placeId; }

    const { data, error } = await supabase.from('time_entries').update(update).eq('id', id).select().single();
    if (error) { console.error(error); throw error; }
    return mapEntry(data);
}

export async function deleteTimeEntry(id) {
    // Best-effort media cleanup so object storage doesn't leak on deletes.
    try {
        const images = await getImagesForEntry(id);
        for (const image of images) {
            await deleteImage(image.id);
        }
    } catch (cleanupErr) {
        console.warn('Entry media cleanup failed before delete:', cleanupErr);
    }

    const { error } = await supabase.from('time_entries').delete().eq('id', id);
    if (error) console.error(error);
}

export async function getTimeEntriesForPlace(placeId) {
    const { data, error } = await supabase.from('time_entries').select('*').eq('place_id', placeId).order('year_start', { ascending: true });
    if (error) { console.error(error); return []; }
    return data.map(mapEntry);
}

export async function getTimeEntriesForPlaces(placeIds = []) {
    const uniqueIds = [...new Set((placeIds || []).filter(Boolean))];
    if (uniqueIds.length === 0) return {};

    const { data, error } = await supabase
        .from('time_entries')
        .select('*')
        .in('place_id', uniqueIds)
        .order('year_start', { ascending: true });

    if (error) {
        console.error(error);
        return Object.fromEntries(uniqueIds.map(id => [id, []]));
    }

    const grouped = Object.fromEntries(uniqueIds.map(id => [id, []]));
    (data || []).forEach((row) => {
        const entry = mapEntry(row);
        if (!grouped[entry.placeId]) grouped[entry.placeId] = [];
        grouped[entry.placeId].push(entry);
    });
    return grouped;
}

export async function getBestEntryForYear(placeId, year) {
    const entries = await getTimeEntriesForPlace(placeId);
    if (entries.length === 0) return { entry: null, type: 'none' };

    const exact = entries.find(e => e.yearStart <= year && (e.yearEnd === null || e.yearEnd >= year));
    if (exact) return { entry: exact, type: 'exact' };

    const earlier = entries.filter(e => e.yearStart <= year).sort((a, b) => b.yearStart - a.yearStart);
    if (earlier.length > 0) return { entry: earlier[0], type: 'last_known' };

    return { entry: entries[0], type: 'before_known' };
}

export async function getProjectYearRange(projectId) {
    const places = await getPlacesByProject(projectId);
    if (places.length === 0) return { min: 1800, max: new Date().getFullYear() };

    const entriesByPlaceId = await getTimeEntriesForPlaces(places.map((place) => place.id));
    let min = Infinity, max = -Infinity;
    for (const p of places) {
        const entries = entriesByPlaceId[p.id] || [];
        for (const e of entries) {
            if (e.yearStart < min) min = e.yearStart;
            const end = e.yearEnd || e.yearStart;
            if (end > max) max = end;
        }
    }
    if (min === Infinity) return { min: 1800, max: new Date().getFullYear() };
    return { min: Math.max(1800, min - 20), max: Math.max(max + 10, new Date().getFullYear()) };
}

// ── Images ────────────────────────────────────────────────

export async function addImage({ timeEntryId, blob, caption, yearTaken, credit, moderationStatus = null }) {
    const ext = blob.type.split('/')[1] || 'jpg';
    const filename = `${timeEntryId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;
    const uploadOpts = { cacheControl: '3600', upsert: false };

    let usedBucket = PRIMARY_IMAGE_BUCKET;
    let uploadError = null;
    for (const bucket of [PRIMARY_IMAGE_BUCKET, FALLBACK_IMAGE_BUCKET]) {
        const { error } = await supabase.storage.from(bucket).upload(filename, blob, uploadOpts);
        if (!error) {
            usedBucket = bucket;
            uploadError = null;
            break;
        }
        uploadError = error;
    }
    if (uploadError) { console.error('Upload error', uploadError); throw uploadError; }

    const insert = {
        time_entry_id: timeEntryId,
        storage_path: encodeStoragePath(usedBucket, filename),
        caption: caption || '',
        year_taken: yearTaken || null,
        credit: credit || ''
    };
    if (moderationStatus) insert.moderation_status = moderationStatus;

    const { data, error } = await supabase.from('images').insert(insert).select().single();

    if (error) { console.error(error); throw error; }
    const img = mapImage(data);
    return { ...img, publicUrl: getImageUrl(img.storagePath) };
}

export async function getImagesForEntry(timeEntryId, { includeUnapproved = false } = {}) {
    const grouped = await getImagesForEntries([timeEntryId], { includeUnapproved });
    return grouped[timeEntryId] || [];
}

export async function getImagesForEntries(timeEntryIds = [], { includeUnapproved = false } = {}) {
    const ids = [...new Set((timeEntryIds || []).filter(Boolean))];
    if (ids.length === 0) return {};

    const { data, error } = await supabase
        .from('images')
        .select('*')
        .in('time_entry_id', ids);
    if (error) { console.error(error); return Object.fromEntries(ids.map((id) => [id, []])); }

    const grouped = Object.fromEntries(ids.map((id) => [id, []]));
    (data || []).forEach((img) => {
        const mapped = mapImage(img);
        const withUrl = { ...mapped, publicUrl: getImageUrl(mapped.storagePath) };
        if (!includeUnapproved && withUrl.moderationStatus !== 'approved') return;
        if (!grouped[withUrl.timeEntryId]) grouped[withUrl.timeEntryId] = [];
        grouped[withUrl.timeEntryId].push(withUrl);
    });
    return grouped;
}

export async function deleteImage(id) {
    const { data } = await supabase.from('images').select('storage_path').eq('id', id).single();
    if (data) {
        const { bucket, path } = decodeStoragePath(data.storage_path);
        const { error: storageError } = await supabase.storage.from(bucket).remove([path]);
        if (storageError) {
            console.warn('Failed to delete storage object:', storageError);
        }
    }
    const { error } = await supabase.from('images').delete().eq('id', id);
    if (error) console.error(error);
}

export async function getImageVoteSummary(imageIds) {
    const ids = [...new Set((imageIds || []).filter(Boolean))];
    if (ids.length === 0) return {};

    const session = await getSession();
    const currentUserId = session?.user?.id || null;
    const { data, error } = await supabase
        .from('image_votes')
        .select('image_id, user_id, vote')
        .in('image_id', ids);

    if (error) {
        if (isMissingSchemaError(error)) return {};
        console.error(error);
        throw error;
    }

    const byImage = {};
    for (const id of ids) {
        byImage[id] = { score: 0, totalVotes: 0, userVote: 0 };
    }

    for (const row of data || []) {
        if (!byImage[row.image_id]) {
            byImage[row.image_id] = { score: 0, totalVotes: 0, userVote: 0 };
        }
        byImage[row.image_id].score += row.vote;
        byImage[row.image_id].totalVotes += 1;
        if (currentUserId && row.user_id === currentUserId) {
            byImage[row.image_id].userVote = row.vote;
        }
    }

    return byImage;
}

export async function voteImage(imageId, projectId, vote) {
    const session = await getSession();
    if (!session) throw new Error('Must be signed in to vote');
    if (![1, -1, 0].includes(vote)) throw new Error('Vote must be 1, -1, or 0');

    if (vote === 0) {
        const { error } = await supabase
            .from('image_votes')
            .delete()
            .eq('image_id', imageId)
            .eq('user_id', session.user.id);
        if (error) { console.error(error); throw error; }
        return true;
    }

    const { error } = await supabase
        .from('image_votes')
        .upsert({
            image_id: imageId,
            project_id: projectId,
            user_id: session.user.id,
            vote
        }, { onConflict: 'image_id,user_id' });
    if (error) { console.error(error); throw error; }
    return true;
}

export async function getPrimaryPlaceImage(placeId) {
    const place = await getPlace(placeId);
    if (!place) return null;

    const entriesByPlace = await getTimeEntriesForPlaces([placeId]);
    const entries = entriesByPlace[placeId] || [];
    const imagesByEntryId = await getImagesForEntries(entries.map((entry) => entry.id));
    const allImages = collectPlaceTimelineImages(entries, imagesByEntryId);
    const voteMap = await getImageVoteSummary(allImages.map((image) => image.id));
    return pickPrimaryPlaceImage(place, allImages, voteMap);
}

export async function getPrimaryPlaceImages(places = [], { entriesByPlaceId = null } = {}) {
    const normalizedPlaces = (places || []).filter(Boolean);
    if (normalizedPlaces.length === 0) return {};

    const placeIds = normalizedPlaces.map((place) => place.id).filter(Boolean);
    const byPlaceId = Object.fromEntries(placeIds.map((id) => [id, null]));
    const resolvedEntriesByPlaceId = entriesByPlaceId || await getTimeEntriesForPlaces(placeIds);
    const entryIds = [...new Set(
        placeIds.flatMap((placeId) => (resolvedEntriesByPlaceId[placeId] || []).map((entry) => entry.id))
    )];

    if (entryIds.length === 0) return byPlaceId;

    const imagesByEntryId = await getImagesForEntries(entryIds);
    const voteMap = await getImageVoteSummary(
        entryIds.flatMap((entryId) => (imagesByEntryId[entryId] || []).map((image) => image.id))
    );

    for (const place of normalizedPlaces) {
        const entries = resolvedEntriesByPlaceId[place.id] || [];
        const allImages = collectPlaceTimelineImages(entries, imagesByEntryId);
        byPlaceId[place.id] = pickPrimaryPlaceImage(place, allImages, voteMap);
    }

    return byPlaceId;
}

export async function getBestImageForYear(placeId, year) {
    const place = await getPlace(placeId);
    if (!place) return null;

    const entriesByPlace = await getTimeEntriesForPlaces([placeId]);
    const entries = entriesByPlace[placeId] || [];
    const imagesByEntryId = await getImagesForEntries(entries.map((entry) => entry.id));
    const allImages = collectPlaceTimelineImages(entries, imagesByEntryId);
    const voteMap = await getImageVoteSummary(allImages.map((image) => image.id));
    return pickBestImageForYear(place, allImages, voteMap, year);
}

// ── Overview History ───────────────────────────────────────

export async function createOverviewRevision({ placeId, previousDescription, newDescription, reason = 'regenerate' }) {
    const place = await getPlace(placeId);
    if (!place) throw new Error('Place not found');

    const { data, error } = await supabase.from('place_overview_history').insert({
        place_id: placeId,
        project_id: place.projectId,
        previous_description: previousDescription || null,
        new_description: newDescription || null,
        reason
    }).select().single();

    if (error) { console.error(error); throw error; }
    return mapOverviewRevision(data);
}

export async function getOverviewHistory(placeId, limit = 12) {
    const { data, error } = await supabase
        .from('place_overview_history')
        .select('*')
        .eq('place_id', placeId)
        .order('created_at', { ascending: false })
        .limit(limit);

    if (error) { console.error(error); return []; }
    return (data || []).map(mapOverviewRevision);
}

export async function restoreOverviewRevision(revisionId) {
    const { data: revision, error } = await supabase
        .from('place_overview_history')
        .select('*')
        .eq('id', revisionId)
        .single();

    if (error) { console.error(error); throw error; }
    if (!revision) throw new Error('Revision not found');

    const place = await getPlace(revision.place_id);
    if (!place) throw new Error('Place not found');

    const currentDescription = place.description || '';
    const restoredDescription = revision.previous_description || '';
    const updatedPlace = await updatePlace(place.id, { description: restoredDescription });

    // Best effort audit trail for restore operations.
    try {
        await createOverviewRevision({
            placeId: place.id,
            previousDescription: currentDescription,
            newDescription: restoredDescription,
            reason: 'restore'
        });
    } catch (err) {
        console.warn('Failed to log overview restore revision:', err);
    }

    return updatedPlace;
}

// ── Comments ────────────────────────────────────────────────

export async function getComments(placeId) {
    const { data, error } = await supabase
        .from('comments')
        .select('*')
        .eq('place_id', placeId)
        .order('created_at', { ascending: true }); // Oldest first for a read-down thread

    if (error) {
        console.error('Error fetching comments:', error);
        return [];
    }
    return data;
}

export async function addComment(placeId, content) {
    if (!content || !content.trim()) throw new Error('Comment cannot be empty');

    const { data, error } = await supabase
        .from('comments')
        .insert({
            place_id: placeId,
            content: content.trim()
        })
        .select()
        .single();

    if (error) {
        console.error('Error adding comment:', error);
        throw error;
    }
    return data;
}

// ── Export ──────────────────────────────────────────────────

export async function exportProjectGeoJSON(projectId) {
    const project = await getProject(projectId);
    if (!project) throw new Error('Project not found');

    const places = await getPlacesByProject(projectId);
    const features = [];

    for (const place of places) {
        const entries = await getTimeEntriesForPlace(place.id);
        const entriesWithImages = [];

        for (const entry of entries) {
            const images = await getImagesForEntry(entry.id);
            entriesWithImages.push({
                ...entry,
                images: images.map(img => ({
                    id: img.id,
                    caption: img.caption,
                    yearTaken: img.yearTaken,
                    credit: img.credit,
                    publicUrl: img.publicUrl
                }))
            });
        }

        features.push({
            type: "Feature",
            geometry: {
                type: "Point",
                coordinates: [place.lng, place.lat]
            },
            properties: {
                id: place.id,
                name: place.name,
                aliases: (place.aliases || []).map(a => ({
                    name: a.alias,
                    startYear: a.startYear,
                    endYear: a.endYear
                })),
                category: place.category,
                createdAt: place.createdAt,
                entries: entriesWithImages
            }
        });
    }

    return {
        type: "FeatureCollection",
        metadata: {
            projectId: project.id,
            name: project.name,
            description: project.description,
            exportedAt: new Date().toISOString()
        },
        features
    };
}
