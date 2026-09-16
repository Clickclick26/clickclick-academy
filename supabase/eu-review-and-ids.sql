-- Run once in the Supabase SQL editor (Clickclick CRM project).
--
-- Two additions, both additive and safe on existing rows.
--
-- 1. region on academy_students.
-- NOTE, corrected 16 Sep 2026: the EU certificate hold does NOT keep this
-- course outside EU VAT, and nobody should rely on it for that.
--
-- The test (Art 7(1), Council Implementing Regulation (EU) 282/2011, kept by
-- the UK after Brexit) is whether the supply is "essentially automated and
-- involving minimal human intervention" BY ITS NATURE. The human bit has to be
-- part of delivering what the student bought: a tutor marking their work, a
-- live session. Approving a certificate after the course is admin at the end,
-- and HMRC says explicitly that manual process which does not change the
-- nature of the supply leaves it automated. HMRC's own examples list
-- "examination services, automated" as a digital service, which is exactly
-- what the auto-graded gate quizzes are.
--
-- Second door, also shut: EU Directive 2022/542 moved the place of supply for
-- consumer online educational activities to where the customer lives from
-- 1 Jan 2025 regardless, and the EUR 10,000 threshold only applies to sellers
-- based inside the EU. ClickClick Ltd is in Belfast, so it gets none of it.
--
-- The plan instead is to not sell to EU consumers until the volume justifies
-- a merchant of record for EU buyers only. The country field below is still
-- what makes that possible, and holding certificates is still decent quality
-- control. It is just not a tax structure.
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
