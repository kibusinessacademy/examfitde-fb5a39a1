
-- pg_cron: batch-poll every 5 minutes via cron-trigger
-- This uses the existing cron-trigger proxy with the "5min" schedule tier.

SELECT cron.schedule(
  'batch-poll-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := current_setting('app.settings.supabase_url') || '/functions/v1/cron-trigger',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', current_setting('app.settings.cron_secret')
    ),
    body := '{"schedule": "5min"}'::jsonb
  );
  $$
);
