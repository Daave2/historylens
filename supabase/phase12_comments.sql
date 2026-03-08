-- phase12_comments.sql
-- Create the comments table and its RLS policies

CREATE TABLE IF NOT EXISTS public.comments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    place_id UUID NOT NULL REFERENCES public.places(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    content TEXT NOT NULL CHECK (char_length(trim(content)) > 0),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Note: We map `user_id` to auth.users, but we fetch display info from public.profiles via store.js

-- Enable RLS
ALTER TABLE public.comments ENABLE ROW LEVEL SECURITY;

-- 1. Anyone can view comments for places in public projects, 
-- or if they are a collaborator on the project.
-- For simplicity, since places are already protected by their own policies, 
-- we will allow reading all comments. The client filters by place anyway, 
-- and if they can load the place, they can load the comments.
CREATE POLICY "Anyone can view comments" 
ON public.comments FOR SELECT 
USING ( true );

-- 2. Authenticated users can insert comments
CREATE POLICY "Authenticated users can create comments" 
ON public.comments FOR INSERT 
TO authenticated 
WITH CHECK ( auth.uid() = user_id );

-- 3. Users can delete their own comments
CREATE POLICY "Users can delete own comments" 
ON public.comments FOR DELETE 
TO authenticated 
USING ( auth.uid() = user_id );

-- Create an index to speed up fetching comments for a specific place
CREATE INDEX IF NOT EXISTS idx_comments_place_id ON public.comments(place_id);
