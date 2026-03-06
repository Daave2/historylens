-- Phase 3: Launch Readiness Security Updates
-- Run this in the Supabase SQL editor: https://supabase.com/dashboard/project/glxdxdubtsyoecfbcqys/sql

-- 1. Add visibility flag to projects
ALTER TABLE projects ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT true;

-- 2. Drop existing permissive policies
DROP POLICY IF EXISTS "Auth insert projects" ON projects;
DROP POLICY IF EXISTS "Auth update projects" ON projects;
DROP POLICY IF EXISTS "Auth delete projects" ON projects;

DROP POLICY IF EXISTS "Auth insert places" ON places;
DROP POLICY IF EXISTS "Auth update places" ON places;
DROP POLICY IF EXISTS "Auth delete places" ON places;

DROP POLICY IF EXISTS "Auth insert entries" ON time_entries;
DROP POLICY IF EXISTS "Auth update entries" ON time_entries;
DROP POLICY IF EXISTS "Auth delete entries" ON time_entries;

DROP POLICY IF EXISTS "Auth insert images" ON images;
DROP POLICY IF EXISTS "Auth update images" ON images;
DROP POLICY IF EXISTS "Auth delete images" ON images;

DROP POLICY IF EXISTS "Public read projects" ON projects;
DROP POLICY IF EXISTS "Public read places" ON places;
DROP POLICY IF EXISTS "Public read entries" ON time_entries;

-- 3. Create Strict RLS Policies

-- PROJECTS
-- Anyone can see public projects, or projects they own
CREATE POLICY "Read projects" ON projects FOR SELECT 
  USING (is_public = true OR owner_id = auth.uid());

-- Only authenticated users can create projects. Owner is set automatically.
CREATE POLICY "Insert projects" ON projects FOR INSERT 
  WITH CHECK (auth.uid() IS NOT NULL);

-- Only the owner can update or delete their project
CREATE POLICY "Update projects" ON projects FOR UPDATE 
  USING (owner_id = auth.uid());
CREATE POLICY "Delete projects" ON projects FOR DELETE 
  USING (owner_id = auth.uid());

-- PLACES
-- Read places if the parent project is public or owned by the user
CREATE POLICY "Read places" ON places FOR SELECT 
  USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = places.project_id AND (projects.is_public = true OR projects.owner_id = auth.uid()))
  );

-- Insert/Update/Delete places only if the user owns the parent project
CREATE POLICY "Modify places" ON places FOR ALL 
  USING (
    EXISTS (SELECT 1 FROM projects WHERE projects.id = places.project_id AND projects.owner_id = auth.uid())
  );

-- TIME ENTRIES
-- Read entries if the parent project is public or owned by the user
CREATE POLICY "Read entries" ON time_entries FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM places 
      JOIN projects ON places.project_id = projects.id 
      WHERE places.id = time_entries.place_id 
      AND (projects.is_public = true OR projects.owner_id = auth.uid())
    )
  );

-- Modify entries only if the user owns the parent project
CREATE POLICY "Modify entries" ON time_entries FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM places 
      JOIN projects ON places.project_id = projects.id 
      WHERE places.id = time_entries.place_id 
      AND projects.owner_id = auth.uid()
    )
  );

-- IMAGES
-- Read image metadata if the parent project is public or owned by the user
CREATE POLICY "Read image metadata" ON images FOR SELECT 
  USING (
    EXISTS (
      SELECT 1 FROM time_entries 
      JOIN places ON time_entries.place_id = places.id 
      JOIN projects ON places.project_id = projects.id 
      WHERE time_entries.id = images.time_entry_id 
      AND (projects.is_public = true OR projects.owner_id = auth.uid())
    )
  );

-- Modify image metadata only if the user owns the parent project
CREATE POLICY "Modify image metadata" ON images FOR ALL 
  USING (
    EXISTS (
      SELECT 1 FROM time_entries 
      JOIN places ON time_entries.place_id = places.id 
      JOIN projects ON places.project_id = projects.id 
      WHERE time_entries.id = images.time_entry_id 
      AND projects.owner_id = auth.uid()
    )
  );

-- Update the main schema file to reflect these changes for the future
