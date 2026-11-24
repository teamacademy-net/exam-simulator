-- =====================================================================
-- ExamSim + Supabase: resume an unfinished exam on another device or browser
-- Run this ONCE, after setup.sql:
--   Supabase -> SQL Editor -> + New query -> paste everything -> Run.
-- Safe to run again.
--
-- Each student has at most one unfinished exam (as in the app). Its progress is
-- kept here as well as in the browser, so they can sign in on a phone, another
-- laptop or another browser and continue. The row is removed when the exam is
-- finished or discarded. Students can only see and change their own row.
-- =====================================================================

create table if not exists public.exam_sessions (
  user_id    uuid primary key references public.profiles (id) on delete cascade,
  exam_id    text not null,
  device_id  text not null check (length(device_id) between 1 and 100),   -- which browser is currently using it
  state      jsonb not null check (octet_length(state::text) < 3000000),   -- the exam in progress (answers, position, time)
  updated_at timestamptz not null default now()
);

alter table public.exam_sessions enable row level security;
revoke all on public.exam_sessions from anon, authenticated;
grant select, insert, update, delete on public.exam_sessions to authenticated;

drop policy if exists "Students keep their own unfinished exam" on public.exam_sessions;
create policy "Students keep their own unfinished exam" on public.exam_sessions
  for all to authenticated
  using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.profiles p where p.id = auth.uid() and p.is_active)
  );
