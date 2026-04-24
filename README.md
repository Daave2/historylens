# HistoryLens

HistoryLens is a Vite-based web app for mapping local history as places plus timeline entries on an interactive map. It combines a browser frontend (Leaflet) with Supabase for auth, data, collaboration, and optional AI features.

## Who It Is For

- Local history researchers
- Heritage/community groups
- Collaborative contributors documenting place-based history

## Key Features

- Interactive map with category-based place markers
- Timeline entries per place with year ranges and historical summaries
- Time slider to filter and animate history by year
- Built-in quick guide/tutorial in dashboard and project sidebar
- Collaboration roles (`owner`, `admin`, `editor`, `pending`, `banned`) and access requests
- Place-level discussion comments for contributors and pending collaborators
- Data export/import utilities (GeoJSON, JSON bundle, CSV)
- Optional AI-assisted research summarization, speculative context, and image analysis via Supabase Edge Function

## Architecture (Repo-Evidenced)

- Frontend SPA: `src/main.js` controls routing, auth state, and view composition.
- UI components: map (`MapView`), sidebar, timeline (`TimeSlider`), forms, settings, dashboard, landing page.
- Data layer: `src/data/store.js` wraps Supabase auth/database/storage calls.
- Backend services:
  - Supabase Postgres schema and RLS policies in `supabase/schema.sql`
  - Supabase Edge Function proxy for AI in `supabase/functions/ai-proxy/index.ts`
- Data flow: user action -> component callback -> store function -> Supabase -> mapped response -> UI refresh.

## Tech Stack

- Vite
- Leaflet
- Supabase (`@supabase/supabase-js`)
- UUID

## Getting Started

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

Create `.env` in the repo root:

```env
VITE_SUPABASE_URL=your_supabase_project_url
VITE_SUPABASE_ANON_KEY=your_supabase_anon_key
# Optional (for historic map overlays)
VITE_MAPTILER_KEY=
```

### 3. Run development server

```bash
npm run dev
```

### 4. Build for production

```bash
npm run build
npm run preview
```

### 5. Optional smoke check

```bash
npm run smoke:geojson
npm run smoke:moderation
```

This reads `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` from your shell or local `.env` file and reports visible project, place, entry, comment, and historic-name counts.

`npm run smoke:moderation` also uses the anon key, but only runs the authenticated contributor/reviewer workflow when these optional variables are present:

- `HISTORYLENS_SMOKE_OWNER_EMAIL`
- `HISTORYLENS_SMOKE_OWNER_PASSWORD`
- `HISTORYLENS_SMOKE_CONTRIBUTOR_EMAIL`
- `HISTORYLENS_SMOKE_CONTRIBUTOR_PASSWORD`
- `HISTORYLENS_SMOKE_PROJECT_ID` (optional; without it, the script creates and deletes a temporary public project)

## Deploy To Vercel

### 1. Import repo into Vercel

- In Vercel, choose **Add New Project** and import this repository.
- Framework preset: **Vite**.
- Build command: `npm run build`
- Output directory: `dist`

`vercel.json` is included to ensure SPA route fallback (`/* -> /index.html`) while still serving static files directly.

### 2. Add environment variables in Vercel

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_MAPTILER_KEY` (optional, only if you use historic map overlays)

### 3. Update Supabase auth URLs

In Supabase Dashboard -> Authentication -> URL Configuration:

- Set **Site URL** to your Vercel production domain (for example `https://history-lens.vercel.app`)
- Add **Additional Redirect URLs** for:
  - your production URL
  - your preview URL pattern (for example `https://*.vercel.app`)

## Optional Backend Setup

- For a fresh Supabase project, apply SQL in this order:
  - `supabase/schema.sql`
  - `supabase/phase12_comments.sql`
  - `supabase/phase18_moderation.sql`
  - `supabase/phase20_storage_policy_hardening.sql`
  - `supabase/phase21_community_workflow.sql`
  - `supabase/phase22_alias_history.sql`
  - `supabase/phase23_comment_policy_alignment.sql`
- The older numbered phase files remain in the repo as historical migrations. For fresh installs, the files above are the current bootstrap path.
- Deploy `supabase/functions/ai-proxy` and set `OPENAI_API_KEY` as a Supabase secret if using AI features.

## Repository Structure

```text
src/
  ai/
  components/
  data/
  styles/
supabase/
  functions/ai-proxy/
  schema.sql
public/
```

## Not Found In Repo

- Dedicated API documentation
- End-to-end test suite
- One-command local Supabase bootstrap/seed script
- Formal production deployment runbook

## Scripts

From `package.json`:

- `npm run dev` - start Vite dev server
- `npm run build` - build production assets
- `npm run preview` - preview production build locally
- `npm run smoke:geojson` - verify core Supabase reads against the current environment
- `npm run smoke:moderation` - verify authenticated request, submission, review-note, approval, and cleanup flow when smoke credentials are configured
