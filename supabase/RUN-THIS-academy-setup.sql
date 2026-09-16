-- Run this once, top to bottom, in the Supabase SQL editor.
-- Clickclick CRM project (ref gapybapywpdogexibtgj).
--
-- Safe to run more than once: every statement is "if not exists", and the
-- certificates column defaults to approved so nothing already issued changes.
--
-- Order matters. academy_certificates has to exist before anything can add a
-- column to it, and it did NOT exist as of 16 Sep 2026, which is why running
-- eu-review-and-ids.sql on its own would have failed halfway.

-- 1. The certificates table. Should already have been created and never was,
--    so the certificate action has been falling back to a local ID all along.
--    The unique constraint on credential_id is what actually makes duplicate
--    credentials impossible rather than merely unlikely.
create table if not exists academy_certificates (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references academy_students(id),
  course_id text not null,
  credential_id text not null unique,
  issued_at timestamptz not null default now(),
  unique (student_id, course_id)
);

-- Deliberately NOT enabling row level security here, unlike the original
-- certificates-table.sql said to. These tables are protected by the public
-- role having no GRANT on them at all, which is verifiable: a REST call with
-- the publishable key returns "permission denied for table" for every one of
-- academy_students, academy_progress, academy_certificates and contacts.
--
-- Turning RLS on as well breaks writes rather than adding protection: with no
-- policy, the RETURNING clause on an insert gets filtered out and the whole
-- statement errors, which is exactly why issuing a certificate started
-- failing with a 500 while everything else kept working.
alter table academy_certificates disable row level security;

-- 2. Where a student is based. Drives the EU certificate hold.
alter table academy_students
  add column if not exists region text;

-- 3. Whether a certificate has been approved. Defaults to true so anything
--    issued in the past stays valid; only new EU ones are created false.
alter table academy_certificates
  add column if not exists approved boolean not null default true;

create index if not exists academy_certificates_pending_idx
  on academy_certificates (approved)
  where approved = false;

-- 4. Check. Should return exactly three rows:
--    academy_certificates / approved
--    academy_certificates / credential_id
--    academy_students     / region
select table_name, column_name, data_type
from information_schema.columns
where table_schema = 'public'
  and (
    (table_name = 'academy_students' and column_name = 'region')
    or (table_name = 'academy_certificates' and column_name in ('approved', 'credential_id'))
  )
order by table_name, column_name;
