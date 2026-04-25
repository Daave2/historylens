import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

const placeDetail = fs.readFileSync(path.join(ROOT_DIR, 'src/components/PlaceDetail.js'), 'utf8');
const entryForm = fs.readFileSync(path.join(ROOT_DIR, 'src/components/EntryForm.js'), 'utf8');
const main = fs.readFileSync(path.join(ROOT_DIR, 'src/main.js'), 'utf8');
const store = fs.readFileSync(path.join(ROOT_DIR, 'src/data/store.js'), 'utf8');
const phase21 = fs.readFileSync(path.join(ROOT_DIR, 'supabase/phase21_community_workflow.sql'), 'utf8');
const phase25 = fs.readFileSync(path.join(ROOT_DIR, 'supabase/phase25_sources.sql'), 'utf8');

const createEntryCalls = [...main.matchAll(/createTimeEntry\(\{[\s\S]*?\n\s*\}\)/g)].map((match) => match[0]);
const suggestionCall = main.match(/submitEntrySuggestion\(\{[\s\S]*?\n\s*\}\)/)?.[0] || '';

assert.ok(placeDetail.includes('safeUrl(src.url)'), 'source chips should sanitize source URLs before rendering hrefs');
assert.ok(entryForm.includes('canCreateStructuredSources'), 'suggestion mode should not expose source creation controls');
assert.ok(suggestionCall.includes('linkedSourceId: data.linkedSourceId || null'), 'entry suggestions should submit linked structured source IDs');
assert.ok(createEntryCalls.every((call) => !call.includes('linkedSourceId')), 'direct entry creation should link structured sources after the entry has an id');
assert.ok(store.includes('linkedSourceId = null'), 'submitEntrySuggestion should accept linkedSourceId');
assert.ok(store.includes('linkedSourceId: linkedSourceId || null'), 'submitEntrySuggestion should persist linkedSourceId in moderation payload');
assert.ok(phase21.includes("v_payload->>'linkedSourceId'"), 'approval RPC should read linkedSourceId from entry submission payload');
assert.ok(phase21.includes('public.entry_sources'), 'approval RPC should link approved entry submissions to structured sources when available');
assert.ok(phase21.includes('project_id = $2'), 'approval RPC should check the linked source belongs to the reviewed project');
assert.ok(phase25.includes('JOIN public.sources s ON s.id = entry_sources.source_id AND s.project_id = p.project_id'), 'entry_sources insert policy should enforce same-project source links');
assert.ok(phase25.includes('CREATE OR REPLACE FUNCTION public.review_moderation_submission'), 'Phase 25 migration should update the review RPC for already-upgraded projects');
assert.ok(phase25.includes("v_payload->>'linkedSourceId'"), 'Phase 25 review RPC should preserve structured source links on approval');

console.log('Citation hardening smoke check passed.');
