-- Run this once in the Supabase SQL editor for the Clickclick CRM project
-- (ref gapybapywpdogexibtgj) before the "certificate" action in
-- academy-progress/index.ts will work. Same pattern as academy_students /
-- academy_progress: RLS on, no policies, only the service-role edge
-- function can touch it.
--
-- This is what actually stops credential IDs duplicating: the `unique`
-- constraint on credential_id makes a collision impossible at the database
-- level, not just unlikely. The edge function retries with a fresh random
-- code on the rare chance it hits one.

create table if not exists academy_certificates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references academy_students(id),
  course_id text not null,
  credential_id text not null unique,
  issued_at timestamptz not null default now(),
  unique (student_id, course_id)
);

alter table academy_certificates enable row level security;
