SELECT cron.unschedule('completion-burst-15min');
SELECT cron.schedule(
  'completion-burst-5min',
  '*/5 * * * *',
  $$ SELECT public.admin_completion_burst(8); $$
);