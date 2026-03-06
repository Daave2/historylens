-- HistoryLens — Phase 4: Project Collaboration SQL Migration
-- Run this in the Supabase SQL editor to add role-based access control.

-- ═══════════════════════════════════════════════
-- PROFILES (for displaying collaborator emails)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public profiles are viewable by everyone." ON public.profiles;
DROP POLICY IF EXISTS "Users can insert their own profile." ON public.profiles;
DROP POLICY IF EXISTS "Users can update own profile." ON public.profiles;

CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile." ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- Function to handle new user signups
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger AS $$
BEGIN
  INSERT INTO public.profiles (id, email)
  VALUES (new.id, new.email);
  RETURN new;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger the function every time a user is created
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- Backfill existing users
INSERT INTO public.profiles (id, email)
SELECT id, email FROM auth.users
ON CONFLICT (id) DO NOTHING;

-- ═══════════════════════════════════════════════
-- DATA COLUMNS FOR OWNERSHIP
-- ═══════════════════════════════════════════════
ALTER TABLE projects ALTER COLUMN owner_id SET DEFAULT auth.uid();
ALTER TABLE places ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE time_entries ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid();
ALTER TABLE images ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid();

-- ═══════════════════════════════════════════════
-- PROJECT ROLES
-- ═══════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS project_roles (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('editor', 'admin', 'pending')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(project_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_project_roles_project ON project_roles(project_id);
CREATE INDEX IF NOT EXISTS idx_project_roles_user ON project_roles(user_id);

ALTER TABLE project_roles ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════
-- SECURITY DEFINER HELPERS (TO PREVENT INFINITE RECURSION)
-- ═══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.is_project_owner(p_project_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND owner_id = auth.uid());
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.has_project_role(p_project_id UUID, p_roles TEXT[]) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM project_roles WHERE project_id = p_project_id AND user_id = auth.uid() AND role = ANY(p_roles));
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.is_project_public(p_project_id UUID) RETURNS BOOLEAN AS $$
  SELECT EXISTS (SELECT 1 FROM projects WHERE id = p_project_id AND is_public = true);
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_project_for_place(p_place_id UUID) RETURNS UUID AS $$
  SELECT project_id FROM places WHERE id = p_place_id;
$$ LANGUAGE sql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION public.get_project_for_entry(p_entry_id UUID) RETURNS UUID AS $$
  SELECT p.project_id FROM time_entries te JOIN places p ON te.place_id = p.id WHERE te.id = p_entry_id;
$$ LANGUAGE sql SECURITY DEFINER;


-- Drop old policies to replace them with collaboration-aware ones
DROP POLICY IF EXISTS "Read projects" ON projects;
DROP POLICY IF EXISTS "Update projects" ON projects;
DROP POLICY IF EXISTS "Delete projects" ON projects;
DROP POLICY IF EXISTS "Insert projects" ON projects;

DROP POLICY IF EXISTS "Read places" ON places;
DROP POLICY IF EXISTS "Modify places" ON places;
DROP POLICY IF EXISTS "Insert places" ON places;
DROP POLICY IF EXISTS "Update places" ON places;
DROP POLICY IF EXISTS "Delete places" ON places;

DROP POLICY IF EXISTS "Read entries" ON time_entries;
DROP POLICY IF EXISTS "Modify entries" ON time_entries;
DROP POLICY IF EXISTS "Insert entries" ON time_entries;
DROP POLICY IF EXISTS "Update entries" ON time_entries;
DROP POLICY IF EXISTS "Delete entries" ON time_entries;

DROP POLICY IF EXISTS "Read image metadata" ON images;
DROP POLICY IF EXISTS "Modify image metadata" ON images;
DROP POLICY IF EXISTS "Insert image metadata" ON images;
DROP POLICY IF EXISTS "Update image metadata" ON images;
DROP POLICY IF EXISTS "Delete image metadata" ON images;

DROP POLICY IF EXISTS "Read roles" ON project_roles;
DROP POLICY IF EXISTS "Insert roles" ON project_roles;
DROP POLICY IF EXISTS "Update roles" ON project_roles;
DROP POLICY IF EXISTS "Delete roles" ON project_roles;

-- ═══════════════════════════════════════════════
-- PROJECT ROLES POLICIES
-- ═══════════════════════════════════════════════

CREATE POLICY "Read roles" ON project_roles FOR SELECT 
  USING (
    user_id = auth.uid() OR 
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin'])
  );

CREATE POLICY "Insert roles" ON project_roles FOR INSERT
  WITH CHECK (
    (user_id = auth.uid() AND role = 'pending') OR
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin'])
  );

CREATE POLICY "Update roles" ON project_roles FOR UPDATE
  USING (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin'])
  );

CREATE POLICY "Delete roles" ON project_roles FOR DELETE
  USING (
    user_id = auth.uid() OR
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin'])
  );

-- ═══════════════════════════════════════════════
-- PROJECTS POLICIES
-- ═══════════════════════════════════════════════

CREATE POLICY "Read projects" ON projects FOR SELECT 
  USING (
    is_public = true OR 
    owner_id = auth.uid() OR
    public.has_project_role(id, ARRAY['editor', 'admin', 'pending'])
  );

CREATE POLICY "Insert projects" ON projects FOR INSERT 
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Update projects" ON projects FOR UPDATE 
  USING (
    owner_id = auth.uid() OR
    public.has_project_role(id, ARRAY['admin'])
  );

CREATE POLICY "Delete projects" ON projects FOR DELETE 
  USING (owner_id = auth.uid()); 

-- ═══════════════════════════════════════════════
-- PLACES POLICIES
-- ═══════════════════════════════════════════════

CREATE POLICY "Read places" ON places FOR SELECT 
  USING (
    public.is_project_public(project_id) OR
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin'])
  );

CREATE POLICY "Insert places" ON places FOR INSERT 
  WITH CHECK (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['editor', 'admin'])
  );

