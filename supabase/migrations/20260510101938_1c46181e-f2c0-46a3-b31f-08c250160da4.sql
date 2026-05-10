
-- =========================================================
-- 1) Destinations (Email/Slack) + Notifications outbox
-- =========================================================
CREATE TABLE IF NOT EXISTS public.heal_alert_destinations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel text NOT NULL CHECK (channel IN ('email','slack')),
  target text NOT NULL,                 -- email address OR slack channel/identifier
  enabled boolean NOT NULL DEFAULT true,
  alert_keys text[] NOT NULL DEFAULT ARRAY['parity_mismatch_count','parity_enqueue_rate_per_run'],
  min_severity text NOT NULL DEFAULT 'warn' CHECK (min_severity IN ('info','warn','critical')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL,
  UNIQUE (channel, target)
);
ALTER TABLE public.heal_alert_destinations ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read heal_alert_destinations" ON public.heal_alert_destinations;
CREATE POLICY "admins read heal_alert_destinations" ON public.heal_alert_destinations
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

CREATE TABLE IF NOT EXISTS public.heal_alert_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  destination_id uuid NOT NULL REFERENCES public.heal_alert_destinations(id) ON DELETE CASCADE,
  channel text NOT NULL,
  target text NOT NULL,
  alert_key text NOT NULL,
  severity text NOT NULL,
  payload jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','failed','skipped')),
  attempts integer NOT NULL DEFAULT 0,
  last_error text NULL,
  sent_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_heal_alert_notifications_pending
  ON public.heal_alert_notifications (status, created_at) WHERE status = 'pending';
ALTER TABLE public.heal_alert_notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read heal_alert_notifications" ON public.heal_alert_notifications;
CREATE POLICY "admins read heal_alert_notifications" ON public.heal_alert_notifications
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

-- =========================================================
-- 2) Alert evaluator v2: fixes key-drift + enabled-filter + outbox
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_run_heal_alert_evaluator()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mismatch int := 0;
  v_enq      int := 0;
  v_th_m numeric;
  v_th_r numeric;
  v_m_enabled boolean := false;
  v_r_enabled boolean := false;
  v_alerts jsonb := '[]'::jsonb;
  v_last auto_heal_log%ROWTYPE;
  v_alert jsonb;
  v_dest record;
  v_outbox_count int := 0;
BEGIN
  -- Read thresholds + enabled flags (respect disabled configs)
  SELECT threshold, enabled INTO v_th_m, v_m_enabled
  FROM heal_alert_config WHERE alert_key = 'parity_mismatch_count';
  SELECT threshold, enabled INTO v_th_r, v_r_enabled
  FROM heal_alert_config WHERE alert_key = 'parity_enqueue_rate_per_run';
  v_th_m := COALESCE(v_th_m, 0);
  v_th_r := COALESCE(v_th_r, 5);
  v_m_enabled := COALESCE(v_m_enabled, false);
  v_r_enabled := COALESCE(v_r_enabled, false);

  SELECT * INTO v_last
  FROM auto_heal_log
  WHERE action_type = 'lesson_join_parity_check'
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_last.id IS NOT NULL THEN
    v_mismatch := COALESCE((v_last.metadata->>'mismatch_count')::int, 0);
    -- FIX: parity check writes auto_heal_enqueued, not enqueued
    v_enq := COALESCE((v_last.metadata->>'auto_heal_enqueued')::int, 0);

    IF v_m_enabled AND v_mismatch > v_th_m THEN
      v_alerts := v_alerts || jsonb_build_object(
        'alert_key','parity_mismatch_count',
        'severity','warn',
        'value', v_mismatch,
        'threshold', v_th_m,
        'message', format('Parity mismatches=%s > threshold %s', v_mismatch, v_th_m),
        'deep_link','/admin/heal-cockpit?tab=diagnostics&card=parity'
      );
    END IF;

    IF v_r_enabled AND v_enq > v_th_r THEN
      v_alerts := v_alerts || jsonb_build_object(
        'alert_key','parity_enqueue_rate_per_run',
        'severity','warn',
        'value', v_enq,
        'threshold', v_th_r,
        'message', format('Heal enqueue rate=%s > threshold %s', v_enq, v_th_r),
        'deep_link','/admin/heal-cockpit?tab=diagnostics&card=parity'
      );
    END IF;
  END IF;

  -- Fan out to destinations (outbox pattern)
  IF jsonb_array_length(v_alerts) > 0 THEN
    FOR v_alert IN SELECT * FROM jsonb_array_elements(v_alerts)
    LOOP
      FOR v_dest IN
        SELECT id, channel, target
        FROM heal_alert_destinations d
        WHERE d.enabled = true
          AND (v_alert->>'alert_key') = ANY(d.alert_keys)
      LOOP
        INSERT INTO heal_alert_notifications
          (destination_id, channel, target, alert_key, severity, payload)
        VALUES
          (v_dest.id, v_dest.channel, v_dest.target,
           v_alert->>'alert_key', v_alert->>'severity', v_alert);
        v_outbox_count := v_outbox_count + 1;
      END LOOP;
    END LOOP;
  END IF;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES (
    'parity_mismatch_alert', 'system',
    CASE WHEN jsonb_array_length(v_alerts) = 0 THEN 'ok' ELSE 'alert' END,
    format('%s alert(s) raised, %s notification(s) queued',
           jsonb_array_length(v_alerts), v_outbox_count),
    jsonb_build_object(
      'alerts', v_alerts,
      'evaluated_at', now(),
      'mismatch_count', v_mismatch,
      'auto_heal_enqueued', v_enq,
      'notifications_queued', v_outbox_count,
      'config_enabled', jsonb_build_object(
        'parity_mismatch_count', v_m_enabled,
        'parity_enqueue_rate_per_run', v_r_enabled)
    )
  );

  RETURN jsonb_build_object(
    'alerts', v_alerts,
    'mismatch_count', v_mismatch,
    'auto_heal_enqueued', v_enq,
    'notifications_queued', v_outbox_count
  );
