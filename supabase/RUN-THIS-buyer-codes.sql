-- One access code per buyer, tied to the Stripe payment that bought it.
--
-- Run this ONCE in the Supabase SQL editor for the Clickclick CRM project.
--
-- Until now there was a single shared code per pack sitting in packs.json,
-- so one buyer could pass it to fifty people and nothing recorded who had
-- paid for what. This table is the record: a code, who it was issued to,
-- which Stripe payment paid for it, and whether it has since been revoked.
-- Codes in packs.json still work, because they are the internal and CLocal
-- ones, but anything bought through Stripe gets a row here instead.
--
-- Grants, not RLS: tables made in the SQL editor are owned by the editor
-- role and service_role has no rights on them by default, which shows up as
-- "permission denied for table" from the edge function. No anon grants at
-- all, because the browser never reads this. A row here is the answer to
-- "they have lost their code": look them up by email.

create table if not exists public.academy_access_codes (
  code                  text primary key,
  pack                  text not null,
  tier                  text not null,
  email                 text not null,
  name                  text not null default '',
  stripe_session_id     text unique,
  stripe_payment_intent text,
  amount_total          integer,
  currency              text,
  consent               text,
  issued_at             timestamptz not null default now(),
  redeemed_at           timestamptz,
  revoked               boolean not null default false,
  revoked_reason        text
);

create index if not exists academy_access_codes_email_idx
  on public.academy_access_codes (lower(email));

create index if not exists academy_access_codes_intent_idx
  on public.academy_access_codes (stripe_payment_intent);

grant usage on schema public to service_role;
grant select, insert, update, delete on public.academy_access_codes to service_role;

-- The Stripe session id is unique on purpose. Both the webhook and the
-- thank-you page mint a code from the same payment, and whichever gets
-- there first wins: the other one reads the existing row back instead of
-- issuing a second code for one payment.
