-- phase19_overview_history.sql
-- Persistent overview revision history so collaborators can restore older versions.

CREATE TABLE IF NOT EXISTS place_overview_history (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  previous_description TEXT,
  new_description TEXT,
  reason TEXT DEFAULT 'regenerate',
  created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_overview_history_place ON place_overview_history(place_id);
CREATE INDEX IF NOT EXISTS idx_overview_history_project ON place_overview_history(project_id);
CREATE INDEX IF NOT EXISTS idx_overview_history_created_at ON place_overview_history(created_at DESC);

ALTER TABLE place_overview_history ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read overview history" ON place_overview_history;
DROP POLICY IF EXISTS "Insert overview history" ON place_overview_history;

CREATE POLICY "Read overview history" ON place_overview_history FOR SELECT
  USING (
    public.is_project_public(project_id) OR
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin'])
  );

CREATE POLICY "Insert overview history" ON place_overview_history FOR INSERT
  WITH CHECK (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin'])
  );
