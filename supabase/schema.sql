-- Buzzer Live — Supabase schema
-- Run this entire file in Supabase Dashboard > SQL Editor as project owner.
create extension if not exists pgcrypto with schema extensions;

create table if not exists public.admin_users (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table if not exists public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{4,10}$'),
  admin_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'waiting' check (status in ('waiting','active','locked','finished')),
  created_at timestamptz not null default now()
);

create table if not exists public.participants (
  id uuid primary key,
  room_id uuid not null references public.rooms(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 40),
  token_hash text not null,
  joined_at timestamptz not null default now()
);
create unique index if not exists participants_room_name_unique on public.participants(room_id, lower(name));
create index if not exists participants_room_idx on public.participants(room_id);

create table if not exists public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  round_number integer not null check (round_number > 0),
  status text not null default 'active' check (status in ('active','locked','finished')),
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique(room_id, round_number)
);
create index if not exists rounds_room_number_idx on public.rounds(room_id, round_number desc);

create table if not exists public.buzzes (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.rounds(id) on delete cascade,
  participant_id uuid not null references public.participants(id) on delete cascade,
  position integer not null check (position > 0),
  created_at timestamptz not null default clock_timestamp(),
  unique(round_id, position),
  unique(round_id, participant_id)
);
create index if not exists buzzes_round_position_idx on public.buzzes(round_id, position);

-- Clients must use the RPCs below. No direct table access is granted to anon/authenticated.
alter table public.admin_users enable row level security;
alter table public.rooms enable row level security;
alter table public.participants enable row level security;
alter table public.rounds enable row level security;
alter table public.buzzes enable row level security;
revoke all on public.admin_users, public.rooms, public.participants, public.rounds, public.buzzes from anon, authenticated;

create or replace function public.is_buzzer_admin()
returns boolean language sql stable security definer set search_path = public, auth
as $$ select exists (select 1 from public.admin_users a where a.user_id = auth.uid()) $$;

