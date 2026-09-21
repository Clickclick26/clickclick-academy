-- Videos over 45MB arrive in pieces (21 Sep 2026). Supabase's free plan caps
-- every stored file at 50MB and a minute of phone video is usually more, so
-- the upload page cuts big files into parts: <path>.part1, .part2 ... and
-- watch.html joins them back in the browser. parts = 1 means a single file.
alter table public.academy_testimonials
  add column if not exists parts integer not null default 1;

-- The save replaces a creator's previous clip, which needs delete.
grant select, insert, update, delete on public.academy_testimonials to service_role;
