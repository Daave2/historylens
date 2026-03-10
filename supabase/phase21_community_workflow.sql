-- Phase 21: Community submission workflow, historical names, and main-image curation

-- Allow pending collaborators to view private project content while awaiting approval.
DROP POLICY IF EXISTS "Read places" ON places;
CREATE POLICY "Read places" ON places FOR SELECT
  USING (
    public.is_project_public(project_id) OR
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin', 'pending'])
  );

DROP POLICY IF EXISTS "Read entries" ON time_entries;
CREATE POLICY "Read entries" ON time_entries FOR SELECT
  USING (
    public.is_project_public(public.get_project_for_place(place_id)) OR
    public.is_project_owner(public.get_project_for_place(place_id)) OR
    public.has_project_role(public.get_project_for_place(place_id), ARRAY['editor', 'admin', 'pending'])
  );

DROP POLICY IF EXISTS "Read image metadata" ON images;
CREATE POLICY "Read image metadata" ON images FOR SELECT
  USING (
    public.is_project_public(public.get_project_for_entry(time_entry_id)) OR
    public.is_project_owner(public.get_project_for_entry(time_entry_id)) OR
    public.has_project_role(public.get_project_for_entry(time_entry_id), ARRAY['editor', 'admin', 'pending'])
  );

-- Image moderation and main-image pinning support.
ALTER TABLE images ADD COLUMN IF NOT EXISTS moderation_status TEXT NOT NULL DEFAULT 'approved';
ALTER TABLE images DROP CONSTRAINT IF EXISTS images_moderation_status_check;
ALTER TABLE images ADD CONSTRAINT images_moderation_status_check CHECK (moderation_status IN ('approved', 'pending', 'rejected'));

ALTER TABLE places ADD COLUMN IF NOT EXISTS pinned_image_id UUID REFERENCES images(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION public.get_project_for_image(p_image_id UUID) RETURNS UUID AS $$
  SELECT p.project_id
  FROM images i
  JOIN time_entries te ON te.id = i.time_entry_id
  JOIN places p ON p.id = te.place_id
  WHERE i.id = p_image_id
  LIMIT 1;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.validate_place_pinned_image()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_place_id UUID;
  v_status TEXT;
BEGIN
  IF NEW.pinned_image_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT p.id, i.moderation_status
  INTO v_place_id, v_status
  FROM images i
  JOIN time_entries te ON te.id = i.time_entry_id
  JOIN places p ON p.id = te.place_id
  WHERE i.id = NEW.pinned_image_id;

  IF v_place_id IS NULL THEN
    RAISE EXCEPTION 'Pinned image does not exist';
  END IF;

  IF v_place_id <> NEW.id THEN
    RAISE EXCEPTION 'Pinned image must belong to this place';
  END IF;

  IF v_status <> 'approved' THEN
    RAISE EXCEPTION 'Pinned image must be approved';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_places_validate_pinned_image ON places;
CREATE TRIGGER trg_places_validate_pinned_image
BEFORE INSERT OR UPDATE OF pinned_image_id ON places
FOR EACH ROW EXECUTE FUNCTION public.validate_place_pinned_image();

-- Historical place names.
CREATE TABLE IF NOT EXISTS place_name_aliases (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  alias TEXT NOT NULL,
  start_year INTEGER,
  end_year INTEGER,
  note TEXT DEFAULT '',
  created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CHECK (start_year IS NULL OR end_year IS NULL OR start_year <= end_year),
  UNIQUE(place_id, alias, start_year, end_year)
);

CREATE INDEX IF NOT EXISTS idx_place_aliases_place ON place_name_aliases(place_id);
CREATE INDEX IF NOT EXISTS idx_place_aliases_project ON place_name_aliases(project_id);
CREATE INDEX IF NOT EXISTS idx_place_aliases_alias_lower ON place_name_aliases((lower(alias)));

ALTER TABLE place_name_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read place aliases" ON place_name_aliases;
DROP POLICY IF EXISTS "Insert place aliases" ON place_name_aliases;
DROP POLICY IF EXISTS "Update place aliases" ON place_name_aliases;
DROP POLICY IF EXISTS "Delete place aliases" ON place_name_aliases;

CREATE POLICY "Read place aliases" ON place_name_aliases FOR SELECT
  USING (
    public.is_project_public(project_id) OR
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin', 'pending'])
  );

CREATE POLICY "Insert place aliases" ON place_name_aliases FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin'])
  );

CREATE POLICY "Update place aliases" ON place_name_aliases FOR UPDATE
  USING (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin']) OR
    (created_by = auth.uid() AND public.has_project_role(project_id, ARRAY['editor']))
  )
  WITH CHECK (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin']) OR
    (created_by = auth.uid() AND public.has_project_role(project_id, ARRAY['editor']))
  );

CREATE POLICY "Delete place aliases" ON place_name_aliases FOR DELETE
  USING (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin']) OR
    (created_by = auth.uid() AND public.has_project_role(project_id, ARRAY['editor']))
  );

