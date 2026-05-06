DO $$
DECLARE v_jobid bigint;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='launch-alert-email-flush-5min';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
END $$;

SELECT cron.schedule(
  'launch-alert-email-flush-5min',
  '*/5 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/launch-alert-email-flush',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InViZHZ2dnNpcnllbmhyZm1xc3Z3Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Njc0NDA4MjgsImV4cCI6MjA4MzAxNjgyOH0.LGMpcVQMXziF3Zal4SoprwQj6KfNyqjVJXDXEh3pAEc'
    ),
    body := jsonb_build_object('source','cron','at',now())
  );
  $$
);

INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES ('launch_alert_email_flush_cron_scheduled','system','success',
  jsonb_build_object('jobname','launch-alert-email-flush-5min','schedule','*/5 * * * *'));