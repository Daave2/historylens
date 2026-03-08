-- Phase 18: Project Settings & Moderation Dashboard

-- 1. Update the project_roles CHECK constraint to allow 'banned'
ALTER TABLE project_roles DROP CONSTRAINT IF EXISTS project_roles_role_check;
ALTER TABLE project_roles ADD CONSTRAINT project_roles_role_check CHECK (role IN ('editor', 'admin', 'pending', 'banned'));

-- 2. Create a secure helper function to wipe a user's contributions from a project
-- This drops all time_entries (and their text/images) and comments made by a specific user within a specific project.
CREATE OR REPLACE FUNCTION delete_user_contributions(p_project_id UUID, p_user_id UUID)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER -- Runs as DB admin to bypass RLS for cleanup
AS $$
BEGIN
  -- Ensure the caller is an owner or admin of the project before proceeding
  IF NOT (
    public.is_project_owner(p_project_id) OR
    public.has_project_role(p_project_id, ARRAY['admin'])
  ) THEN
    RAISE EXCEPTION 'Not authorized to moderate this project';
  END IF;

  -- Delete all comments by this user on this project's places
  DELETE FROM comments 
  WHERE user_id = p_user_id AND place_id IN (
    SELECT id FROM places WHERE project_id = p_project_id
  );

  -- Delete all time_entries by this user on this project's places
  -- (Image rows referencing these will be automatically cascaded)
  DELETE FROM time_entries 
  WHERE created_by = p_user_id AND place_id IN (
    SELECT id FROM places WHERE project_id = p_project_id
  );
  
END;
$$;
