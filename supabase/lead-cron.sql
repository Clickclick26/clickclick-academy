-- Follow-up emails on time.
--
-- GitHub Actions claimed to run this every 10 minutes and actually ran it
-- every 3 to 5 hours: their scheduler throttles cron on quiet repos, with no
-- warning and no failure. A lead who asked for the course at nine could be
-- waiting until two for the email with the link in it.
--
-- pg_cron runs inside the database and does not get throttled. The key lives
-- in Vault rather than in this file, so the schedule can be read by anyone
-- with the repo without handing them the key.

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

-- Replace CRON_KEY_HERE when applying; never commit the real key.
-- Applied to production 20 Sep 2026 (job "meta-leads-every-10-min", jobid 1).
select vault.create_secret('CRON_KEY_HERE', 'meta_leads_cron_key', 'Key the lead follow-up cron sends to the meta-leads function');

select cron.schedule(
  'meta-leads-every-10-min',
  '*/10 * * * *',
  $$
  select net.http_post(
    url := 'https://gapybapywpdogexibtgj.supabase.co/functions/v1/meta-leads',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := jsonb_build_object(
      'type', 'run',
      'key', (select decrypted_secret from vault.decrypted_secrets where name = 'meta_leads_cron_key')
    ),
    timeout_milliseconds := 25000
  );
  $$
);
