# Next Phase Status

This pass moved HistoryLens out of the "inventory the risks" stage and into a mostly stabilized Phase 23 baseline. The app now has a clearer Supabase-first data path, a documented bootstrap sequence, reviewer-visible moderation history, and lightweight smoke coverage for the paths that were easiest to regress.

## Completed

- Synced the local branch with `origin/main` before making changes.
- Removed the stale Dexie dependency and migrated import/export flows to the Supabase store layer.
- Updated README setup notes so fresh projects use the current schema sequence through `supabase/phase23_comment_policy_alignment.sql`.
- Added `npm run smoke:geojson` and fixed its Supabase-backed export path.
- Added `npm run smoke:moderation`, which performs a real owner/contributor moderation flow when test account environment variables are present and skips cleanly otherwise.
- Aligned Talk/comment policies with the contributor UX by adding `supabase/phase23_comment_policy_alignment.sql`.
- Added contributor-facing moderation history with reviewer notes for rejected and approved submissions.
- Added reviewer filters in Project Settings for status and submission type.
- Made entry suggestion image handling explicit: suggested entries do not accept images until approval because uploaded images need a real `time_entries.id`.
- Reduced sidebar and timeline data churn with batched image lookups, cached place/entry state, and incremental marker updates.
- Added `npm run seed:demo` for authenticated repeatable demo data.
- Added `npm run verify` as the one-command local build/smoke baseline.
- Cleared npm audit findings by removing unused `uuid`, updating Vite to `7.3.2`, and applying transitive patch fixes.
- Hardened service-worker behavior behind an explicit `VITE_ENABLE_SERVICE_WORKER=true` opt-in.
- Reworked place seed enrichment to prefer OSM/Wikidata/Wikipedia evidence and show generic research leads without auto-saving them.

## Remaining

1. Apply `supabase/phase23_comment_policy_alignment.sql` to the live Supabase project.
2. Configure smoke-test accounts locally or in CI:
   - `HISTORYLENS_SMOKE_OWNER_EMAIL`
   - `HISTORYLENS_SMOKE_OWNER_PASSWORD`
   - `HISTORYLENS_SMOKE_CONTRIBUTOR_EMAIL`
   - `HISTORYLENS_SMOKE_CONTRIBUTOR_PASSWORD`
   - optional `HISTORYLENS_SMOKE_PROJECT_ID`
3. Run the full authenticated moderation smoke test after those accounts exist.
4. Re-check map/sidebar performance with a larger production-like dataset.
5. Run a browser offline/auth pass before enabling `VITE_ENABLE_SERVICE_WORKER` in production.

## Current Verification

- `npm run build` passes.
- `npm run verify` runs the production build plus both smoke checks.
- `npm run smoke:geojson` passes against the current Supabase data.
- `npm run smoke:moderation` exits successfully and reports a skip unless smoke account credentials are configured.
- `npm run seed:demo` is available for authenticated demo data seeding.
- `npm audit --audit-level=moderate` reports 0 vulnerabilities.

## Working Definition Of Done

- A new clone can follow README setup without relying on legacy phase files.
- Import/export, map markers, time filtering, moderation review, and contributor feedback all use the Supabase-backed path.
- Comment/Talk permissions match the documented contributor model.
- Lightweight smoke commands exist for anonymous export behavior and authenticated moderation behavior.
- Remaining production work is explicit and no longer mixed with already-completed cleanup.
