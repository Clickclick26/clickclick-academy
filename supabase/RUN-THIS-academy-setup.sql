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

-- A table created from the SQL editor does not automatically get the grants
-- that Supabase gives tables made through the dashboard, and without them the
-- edge function gets "permission denied for table academy_certificates" and
-- every certificate request 500s. This is the line that actually fixes it.
--
-- service_role ONLY. Deliberately no grant to anon or authenticated: that is
-- what keeps the table unreadable from the browser, and it is how
-- academy_students and academy_progress are already protected. Checkable: a
-- REST call with the publishable key returns permission-denied for all of
-- them.
--
-- Row level security is left OFF, matching the other two tables. Turning it on
-- with no policy does not add protection here and does break writes: the
-- RETURNING clause on an insert gets filtered and the statement errors.
grant all privileges on table academy_certificates to service_role;
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