CREATE POLICY "Update places" ON places FOR UPDATE 
  USING (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin']) OR
    (created_by = auth.uid() AND public.has_project_role(project_id, ARRAY['editor']))
  );

CREATE POLICY "Delete places" ON places FOR DELETE 
  USING (
    public.is_project_owner(project_id) OR
    public.has_project_role(project_id, ARRAY['admin']) OR
    (created_by = auth.uid() AND public.has_project_role(project_id, ARRAY['editor']))
  );

-- ═══════════════════════════════════════════════
-- TIME ENTRIES POLICIES
-- ═══════════════════════════════════════════════

CREATE POLICY "Read entries" ON time_entries FOR SELECT 
  USING (
    public.is_project_public(public.get_project_for_place(place_id)) OR
    public.is_project_owner(public.get_project_for_place(place_id)) OR
    public.has_project_role(public.get_project_for_place(place_id), ARRAY['editor', 'admin'])
  );

CREATE POLICY "Insert entries" ON time_entries FOR INSERT 
  WITH CHECK (
    public.is_project_owner(public.get_project_for_place(place_id)) OR
    public.has_project_role(public.get_project_for_place(place_id), ARRAY['editor', 'admin'])
  );

CREATE POLICY "Update entries" ON time_entries FOR UPDATE 
  USING (
    public.is_project_owner(public.get_project_for_place(place_id)) OR
    public.has_project_role(public.get_project_for_place(place_id), ARRAY['admin']) OR
    (created_by = auth.uid() AND public.has_project_role(public.get_project_for_place(place_id), ARRAY['editor']))
  );

CREATE POLICY "Delete entries" ON time_entries FOR DELETE 
  USING (
    public.is_project_owner(public.get_project_for_place(place_id)) OR
    public.has_project_role(public.get_project_for_place(place_id), ARRAY['admin']) OR
    (created_by = auth.uid() AND public.has_project_role(public.get_project_for_place(place_id), ARRAY['editor']))
  );

-- ═══════════════════════════════════════════════
-- IMAGES POLICIES
-- ═══════════════════════════════════════════════

CREATE POLICY "Read image metadata" ON images FOR SELECT 
  USING (
    public.is_project_public(public.get_project_for_entry(time_entry_id)) OR
    public.is_project_owner(public.get_project_for_entry(time_entry_id)) OR
    public.has_project_role(public.get_project_for_entry(time_entry_id), ARRAY['editor', 'admin'])
  );

CREATE POLICY "Insert image metadata" ON images FOR INSERT 
  WITH CHECK (
    public.is_project_owner(public.get_project_for_entry(time_entry_id)) OR
    public.has_project_role(public.get_project_for_entry(time_entry_id), ARRAY['editor', 'admin'])
  );

CREATE POLICY "Update image metadata" ON images FOR UPDATE 
  USING (
    public.is_project_owner(public.get_project_for_entry(time_entry_id)) OR
    public.has_project_role(public.get_project_for_entry(time_entry_id), ARRAY['admin']) OR
    (created_by = auth.uid() AND public.has_project_role(public.get_project_for_entry(time_entry_id), ARRAY['editor']))
  );

CREATE POLICY "Delete image metadata" ON images FOR DELETE 
  USING (
    public.is_project_owner(public.get_project_for_entry(time_entry_id)) OR
    public.has_project_role(public.get_project_for_entry(time_entry_id), ARRAY['admin']) OR
    (created_by = auth.uid() AND public.has_project_role(public.get_project_for_entry(time_entry_id), ARRAY['editor']))
  );
