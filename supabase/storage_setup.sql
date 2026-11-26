-- Bucket para imágenes
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('media', 'media', true, 10485760, array['image/jpeg','image/png','image/gif','image/webp'])
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- Políticas RLS para el bucket media
-- anon: SOLO insertar (no listar, no actualizar, no borrar)
create policy "anon_insert_media" on storage.objects
  for insert to anon
  with check (bucket_id = 'media');

-- Público: leer (para que el overlay pueda mostrar imágenes via URL pública)
create policy "public_read_media" on storage.objects
  for select to public
  using (bucket_id = 'media');