-- What has been emailed to a student, as opposed to a lead.
--
-- Until 26 Sep 2026 every follow-up email was keyed on meta_leads: the day 0,
-- day 2 and day 7 sequence, and the resume nudge, all looked the student up by
-- email and skipped anyone they could not find. So anyone who signed up from an
-- Instagram DM, a Facebook group or the website got nothing at all, which with
-- the ads switched off is everybody.
--
-- meta_lead_broadcasts cannot hold these: its primary key is a foreign key into
-- meta_leads, and these people have no lead row by definition.
create table if not exists academy_sends (
  student_id uuid not null references academy_students(id) on delete cascade,
  campaign   text not null,
  sent_at    timestamptz not null default now(),
  primary key (student_id, campaign)
);

-- A student's own unsubscribe, the same right a lead already has.
alter table academy_students add column if not exists unsubscribed_at timestamptz;

grant all on academy_sends to service_role;
grant all on academy_sends to postgres;

create index if not exists academy_sends_campaign_idx on academy_sends (campaign, sent_at desc);
