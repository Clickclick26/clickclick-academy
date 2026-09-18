-- People who filled in a ClickClick lead form on Facebook or Instagram, and
-- where each one is in their follow-up emails. Filled by the meta-leads edge
-- function, which pulls new leads from Meta every few minutes.
--
-- steps_sent is what makes sending safe to run on a schedule: each send is
-- claimed with a conditional update on it first, so two overlapping runs can
-- never email the same person the same thing twice.

create table if not exists public.meta_leads (
  leadgen_id      text primary key,
  form_id         text not null,
  form_name       text,
  -- brand, creator-uk or creator-us. Null for a form the function does not
  -- recognise, and a null audience is never emailed.
  audience        text,
  email           text,
  name            text,
  answers         jsonb not null default '{}'::jsonb,
  created_time    timestamptz not null,
  fetched_at      timestamptz not null default now(),
  steps_sent      int not null default 0,
  last_sent_at    timestamptz,
  -- Set when they click unsubscribe, or when they buy and the rest of the
  -- sales emails would be pointless.
  stopped_at      timestamptz,
  stopped_reason  text
);

create index if not exists meta_leads_active_idx
  on public.meta_leads (created_time)
  where stopped_at is null and audience is not null;

create index if not exists meta_leads_email_idx on public.meta_leads (lower(email));

-- Tables made from SQL get no grants, and the edge function runs as
-- service_role. Never turn on RLS to "fix" a permission error here.
grant all on table public.meta_leads to service_role;