END;$$;
REVOKE ALL ON FUNCTION public.fn_run_heal_alert_evaluator() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_run_heal_alert_evaluator() TO service_role;

-- Update summary RPC to expose new key
CREATE OR REPLACE FUNCTION public.admin_get_heal_alerts_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'last_eval_at', l.created_at,
    'status', l.result_status,
    'alerts', COALESCE(l.metadata->'alerts', '[]'::jsonb),
    'mismatch_count', COALESCE((l.metadata->>'mismatch_count')::int, 0),
    'auto_heal_enqueued', COALESCE((l.metadata->>'auto_heal_enqueued')::int, 0),
    'notifications_queued', COALESCE((l.metadata->>'notifications_queued')::int, 0),
    'config', (
      SELECT jsonb_object_agg(alert_key,
        jsonb_build_object('threshold', threshold, 'enabled', enabled, 'channels', channels))
      FROM heal_alert_config
    ),
    'destinations', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', id, 'channel', channel, 'target', target,
        'enabled', enabled, 'alert_keys', alert_keys, 'min_severity', min_severity)), '[]'::jsonb)
      FROM heal_alert_destinations
    )
  ) INTO v
  FROM auto_heal_log l
  WHERE l.action_type = 'parity_mismatch_alert'
  ORDER BY l.created_at DESC
  LIMIT 1;
  RETURN COALESCE(v, jsonb_build_object('last_eval_at', null, 'status', 'unknown', 'alerts', '[]'::jsonb));
END;$$;
REVOKE ALL ON FUNCTION public.admin_get_heal_alerts_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_heal_alerts_summary() TO authenticated;

-- =========================================================
-- 3) Admin RPCs for destinations
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_upsert_heal_alert_destination(
  p_channel text,
  p_target text,
  p_enabled boolean DEFAULT true,
  p_alert_keys text[] DEFAULT ARRAY['parity_mismatch_count','parity_enqueue_rate_per_run'],
  p_min_severity text DEFAULT 'warn'
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO heal_alert_destinations (channel, target, enabled, alert_keys, min_severity, updated_by, updated_at)
  VALUES (p_channel, p_target, COALESCE(p_enabled,true), p_alert_keys, p_min_severity, auth.uid(), now())
  ON CONFLICT (channel, target) DO UPDATE
    SET enabled = EXCLUDED.enabled,
        alert_keys = EXCLUDED.alert_keys,
        min_severity = EXCLUDED.min_severity,
        updated_by = auth.uid(),
        updated_at = now()
  RETURNING id INTO v_id;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('heal_alert_destination_upsert','system','ok',
    format('%s -> %s (enabled=%s)', p_channel, p_target, p_enabled),
    jsonb_build_object('id', v_id, 'channel', p_channel, 'target', p_target,
      'enabled', p_enabled, 'alert_keys', p_alert_keys, 'min_severity', p_min_severity,
      'actor', auth.uid()));
  RETURN v_id;
END;$$;
REVOKE ALL ON FUNCTION public.admin_upsert_heal_alert_destination(text,text,boolean,text[],text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_upsert_heal_alert_destination(text,text,boolean,text[],text) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_delete_heal_alert_destination(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  DELETE FROM heal_alert_destinations WHERE id = p_id;
  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('heal_alert_destination_delete','system','ok',
    format('deleted destination %s', p_id),
    jsonb_build_object('id', p_id, 'actor', auth.uid()));
END;$$;
REVOKE ALL ON FUNCTION public.admin_delete_heal_alert_destination(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_delete_heal_alert_destination(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_heal_alert_notifications(p_limit int DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', n.id, 'created_at', n.created_at, 'channel', n.channel, 'target', n.target,
    'alert_key', n.alert_key, 'severity', n.severity, 'status', n.status,
    'attempts', n.attempts, 'last_error', n.last_error, 'sent_at', n.sent_at,
    'payload', n.payload
  ) ORDER BY n.created_at DESC), '[]'::jsonb) INTO v
  FROM (
    SELECT * FROM heal_alert_notifications
    ORDER BY created_at DESC
    LIMIT GREATEST(p_limit, 1)
  ) n;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public.admin_get_heal_alert_notifications(int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_heal_alert_notifications(int) TO authenticated;

-- =========================================================
-- 4) Re-schedule crons explicitly (idempotent)
-- =========================================================
DO $cron$
DECLARE v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'parity-cron-guard-daily';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule('parity-cron-guard-daily','7 4 * * *',
    $job$ SELECT public.fn_run_parity_cron_guard(); $job$);

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname = 'heal-alerts-15min';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule('heal-alerts-15min','*/15 * * * *',
    $job$ SELECT public.fn_run_heal_alert_evaluator(); $job$);
END;
$cron$;

-- =========================================================
-- 5) Smoke run
-- =========================================================
DO $smoke$
DECLARE v_result jsonb;
BEGIN
  v_result := public.fn_run_heal_alert_evaluator();
  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('heal_alert_loop_v1_1_smoke','system','ok','post-migration smoke',
    jsonb_build_object('result', v_result, 'ts', now()));
END;
$smoke$;
