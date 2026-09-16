-- Run once in the Supabase SQL editor (Clickclick CRM project).
--
-- Two additions, both additive and safe on existing rows.
--
-- 1. region on academy_students.
--    A student says at sign-up whether they are in the EU. If they are, their
--    certificate is held for a human look rather than issued automatically.
--    The reason is tax, not quality: a course with no human involvement at all
--    is an "electronically supplied service" in EU VAT law, which means VAT is
--    due in the buyer's own country from the very first sale with no threshold
--    to hide behind. A real human step in the supply is the thing that changes
--    that analysis. Get an accountant to confirm it actually does before
--    relying on it, because being wrong here is cumulative and backdated.
--
-- 2. approved on academy_certificates.
--    Defaults to TRUE so every certificate already issued stays valid and
--    nothing that works today stops working. Only EU students' new
--    certificates are created FALSE.

alter table academy_students
  add column if not exists region text;

alter table academy_certificates
  add column if not exists approved boolean not null default true;

-- Makes the pending queue cheap to read once there are more than a handful.
create index if not exists academy_certificates_pending_idx
  on academy_certificates (approved)
  where approved = false;

-- Sanity check, should return the two new columns.
select table_name, column_name, data_type, column_default
from information_schema.columns
where (table_name = 'academy_students' and column_name = 'region')
   or (table_name = 'academy_certificates' and column_name = 'approved')
order by table_name;