create or replace function public.get_room_state(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public
as $$
declare v_room public.rooms%rowtype; v_round public.rounds%rowtype; v_buzzes jsonb;
begin
  select * into v_room from public.rooms where code = upper(trim(p_code));
  if not found then raise exception 'No existe una partida con ese código.'; end if;
  select * into v_round from public.rounds where room_id = v_room.id order by round_number desc limit 1;
  if found then
    select coalesce(jsonb_agg(jsonb_build_object(
      'id', b.id, 'participant_id', b.participant_id, 'participant_name', p.name,
      'position', b.position, 'created_at', b.created_at
    ) order by b.position), '[]'::jsonb) into v_buzzes
    from public.buzzes b join public.participants p on p.id = b.participant_id where b.round_id = v_round.id;
  else v_buzzes := '[]'::jsonb; end if;
  return jsonb_build_object(
    'code', v_room.code, 'status', v_room.status,
    'round_number', coalesce(v_round.round_number, 0), 'round_id', v_round.id,
    'participant_count', (select count(*) from public.participants where room_id = v_room.id),
    'buzzes', v_buzzes
  );
end $$;

create or replace function public.join_room(p_code text, p_name text, p_participant_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_room public.rooms%rowtype; v_name text := trim(p_name);
begin
  if length(v_name) < 1 or length(v_name) > 40 then raise exception 'El nombre debe tener entre 1 y 40 caracteres.'; end if;
  if p_token is null or length(p_token) < 32 then raise exception 'Token de participante inválido.'; end if;
  select * into v_room from public.rooms where code = upper(trim(p_code)) for update;
  if not found then raise exception 'No existe una partida con ese código.'; end if;
  if v_room.status = 'finished' then raise exception 'Esta partida ya finalizó.'; end if;
  if exists(select 1 from public.participants where room_id = v_room.id and lower(name) = lower(v_name) and id <> p_participant_id) then
    raise exception 'Ese nombre ya está en uso en esta partida.';
  end if;
  insert into public.participants(id, room_id, name, token_hash)
  values (p_participant_id, v_room.id, v_name, encode(extensions.digest(p_token, 'sha256'), 'hex'))
  on conflict (id) do update set name = excluded.name, token_hash = excluded.token_hash
  where participants.room_id = excluded.room_id;
  return public.get_room_state(v_room.code);
end $$;

create or replace function public.submit_buzz(p_code text, p_participant_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public, extensions
as $$
declare v_room public.rooms%rowtype; v_round public.rounds%rowtype; v_participant public.participants%rowtype; v_existing public.buzzes%rowtype; v_position integer;
begin
  select * into v_room from public.rooms where code = upper(trim(p_code));
  if not found then raise exception 'No existe una partida con ese código.'; end if;
  if v_room.status <> 'active' then raise exception 'La ronda no está activa.'; end if;
  select * into v_participant from public.participants where id = p_participant_id and room_id = v_room.id;
  if not found or p_token is null or v_participant.token_hash <> encode(extensions.digest(p_token, 'sha256'), 'hex') then
    raise exception 'Participante no válido. Vuelve a entrar a la partida.';
  end if;
  -- Lock the active round row so simultaneous submissions receive unique, serialized positions.
  select * into v_round from public.rounds where room_id = v_room.id and status = 'active' order by round_number desc limit 1 for update;
  if not found then raise exception 'No hay una ronda activa.'; end if;
  select * into v_existing from public.buzzes where round_id = v_round.id and participant_id = v_participant.id;
  if found then return jsonb_build_object('position', v_existing.position, 'created_at', v_existing.created_at, 'duplicate', true); end if;
  select coalesce(max(position), 0) + 1 into v_position from public.buzzes where round_id = v_round.id;
  insert into public.buzzes(round_id, participant_id, position) values (v_round.id, v_participant.id, v_position);
  return jsonb_build_object('position', v_position, 'duplicate', false);
end $$;

create or replace function public.create_room(p_code text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_room public.rooms%rowtype;
begin
  if auth.uid() is null or not public.is_buzzer_admin() then raise exception 'No tienes permisos de administrador.'; end if;
  if upper(trim(p_code)) !~ '^[A-Z0-9]{4,10}$' then raise exception 'El código debe tener entre 4 y 10 letras o números.'; end if;
  insert into public.rooms(code, admin_id) values (upper(trim(p_code)), auth.uid()) returning * into v_room;
  return to_jsonb(v_room);
end $$;

create or replace function public.list_admin_rooms()
returns jsonb language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null or not public.is_buzzer_admin() then raise exception 'No tienes permisos de administrador.'; end if;
  return coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'code', r.code, 'status', r.status, 'created_at', r.created_at) order by r.created_at desc)
    from public.rooms r where r.admin_id = auth.uid()), '[]'::jsonb);
end $$;

