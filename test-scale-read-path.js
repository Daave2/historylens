import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

const phase26 = fs.readFileSync(path.join(ROOT_DIR, 'supabase/phase26_scale_read_path.sql'), 'utf8');
const store = fs.readFileSync(path.join(ROOT_DIR, 'src/data/store.js'), 'utf8');
const sidebar = fs.readFileSync(path.join(ROOT_DIR, 'src/components/Sidebar.js'), 'utf8');
const placeDetail = fs.readFileSync(path.join(ROOT_DIR, 'src/components/PlaceDetail.js'), 'utf8');
const mapView = fs.readFileSync(path.join(ROOT_DIR, 'src/components/MapView.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT_DIR, 'src/main.js'), 'utf8');
const styles = fs.readFileSync(path.join(ROOT_DIR, 'src/styles/index.css'), 'utf8');
const readme = fs.readFileSync(path.join(ROOT_DIR, 'README.md'), 'utf8');
const plan = fs.readFileSync(path.join(ROOT_DIR, 'PROJECT_COLLAB_SCALE_PLAN.md'), 'utf8');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));

assert.ok(phase26.includes('CREATE OR REPLACE FUNCTION public.get_project_map_snapshot'), 'Phase 26 should define the bounded map snapshot RPC');
assert.ok(phase26.includes('CREATE OR REPLACE FUNCTION public.get_project_year_bounds'), 'Phase 26 should define the year bounds RPC');
assert.ok(phase26.includes('CREATE OR REPLACE FUNCTION public.get_place_detail_bundle'), 'Phase 26 should define the bundled place-detail RPC');
assert.ok(phase26.includes('idx_places_project_lat_lng'), 'Phase 26 should add a project + bbox-friendly places index');
assert.ok(phase26.includes('idx_time_entries_place_year_created'), 'Phase 26 should add a per-place timeline index for detail bundles');
assert.ok(phase26.includes('LIMIT v_limit + 1'), 'map snapshot RPC should fetch one extra row for cursor pagination');
assert.ok(!/\bOFFSET\b/i.test(phase26), 'Phase 26 read RPCs should avoid OFFSET pagination');
assert.ok(phase26.includes('p_cursor_created_at') && phase26.includes('p_cursor_id'), 'map snapshot RPC should accept a composite cursor');
assert.ok(phase26.includes('public.is_project_public') && phase26.includes('public.has_project_role'), 'map snapshot RPC should enforce project visibility');
assert.ok(phase26.includes("v_category = 'other'"), 'map snapshot RPC should preserve the sidebar Other category semantics');
assert.ok(phase26.includes('p.lng >= v_min_lng OR p.lng <= v_max_lng'), 'map snapshot RPC should handle anti-meridian bbox wrapping');
assert.ok(phase26.includes('public.entry_sources') && phase26.includes('public.sources'), 'map snapshot search should include structured source links');

assert.ok(store.includes('export async function getProjectMapSnapshot'), 'store should expose getProjectMapSnapshot');
assert.ok(store.includes("supabase.rpc('get_project_map_snapshot'"), 'store should call the map snapshot RPC');
assert.ok(store.includes("supabase.rpc('get_project_year_bounds'"), 'getProjectYearRange should prefer the bounded year-bounds RPC');
assert.ok(store.includes('export async function getPlaceDetailBundle'), 'store should expose getPlaceDetailBundle');
assert.ok(store.includes("supabase.rpc('get_place_detail_bundle'"), 'store should call the bundled place-detail RPC');
assert.ok(store.includes('getPlaceDetailBundleFallback'), 'store should keep a fallback before the place-detail bundle migration is applied');
assert.ok(store.includes('getProjectMapSnapshotFallback'), 'store should keep a fallback before Phase 26 is applied');

assert.ok(sidebar.includes('getProjectMapSnapshot'), 'Sidebar should load map rows from the bounded snapshot helper');
assert.ok(sidebar.includes('usesBoundedSnapshots'), 'Sidebar should track when server-side snapshot filtering is active');
assert.ok(sidebar.includes('placeSummariesById') && sidebar.includes('markerStatesByPlaceId'), 'Sidebar should render snapshot entry summaries and marker states without loading all entries');
assert.ok(sidebar.includes('snapshotProjectHasPlaces'), 'Sidebar should distinguish an empty project from an empty viewport snapshot');
assert.ok(sidebar.includes('snapshotNextCursor') && sidebar.includes('cursor: append ? this.snapshotNextCursor : null'), 'Sidebar should pass the snapshot cursor when loading additional rows');
assert.ok(sidebar.includes('renderSnapshotLoadMore') && sidebar.includes('place-list-more'), 'Sidebar should render a load-more control for paged snapshots');
assert.ok(mapView.includes('getViewportBounds'), 'MapView should expose padded viewport bounds for snapshot queries');
assert.ok(main.includes('mapView.map.on(\'moveend\''), 'main should refresh bounded snapshots after map movement');
assert.ok(main.includes('onQueryChange: () => queueSnapshotRefresh()'), 'main should refresh bounded snapshots after sidebar search/category changes');
assert.ok(main.includes('onLoadMore: () => loadProjectSnapshot({ append: true })'), 'main should wire snapshot load-more requests back through the shared refresh path');
assert.ok(main.includes('updateMarkerStates(mapView, sidebar.places, sidebar.entriesByPlaceId, selectedYear, sidebar.markerStatesByPlaceId)'), 'main should apply server-provided marker states');
assert.ok(placeDetail.includes('getPlaceDetailBundle') && placeDetail.includes('entriesWithImages'), 'PlaceDetail should hydrate from the bundled detail helper');
assert.ok(styles.includes('.place-list-more'), 'CSS should style the snapshot load-more control');

assert.ok(readme.includes('supabase/phase26_scale_read_path.sql'), 'README setup should include Phase 26 migration');
assert.ok(plan.includes('get_project_map_snapshot') && plan.includes('Phase 26 read-path foundation'), 'collaboration/scale plan should track Phase 26 read-path status');
assert.ok(pkg.scripts.verify.includes('smoke:scale-read'), 'npm run verify should include the scale read-path smoke test');

console.log('Scale read-path smoke check passed.');
