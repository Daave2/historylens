-- phase22_alias_history.sql
-- Persistent audit trail for historic place names.

CREATE TABLE IF NOT EXISTS place_name_alias_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  alias_id UUID REFERENCES place_name_aliases(id) ON DELETE SET NULL,
  place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  action TEXT NOT NULL CHECK (action IN ('create', 'update', 'delete')),
  previous_alias TEXT,
  previous_start_year INTEGER,
  previous_end_year INTEGER,
  previous_note TEXT,
  new_alias TEXT,
  new_start_year INTEGER,
  new_end_year INTEGER,
  new_note TEXT,
  changed_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alias_history_alias ON place_name_alias_history(alias_id);
CREATE INDEX IF NOT EXISTS idx_alias_history_place ON place_name_alias_history(place_id);
CREATE INDEX IF NOT EXISTS idx_alias_history_project ON place_name_alias_history(project_id);
CREATE INDEX IF NOT EXISTS idx_alias_history_created_at ON place_name_alias_history(created_at DESC);

ALTER TABLE place_name_alias_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read place alias history" ON place_name_alias_history;

CREATE POLICY "Read place alias history" ON place_name_alias_history FOR SELECT
  USING (
    public.is_project_public(project_id) OR
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin', 'pending'])
  );

CREATE OR REPLACE FUNCTION public.log_place_name_alias_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO place_name_alias_history (
      alias_id,
      place_id,
      project_id,
      action,
      new_alias,
      new_start_year,
      new_end_year,
      new_note,
      changed_by
    ) VALUES (
      NEW.id,
      NEW.place_id,
      NEW.project_id,
      'create',
      NEW.alias,
      NEW.start_year,
      NEW.end_year,
      NEW.note,
      coalesce(NEW.created_by, auth.uid())
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.alias IS NOT DISTINCT FROM NEW.alias
      AND OLD.start_year IS NOT DISTINCT FROM NEW.start_year
      AND OLD.end_year IS NOT DISTINCT FROM NEW.end_year
      AND coalesce(OLD.note, '') IS NOT DISTINCT FROM coalesce(NEW.note, '') THEN
      RETURN NEW;
    END IF;

    INSERT INTO place_name_alias_history (
      alias_id,
      place_id,
      project_id,
      action,
      previous_alias,
      previous_start_year,
      previous_end_year,
      previous_note,
      new_alias,
      new_start_year,
      new_end_year,
      new_note,
      changed_by
    ) VALUES (
      NEW.id,
      NEW.place_id,
      NEW.project_id,
      'update',
      OLD.alias,
      OLD.start_year,
      OLD.end_year,
      OLD.note,
      NEW.alias,
      NEW.start_year,
      NEW.end_year,
      NEW.note,
      auth.uid()
    );

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    INSERT INTO place_name_alias_history (
      alias_id,
      place_id,
      project_id,
      action,
      previous_alias,
      previous_start_year,
      previous_end_year,
      previous_note,
      changed_by
    ) VALUES (
      NULL,
      OLD.place_id,
      OLD.project_id,
      'delete',
      OLD.alias,
      OLD.start_year,
      OLD.end_year,
      OLD.note,
      auth.uid()
    );

    RETURN OLD;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_place_name_alias_history ON place_name_aliases;
CREATE TRIGGER trg_place_name_alias_history
AFTER INSERT OR UPDATE OR DELETE ON place_name_aliases
FOR EACH ROW EXECUTE FUNCTION public.log_place_name_alias_change();
