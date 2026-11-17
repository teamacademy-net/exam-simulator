-- =====================================================================
-- ExamSim + Supabase: database set-up
-- Run this ONCE in Supabase: SQL Editor -> New query -> paste -> Run.
-- It creates:
--   profiles  : one row per registered user (name, email, role, active)
--   attempts  : one row per finished exam (score, pass/fail, domains)
-- and the security rules (Row Level Security) that decide who sees what.
-- Safe to run again: it drops and recreates its own policies/functions.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tables
-- ---------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text not null default '',
  role        text not null default 'student'
              check (role in ('student', 'trainer', 'admin')),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.attempts (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null default auth.uid()
                      references public.profiles (id) on delete cascade,
  exam_id             text not null,
  exam_title          text,
  mode                text check (mode in ('exam', 'practice')),
  total_questions     integer,
  correct             integer,
  percent             integer check (percent between 0 and 100),
  passing_score       integer,
  passed              boolean,
  time_used_seconds   integer,
  time_limit_seconds  integer,
  time_up             boolean not null default false,
  domains             jsonb,
  created_at          timestamptz not null default now()
);

create index if not exists attempts_user_id_idx    on public.attempts (user_id);
create index if not exists attempts_created_at_idx on public.attempts (created_at desc);

-- ---------------------------------------------------------------------
-- 2. Helper functions (used by the security rules)
--    "security definer" lets them read profiles without being blocked
--    by the rules themselves.
-- ---------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin' and is_active
  );
$$;

create or replace function public.is_staff()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role in ('admin', 'trainer') and is_active
  );
$$;

-- ---------------------------------------------------------------------
-- 3. Create a profile automatically when someone registers
-- ---------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (
    new.id,
    new.email,
    left(coalesce(new.raw_user_meta_data ->> 'full_name', ''), 120)
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------
-- 4. Admin-only action: change a user's role or block/unblock them
-- ---------------------------------------------------------------------
create or replace function public.admin_update_user(
  target_id  uuid,
  new_role   text    default null,
  new_active boolean default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only admins can change users';
  end if;
  if target_id = (select auth.uid())
     and (coalesce(new_role, 'admin') <> 'admin' or new_active = false) then
    raise exception 'You cannot remove your own admin access';
  end if;
  if new_role is not null and new_role not in ('student', 'trainer', 'admin') then
    raise exception 'Unknown role: %', new_role;
  end if;
  update public.profiles
     set role      = coalesce(new_role, role),
         is_active = coalesce(new_active, is_active)
   where id = target_id;
end;
$$;

-- ---------------------------------------------------------------------
-- 5. Who may do what (permissions + Row Level Security)
-- ---------------------------------------------------------------------
alter table public.profiles enable row level security;
alter table public.attempts enable row level security;

-- Start from nothing, then grant only what the app needs.
revoke all on public.profiles from anon, authenticated;
revoke all on public.attempts from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (full_name) on public.profiles to authenticated;   -- users may edit their name only
grant select, insert on public.attempts to authenticated;       -- no edits or deletes of scores

revoke all on function public.is_admin()                            from public, anon;
revoke all on function public.is_staff()                            from public, anon;
revoke all on function public.handle_new_user()                     from public, anon, authenticated;
revoke all on function public.admin_update_user(uuid, text, boolean) from public, anon;
grant execute on function public.is_admin()                            to authenticated;
grant execute on function public.is_staff()                            to authenticated;
grant execute on function public.admin_update_user(uuid, text, boolean) to authenticated;

-- profiles
drop policy if exists "Users read own profile"        on public.profiles;
drop policy if exists "Staff read all profiles"       on public.profiles;
drop policy if exists "Users update own profile"      on public.profiles;

create policy "Users read own profile" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()));

create policy "Staff read all profiles" on public.profiles
  for select to authenticated
  using (public.is_staff());

create policy "Users update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- attempts
drop policy if exists "Active users save own attempts" on public.attempts;
drop policy if exists "Users read own attempts"        on public.attempts;
drop policy if exists "Staff read all attempts"        on public.attempts;

create policy "Active users save own attempts" on public.attempts
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (select 1 from public.profiles p
                where p.id = (select auth.uid()) and p.is_active)
  );

create policy "Users read own attempts" on public.attempts
  for select to authenticated
  using (user_id = (select auth.uid()));

create policy "Staff read all attempts" on public.attempts
  for select to authenticated
  using (public.is_staff());

-- ---------------------------------------------------------------------
-- 6. Profiles for anyone who registered BEFORE this script was run
-- ---------------------------------------------------------------------
insert into public.profiles (id, email, full_name)
select u.id, u.email, left(coalesce(u.raw_user_meta_data ->> 'full_name', ''), 120)
from auth.users u
on conflict (id) do nothing;

-- =====================================================================
-- AFTER you have registered your own account on the site, make yourself
-- admin by running this ONE line (change the email first):
--
--   update public.profiles set role = 'admin' where email = 'you@example.com';
-- =====================================================================
