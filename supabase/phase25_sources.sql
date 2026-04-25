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
