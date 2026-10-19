-- Migración para el proyecto ya existente: permite guardar imágenes del catálogo.
alter table public.games add column if not exists image_path text;

-- La vista existente no incorpora automáticamente columnas nuevas de games.
-- Se agrega image_path al final para conservar el orden de sus columnas anteriores.
create or replace view public.game_availability as
select g.id, g.name, g.category, g.description, g.quantity, g.status, g.created_at,
  greatest(g.quantity - count(l.id) filter (where l.status = 'active'), 0)::integer as available,
  g.image_path
from public.games g
left join public.loans l on l.game_id = g.id
group by g.id;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('game-images', 'game-images', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "game_images_public_read" on storage.objects;
create policy "game_images_public_read" on storage.objects
for select to public using (bucket_id = 'game-images');

drop policy if exists "game_images_admin_upload" on storage.objects;
create policy "game_images_admin_upload" on storage.objects
for insert to authenticated with check (bucket_id = 'game-images' and (select public.has_role('admin')));

drop policy if exists "game_images_admin_update" on storage.objects;
create policy "game_images_admin_update" on storage.objects
for update to authenticated using (bucket_id = 'game-images' and (select public.has_role('admin')))
with check (bucket_id = 'game-images' and (select public.has_role('admin')));

drop policy if exists "game_images_admin_delete" on storage.objects;
create policy "game_images_admin_delete" on storage.objects
for delete to authenticated using (bucket_id = 'game-images' and (select public.has_role('admin')));