-- Location correction audit trail.
CREATE TABLE IF NOT EXISTS place_location_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  previous_lat DOUBLE PRECISION NOT NULL,
  previous_lng DOUBLE PRECISION NOT NULL,
  new_lat DOUBLE PRECISION NOT NULL,
  new_lng DOUBLE PRECISION NOT NULL,
  reason TEXT DEFAULT '',
  changed_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_place_location_history_place ON place_location_history(place_id);
CREATE INDEX IF NOT EXISTS idx_place_location_history_project ON place_location_history(project_id);
CREATE INDEX IF NOT EXISTS idx_place_location_history_created_at ON place_location_history(created_at DESC);

ALTER TABLE place_location_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read place location history" ON place_location_history;
DROP POLICY IF EXISTS "Insert place location history" ON place_location_history;

CREATE POLICY "Read place location history" ON place_location_history FOR SELECT
  USING (
    public.is_project_public(project_id) OR
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin', 'pending'])
  );

CREATE POLICY "Insert place location history" ON place_location_history FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin'])
  );

-- Generic moderation submissions queue.
CREATE TABLE IF NOT EXISTS moderation_submissions (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  submitter_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  submission_type TEXT NOT NULL CHECK (submission_type IN ('place_create', 'entry_create', 'place_move', 'place_name_alias')),
  target_place_id UUID REFERENCES places(id) ON DELETE SET NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewer_note TEXT DEFAULT '',
  reviewed_by UUID REFERENCES auth.users(id),
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_mod_submissions_project_status ON moderation_submissions(project_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_mod_submissions_submitter ON moderation_submissions(submitter_id, created_at DESC);

ALTER TABLE moderation_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read moderation submissions" ON moderation_submissions;
DROP POLICY IF EXISTS "Insert moderation submissions" ON moderation_submissions;
DROP POLICY IF EXISTS "Update moderation submissions" ON moderation_submissions;
DROP POLICY IF EXISTS "Delete moderation submissions" ON moderation_submissions;

CREATE POLICY "Read moderation submissions" ON moderation_submissions FOR SELECT
  USING (
    submitter_id = auth.uid() OR
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin'])
  );

CREATE POLICY "Insert moderation submissions" ON moderation_submissions FOR INSERT
  TO authenticated
  WITH CHECK (
    submitter_id = auth.uid() AND
    NOT public.has_project_role(project_id, ARRAY['banned']) AND
    (
      public.is_project_public(project_id) OR
      public.is_project_owner(project_id) OR
      public.has_project_role(project_id, ARRAY['editor', 'admin', 'pending'])
    )
  );

CREATE POLICY "Update moderation submissions" ON moderation_submissions FOR UPDATE
  USING (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin'])
  )
  WITH CHECK (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin'])
  );

CREATE POLICY "Delete moderation submissions" ON moderation_submissions FOR DELETE
  USING (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin'])
  );

-- Community voting for image ranking.
CREATE TABLE IF NOT EXISTS image_votes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  image_id UUID NOT NULL REFERENCES images(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  vote SMALLINT NOT NULL CHECK (vote IN (-1, 1)),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(image_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_image_votes_image ON image_votes(image_id);
CREATE INDEX IF NOT EXISTS idx_image_votes_project ON image_votes(project_id);

CREATE OR REPLACE FUNCTION public.set_image_vote_project()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.project_id := public.get_project_for_image(NEW.image_id);
  IF NEW.project_id IS NULL THEN
    RAISE EXCEPTION 'Invalid image reference';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_row_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_image_votes_set_project ON image_votes;
CREATE TRIGGER trg_image_votes_set_project
BEFORE INSERT OR UPDATE OF image_id ON image_votes
FOR EACH ROW EXECUTE FUNCTION public.set_image_vote_project();

DROP TRIGGER IF EXISTS trg_image_votes_updated ON image_votes;
CREATE TRIGGER trg_image_votes_updated
BEFORE UPDATE ON image_votes
FOR EACH ROW EXECUTE FUNCTION public.set_row_updated_at();

ALTER TABLE image_votes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read image votes" ON image_votes;
DROP POLICY IF EXISTS "Insert image votes" ON image_votes;
DROP POLICY IF EXISTS "Update image votes" ON image_votes;
DROP POLICY IF EXISTS "Delete image votes" ON image_votes;

CREATE POLICY "Read image votes" ON image_votes FOR SELECT
  USING (
    public.is_project_public(project_id) OR
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin', 'pending'])
  );

CREATE POLICY "Insert image votes" ON image_votes FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid() AND
    NOT public.has_project_role(project_id, ARRAY['banned']) AND
    (
      public.is_project_public(project_id) OR
      public.is_project_owner(project_id) OR
      public.has_project_role(project_id, ARRAY['editor', 'admin', 'pending'])
    )
  );

CREATE POLICY "Update image votes" ON image_votes FOR UPDATE
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Delete image votes" ON image_votes FOR DELETE
  USING (user_id = auth.uid());

-- Reviewer action RPC: approve/reject and publish queued submissions.
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
        );

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
