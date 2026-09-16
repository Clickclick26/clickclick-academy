-- Portfolio pages for the £249 "Certification + Priority" tier.
--
-- Run this ONCE in the Supabase SQL editor for the Clickclick CRM project,
-- then create the storage bucket (instructions at the bottom).
--
-- Why grants and not RLS: the SQL editor creates tables owned by the editor
-- role, and service_role has no rights on them by default. That shows up as
-- "permission denied for table" from the edge function even though RLS is
-- off. Enabling RLS does not fix it and makes it harder to debug. Grant
-- explicitly instead. No anon/authenticated grants at all: the browser never
-- touches this table, only the edge function does.

create table if not exists public.academy_portfolios (
  student_id  uuid primary key references public.academy_students(id) on delete cascade,
  slug        text not null unique,
  data        jsonb not null default '{}'::jsonb,
  published   boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists academy_portfolios_slug_idx
  on public.academy_portfolios (slug);

create index if not exists academy_portfolios_published_idx
  on public.academy_portfolios (published)
  where published;

grant usage on schema public to service_role;
grant select, insert, update, delete on public.academy_portfolios to service_role;

-- A slug is part of a URL a creator sends to brands, so it must never be
-- reassigned to somebody else once it is out in the world. Deleting a
-- student cascades the row away, which is the only way one frees up.

-- ---------------------------------------------------------------------------
-- Storage bucket, do this in the dashboard after running the SQL above:
--
--   Storage -> New bucket
--     Name:   creator-portfolios
--     Public: YES (tick it)
--     File size limit: 25 MB
--     Allowed MIME types: image/jpeg, image/png, image/webp, video/mp4, video/quicktime
--
-- Public on purpose. These files are the creator's own portfolio, meant to be
-- opened by brands who were sent the link, so signed URLs would only expire
-- and break the page. Nothing private is ever written to this bucket: the
-- edge function is the only thing that can issue an upload URL, it namespaces
-- every file under the student's own id, and it refuses anyone whose access
-- code is not on a portfolio pack.
-- ---------------------------------------------------------------------------
