-- Getting back in, 22 Sep 2026 (all 13 agents' access audit).
--
-- academy_link_requests: every "Email me my link" request, so one address
-- cannot be used to flood someone's inbox (3 an hour).
create table if not exists public.academy_link_requests (
  id bigint generated always as identity primary key,
  email text not null,
  sent boolean not null default false,
  at timestamptz not null default now()
);
create index if not exists academy_link_requests_email_at on public.academy_link_requests (lower(email), at desc);
grant select, insert on public.academy_link_requests to service_role;

-- academy_events: the steps before someone is a student, so drop-off can be
-- seen (73 of 93 leads never reached the form and nobody could say where).
-- No names, no emails: just which door they came through and how far.
create table if not exists public.academy_events (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  event text not null,
  source text,
  has_code boolean,
  has_lead boolean,
  has_student boolean,
  visitor text
);
create index if not exists academy_events_at on public.academy_events (at desc);
grant select, insert on public.academy_events to service_role;
