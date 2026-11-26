-- Mensajes
create table public.messages (
  id           uuid primary key default gen_random_uuid(),
  seq          bigint generated always as identity,
  device_id    text not null default 'juan-macbook',
  sender       text not null default 'Valentina 💕',
  avatar       text,
  text         text check (char_length(text) <= 1000),
  image_path   text,                      -- ruta dentro del bucket (para borrar luego)
  image_url    text,                      -- URL pública para el overlay
  image_type   text check (image_type in ('image','gif','webp')),
  created_at   timestamptz not null default now(),
  delivered_at timestamptz,               -- se llena con ack_messages()
  constraint has_content check (text is not null or image_path is not null)
);
create index messages_pending_idx on public.messages (device_id, delivered_at, seq);

alter table public.messages enable row level security;

-- anon: SOLO insertar (sin select/update/delete)
create policy anon_insert on public.messages
  for insert to anon
  with check (device_id = 'juan-macbook' and delivered_at is null);

-- Secreto del receptor (schema NO expuesto por la API)
create schema if not exists private;
create table private.receiver (id int primary key default 1, secret_hash text not null);

-- Insertar hash del secreto (generado con: echo -n '8MnVwyYuoX5rCJi03Q9CIxD4sM+7zqeshKLg6IURU/A=' | sha256sum)
insert into private.receiver (id, secret_hash) values (1, '95d299f7edfafa69dca1e52fad8e10d5ba183e38dc00d70be8b8a766998b5882')
on conflict (id) do update set secret_hash = excluded.secret_hash;

-- Función helper para validar el secreto
create or replace function private.verify_receiver_secret(p_secret text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_hash text;
begin
  select secret_hash into v_hash from private.receiver where id = 1;
  if v_hash is null then
    return false;
  end if;
  -- Comparación en tiempo constante simple (para producción considerar pgcrypto)
  return v_hash = encode(sha256(p_secret::bytea), 'hex');
end;
$$;

-- RPC: pull_messages - devuelve mensajes pendientes, NO los marca
create or replace function public.pull_messages(
  p_secret text,
  p_device text default 'juan-macbook',
  p_limit int default 50
)
returns setof public.messages
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.verify_receiver_secret(p_secret) then
    raise exception 'Invalid receiver secret' using errcode = '42501';
  end if;

  return query
  select * from public.messages
  where device_id = p_device
    and delivered_at is null
  order by seq asc
  limit p_limit;
end;
$$;

revoke all on function public.pull_messages(text, text, int) from public;
grant execute on function public.pull_messages(text, text, int) to anon;

-- RPC: ack_messages - marca como entregados (idempotente)
create or replace function public.ack_messages(
  p_secret text,
  p_ids uuid[]
)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_updated int;
begin
  if not private.verify_receiver_secret(p_secret) then
    raise exception 'Invalid receiver secret' using errcode = '42501';
  end if;

  update public.messages
  set delivered_at = now()
  where id = any(p_ids)
    and delivered_at is null;

  get diagnostics v_updated = row_count;
  return v_updated;
end;
$$;

revoke all on function public.ack_messages(text, uuid[]) from public;
grant execute on function public.ack_messages(text, uuid[]) to anon;