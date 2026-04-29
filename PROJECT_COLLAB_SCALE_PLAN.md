# Project Collaboration And Scale Plan

## Goal

Move HistoryLens from a small-team map editor to a community-scale project workspace where many contributors can suggest, review, discuss, and improve local history without the app becoming noisy, slow, or hard to moderate.

The current app already has a useful collaboration base: project roles, access requests, pending submissions, reviewer notes, Talk comments, bans, image voting, overview history, and smoke tests. The next phase should keep that foundation but make two things much stronger:

- Trust: clearer roles, review flows, audit trails, notifications, and source handling.
- Scale: bounded database reads, paginated queues, viewport map loading, server-side search, and query/RLS tuning.

## Current Baseline

Already in place:

- Roles: owner, admin, editor, pending, banned.
- Access requests through `project_roles`.
- Moderation submissions for new places, timeline entries, moves, and historical names.
- Reviewer approve/reject notes and contributor-visible moderation history.
- Project Settings inbox counts for pending access and submissions.
- Talk comments on places.
- Image uploads, image voting, and primary image selection.
- Place overview revision history and historical-name history.
- Smoke commands for build, read-only Supabase access, enrichment, and authenticated moderation when credentials exist.

Main scale risks:

- `Sidebar.loadPlaces()` loads every place, every entry, and primary-image candidates for the whole project.
- Search is client-side across all loaded place and entry text.
- Place detail still does several related reads and loops over entry images.
- Export loops through places, entries, and images.
- Moderation fetches a fixed recent slice and filters it in the browser.
- Some RLS helper patterns are correct functionally but should be tuned before large tables.
- Research links are currently stored in timeline summaries instead of structured source/link tables.

## Phase 24: Collaboration Model Hardening

Purpose: make permissions and contributor states easier to reason about before the project grows.

Tasks:

1. Define a capability matrix in README and code comments:
   - guest: read public projects.
   - signed-in viewer: request access and submit public suggestions where allowed.
   - contributor: submit suggestions and Talk comments, but cannot publish directly.
   - editor: create and edit published content.
   - admin: review submissions, manage contributors, moderate.
   - owner: project deletion, billing/export/final authority.
   - banned: read-only or blocked interaction depending project visibility.

2. Stop overloading `pending` long-term.
   - Keep existing behavior for compatibility.
   - Plan a migration from `project_roles.role = 'pending'` to either `access_requests` plus `contributor`, or a clearer `requested`/`contributor` split.
   - Preserve current UX while making the database semantics less muddy.

3. Add role and access audit history.
   - Record who approved, rejected, promoted, demoted, banned, unbanned, or removed someone.
   - Show recent access decisions in Project Settings.

4. Add invitation support.
   - Invite by email.
   - Let owners/admins pre-grant contributor/editor/admin access before the person signs in.
   - Show pending invites separately from access requests.

5. Add reviewer assignment and queue state.
   - `assigned_to`, `priority`, `review_started_at`, and optional internal note fields on moderation submissions.
   - Filter by assignee and priority.

Definition of done:

- A project owner can tell exactly who can do what.
- Reviewer actions have an audit trail.
- Access requests, invitations, and contributor permissions are distinct in the UI and database.

## Phase 25: Review Workflow Upgrade

Purpose: help admins review many suggestions without losing context.

Tasks:

1. Add rich diff previews for moderation cards.
   - New place: map preview, proposed name/category, seed entries.
   - Timeline entry: target place, date range, source, confidence, summary.
   - Move: before/after map coordinates.
   - Historical name: old/new labels and years.

2. Add contributor feedback loop.
   - Contributor sees status, reviewer note, reviewed date, and published target link.
   - Add "needs changes" later if we want back-and-forth without rejecting.

3. Add bulk and keyboard review tools.
   - Bulk reject obvious spam.
   - Bulk approve trusted low-risk suggestions.
   - Keyboard actions for next/approve/reject.

4. Add moderation guardrails.
   - Detect duplicate nearby place suggestions.
   - Detect duplicate timeline entries on the same place/year/title.
   - Warn when a suggestion touches a locked or high-sensitivity place.

