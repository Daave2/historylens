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

const mapPlace = (row) => ({
    id: row.id,
    projectId: row.project_id,
    name: row.name,
    description: row.description,
    lat: row.lat,
    lng: row.lng,
    category: row.category,
    createdBy: row.created_by,
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
    createdBy: row.created_by,
    createdAt: new Date(row.created_at)
});

// Helper for generating public URLs
const getImageUrl = (path) => {
    const { data } = supabase.storage.from('entry_images').getPublicUrl(path);
    return data.publicUrl;
};

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

    return roles.map(r => ({ ...r, email: emailMap[r.user_id] || 'Unknown User' }));
}

export async function requestAccess(projectId) {
    const session = await getSession();
    if (!session) throw new Error("Must be signed in");

    const { data, error } = await supabase.from('project_roles').insert({
        project_id: projectId,
        user_id: session.user.id,
        role: 'pending'
    }).select().single();

    if (error) { console.error(error); throw error; }
    return data;
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

// ── Places ────────────────────────────────────────────────

export async function createPlace({ projectId, name, description, lat, lng, category }) {
    const { data, error } = await supabase.from('places').insert({
        project_id: projectId,
        name: name || 'Unnamed Place',
        description: description || null,
        lat,
        lng,
        category: category || 'residential'
    }).select().single();
    if (error) { console.error(error); throw error; }
    return mapPlace(data);
}

export async function updatePlace(id, changes) {
    const update = { ...changes };
    if (changes.projectId) { update.project_id = changes.projectId; delete update.projectId; }
    if (changes.description !== undefined) { update.description = changes.description || null; }

    const { data, error } = await supabase.from('places').update(update).eq('id', id).select().single();
    if (error) { console.error(error); throw error; }
    return mapPlace(data);
}

export async function deletePlace(id) {
    const { error } = await supabase.from('places').delete().eq('id', id);
    if (error) console.error(error);
}

export async function getPlacesByProject(projectId) {
    const { data, error } = await supabase.from('places').select('*').eq('project_id', projectId);
    if (error) { console.error(error); return []; }
    return data.map(mapPlace);
}

export async function getPlace(id) {
    const { data, error } = await supabase.from('places').select('*').eq('id', id).single();
    if (error) { console.error(error); return null; }
    return mapPlace(data);
}

// ── Time Entries ──────────────────────────────────────────

export async function createTimeEntry({ placeId, yearStart, yearEnd, title, summary, source, sourceType, confidence }) {
    const { data, error } = await supabase.from('time_entries').insert({
        place_id: placeId,
        year_start: yearStart || new Date().getFullYear(),
        year_end: yearEnd || null,
        title: title || '',
        summary: summary || '',
        source: source || '',
        source_type: sourceType || 'user',
        confidence: confidence || 'likely'
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
    const { error } = await supabase.from('time_entries').delete().eq('id', id);
    if (error) console.error(error);
}

export async function getTimeEntriesForPlace(placeId) {
    const { data, error } = await supabase.from('time_entries').select('*').eq('place_id', placeId).order('year_start', { ascending: true });
    if (error) { console.error(error); return []; }
    return data.map(mapEntry);
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

    let min = Infinity, max = -Infinity;
    for (const p of places) {
        const entries = await getTimeEntriesForPlace(p.id);
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

export async function addImage({ timeEntryId, blob, caption, yearTaken, credit }) {
    const ext = blob.type.split('/')[1] || 'jpg';
    const filename = `${timeEntryId}/${Date.now()}_${Math.random().toString(36).substring(7)}.${ext}`;

    const { error: storageError } = await supabase.storage.from('entry_images').upload(filename, blob, {
        cacheControl: '3600',
        upsert: false
    });
    if (storageError) { console.error('Upload error', storageError); throw storageError; }

    const { data, error } = await supabase.from('images').insert({
        time_entry_id: timeEntryId,
        storage_path: filename,
        caption: caption || '',
        year_taken: yearTaken || null,
        credit: credit || ''
    }).select().single();

    if (error) { console.error(error); throw error; }
    const img = mapImage(data);
    return { ...img, publicUrl: getImageUrl(img.storagePath) };
}

export async function getImagesForEntry(timeEntryId) {
    const { data, error } = await supabase.from('images').select('*').eq('time_entry_id', timeEntryId);
    if (error) { console.error(error); return []; }

    return data.map(img => {
        const mapped = mapImage(img);
        return { ...mapped, publicUrl: getImageUrl(mapped.storagePath) };
    });
}

export async function deleteImage(id) {
    const { data } = await supabase.from('images').select('storage_path').eq('id', id).single();
    if (data) await supabase.storage.from('entry_images').remove([data.storage_path]);
    const { error } = await supabase.from('images').delete().eq('id', id);
    if (error) console.error(error);
}

export async function getBestImageForYear(placeId, year) {
    const entries = await getTimeEntriesForPlace(placeId);
    const allImages = [];
    for (const e of entries) {
        const images = await getImagesForEntry(e.id);
        for (const img of images) {
            allImages.push({ ...img, entryYearStart: e.yearStart, effectiveYear: img.yearTaken || e.yearStart });
        }
    }
    if (allImages.length === 0) return null;
    allImages.sort((a, b) => Math.abs(a.effectiveYear - year) - Math.abs(b.effectiveYear - year));
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
