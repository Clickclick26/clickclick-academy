-- Marketing consent and sign-up source for Academy students (21 Sep 2026).
-- consent is only ever switched on by the student ticking the box; an
-- unticked repeat visit never switches it back off (unsubscribing does that,
-- through meta_leads.stopped_at).
alter table public.academy_students
  add column if not exists marketing_consent boolean not null default false,
  add column if not exists consent_at timestamptz,
  add column if not exists source text;

grant select, insert, update on public.academy_students to service_role;
