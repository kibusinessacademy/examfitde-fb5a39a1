
-- Cron für email-sequence-worker (alle 5 Min)
DO $$
DECLARE
  v_url text := 'https://ubdvvvsiryenhrfmqsvw.supabase.co/functions/v1/email-sequence-worker';
  v_key text;
BEGIN
  -- Vault-Secret holen
  SELECT decrypted_secret INTO v_key
  FROM vault.decrypted_secrets
  WHERE name = 'email_queue_service_role_key' LIMIT 1;

  IF v_key IS NULL THEN
    -- Fallback: skip (wird beim nächsten setup_email_infra gesetzt)
    RAISE NOTICE 'email_queue_service_role_key not in vault — skipping cron registration';
    RETURN;
  END IF;

  -- Alten Job entfernen
  PERFORM cron.unschedule('email-sequence-worker-5min')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'email-sequence-worker-5min');

  PERFORM cron.schedule(
    'email-sequence-worker-5min',
    '*/5 * * * *',
    format($job$
      SELECT net.http_post(
        url := %L,
        headers := jsonb_build_object('Content-Type','application/json','Authorization','Bearer %s'),
        body := jsonb_build_object('limit', 50)
      );
    $job$, v_url, v_key)
  );
END $$;
