-- phase23_comment_policy_alignment.sql
-- Align Talk comment permissions with the current collaboration UX.

DROP POLICY IF EXISTS "Anyone can view comments" ON public.comments;
DROP POLICY IF EXISTS "Authenticated users can create comments" ON public.comments;
DROP POLICY IF EXISTS "Users can delete own comments" ON public.comments;
DROP POLICY IF EXISTS "Read comments" ON public.comments;
DROP POLICY IF EXISTS "Create comments" ON public.comments;
DROP POLICY IF EXISTS "Delete own comments" ON public.comments;

CREATE POLICY "Read comments"
ON public.comments FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.places p
    WHERE p.id = comments.place_id
      AND (
        public.is_project_public(p.project_id)
        OR public.is_project_owner(p.project_id)
        OR public.has_project_role(p.project_id, ARRAY['editor', 'admin', 'pending'])
      )
  )
);

CREATE POLICY "Create comments"
ON public.comments FOR INSERT
TO authenticated
WITH CHECK (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.places p
    WHERE p.id = comments.place_id
      AND (
        public.is_project_owner(p.project_id)
        OR public.has_project_role(p.project_id, ARRAY['editor', 'admin', 'pending'])
      )
  )
);

CREATE POLICY "Delete own comments"
ON public.comments FOR DELETE
TO authenticated
USING (
  auth.uid() = user_id
  AND EXISTS (
    SELECT 1
    FROM public.places p
    WHERE p.id = comments.place_id
      AND (
        public.is_project_public(p.project_id)
        OR public.is_project_owner(p.project_id)
        OR public.has_project_role(p.project_id, ARRAY['editor', 'admin', 'pending'])
      )
  )
);
