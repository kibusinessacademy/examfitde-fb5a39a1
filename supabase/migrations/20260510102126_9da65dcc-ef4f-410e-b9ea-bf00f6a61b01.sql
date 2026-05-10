
DO $cron$
DECLARE v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'heal-alerts-dispatch-5min';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;

  PERFORM cron.schedule(
    'heal-alerts-dispatch-5min',
    '*/5 * * * *',
    $job$
    SELECT net.http_post(
      url := current_setting('app.settings.supabase_url') || '/functions/v1/cron-trigger',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', current_setting('app.settings.cron_secret')
      ),
      body := '{"schedule":"heal-alerts"}'::jsonb
    );
    $job$
  );

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('heal_alert_dispatch_cron_scheduled','system','ok',
    'heal-alerts-dispatch-5min scheduled (every 5 min via cron-trigger)',
    jsonb_build_object('cron','heal-alerts-dispatch-5min','schedule','*/5 * * * *',
                       'tier','heal-alerts','function','heal-alert-notify'));
END;
$cron$;