5. Add structured source capture.
   - Introduce `sources` and `entry_sources` tables.
   - Move research lead links out of summary text over time.
   - Keep a compatibility parser for existing saved summaries.

Definition of done:

- Reviewers can process a queue by priority/status/type without opening every place manually.
- Contributors can understand what happened to their suggestions.
- Published entries can carry structured citations instead of only free text.

Current status (Phase 25):

- ✅ Rich diff previews added for all 4 submission types (place_create, entry_create, place_move, place_name_alias).
- ✅ `sources` and `entry_sources` tables created with full RLS and indexes.
- ✅ Store layer has CRUD for sources + batch entry source lookups.
- ✅ Timeline entries render structured source citation chips.
- ✅ EntryForm has inline source search/create/link workflow.
- ✅ Structured source links are sanitized, preserved through entry suggestions, and constrained to the same project on approval.
- ✅ Bulk review tools: select-all checkbox, bulk approve/reject with shared note prompt.
- ✅ Keyboard shortcuts: J/K navigate pending cards, A approve, R reject (scoped to modal).
- ✅ Duplicate detection: warns on nearby places (<50m) or same-name/same-year entries.
- Remaining: contributor feedback loop enhancements ("needs changes" status).

## Phase 26: Scale The Read Path

Purpose: stop loading whole projects into the browser.

Tasks:

1. Add scale-oriented indexes.
   - `places(project_id, category, created_at desc)`.
   - `time_entries(place_id, year_start, year_end)`.
   - `images(time_entry_id, moderation_status)`.
   - `comments(place_id, created_at)`.
   - `project_roles(project_id, role, created_at desc)`.
   - `moderation_submissions(project_id, status, submission_type, created_at desc)`.
   - Add or verify all foreign-key indexes for cascade/delete paths.

2. Tune RLS for large tables.
   - Wrap `auth.uid()` calls in `select auth.uid()` where policies compare per-row user IDs.
   - Ensure helper functions have explicit `set search_path = public`.
   - Keep helper lookups indexed.
   - Re-check policies for `pending`/future `contributor` visibility.

3. Add bounded RPC/read APIs.
   - `get_project_map_snapshot(project_id, bbox, year, category, search, cursor, limit)`.
   - `get_place_detail_bundle(place_id)` for place, entries, images, comments, overview history, aliases, and profiles.
   - `get_project_year_bounds(project_id)` using an aggregate query.
   - `get_review_queue(project_id, status, type, cursor, limit)`.

4. Update the frontend loading model.
   - Load markers by viewport bounds rather than entire project.
   - Debounce map movement and search.
   - Server-side search for names, aliases, sources, entry titles, and summaries.
   - Virtualize the sidebar list for large result sets.
   - Load primary images lazily or only for visible sidebar rows.

5. Batch export paths.
   - Replace per-place/per-entry loops with batched reads.
   - Add progress feedback and cancellation for large exports.
   - Consider server-side export generation for very large projects.

Definition of done:

- A project with thousands of places remains usable without fetching every row on first load.
- Review and comment screens paginate instead of growing indefinitely.
- Place detail opens through one bundled read rather than several dependent reads.

Current status (Phase 26):

- ✅ Phase 26 read-path foundation added with `get_project_map_snapshot`, `get_project_year_bounds`, viewport snapshot loading, server-side sidebar search/category filters, and marker state summaries.
- ✅ Bounded snapshot cursors are wired into the sidebar with a "Load more places" control so large result sets can page in without reverting to full-project loads.
- ✅ Place detail now has a bundled read RPC for place, aliases, entries, images, votes, comments, history, citations, and profiles.
- Remaining: paginated review queue RPC, export batching, sidebar virtualization, and large-dataset performance testing.

## Phase 27: Realtime And Presence

Purpose: make collaboration feel alive without introducing edit conflicts.

Tasks:

1. Add project activity feed.
   - New place, new entry, approved suggestion, rejected suggestion, comment, role change.
   - Show recent activity in sidebar or Project Settings.

