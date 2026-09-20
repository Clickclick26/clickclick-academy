-- The Click List: which certified creators appear on
-- clickclick.video/creators/verified/, and the briefs brands send in.
--
-- "listed" is Kathryn's tick, not the creator's. Finishing the free course
-- issues a certificate, and that can be rushed in twenty minutes, so the
-- certificate alone is not enough to put someone in front of a brand.

alter table public.academy_portfolios
  add column if not exists listed boolean not null default false;

create table if not exists public.brand_briefs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  brand text not null,
  email text not null,
  website text,
  brief text not null,
  budget text,
  handled_at timestamptz
);

create index if not exists brand_briefs_created_idx
  on public.brand_briefs (created_at desc);

-- Same grant pattern as the other Academy tables: the edge functions use the
-- service role, and nothing here is readable with the anon key.
grant select, insert, update on public.brand_briefs to service_role;
