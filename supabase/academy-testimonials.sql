-- Where a creator's 60 seconds to camera lands.
--
-- Email was the obvious route and it does not work: a minute of phone video is
-- 60 to 150MB and Gmail refuses anything over 25MB, so the ask would fail at
-- the last step and nobody would try twice.

create table if not exists public.academy_testimonials (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.academy_students(id) on delete cascade,
  path text not null,
  note text not null default '',
  -- Their word that we can use it. Nothing is traded for the video, so this is
  -- permission, not a contract.
  consent boolean not null default false,
  created_at timestamptz not null default now()
);

create index if not exists academy_testimonials_created_idx
  on public.academy_testimonials (created_at desc);

grant select, insert, update on public.academy_testimonials to service_role;