create or replace function public.start_round(p_code text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_room public.rooms%rowtype; v_next integer;
begin
  if auth.uid() is null or not public.is_buzzer_admin() then raise exception 'No tienes permisos de administrador.'; end if;
  select * into v_room from public.rooms where code = upper(trim(p_code)) and admin_id = auth.uid() for update;
  if not found then raise exception 'Partida no encontrada o sin permisos.'; end if;
  if v_room.status = 'active' then raise exception 'Ya hay una ronda activa. Bloquéala o finalízala antes de iniciar otra.'; end if;
  update public.rounds set status = 'finished', ended_at = now() where room_id = v_room.id and status in ('active','locked');
  select coalesce(max(round_number), 0) + 1 into v_next from public.rounds where room_id = v_room.id;
  insert into public.rounds(room_id, round_number, status) values (v_room.id, v_next, 'active');
  update public.rooms set status = 'active' where id = v_room.id;
  return public.get_room_state(v_room.code);
end $$;

create or replace function public.lock_round(p_code text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_room public.rooms%rowtype;
begin
  if auth.uid() is null or not public.is_buzzer_admin() then raise exception 'No tienes permisos de administrador.'; end if;
  select * into v_room from public.rooms where code = upper(trim(p_code)) and admin_id = auth.uid() for update;
  if not found then raise exception 'Partida no encontrada o sin permisos.'; end if;
  if v_room.status <> 'active' then raise exception 'No hay una ronda activa para bloquear.'; end if;
  update public.rounds set status = 'locked', ended_at = now() where room_id = v_room.id and status = 'active';
  update public.rooms set status = 'locked' where id = v_room.id;
  return public.get_room_state(v_room.code);
end $$;

create or replace function public.finish_round(p_code text)
returns jsonb language plpgsql security definer set search_path = public
as $$
declare v_room public.rooms%rowtype;
begin
  if auth.uid() is null or not public.is_buzzer_admin() then raise exception 'No tienes permisos de administrador.'; end if;
  select * into v_room from public.rooms where code = upper(trim(p_code)) and admin_id = auth.uid() for update;
  if not found then raise exception 'Partida no encontrada o sin permisos.'; end if;
  if v_room.status not in ('active','locked') then raise exception 'No hay una ronda activa para finalizar.'; end if;
  update public.rounds set status = 'finished', ended_at = now() where room_id = v_room.id and status in ('active','locked');
  update public.rooms set status = 'finished' where id = v_room.id;
  return public.get_room_state(v_room.code);
end $$;

-- Database-triggered Broadcast events wake up connected clients. The client also polls as a fallback.
create or replace function public.broadcast_buzzer_change()
returns trigger language plpgsql security definer set search_path = public
as $$
declare v_row jsonb; v_room_id uuid; v_code text;
begin
  v_row := case when TG_OP = 'DELETE' then to_jsonb(OLD) else to_jsonb(NEW) end;
  if TG_TABLE_NAME = 'rooms' then
    v_code := v_row->>'code';
  else
    v_room_id := (v_row->>'room_id')::uuid;
    select code into v_code from public.rooms where id = v_room_id;
  end if;
  if v_code is not null then
    perform realtime.broadcast_changes('room:' || v_code, TG_OP, TG_OP, TG_TABLE_NAME, TG_TABLE_SCHEMA, NEW, OLD);
  end if;
  if TG_OP = 'DELETE' then return OLD; end if;
  return NEW;
end $$;

drop trigger if exists rooms_broadcast on public.rooms;
create trigger rooms_broadcast after insert or update on public.rooms for each row execute function public.broadcast_buzzer_change();
drop trigger if exists rounds_broadcast on public.rounds;
create trigger rounds_broadcast after insert or update on public.rounds for each row execute function public.broadcast_buzzer_change();
drop trigger if exists buzzes_broadcast on public.buzzes;
create trigger buzzes_broadcast after insert on public.buzzes for each row execute function public.broadcast_buzzer_change();

-- RPC permissions: participants can join/read the room snapshot/submit a buzz; admin actions require an allowlisted user.
revoke all on function public.is_buzzer_admin() from public;
revoke all on function public.get_room_state(text) from public;
revoke all on function public.join_room(text,text,uuid,text) from public;
revoke all on function public.submit_buzz(text,uuid,text) from public;
revoke all on function public.create_room(text) from public;
revoke all on function public.list_admin_rooms() from public;
revoke all on function public.start_round(text) from public;
revoke all on function public.lock_round(text) from public;
revoke all on function public.finish_round(text) from public;
grant execute on function public.get_room_state(text) to anon, authenticated;
grant execute on function public.join_room(text,text,uuid,text) to anon, authenticated;
grant execute on function public.submit_buzz(text,uuid,text) to anon, authenticated;
grant execute on function public.is_buzzer_admin() to authenticated;
grant execute on function public.create_room(text) to authenticated;
grant execute on function public.list_admin_rooms() to authenticated;
grant execute on function public.start_round(text) to authenticated;
grant execute on function public.lock_round(text) to authenticated;
grant execute on function public.finish_round(text) to authenticated;

-- After creating the admin account in Supabase Authentication, allowlist it with:
-- insert into public.admin_users(user_id) select id from auth.users where email = 'admin@tudominio.com';
