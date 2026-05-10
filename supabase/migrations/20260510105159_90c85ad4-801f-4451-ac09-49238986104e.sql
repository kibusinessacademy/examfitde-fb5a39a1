
-- 1) Outbox lifecycle hardening ------------------------------------------------
ALTER TABLE public.heal_alert_notifications
  DROP CONSTRAINT IF EXISTS heal_alert_notifications_status_check;
ALTER TABLE public.heal_alert_notifications
  ADD CONSTRAINT heal_alert_notifications_status_check
  CHECK (status = ANY (ARRAY['pending','processing','sent','failed','skipped','dlq']));

ALTER TABLE public.heal_alert_notifications
  ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz,
  ADD COLUMN IF NOT EXISTS max_attempts int NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS dispatched_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_heal_alert_notifications_status_created
  ON public.heal_alert_notifications(status, created_at DESC);

-- 2) Threshold config admin RPCs ----------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_heal_alert_config()
RETURNS TABLE(alert_key text, threshold numeric, enabled boolean, channels text[], updated_at timestamptz)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT alert_key, threshold, enabled, channels, updated_at
  FROM public.heal_alert_config
  WHERE public.has_role(auth.uid(),'admin'::app_role)
  ORDER BY alert_key;
$$;
REVOKE ALL ON FUNCTION public.admin_get_heal_alert_config() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_heal_alert_config() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_upsert_heal_alert_config(
  p_alert_key text, p_threshold numeric, p_enabled boolean, p_channels text[]
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_old jsonb; v_new jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  IF p_alert_key IS NULL OR p_alert_key = '' THEN RAISE EXCEPTION 'alert_key required'; END IF;

  SELECT to_jsonb(c) INTO v_old FROM public.heal_alert_config c WHERE alert_key = p_alert_key;

  INSERT INTO public.heal_alert_config(alert_key, threshold, enabled, channels, updated_at, updated_by)
  VALUES (p_alert_key, COALESCE(p_threshold,0), COALESCE(p_enabled,true),
          COALESCE(p_channels, ARRAY['cockpit']::text[]), now(), auth.uid())
  ON CONFLICT (alert_key) DO UPDATE
    SET threshold = EXCLUDED.threshold,
        enabled = EXCLUDED.enabled,
        channels = EXCLUDED.channels,
        updated_at = now(),
        updated_by = auth.uid()
  RETURNING to_jsonb(public.heal_alert_config.*) INTO v_new;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES ('heal_alert_config_upsert','config', NULL, 'ok',
          jsonb_build_object('alert_key', p_alert_key, 'before', v_old, 'after', v_new, 'actor', auth.uid()));

  RETURN v_new;
END $$;
REVOKE ALL ON FUNCTION public.admin_upsert_heal_alert_config(text,numeric,boolean,text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_upsert_heal_alert_config(text,numeric,boolean,text[]) TO authenticated, service_role;

-- 3) Auto-escalation for sustained delivery degradation ----------------------
CREATE OR REPLACE FUNCTION public.fn_evaluate_notification_delivery_escalation()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_recent int;
  v_bad int;
  v_last_status text;
  v_result jsonb;
BEGIN
  -- Examine last 6 hourly health checks
  WITH src AS (
    SELECT (metadata->>'status') AS s, created_at
    FROM public.auto_heal_log
    WHERE action_type = 'notification_delivery_health_check'
      AND created_at > now() - interval '6 hours'
    ORDER BY created_at DESC
    LIMIT 6
  )
  SELECT COUNT(*), COUNT(*) FILTER (WHERE s IN ('degraded','critical')),
         (SELECT s FROM src ORDER BY created_at DESC LIMIT 1)
  INTO v_recent, v_bad, v_last_status FROM src;

  IF v_recent < 2 OR v_bad < 2 THEN
    v_result := jsonb_build_object('escalated', false, 'recent_checks', v_recent, 'bad_checks', v_bad);
    INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
    VALUES ('notification_delivery_escalation','system','ok', v_result || jsonb_build_object('reason','below_threshold'));
    RETURN v_result;
  END IF;

  v_result := jsonb_build_object(
    'escalated', true,
    'recent_checks', v_recent,
    'bad_checks', v_bad,
    'last_status', v_last_status,
    'severity', CASE WHEN v_last_status='critical' OR v_bad >= 4 THEN 'critical' ELSE 'high' END,
    'evaluated_at', now()
  );

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('notification_delivery_escalation','system','warn',
          v_result || jsonb_build_object('reason','sustained_degradation'));

  RETURN v_result;
END $$;
REVOKE ALL ON FUNCTION public.fn_evaluate_notification_delivery_escalation() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_evaluate_notification_delivery_escalation() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_delivery_escalation_status()
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT CASE WHEN public.has_role(auth.uid(),'admin'::app_role) THEN
    COALESCE(
      (SELECT metadata FROM public.auto_heal_log
        WHERE action_type='notification_delivery_escalation'
        ORDER BY created_at DESC LIMIT 1),
      '{"escalated":false,"reason":"no_history"}'::jsonb
    )
  ELSE NULL END;
$$;
REVOKE ALL ON FUNCTION public.admin_get_delivery_escalation_status() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_delivery_escalation_status() TO authenticated, service_role;

-- 4) Outbox drilldown RPC ----------------------------------------------------
CREATE OR REPLACE FUNCTION public.admin_get_notification_outbox_entries(
  p_status text DEFAULT 'failed',
  p_limit int DEFAULT 50
) RETURNS TABLE(
  id uuid, channel text, target text, alert_key text, severity text,
  status text, attempts int, max_attempts int, last_error text,
  next_attempt_at timestamptz, sent_at timestamptz, dispatched_at timestamptz,
  created_at timestamptz, age_minutes int, payload_summary jsonb
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.channel, n.target, n.alert_key, n.severity,
         n.status, n.attempts, n.max_attempts, n.last_error,
         n.next_attempt_at, n.sent_at, n.dispatched_at, n.created_at,
         GREATEST(0, EXTRACT(EPOCH FROM (now() - n.created_at))/60)::int AS age_minutes,
         jsonb_build_object(
           'simulated', COALESCE(n.payload->>'simulated','false')::boolean,
           'e2e', COALESCE(n.payload->>'__e2e','false')::boolean,
           'scenario', n.payload->>'scenario',
           'outcome', n.payload->>'outcome'
         ) AS payload_summary
  FROM public.heal_alert_notifications n
  WHERE public.has_role(auth.uid(),'admin'::app_role)
    AND CASE
          WHEN p_status = 'stale_pending' THEN n.status='pending' AND n.created_at < now() - interval '15 minutes'
          WHEN p_status = 'all' THEN true
          ELSE n.status = p_status
        END
  ORDER BY n.created_at DESC
  LIMIT GREATEST(1, LEAST(p_limit, 200));
$$;
REVOKE ALL ON FUNCTION public.admin_get_notification_outbox_entries(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_notification_outbox_entries(text,int) TO authenticated, service_role;

-- 5) E2E real-row dispatcher --------------------------------------------------
CREATE OR REPLACE FUNCTION public.fn_e2e_outbox_seed_destination()
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.heal_alert_destinations
   WHERE channel='cockpit' AND target='__e2e_test__' LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  INSERT INTO public.heal_alert_destinations(channel, target, enabled, severity_floor)
  VALUES ('cockpit','__e2e_test__', false, 'low')
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.fn_e2e_outbox_seed_destination() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_e2e_outbox_seed_destination() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_e2e_outbox_enqueue(
  p_scenario text DEFAULT 'late',
  p_outcome  text DEFAULT 'ok',
  p_max_attempts int DEFAULT 5
) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_dest uuid; v_id uuid; v_sev text;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role)
          OR current_setting('role',true) = 'service_role'
          OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  v_dest := public.fn_e2e_outbox_seed_destination();
  v_sev := CASE p_scenario WHEN 'missing' THEN 'high' WHEN 'late' THEN 'medium' ELSE 'info' END;

  INSERT INTO public.heal_alert_notifications(
    destination_id, channel, target, alert_key, severity,
    payload, status, attempts, max_attempts, next_attempt_at
  ) VALUES (
    v_dest, 'cockpit', '__e2e_test__', '__e2e_parity', v_sev,
    jsonb_build_object('__e2e', true, 'scenario', p_scenario, 'outcome', p_outcome),
    'pending', 0, GREATEST(1,p_max_attempts), now()
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.admin_e2e_outbox_enqueue(text,text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_e2e_outbox_enqueue(text,text,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_e2e_outbox_dispatch_step(p_id uuid)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_row public.heal_alert_notifications%ROWTYPE;
  v_outcome text;
  v_new_status text;
  v_new_error text;
  v_new_attempts int;
  v_backoff_minutes int;
  v_next_at timestamptz;
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role)
          OR auth.uid() IS NULL) THEN
    RAISE EXCEPTION 'forbidden';
  END IF;
  SELECT * INTO v_row FROM public.heal_alert_notifications WHERE id = p_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'row_not_found'; END IF;
  IF COALESCE(v_row.payload->>'__e2e','false') <> 'true' THEN
    RAISE EXCEPTION 'not_an_e2e_row';
  END IF;
  IF v_row.status IN ('sent','skipped','dlq') THEN
    RETURN jsonb_build_object('id', v_row.id, 'status', v_row.status, 'noop', true);
  END IF;

  -- Move to processing first (record transition)
  UPDATE public.heal_alert_notifications
     SET status='processing', dispatched_at=now()
   WHERE id = p_id;

  v_outcome := COALESCE(v_row.payload->>'outcome','ok');
  v_new_attempts := v_row.attempts + 1;

  IF v_outcome = 'ok' THEN
    v_new_status := 'sent'; v_new_error := NULL; v_next_at := NULL;
  ELSIF v_outcome = 'missing_secret' THEN
    v_new_status := 'skipped'; v_new_error := 'missing_secret:SLACK_HEAL_WEBHOOK_URL'; v_next_at := NULL;
  ELSIF v_outcome = 'webhook_500' THEN
    IF v_new_attempts >= v_row.max_attempts THEN
      v_new_status := 'dlq'; v_next_at := NULL;
    ELSE
      v_new_status := 'failed';
      v_backoff_minutes := POWER(2, v_new_attempts)::int; -- 2,4,8,16...
      v_next_at := now() + make_interval(mins => v_backoff_minutes);
    END IF;
    v_new_error := 'webhook_5xx:simulated_500';
  ELSE
    v_new_status := 'failed'; v_new_error := 'unknown_outcome:' || v_outcome;
    v_next_at := now() + interval '2 minutes';
  END IF;

  UPDATE public.heal_alert_notifications
     SET status = v_new_status,
         attempts = v_new_attempts,
         last_error = v_new_error,
         next_attempt_at = v_next_at,
         sent_at = CASE WHEN v_new_status='sent' THEN now() ELSE sent_at END
   WHERE id = p_id;

  RETURN jsonb_build_object(
    'id', p_id, 'previous_status', v_row.status, 'status', v_new_status,
    'attempts', v_new_attempts, 'max_attempts', v_row.max_attempts,
    'last_error', v_new_error, 'next_attempt_at', v_next_at,
    'reached_dlq', v_new_status='dlq', 'terminal', v_new_status IN ('sent','skipped','dlq')
  );
END $$;
REVOKE ALL ON FUNCTION public.admin_e2e_outbox_dispatch_step(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_e2e_outbox_dispatch_step(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_e2e_outbox_get(p_id uuid)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT to_jsonb(n.*) FROM public.heal_alert_notifications n WHERE n.id = p_id;
$$;
REVOKE ALL ON FUNCTION public.admin_e2e_outbox_get(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_e2e_outbox_get(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_e2e_outbox_cleanup()
RETURNS int
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_deleted int;
BEGIN
  DELETE FROM public.heal_alert_notifications
   WHERE alert_key='__e2e_parity'
      OR (payload->>'__e2e') = 'true';
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END $$;
REVOKE ALL ON FUNCTION public.admin_e2e_outbox_cleanup() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_e2e_outbox_cleanup() TO authenticated, service_role;

-- 6) Hourly escalation cron via cron-trigger tier 'delivery-escalation' ------
DO $$
DECLARE v_jobid int;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'notification-delivery-escalation-hourly';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule('notification-delivery-escalation-hourly'); END IF;
  PERFORM cron.schedule(
    'notification-delivery-escalation-hourly',
    '37 * * * *',
    $cron$ SELECT public.fn_evaluate_notification_delivery_escalation(); $cron$
  );
END $$;
