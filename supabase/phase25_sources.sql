-- phase25_sources.sql
-- Structured citation tracking for timeline entries.
-- Creates reusable source records and a junction table linking entries to sources.

-- A reusable source record (a book, website, archive, newspaper, etc.)
CREATE TABLE IF NOT EXISTS public.sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  title TEXT NOT NULL CHECK (char_length(trim(title)) > 0),
  url TEXT,
  source_type TEXT NOT NULL DEFAULT 'web'
    CHECK (source_type IN ('web', 'archive', 'newspaper', 'book', 'oral', 'photo', 'map', 'user', 'other')),
  author TEXT,
  publication_date TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sources_project ON public.sources(project_id);
CREATE INDEX IF NOT EXISTS idx_sources_project_type ON public.sources(project_id, source_type);
CREATE INDEX IF NOT EXISTS idx_sources_created_by ON public.sources(created_by) WHERE created_by IS NOT NULL;

ALTER TABLE public.sources ENABLE ROW LEVEL SECURITY;

-- Read: same visibility as the parent project.
DROP POLICY IF EXISTS "Read sources" ON public.sources;
CREATE POLICY "Read sources" ON public.sources FOR SELECT
USING (
  public.is_project_public(project_id)
  OR public.is_project_owner(project_id)
  OR public.has_project_role(project_id, ARRAY['editor', 'admin', 'pending'])
);

-- Insert: editors, admins, owners.
DROP POLICY IF EXISTS "Create sources" ON public.sources;
CREATE POLICY "Create sources" ON public.sources FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = created_by
  AND (
    public.is_project_owner(project_id)
    OR public.has_project_role(project_id, ARRAY['editor', 'admin'])
  )
);

-- Update: editors, admins, owners.
DROP POLICY IF EXISTS "Update sources" ON public.sources;
CREATE POLICY "Update sources" ON public.sources FOR UPDATE
TO authenticated
USING (
  public.is_project_owner(project_id)
  OR public.has_project_role(project_id, ARRAY['editor', 'admin'])
);

-- Delete: admins, owners, or the creator.
DROP POLICY IF EXISTS "Delete sources" ON public.sources;
CREATE POLICY "Delete sources" ON public.sources FOR DELETE
TO authenticated
USING (
  created_by = (SELECT auth.uid())
  OR public.is_project_owner(project_id)
  OR public.has_project_role(project_id, ARRAY['admin'])
);

-- Junction table linking timeline entries to sources.
CREATE TABLE IF NOT EXISTS public.entry_sources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES public.time_entries(id) ON DELETE CASCADE,
  source_id UUID NOT NULL REFERENCES public.sources(id) ON DELETE CASCADE,
  page_or_section TEXT,
  quote TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(entry_id, source_id)
);

CREATE INDEX IF NOT EXISTS idx_entry_sources_entry ON public.entry_sources(entry_id);
CREATE INDEX IF NOT EXISTS idx_entry_sources_source ON public.entry_sources(source_id);

ALTER TABLE public.entry_sources ENABLE ROW LEVEL SECURITY;

-- Read: inherit visibility from the entry's parent place/project.
DROP POLICY IF EXISTS "Read entry sources" ON public.entry_sources;
CREATE POLICY "Read entry sources" ON public.entry_sources FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.time_entries te
    JOIN public.places p ON p.id = te.place_id
    WHERE te.id = entry_sources.entry_id
      AND (
        public.is_project_public(p.project_id)
        OR public.is_project_owner(p.project_id)
        OR public.has_project_role(p.project_id, ARRAY['editor', 'admin', 'pending'])
      )
  )
);

-- Insert: editors, admins, owners.
DROP POLICY IF EXISTS "Create entry sources" ON public.entry_sources;
CREATE POLICY "Create entry sources" ON public.entry_sources FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.time_entries te
    JOIN public.places p ON p.id = te.place_id
    JOIN public.sources s ON s.id = entry_sources.source_id AND s.project_id = p.project_id
    WHERE te.id = entry_sources.entry_id
      AND (
        public.is_project_owner(p.project_id)
        OR public.has_project_role(p.project_id, ARRAY['editor', 'admin'])
      )
  )
);

