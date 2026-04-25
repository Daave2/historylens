-- phase24_collab_scale_foundation.sql
-- Collaboration and scale foundation: queue metadata, role audit history, indexes, and RLS helper tuning.

-- Queue metadata for larger review workflows.
ALTER TABLE public.moderation_submissions
  ADD COLUMN IF NOT EXISTS assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS priority TEXT NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS review_started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS internal_note TEXT NOT NULL DEFAULT '';

ALTER TABLE public.moderation_submissions
  DROP CONSTRAINT IF EXISTS moderation_submissions_priority_check;

ALTER TABLE public.moderation_submissions
  ADD CONSTRAINT moderation_submissions_priority_check
  CHECK (priority IN ('low', 'normal', 'high', 'urgent'));

CREATE INDEX IF NOT EXISTS idx_mod_submissions_project_status_type_created
  ON public.moderation_submissions(project_id, status, submission_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mod_submissions_project_priority_created
  ON public.moderation_submissions(project_id, priority, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_mod_submissions_assigned_to_created
  ON public.moderation_submissions(assigned_to, created_at DESC)
  WHERE assigned_to IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_mod_submissions_target_place
  ON public.moderation_submissions(target_place_id)
  WHERE target_place_id IS NOT NULL;

-- Role/access audit history.
CREATE TABLE IF NOT EXISTS public.project_role_events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  role_id UUID,
  target_user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES auth.users(id) ON DELETE SET NULL DEFAULT auth.uid(),
  action TEXT NOT NULL CHECK (action IN ('request', 'grant', 'approve', 'reject', 'promote', 'demote', 'ban', 'unban', 'remove', 'update')),
  previous_role TEXT,
  new_role TEXT,
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_role_events_project_created
  ON public.project_role_events(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_role_events_target_created
  ON public.project_role_events(target_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_role_events_actor_created
  ON public.project_role_events(actor_id, created_at DESC)
  WHERE actor_id IS NOT NULL;

ALTER TABLE public.project_role_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read project role events" ON public.project_role_events;

CREATE POLICY "Read project role events"
ON public.project_role_events FOR SELECT
USING (
  target_user_id = (SELECT auth.uid())
  OR public.is_project_owner(project_id)
  OR public.has_project_role(project_id, ARRAY['admin'])
);

CREATE OR REPLACE FUNCTION public.classify_project_role_event(
  p_op TEXT,
  p_previous_role TEXT,
  p_new_role TEXT
)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_op = 'INSERT' AND p_new_role = 'pending' THEN 'request'
    WHEN p_op = 'INSERT' AND p_new_role = 'banned' THEN 'ban'
    WHEN p_op = 'INSERT' THEN 'grant'
    WHEN p_op = 'DELETE' AND p_previous_role = 'pending' THEN 'reject'
    WHEN p_op = 'DELETE' AND p_previous_role = 'banned' THEN 'unban'
    WHEN p_op = 'DELETE' THEN 'remove'
    WHEN p_previous_role = 'pending' AND p_new_role IN ('editor', 'admin') THEN 'approve'
    WHEN p_new_role = 'banned' THEN 'ban'
    WHEN p_previous_role = 'banned' THEN 'unban'
    WHEN p_previous_role <> 'admin' AND p_new_role = 'admin' THEN 'promote'
    WHEN p_previous_role = 'admin' AND p_new_role <> 'admin' THEN 'demote'
    ELSE 'update'
  END;
$$;

CREATE OR REPLACE FUNCTION public.log_project_role_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action TEXT;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := public.classify_project_role_event(TG_OP, NULL, NEW.role);

    INSERT INTO public.project_role_events (
      project_id,
      role_id,
      target_user_id,
      actor_id,
      action,
      previous_role,
      new_role
    ) VALUES (
      NEW.project_id,
      NEW.id,
      NEW.user_id,
      auth.uid(),
      v_action,
      NULL,
      NEW.role
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.role IS NOT DISTINCT FROM NEW.role THEN
      RETURN NEW;
    END IF;

    v_action := public.classify_project_role_event(TG_OP, OLD.role, NEW.role);

    INSERT INTO public.project_role_events (
      project_id,
      role_id,
      target_user_id,
      actor_id,
      action,
      previous_role,
      new_role
    ) VALUES (
      NEW.project_id,
      NEW.id,
      NEW.user_id,
      auth.uid(),
      v_action,
      OLD.role,
      NEW.role
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    v_action := public.classify_project_role_event(TG_OP, OLD.role, NULL);

    INSERT INTO public.project_role_events (
      project_id,
      role_id,
      target_user_id,
      actor_id,
      action,
      previous_role,
      new_role
    ) VALUES (
      OLD.project_id,
      OLD.id,
      OLD.user_id,
      auth.uid(),
      v_action,
      OLD.role,
      NULL
    );

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_project_role_events ON public.project_roles;
CREATE TRIGGER trg_project_role_events
AFTER INSERT OR UPDATE OR DELETE ON public.project_roles
FOR EACH ROW EXECUTE FUNCTION public.log_project_role_event();

-- Scale-oriented indexes for common map, review, and cleanup paths.
CREATE INDEX IF NOT EXISTS idx_places_project_category_created
  ON public.places(project_id, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_places_project_created
  ON public.places(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_time_entries_place_years
  ON public.time_entries(place_id, year_start, year_end);

CREATE INDEX IF NOT EXISTS idx_time_entries_created_by
  ON public.time_entries(created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_images_entry_status
  ON public.images(time_entry_id, moderation_status);

CREATE INDEX IF NOT EXISTS idx_images_created_by
  ON public.images(created_by)
  WHERE created_by IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_comments_place_created
  ON public.comments(place_id, created_at);

CREATE INDEX IF NOT EXISTS idx_comments_user_id
  ON public.comments(user_id)
  WHERE user_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_project_roles_project_role_created
  ON public.project_roles(project_id, role, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_project_roles_user_project
  ON public.project_roles(user_id, project_id);

CREATE INDEX IF NOT EXISTS idx_overview_history_project_created
  ON public.place_overview_history(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_place_aliases_place_start
  ON public.place_name_aliases(place_id, start_year);

CREATE INDEX IF NOT EXISTS idx_place_location_history_place_created
  ON public.place_location_history(place_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_image_votes_image_user
  ON public.image_votes(image_id, user_id);

-- RLS helper tuning: explicit search_path and cached auth.uid() lookups.
CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects
    WHERE id = p_project_id
      AND owner_id = (SELECT auth.uid())
  );
$$;

CREATE OR REPLACE FUNCTION public.has_project_role(p_project_id UUID, p_roles TEXT[])
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.project_roles
    WHERE project_id = p_project_id
      AND user_id = (SELECT auth.uid())
      AND role = ANY(p_roles)
  );
$$;

CREATE OR REPLACE FUNCTION public.is_project_public(p_project_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.projects
    WHERE id = p_project_id
      AND is_public = true
  );
$$;

CREATE OR REPLACE FUNCTION public.get_project_for_place(p_place_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT project_id
  FROM public.places
  WHERE id = p_place_id;
$$;

CREATE OR REPLACE FUNCTION public.get_project_for_entry(p_entry_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.project_id
  FROM public.time_entries te
  JOIN public.places p ON p.id = te.place_id
  WHERE te.id = p_entry_id;
$$;

CREATE OR REPLACE FUNCTION public.get_project_for_image(p_image_id UUID)
RETURNS UUID
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.project_id
  FROM public.images i
  JOIN public.time_entries te ON te.id = i.time_entry_id
  JOIN public.places p ON p.id = te.place_id
  WHERE i.id = p_image_id;
$$;
