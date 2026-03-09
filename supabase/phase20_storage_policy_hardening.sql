-- phase20_storage_policy_hardening.sql
-- Tighten storage policies and support both legacy/new image buckets.

insert into storage.buckets (id, name, public)
values ('place-images', 'place-images', true)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('entry_images', 'entry_images', true)
on conflict (id) do nothing;

drop policy if exists "Public image read" on storage.objects;
create policy "Public image read"
on storage.objects for select
using (bucket_id in ('place-images', 'entry_images'));

drop policy if exists "Allow image upload" on storage.objects;
create policy "Allow image upload"
on storage.objects for insert
to authenticated
with check (bucket_id in ('place-images', 'entry_images'));

drop policy if exists "Allow image delete" on storage.objects;
create policy "Allow image delete"
on storage.objects for delete
to authenticated
using (bucket_id in ('place-images', 'entry_images') and auth.uid() = owner);
