-- HistoryLens — Supabase Database Schema
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/glxdxdubtsyoecfbcqys/sql

-- Enable UUID generation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ═══════════════════════════════════════════════
-- PROJECTS
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS projects (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name TEXT NOT NULL DEFAULT 'Local History Project',
  description TEXT DEFAULT '',
  centre_lat DOUBLE PRECISION DEFAULT 53.8175,
  centre_lng DOUBLE PRECISION DEFAULT -3.0530,
  default_zoom INTEGER DEFAULT 14,
  owner_id UUID NOT NULL REFERENCES auth.users(id) DEFAULT auth.uid(),
  is_public BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════
-- PROFILES (for displaying collaborator emails)
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.profiles (
  id UUID REFERENCES auth.users(id) PRIMARY KEY,
  email TEXT
);

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

-- ═══════════════════════════════════════════════
-- PLACES
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS places (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  project_id UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  lat DOUBLE PRECISION NOT NULL,
  lng DOUBLE PRECISION NOT NULL,
  category TEXT DEFAULT 'residential',
  created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_places_project ON places(project_id);

-- ═══════════════════════════════════════════════
-- TIME ENTRIES
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS time_entries (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  place_id UUID NOT NULL REFERENCES places(id) ON DELETE CASCADE,
  year_start INTEGER NOT NULL,
  year_end INTEGER,
  title TEXT NOT NULL DEFAULT '',
  summary TEXT DEFAULT '',
  source TEXT DEFAULT '',
  source_type TEXT DEFAULT 'user' CHECK (source_type IN ('archive', 'newspaper', 'oral', 'photo', 'map', 'user')),
  confidence TEXT DEFAULT 'likely' CHECK (confidence IN ('verified', 'likely', 'speculative')),
  created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_entries_place ON time_entries(place_id);
CREATE INDEX IF NOT EXISTS idx_entries_years ON time_entries(year_start, year_end);

-- ═══════════════════════════════════════════════
-- IMAGES
-- ═══════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS images (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  time_entry_id UUID NOT NULL REFERENCES time_entries(id) ON DELETE CASCADE,
  storage_path TEXT NOT NULL,
  caption TEXT DEFAULT '',
  year_taken INTEGER,
  credit TEXT DEFAULT '',
  created_by UUID REFERENCES auth.users(id) DEFAULT auth.uid(),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_images_entry ON images(time_entry_id);

-- ═══════════════════════════════════════════════
-- PROJECT ROLES (Collaboration)
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

-- ═══════════════════════════════════════════════
-- ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════

ALTER TABLE projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE places ENABLE ROW LEVEL SECURITY;
ALTER TABLE time_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE images ENABLE ROW LEVEL SECURITY;
ALTER TABLE project_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- ═══════════════════════════════════════════════
-- SECURITY DEFINER HELPERS (prevent infinite recursion)
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

-- PROFILES
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public profiles are viewable by everyone." ON public.profiles FOR SELECT USING (true);
CREATE POLICY "Users can insert their own profile." ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can update own profile." ON public.profiles FOR UPDATE USING (auth.uid() = id);

-- PROJECT ROLES
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

-- PROJECTS
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

-- PLACES
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

-- TIME ENTRIES
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

-- IMAGES
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

-- ═══════════════════════════════════════════════
-- STORAGE BUCKET for images
-- ═══════════════════════════════════════════════
INSERT INTO storage.buckets (id, name, public) 
VALUES ('place-images', 'place-images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read for images
CREATE POLICY "Public image read" ON storage.objects FOR SELECT USING (bucket_id = 'place-images');
-- Allow any user to upload images
CREATE POLICY "Allow image upload" ON storage.objects FOR INSERT WITH CHECK (bucket_id = 'place-images');

-- ═══════════════════════════════════════════════
-- UPDATED_AT trigger
-- ═══════════════════════════════════════════════
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_places_updated BEFORE UPDATE ON places FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER trg_entries_updated BEFORE UPDATE ON time_entries FOR EACH ROW EXECUTE FUNCTION update_updated_at();
