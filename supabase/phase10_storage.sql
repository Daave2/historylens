-- phase10_storage.sql
-- Run this in the Supabase SQL editor to create the image storage bucket and policies

-- Create the storage bucket for timeline images
insert into storage.buckets (id, name, public) 
values ('entry_images', 'entry_images', true)
ON CONFLICT (id) DO NOTHING;

-- Allow public read access to all images
CREATE POLICY "Public Access"
ON storage.objects FOR SELECT
USING ( bucket_id = 'entry_images' );

-- Allow authenticated users to upload new images
CREATE POLICY "Authenticated users can upload images"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK ( bucket_id = 'entry_images' );

-- Allow users to delete their own uploaded images
CREATE POLICY "Users can delete their own images"
ON storage.objects FOR DELETE
TO authenticated
USING ( bucket_id = 'entry_images' AND auth.uid() = owner );
