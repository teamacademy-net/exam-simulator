-- =====================================================================
-- ExamSim + Supabase: question banks uploaded on the Admin page
-- Run this ONCE, AFTER setup.sql: SQL Editor -> New query -> paste -> Run.
-- It creates the "exams" table and its security rules:
--   * admins upload, publish/hide, replace and delete exams
--   * trainers and admins can see every exam (also hidden ones, to preview)
--   * active students see published exams only
-- Safe to run again.
-- =====================================================================

create table if not exists public.exams (
  id             text primary key check (id ~ '^[A-Za-z0-9._-]{1,100}$'),
  title          text not null,
  category       text not null default 'Other',
  level          text,
  question_count integer not null default 0,
  published      boolean not null default false,
  definition     jsonb not null,                       -- the whole uploaded JSON file
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.profiles (id) on delete set null
);

create index if not exists exams_category_idx on public.exams (category);

alter table public.exams enable row level security;

revoke all on public.exams from anon, authenticated;
grant select, insert, update, delete on public.exams to authenticated;  -- the policies below narrow this down

drop policy if exists "Read published exams or all if staff" on public.exams;
drop policy if exists "Admins add exams"                     on public.exams;
drop policy if exists "Admins change exams"                  on public.exams;
drop policy if exists "Admins delete exams"                  on public.exams;

create policy "Read published exams or all if staff" on public.exams
  for select to authenticated
  using (
    public.is_staff()
    or (published and exists (select 1 from public.profiles p
                              where p.id = (select auth.uid()) and p.is_active))
  );

create policy "Admins add exams" on public.exams
  for insert to authenticated
  with check (public.is_admin());

create policy "Admins change exams" on public.exams
  for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admins delete exams" on public.exams
  for delete to authenticated
  using (public.is_admin());
