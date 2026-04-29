-- phase27_project_chat.sql
-- Add project-level live chat for community collaboration.

CREATE TABLE IF NOT EXISTS public.project_chat_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE DEFAULT auth.uid(),
  body TEXT NOT NULL CHECK (char_length(trim(body)) BETWEEN 1 AND 1200),
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_chat_messages_project_created
  ON public.project_chat_messages(project_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_project_chat_messages_user_created
  ON public.project_chat_messages(user_id, created_at DESC);

ALTER TABLE public.project_chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_chat_messages REPLICA IDENTITY FULL;

DROP POLICY IF EXISTS "Read project chat messages" ON public.project_chat_messages;
DROP POLICY IF EXISTS "Create project chat messages" ON public.project_chat_messages;
DROP POLICY IF EXISTS "Delete project chat messages" ON public.project_chat_messages;

CREATE POLICY "Read project chat messages"
ON public.project_chat_messages FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_chat_messages.project_id
      AND (
        p.is_public = true
        OR p.owner_id = (SELECT auth.uid())
        OR public.has_project_role(p.id, ARRAY['editor', 'admin', 'pending'])
      )
  )
);

CREATE POLICY "Create project chat messages"
ON public.project_chat_messages FOR INSERT
TO authenticated
WITH CHECK (
  user_id = (SELECT auth.uid())
  AND char_length(trim(body)) BETWEEN 1 AND 1200
  AND NOT public.has_project_role(project_id, ARRAY['banned'])
  AND EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_chat_messages.project_id
      AND (
        p.owner_id = (SELECT auth.uid())
        OR public.has_project_role(p.id, ARRAY['editor', 'admin', 'pending'])
      )
  )
);

CREATE POLICY "Delete project chat messages"
ON public.project_chat_messages FOR DELETE
TO authenticated
USING (
  user_id = (SELECT auth.uid())
  OR EXISTS (
    SELECT 1
    FROM public.projects p
    WHERE p.id = project_chat_messages.project_id
      AND (
        p.owner_id = (SELECT auth.uid())
        OR public.has_project_role(p.id, ARRAY['admin'])
      )
  )
);

DO $$
BEGIN
  ALTER PUBLICATION supabase_realtime ADD TABLE public.project_chat_messages;
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN insufficient_privilege THEN NULL;
  WHEN undefined_object THEN NULL;
END $$;

COMMENT ON TABLE public.project_chat_messages IS 'Project-level live chat messages for HistoryLens collaboration.';
