# Next Phase Plan

## Recommendation

The next phase should be a stabilization-and-shipping phase for the new collaboration model, not another broad feature phase.

HistoryLens already has the shape of the product we want: collaborative projects, access requests, moderation submissions, historic names, alias history, overview history, image voting, and a cleaner onboarding flow. The biggest risk now is not missing feature surface. It is drift between the current UI, the real data model, and the deployment path.

## Why This Phase Now

- The app builds successfully with `npm run build`, so the current codebase is in a usable state.
- Local `main` is behind `origin/main` by two commits, and the upstream delta is directly relevant to the current historic-name workflow.
- The repo docs and runtime behavior have drifted in a few important places:
  - The README still tells fresh setups to apply `supabase/schema.sql`, but newer collaboration features live in later SQL files such as `supabase/phase21_community_workflow.sql` and `supabase/phase22_alias_history.sql`.
  - Import and CSV export still read from the old Dexie browser store in `src/data/io.js`, while the live app writes to Supabase through `src/data/store.js`.
  - There is no real test runner or E2E coverage in `package.json`.
  - The PWA shell exists, but service-worker registration is intentionally disabled in `src/main.js`.
  - The one smoke script, `test-geojson.js`, currently fails because it imports `dotenv` even though `dotenv` is not installed.

## Evidence

- Product docs still describe import/export as a first-class feature: `README.md`
- Fresh setup still points to the older schema entrypoint: `README.md`
- Canonical schema file stops before the current moderation and alias-history tables: `supabase/schema.sql`
- New collaboration tables and policies are defined separately:
  - `supabase/phase21_community_workflow.sql`
  - `supabase/phase22_alias_history.sql`
- Active UI imports and CSV export still depend on Dexie-backed utilities:
  - `src/main.js`
  - `src/data/io.js`
  - `src/data/db.js`
- Service worker registration is currently in cleanup-only mode: `src/main.js`
- Talk permissions are inconsistent:
  - UI only allows posting when the user can add entries: `src/components/PlaceDetail.js`
  - Database policy allows any authenticated user to insert comments: `supabase/phase12_comments.sql`

## Phase Goal

Make the collaboration release trustworthy enough to deploy, demo, and build on without tripping over data drift or unclear permissions.

## Workstream 1: Data and Deployment Correctness

Priority: `P0`

1. Make import/export use the same source of truth as the live app.
2. Define one canonical database setup path for new environments.
3. Replace or remove unsupported smoke scripts.
4. Update the README so setup, deploy, and local testing match the real codebase.

### Concrete tasks

- Replace the Dexie-backed JSON import/export and CSV export in `src/data/io.js` with Supabase-backed implementations.
- If that work will not fit immediately, temporarily hide broken import flows rather than leaving them exposed.
- Decide whether `supabase/schema.sql` becomes the full current schema or whether the project moves to an explicit ordered migration path.
- Document the exact SQL bootstrap order in the README if migrations remain split by phase.
- Fix or retire `test-geojson.js`.

## Workstream 2: Finish the Community Review Loop

Priority: `P0` to `P1`

1. Sync with `origin/main` first so the upstream historic-name restore work lands before we build on top of it.
2. Make the moderation flow feel complete for both reviewers and contributors.
3. Align comment, suggestion, and access-request permissions across UI and RLS.

### Concrete tasks

- Pull in the upstream historic-name restore/revert changes before starting new UI work in that area.
- Show reviewer notes and decision history back to contributors, not only inside the reviewer panel.
- Add queue filters in project moderation for status and submission type once the base flow is stable.
- Decide how entry suggestions should handle images. Right now the UI explicitly blocks image attachment until after approval.
- Decide whether Talk should be:
  - edit-role only, matching the UI today, or
  - available to all signed-in collaborators/viewers, matching the current comment insert policy.
- Enforce that Talk decision in both the UI and the database.

## Workstream 3: Verification and Release Safety

Priority: `P0`

1. Add an actual automated test path.
2. Cover the handful of workflows that are most likely to regress.
3. Create a minimal local bootstrap path for contributors.

### Concrete tasks

- Add a test script to `package.json`.
- Start with focused smoke coverage for:
  - project load
  - place creation or suggestion
  - entry suggestion and moderation approval
  - historic-name add/edit/delete/restore
  - export path
- Add a lightweight local bootstrap or seed path for Supabase-backed development.

## Workstream 4: Performance and Offline Polish

Priority: `P2`

This is worth doing after the data and workflow contracts are stable.

### Concrete tasks

- Cache project places and entries during time-slider interaction so we do not refetch every place on every year change.
- Reduce N+1 fetching for sidebar thumbnails and hover-card data.
- Revisit service-worker registration only after the startup path is confirmed stable in production.
- Add caching or throttling around external geocoding and historical lookup requests where needed.

## Suggested Sequence

1. Sync local `main` with `origin/main`.
2. Fix the data/export/schema drift.
3. Add a real verification path.
4. Close the moderation and permissions gaps.
5. Do a smaller performance/offline polish pass.

## Definition of Done for This Phase

- A fresh environment can be bootstrapped from the repo docs without guesswork.
- Import/export uses the same Supabase-backed data model as the app itself.
- Historic-name moderation and restore flows are merged and working.
- Talk permissions are consistent between UI copy and database policy.
- A small automated smoke suite exists and runs from `package.json`.
- The deployment path is documented clearly enough that another contributor can ship it without tribal knowledge.
