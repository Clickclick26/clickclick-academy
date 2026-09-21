-- The easier testimonial (21 Sep 2026): one sentence, and a photo if they
-- are happy for it to be used. Same one-row-per-student slot as the video;
-- path stays '' when only a quote has come in. Unlike the video (edited
-- first, permission asked later), a quote can go straight onto the site, so
-- it is only accepted with the permission tick: quote_consent.
alter table public.academy_testimonials
  add column if not exists quote text,
  add column if not exists photo_path text,
  add column if not exists quote_consent boolean not null default false,
  add column if not exists quote_at timestamptz;
