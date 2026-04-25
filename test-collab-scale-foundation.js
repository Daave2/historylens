import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = path.dirname(fileURLToPath(import.meta.url));

const sql = fs.readFileSync(path.join(ROOT_DIR, 'supabase/phase24_collab_scale_foundation.sql'), 'utf8');
const store = fs.readFileSync(path.join(ROOT_DIR, 'src/data/store.js'), 'utf8');
const plan = fs.readFileSync(path.join(ROOT_DIR, 'PROJECT_COLLAB_SCALE_PLAN.md'), 'utf8');

[
    'CREATE TABLE IF NOT EXISTS public.project_role_events',
    'ADD COLUMN IF NOT EXISTS assigned_to',
    'ADD COLUMN IF NOT EXISTS priority',
    'CREATE TRIGGER trg_project_role_events',
    'idx_mod_submissions_project_status_type_created',
    'idx_project_roles_project_role_created',
    'idx_time_entries_place_years',
    'CREATE OR REPLACE FUNCTION public.is_project_owner',
    'SET search_path = public'
].forEach((needle) => {
    assert.ok(sql.includes(needle), `phase24 SQL should include ${needle}`);
});

[
    'export async function getReviewQueue',
    'export async function getProjectRoleEvents',
    'export async function getAssignableReviewers',
    'export async function updateModerationQueueMeta',
    'REVIEW_QUEUE_SELECT',
    'hasQueueFields'
].forEach((needle) => {
    assert.ok(store.includes(needle), `store should include ${needle}`);
});

const projectSettings = fs.readFileSync(path.join(ROOT_DIR, 'src/components/ProjectSettings.js'), 'utf8');
[
    'mod-sub-assignee',
    'getAssignableReviewers',
    'assignedTo'
].forEach((needle) => {
    assert.ok(projectSettings.includes(needle), `Project Settings should include ${needle}`);
});

[
    'Phase 24: Collaboration Model Hardening',
    'Phase 26: Scale The Read Path',
    'Recommended Next Sprint'
].forEach((needle) => {
    assert.ok(plan.includes(needle), `collab scale plan should include ${needle}`);
});

console.log('Collaboration scale foundation smoke check passed.');