-- Delete: editors, admins, owners.
DROP POLICY IF EXISTS "Delete entry sources" ON public.entry_sources;
CREATE POLICY "Delete entry sources" ON public.entry_sources FOR DELETE
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.time_entries te
    JOIN public.places p ON p.id = te.place_id
    WHERE te.id = entry_sources.entry_id
      AND (
        public.is_project_owner(p.project_id)
        OR public.has_project_role(p.project_id, ARRAY['editor', 'admin'])
      )
  )
);

-- Keep moderation approvals in sync for live projects that already applied Phase 21.
-- The replacement function links approved entry suggestions to selected structured sources.
CREATE OR REPLACE FUNCTION public.review_moderation_submission(
  p_submission_id UUID,
  p_decision TEXT,
  p_note TEXT DEFAULT ''
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_submission moderation_submissions%ROWTYPE;
  v_decision TEXT;
  v_payload JSONB;
  v_place_id UUID;
  v_prev_lat DOUBLE PRECISION;
  v_prev_lng DOUBLE PRECISION;
  v_reason TEXT;
  v_item JSONB;
  v_entry_id UUID;
  v_source_id UUID;
  v_source_project_match BOOLEAN;
BEGIN
  v_decision := lower(coalesce(p_decision, ''));
  IF v_decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Decision must be approved or rejected';
  END IF;

  SELECT *
  INTO v_submission
  FROM moderation_submissions
  WHERE id = p_submission_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Submission not found';
  END IF;

  IF NOT (
    public.is_project_owner(v_submission.project_id) OR
    public.has_project_role(v_submission.project_id, ARRAY['admin'])
  ) THEN
    RAISE EXCEPTION 'Not authorized to review submissions';
  END IF;

  IF v_submission.status <> 'pending' THEN
    RAISE EXCEPTION 'Submission is already reviewed';
  END IF;

  v_payload := coalesce(v_submission.payload, '{}'::jsonb);

  IF v_decision = 'approved' THEN
    CASE v_submission.submission_type
      WHEN 'place_create' THEN
        INSERT INTO places (
          project_id,
          name,
          description,
          lat,
          lng,
          category,
          created_by
        ) VALUES (
          v_submission.project_id,
          coalesce(nullif(trim(v_payload->>'name'), ''), 'Unnamed Place'),
          nullif(trim(v_payload->>'description'), ''),
          (v_payload->>'lat')::double precision,
          (v_payload->>'lng')::double precision,
          coalesce(nullif(trim(v_payload->>'category'), ''), 'residential'),
          v_submission.submitter_id
        )
        RETURNING id INTO v_place_id;

        IF jsonb_typeof(v_payload->'autoEntries') = 'array' THEN
          FOR v_item IN SELECT value FROM jsonb_array_elements(v_payload->'autoEntries')
          LOOP
            INSERT INTO time_entries (
              place_id,
              year_start,
              year_end,
              title,
              summary,
              source,
              source_type,
              confidence,
              created_by
            ) VALUES (
              v_place_id,
              coalesce(nullif(v_item->>'yearStart', '')::integer, EXTRACT(YEAR FROM NOW())::integer),
              nullif(v_item->>'yearEnd', '')::integer,
              coalesce(v_item->>'title', ''),
              coalesce(v_item->>'summary', ''),
              coalesce(v_item->>'source', ''),
              coalesce(v_item->>'sourceType', 'user'),
              coalesce(v_item->>'confidence', 'likely'),
              v_submission.submitter_id
            );
          END LOOP;
        END IF;

      WHEN 'entry_create' THEN
        v_place_id := coalesce(v_submission.target_place_id, nullif(v_payload->>'placeId', '')::uuid);
        IF v_place_id IS NULL THEN
          RAISE EXCEPTION 'Missing target place for entry submission';
        END IF;

        PERFORM 1 FROM places WHERE id = v_place_id AND project_id = v_submission.project_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Target place is not part of this project';
        END IF;

        INSERT INTO time_entries (
          place_id,
          year_start,
          year_end,
          title,
          summary,
          source,
          source_type,
          confidence,
          created_by
        ) VALUES (
          v_place_id,
          coalesce(nullif(v_payload->>'yearStart', '')::integer, EXTRACT(YEAR FROM NOW())::integer),
          nullif(v_payload->>'yearEnd', '')::integer,
          coalesce(v_payload->>'title', ''),
          coalesce(v_payload->>'summary', ''),
          coalesce(v_payload->>'source', ''),
          coalesce(v_payload->>'sourceType', 'user'),
          coalesce(v_payload->>'confidence', 'likely'),
          v_submission.submitter_id
        )
        RETURNING id INTO v_entry_id;

        v_source_id := CASE
          WHEN coalesce(v_payload->>'linkedSourceId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN (v_payload->>'linkedSourceId')::uuid
          ELSE NULL
        END;
        IF v_source_id IS NOT NULL
          AND to_regclass('public.sources') IS NOT NULL
          AND to_regclass('public.entry_sources') IS NOT NULL THEN
          EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.sources WHERE id = $1 AND project_id = $2)'
          INTO v_source_project_match
          USING v_source_id, v_submission.project_id;

          IF v_source_project_match THEN
            EXECUTE 'INSERT INTO public.entry_sources (entry_id, source_id) VALUES ($1, $2) ON CONFLICT DO NOTHING'
            USING v_entry_id, v_source_id;
          END IF;
        END IF;

      WHEN 'place_move' THEN
        v_place_id := coalesce(v_submission.target_place_id, nullif(v_payload->>'placeId', '')::uuid);
        IF v_place_id IS NULL THEN
          RAISE EXCEPTION 'Missing target place for move submission';
        END IF;

        SELECT lat, lng INTO v_prev_lat, v_prev_lng
        FROM places
        WHERE id = v_place_id AND project_id = v_submission.project_id
        FOR UPDATE;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'Target place is not part of this project';
        END IF;

        UPDATE places
        SET
          lat = (v_payload->>'lat')::double precision,
          lng = (v_payload->>'lng')::double precision
        WHERE id = v_place_id;

        v_reason := coalesce(nullif(trim(v_payload->>'reason'), ''), 'moderation_submission');
        INSERT INTO place_location_history (
          place_id,
          project_id,
          previous_lat,
          previous_lng,
          new_lat,
          new_lng,
          reason,
          changed_by
        ) VALUES (
          v_place_id,
          v_submission.project_id,
          v_prev_lat,
          v_prev_lng,
          (v_payload->>'lat')::double precision,
          (v_payload->>'lng')::double precision,
          v_reason,
          auth.uid()
        );

      WHEN 'place_name_alias' THEN
        v_place_id := coalesce(v_submission.target_place_id, nullif(v_payload->>'placeId', '')::uuid);
        IF v_place_id IS NULL THEN
          RAISE EXCEPTION 'Missing target place for alias submission';
        END IF;

        PERFORM 1 FROM places WHERE id = v_place_id AND project_id = v_submission.project_id;
        IF NOT FOUND THEN
          RAISE EXCEPTION 'Target place is not part of this project';
        END IF;

        INSERT INTO place_name_aliases (
          place_id,
          project_id,
          alias,
          start_year,
          end_year,
          note,
          created_by
        ) VALUES (
          v_place_id,
          v_submission.project_id,
          coalesce(nullif(trim(v_payload->>'alias'), ''), 'Unnamed alias'),
          nullif(v_payload->>'startYear', '')::integer,
          nullif(v_payload->>'endYear', '')::integer,
          coalesce(v_payload->>'note', ''),
          v_submission.submitter_id
        );

      ELSE
        RAISE EXCEPTION 'Unsupported submission type: %', v_submission.submission_type;
    END CASE;
  END IF;

  UPDATE moderation_submissions
  SET
    status = v_decision,
    reviewer_note = coalesce(p_note, ''),
    reviewed_by = auth.uid(),
    reviewed_at = NOW(),
    target_place_id = coalesce(target_place_id, v_place_id)
  WHERE id = p_submission_id;

  RETURN jsonb_build_object(
    'id', p_submission_id,
    'status', v_decision,
    'submission_type', v_submission.submission_type,
    'target_place_id', coalesce(v_submission.target_place_id, v_place_id)
  );
END;
$$;
