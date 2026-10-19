-- Club Geek: ejecutar en el SQL Editor del proyecto Supabase.
create extension if not exists pgcrypto;
create extension if not exists btree_gist;

create type public.app_role as enum ('admin', 'member');
create type public.reservation_status as enum ('confirmed', 'cancelled', 'completed');
create type public.loan_status as enum ('active', 'returned');

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null check (length(trim(full_name)) between 2 and 120),
  dni text not null unique check (dni ~ '^\d{7,9}$'),
  email text not null unique,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
create table public.user_roles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  role public.app_role not null default 'member'
);
create table public.games (
  id uuid primary key default gen_random_uuid(), name text not null check (length(trim(name)) between 1 and 100),
  category text not null, description text not null default '', quantity integer not null check (quantity > 0),
  status text not null default 'available' check (status in ('available', 'maintenance')),
  image_path text,
  created_at timestamptz not null default now()
);
create table public.tournaments (
  id uuid primary key default gen_random_uuid(), name text not null, game_id uuid not null references public.games(id) on delete restrict,
  starts_at timestamptz not null, description text not null default '', max_participants integer not null check (max_participants > 1),
  status text not null default 'open' check (status in ('open', 'closed')), created_at timestamptz not null default now()
);
create table public.tournament_registrations (
  id uuid primary key default gen_random_uuid(), tournament_id uuid not null references public.tournaments(id) on delete cascade,
  user_id uuid not null references public.profiles(user_id) on delete cascade, created_at timestamptz not null default now(),
  unique (tournament_id, user_id)
);
create table public.reservations (
  id uuid primary key default gen_random_uuid(), game_id uuid not null references public.games(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade, starts_at timestamptz not null, ends_at timestamptz not null,
  status public.reservation_status not null default 'confirmed', created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
create table public.loans (
  id uuid primary key default gen_random_uuid(), game_id uuid not null references public.games(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete cascade, borrowed_at timestamptz not null default now(), due_at timestamptz not null,
  returned_at timestamptz, status public.loan_status not null default 'active', created_at timestamptz not null default now(),
  check (due_at > borrowed_at)
);
create index reservations_user_idx on public.reservations(user_id, starts_at);
create index loans_user_idx on public.loans(user_id, borrowed_at desc);
create index registrations_tournament_idx on public.tournament_registrations(tournament_id);

create or replace function public.has_role(wanted public.app_role)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.user_roles r where r.user_id = (select auth.uid()) and r.role = wanted)
$$;
revoke all on function public.has_role(public.app_role) from public;
grant execute on function public.has_role(public.app_role) to authenticated;

create or replace function public.create_member_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles(user_id, full_name, dni, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'full_name', ''), coalesce(new.raw_user_meta_data->>'dni', ''), lower(new.email));
  insert into public.user_roles(user_id, role) values (new.id, 'member');
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.create_member_profile();

create or replace function public.enforce_tournament_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare cap integer; registered integer; state text;
begin
  select max_participants, status into cap, state from public.tournaments where id = new.tournament_id for update;
  select count(*) into registered from public.tournament_registrations where tournament_id = new.tournament_id;
  if state <> 'open' then raise exception 'La inscripción a este torneo está cerrada.'; end if;
  if registered >= cap then raise exception 'El torneo ya alcanzó el cupo máximo.'; end if;
  return new;
end;
$$;
create trigger registration_capacity before insert on public.tournament_registrations for each row execute function public.enforce_tournament_capacity();

create or replace function public.enforce_game_availability()
returns trigger language plpgsql security definer set search_path = '' as $$
declare quantity_available integer; active_count integer;
begin
  select quantity into quantity_available from public.games where id = new.game_id and status = 'available' for update;
  if quantity_available is null then raise exception 'El juego no está disponible.'; end if;
  select count(*) into active_count from public.loans where game_id = new.game_id and status = 'active';
  if active_count >= quantity_available then raise exception 'No hay unidades disponibles para préstamo.'; end if;
  if exists (select 1 from public.loans where game_id = new.game_id and user_id = new.user_id and status = 'active') then raise exception 'Ya tenés un préstamo activo de este juego.'; end if;
  return new;
end;
$$;
create trigger loan_availability before insert on public.loans for each row execute function public.enforce_game_availability();

create or replace function public.enforce_reservation_capacity()
returns trigger language plpgsql security definer set search_path = '' as $$
declare quantity_available integer; overlapping integer;
begin
  select quantity into quantity_available from public.games where id = new.game_id and status = 'available' for update;
  if quantity_available is null then raise exception 'El juego no está disponible.'; end if;
  select count(*) into overlapping from public.reservations r where r.game_id = new.game_id and r.status = 'confirmed'
    and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)');
  overlapping := overlapping + (select count(*) from public.loans l where l.game_id = new.game_id and l.status = 'active'
    and tstzrange(l.borrowed_at, l.due_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)'));
  if overlapping >= quantity_available then raise exception 'No hay unidades disponibles en ese horario.'; end if;
  if exists (select 1 from public.reservations r where r.user_id = new.user_id and r.status = 'confirmed'
    and tstzrange(r.starts_at, r.ends_at, '[)') && tstzrange(new.starts_at, new.ends_at, '[)')) then
    raise exception 'Ya tenés una reserva en ese horario.';
  end if;
  return new;
end;
$$;
create trigger reservation_capacity before insert on public.reservations for each row execute function public.enforce_reservation_capacity();

create or replace function public.set_member_active(member_id uuid, is_active boolean)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if not (select public.has_role('admin')) then raise exception 'No autorizado.' using errcode = '42501'; end if;
  update public.profiles set active = is_active where user_id = member_id;
end;
$$;
revoke all on function public.set_member_active(uuid, boolean) from public;
grant execute on function public.set_member_active(uuid, boolean) to authenticated;

-- Este agregado solo expone cantidades del catálogo, no datos personales; debe contar
-- todos los préstamos activos aunque RLS oculte a los socios entre sí.
create or replace view public.game_availability as
select g.id, g.name, g.category, g.description, g.quantity, g.status, g.created_at,
  greatest(g.quantity - count(l.id) filter (where l.status = 'active'), 0)::integer as available,
  g.image_path
from public.games g left join public.loans l on l.game_id = g.id group by g.id;

alter table public.profiles enable row level security;
alter table public.user_roles enable row level security;
alter table public.games enable row level security;
alter table public.tournaments enable row level security;
alter table public.tournament_registrations enable row level security;
alter table public.reservations enable row level security;
alter table public.loans enable row level security;

create policy "profiles_read_self_or_admin" on public.profiles for select to authenticated using (user_id = (select auth.uid()) or (select public.has_role('admin')));
create policy "roles_read_self_or_admin" on public.user_roles for select to authenticated using (user_id = (select auth.uid()) or (select public.has_role('admin')));
create policy "games_read_members" on public.games for select to authenticated using (exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active));
create policy "games_admin_insert" on public.games for insert to authenticated with check ((select public.has_role('admin')));
create policy "games_admin_update" on public.games for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy "games_admin_delete" on public.games for delete to authenticated using ((select public.has_role('admin')));
create policy "tournaments_read_members" on public.tournaments for select to authenticated using (true);
create policy "tournaments_admin_insert" on public.tournaments for insert to authenticated with check ((select public.has_role('admin')));
create policy "tournaments_admin_update" on public.tournaments for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy "tournaments_admin_delete" on public.tournaments for delete to authenticated using ((select public.has_role('admin')));
create policy "registrations_read_own_or_admin" on public.tournament_registrations for select to authenticated using (user_id = (select auth.uid()) or (select public.has_role('admin')));
create policy "registrations_join_self" on public.tournament_registrations for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active));
create policy "registrations_delete_own_or_admin" on public.tournament_registrations for delete to authenticated using (user_id = (select auth.uid()) or (select public.has_role('admin')));
create policy "reservations_read_own_or_admin" on public.reservations for select to authenticated using (user_id = (select auth.uid()) or (select public.has_role('admin')));
create policy "reservations_create_self" on public.reservations for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active));
create policy "reservations_admin_update" on public.reservations for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));
create policy "loans_read_own_or_admin" on public.loans for select to authenticated using (user_id = (select auth.uid()) or (select public.has_role('admin')));
create policy "loans_create_self" on public.loans for insert to authenticated with check (user_id = (select auth.uid()) and exists (select 1 from public.profiles p where p.user_id = (select auth.uid()) and p.active));
create policy "loans_admin_update" on public.loans for update to authenticated using ((select public.has_role('admin'))) with check ((select public.has_role('admin')));

grant select on public.profiles to authenticated;
grant select on public.user_roles to authenticated;
grant select, insert, update, delete on public.games, public.tournaments to authenticated;
grant select, insert, delete on public.tournament_registrations to authenticated;
grant select, insert on public.reservations to authenticated;
grant update on public.reservations to authenticated;
grant select, insert, update on public.loans to authenticated;
grant select on public.game_availability to authenticated;

-- Después de registrar la cuenta del administrador, promoverla desde aquí con su UUID:
-- update public.user_roles set role = 'admin' where user_id = 'UUID-DE-LA-CUENTA';
