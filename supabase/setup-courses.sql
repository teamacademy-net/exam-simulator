-- =====================================================================
-- ExamSim + Supabase: courses and enrollments (who may see which exams)
-- Run this ONCE, AFTER setup.sql and setup-exams.sql:
--   Supabase -> SQL Editor -> + New query -> paste everything -> Run.
-- Safe to run again.
--
-- How it works
--   * A course (e.g. "PMP") unlocks one or more exams.
--   * Admins enrol students BY EMAIL, even before they register.
--     Access lasts the course's "access_months" (3 by default) from the day of enrollment.
--   * Students see an exam only if it is published AND
--       - it belongs to no course (a free exam), or
--       - they have an active enrollment in a course that contains it.
--   * Trainers and admins still see every exam.
-- =====================================================================

-- ---------------------------------------------------------------- tables
create table if not exists public.courses (
  id            text primary key check (id ~ '^[a-z0-9][a-z0-9-]{0,49}$'),   -- short code, e.g. pmp
  name          text not null check (length(trim(name)) between 1 and 120),
  access_months integer not null default 3 check (access_months between 1 and 120),
  created_at    timestamptz not null default now()
);

create table if not exists public.course_exams (
  course_id text not null references public.courses (id) on delete cascade,
  exam_id   text not null check (exam_id ~ '^[A-Za-z0-9._-]{1,100}$'),     -- uploaded or built-in exam id
  primary key (course_id, exam_id)
);
create index if not exists course_exams_exam_idx on public.course_exams (exam_id);

create table if not exists public.enrollments (
  course_id   text not null references public.courses (id) on delete cascade,
  email       text not null check (email = lower(email) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  starts_at   timestamptz not null default now(),
  expires_at  timestamptz not null,
  enrolled_by uuid references public.profiles (id) on delete set null,
  created_at  timestamptz not null default now(),
  primary key (course_id, email)
);
create index if not exists enrollments_email_idx on public.enrollments (email);

-- ---------------------------------------------------------------- helper functions
-- The signed-in user's email (lower case), from their profile.
create or replace function public.my_email()
returns text language sql stable security definer set search_path = '' as $$
  select lower(p.email) from public.profiles p where p.id = auth.uid()
$$;

-- May the signed-in user open this exam? (staff: always; free exam: yes; otherwise an active enrollment is needed)
create or replace function public.can_open_exam(p_exam_id text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_staff()
      or not exists (select 1 from public.course_exams ce where ce.exam_id = p_exam_id)
      or exists (
           select 1
           from public.course_exams ce
           join public.enrollments e on e.course_id = ce.course_id
           where ce.exam_id = p_exam_id
             and e.email = public.my_email()
             and now() >= e.starts_at and now() < e.expires_at)
$$;

-- The signed-in student's courses (also expired ones, so the page can say when access ended).
create or replace function public.my_courses()
returns table (course_id text, name text, starts_at timestamptz, expires_at timestamptz, exam_ids text[])
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, e.starts_at, e.expires_at,
         coalesce(array_agg(ce.exam_id order by ce.exam_id) filter (where ce.exam_id is not null), '{}')
  from public.enrollments e
  join public.courses c on c.id = e.course_id
  left join public.course_exams ce on ce.course_id = c.id
  where e.email = public.my_email()
  group by c.id, c.name, e.starts_at, e.expires_at
  order by c.name
$$;

-- Admins: enrol a list of emails in a course. Access starts now and lasts the course's access_months.
-- Someone already enrolled gets a fresh period from today (renewal).
create or replace function public.admin_enroll(p_course_id text, p_emails text[])
returns table (added integer, renewed integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_months  integer;
  v_email   text;
  v_added   integer := 0;
  v_renewed integer := 0;
begin
  if not public.is_admin() then
    raise exception 'Only admins can enrol students.';
  end if;
  select c.access_months into v_months from public.courses c where c.id = p_course_id;
  if v_months is null then
    raise exception 'The course "%" does not exist.', p_course_id;
  end if;
  foreach v_email in array coalesce(p_emails, '{}') loop
    v_email := lower(trim(v_email));
    continue when v_email = '';
    if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
      raise exception '"%" is not an email address.', v_email;
    end if;
    update public.enrollments
       set starts_at = now(), expires_at = now() + make_interval(months => v_months), enrolled_by = auth.uid()
     where course_id = p_course_id and email = v_email;
    if found then
      v_renewed := v_renewed + 1;
    else
      insert into public.enrollments (course_id, email, starts_at, expires_at, enrolled_by)
      values (p_course_id, v_email, now(), now() + make_interval(months => v_months), auth.uid());
      v_added := v_added + 1;
    end if;
  end loop;
  return query select v_added, v_renewed;
end;
$$;

revoke all on function public.my_email() from public, anon;
revoke all on function public.can_open_exam(text) from public, anon;
revoke all on function public.my_courses() from public, anon;
revoke all on function public.admin_enroll(text, text[]) from public, anon;
grant execute on function public.my_email() to authenticated;
grant execute on function public.can_open_exam(text) to authenticated;
grant execute on function public.my_courses() to authenticated;
grant execute on function public.admin_enroll(text, text[]) to authenticated;

-- ---------------------------------------------------------------- permissions
alter table public.courses      enable row level security;
alter table public.course_exams enable row level security;
alter table public.enrollments  enable row level security;

revoke all on public.courses, public.course_exams, public.enrollments from anon, authenticated;
grant select, insert, update, delete on public.courses, public.course_exams, public.enrollments to authenticated;  -- narrowed below

drop policy if exists "Signed-in users read courses"   on public.courses;
drop policy if exists "Admins manage courses"           on public.courses;
drop policy if exists "Signed-in users read course exams" on public.course_exams;
drop policy if exists "Admins manage course exams"      on public.course_exams;
drop policy if exists "Staff read all, students own enrollments" on public.enrollments;
drop policy if exists "Admins manage enrollments"       on public.enrollments;

create policy "Signed-in users read courses" on public.courses
  for select to authenticated using (true);
create policy "Admins manage courses" on public.courses
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Signed-in users read course exams" on public.course_exams
  for select to authenticated using (true);
create policy "Admins manage course exams" on public.course_exams
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

create policy "Staff read all, students own enrollments" on public.enrollments
  for select to authenticated using (public.is_staff() or email = public.my_email());
create policy "Admins manage enrollments" on public.enrollments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

-- ---------------------------------------------------------------- the exam rule
-- An extra, "restrictive" rule: it is checked IN ADDITION to the rule in setup-exams.sql,
-- so running setup-exams.sql again never removes the course restriction.
drop policy if exists "Students only get exams of their courses" on public.exams;
create policy "Students only get exams of their courses" on public.exams
  as restrictive for select to authenticated
  using (public.can_open_exam(id));
