-- Release the codes that were held for the 14-day cancellation period.
--
-- Run this ONCE in the Supabase SQL editor for the Clickclick CRM project,
-- then redeploy the academy-stripe function.
--
-- The bug this fixes: a buyer who kept their cancellation right at checkout
-- was told on the thank-you page "we will send it on <date>", and nothing
-- ever did. There was no job, and coming back to the page later did not
-- help either, because the check is on the consent answer stored at
-- checkout and that answer never changes. The code was held forever, not
-- for 14 days, and the buyer had paid £149 for silence.
--
-- code_sent_at is what makes the release safe to run on a schedule: it is
-- claimed with a conditional update before the email goes out, so two runs
-- overlapping cannot both send, and a send that fails puts it back to null
-- so the next run retries.

alter table public.academy_access_codes
  add column if not exists code_sent_at timestamptz;

-- Every row that exists today with consent given has already had its email
-- sent by the old code path, so stamp those. Held rows stay null on purpose:
-- null is exactly what the release job looks for.
update public.academy_access_codes
   set code_sent_at = issued_at
 where code_sent_at is null
   and lower(regexp_replace(coalesce(consent, ''), '[^a-zA-Z0-9]', '', 'g')) like 'iagree%';

-- The release job scans for held rows only, so index only those. Stays tiny
-- however many codes are sold, because a row leaves the index the moment its
-- email goes out.
create index if not exists academy_access_codes_unsent_idx
  on public.academy_access_codes (issued_at)
  where code_sent_at is null;
