-- The four boxes a certified creator fills in to appear on
-- clickclick.video/creators/verified/.
--
-- Deliberately not academy_portfolios: a portfolio page is part of the £249
-- Certification + Priority tier and renders a whole page at /creators/p/.
-- This is a card on one shared page, open to anyone who certifies, so the
-- paid tier keeps something the free one does not have.

create table if not exists public.academy_listings (
  student_id uuid primary key references public.academy_students(id) on delete cascade,
  niche text not null default '',
  location text not null default '',
  handle text not null default '',
  avatar text not null default '',
  -- Kathryn's tick. A certificate can be rushed, so nothing reaches a brand
  -- until a person has looked at it.
  listed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists academy_listings_listed_idx
  on public.academy_listings (listed, updated_at desc);

grant select, insert, update on public.academy_listings to service_role;