2. Add realtime refresh for low-risk events.
   - Inbox counts.
   - New comments on the open place.
   - Submission status changes for the current user.
   - Marker updates after moderation approval.

3. Add soft edit presence.
   - "Someone else is editing this place" indicator.
   - Avoid hard locks at first.
   - Use updated timestamps and compare-before-save warnings for place/entry edits.

4. Add notifications.
   - In-app notification center first.
   - Email digests later for owners/admins and contributors.

Definition of done:

- Reviewers do not need to refresh to see new queue counts.
- Contributors can see when their work has been reviewed.
- Editors get conflict warnings rather than silent overwrites.

## Phase 28: Operations And Observability

Purpose: keep the system debuggable as data and contributors grow.

Tasks:

1. Add a seed/performance dataset.
   - Generate 1k, 5k, and 25k place test projects.
   - Include entries, aliases, comments, images, votes, and submissions.

2. Add performance smoke tests.
   - Map snapshot query budget.
   - Place detail bundle budget.
   - Review queue query budget.
   - Export batch budget.

3. Add database diagnostics.
   - Use `pg_stat_statements` in Supabase.
   - Capture slow query examples.
   - Document expected indexes and run a missing-index check.

4. Tighten migration discipline.
   - Create a canonical fresh-schema path.
   - Fold old phase drift into a new baseline once Phase 24/25 are stable.
   - Keep incremental migrations for deployed projects.

5. Add admin safety tools.
   - Project backup/export before destructive actions.
   - Restore deleted place/entry where possible.
   - Safer "wipe contributions" preview before commit.

Definition of done:

- We can reproduce scale issues locally.
- Slow queries point to specific fixes.
- Destructive moderation actions are harder to trigger accidentally.

## Recommended Next Sprint

The first foundation slice has been implemented locally:

- `supabase/phase24_collab_scale_foundation.sql` adds review queue metadata, access audit events, scale indexes, and tuned helper functions.
- Store helpers now expose a bounded review queue, assignable reviewers, access activity events, and queue metadata updates.
- Project Settings uses the bounded queue and shows access activity plus priority and reviewer assignment controls when the migration is present.
- `npm run smoke:collab-scale` checks that the Phase 24 foundation files remain wired into the repo.

Next, continue with Phase 26 (Scale The Read Path):

1. Apply the Phase 24 + Phase 25 migrations to the live Supabase project.
2. Build the `get_project_map_snapshot` RPC for viewport-bounded marker loading. ✅ Phase 26 read-path foundation added locally.
3. Switch sidebar/map loading from full-project fetch to bounded viewport queries. ✅ Initial bounded snapshot UI path added locally.
4. Add server-side search for names, aliases, sources, entry titles, and summaries.
5. Add remaining Phase 25 items (bulk review, duplicate detection) as they become needed.

Current status (Phase 26):

- ✅ `supabase/phase26_scale_read_path.sql` adds `get_project_map_snapshot` and `get_project_year_bounds`.
- ✅ Store helpers expose `getProjectMapSnapshot` with a pre-migration fallback.
- ✅ Store helpers expose `getPlaceDetailBundle` with a pre-migration fallback.
- ✅ `getProjectYearRange` now prefers the bounded year-bounds RPC before falling back to client aggregation.
- ✅ Sidebar/map loading now refreshes from bounded viewport snapshots on map movement, search/category changes, and year changes.
- ✅ Place detail now hydrates through the bundled read helper instead of separate entry/image/comment/history/source calls.
- ✅ `npm run smoke:scale-read` covers the Phase 26 read-path wiring.
- ✅ Phase 27 project chat adds a realtime-backed project chat drawer for meeting notes, shared leads, and quick coordination.
- Remaining: apply Phase 27 live, paginated review queue RPC, export batching, sidebar virtualization, and performance-test with generated large projects.

## Watchpoints

- Do not make pending contributors direct editors by accident.
- Keep public read behavior separate from write/review behavior.
- Avoid storing new structured data only inside JSON payloads if it needs filtering.
- Do not depend on client-side filtering for review queues or map search at scale.
- Keep every scale change compatible with existing projects and submissions.
