-- Which one-off campaigns each lead has been sent. The primary key is what
-- stops a lead getting the same campaign twice, even if a send is retried.
create table if not exists public.meta_lead_broadcasts (
  leadgen_id text not null references public.meta_leads(leadgen_id) on delete cascade,
  campaign   text not null,
  sent_at    timestamptz not null default now(),
  primary key (leadgen_id, campaign)
);
grant all on table public.meta_lead_broadcasts to service_role;
