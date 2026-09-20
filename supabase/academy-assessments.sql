-- The final check that stands between finishing the lessons and holding a
-- credential, scored on the server the way an accredited course does it.
-- Retakes allowed, because the point is that they know it, not that they got
-- it right first time.

create table if not exists public.academy_assessments (
  student_id uuid not null references public.academy_students(id) on delete cascade,
  course_id text not null,
  score int not null default 0,
  total int not null default 0,
  passed boolean not null default false,
  attempts int not null default 1,
  taken_at timestamptz not null default now(),
  primary key (student_id, course_id)
);

grant select, insert, update on public.academy_assessments to service_role;
