
CREATE TABLE IF NOT EXISTS public.heal_alert_config (
  alert_key text PRIMARY KEY,
  threshold numeric NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  channels text[] NOT NULL DEFAULT ARRAY['cockpit'],
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid NULL
);
ALTER TABLE public.heal_alert_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "admins read heal_alert_config" ON public.heal_alert_config;
CREATE POLICY "admins read heal_alert_config" ON public.heal_alert_config
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(),'admin'));

INSERT INTO public.heal_alert_config (alert_key, threshold, enabled, channels) VALUES
  ('parity_mismatch_count', 0, true, ARRAY['cockpit']),
  ('parity_enqueue_rate_per_run', 5, true, ARRAY['cockpit']),
  ('parity_cron_stale_hours', 36, true, ARRAY['cockpit'])
ON CONFLICT (alert_key) DO NOTHING;

CREATE OR REPLACE FUNCTION public.fn_record_heal_run_audit(
  p_origin text, p_recommended_action text, p_package_ids uuid[],
  p_jobs jsonb, p_result_status text, p_result_detail text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_id uuid;
BEGIN
  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('heal_run_audit','system', COALESCE(p_result_status,'unknown'), p_result_detail,
    jsonb_build_object(
      'origin', p_origin,
      'recommended_action', p_recommended_action,
      'package_ids', to_jsonb(COALESCE(p_package_ids, ARRAY[]::uuid[])),
      'package_count', COALESCE(array_length(p_package_ids,1),0),
      'jobs', COALESCE(p_jobs,'[]'::jsonb),
      'recorded_at', now()))
  RETURNING id INTO v_id;
  RETURN v_id;
END;$$;
REVOKE ALL ON FUNCTION public.fn_record_heal_run_audit(text,text,uuid[],jsonb,text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_record_heal_run_audit(text,text,uuid[],jsonb,text,text) TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_heal_run_audit_trail(p_limit integer DEFAULT 50)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', l.id, 'created_at', l.created_at,
    'action_type', l.action_type,
    'origin', l.metadata->>'origin',
    'recommended_action', l.metadata->>'recommended_action',
    'package_count', COALESCE((l.metadata->>'package_count')::int,0),
    'package_ids', COALESCE(l.metadata->'package_ids','[]'::jsonb),
    'jobs', COALESCE(l.metadata->'jobs','[]'::jsonb),
    'result_status', l.result_status,
    'result_detail', l.result_detail
  ) ORDER BY l.created_at DESC), '[]'::jsonb) INTO v
  FROM (SELECT * FROM auto_heal_log
        WHERE action_type IN ('heal_run_audit','lesson_join_parity_check','parity_cron_guard','parity_mismatch_alert')
        ORDER BY created_at DESC LIMIT GREATEST(p_limit,1)) l;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public.admin_get_heal_run_audit_trail(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_heal_run_audit_trail(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_run_parity_cron_guard()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_jobid integer; v_active boolean; v_schedule text;
  v_last_run timestamptz; v_threshold numeric := 36;
  v_status text; v_detail text; v_age numeric;
BEGIN
  SELECT threshold INTO v_threshold FROM heal_alert_config WHERE alert_key='parity_cron_stale_hours';
  v_threshold := COALESCE(v_threshold, 36);

  SELECT jobid, active, schedule INTO v_jobid, v_active, v_schedule
  FROM cron.job WHERE jobname='lesson-join-parity-daily' LIMIT 1;

  SELECT MAX(created_at) INTO v_last_run
  FROM auto_heal_log WHERE action_type='lesson_join_parity_check';

  v_age := ROUND((EXTRACT(EPOCH FROM (now() - COALESCE(v_last_run,'epoch'::timestamptz)))/3600.0)::numeric, 1);

  IF v_jobid IS NULL THEN
    v_status := 'critical'; v_detail := 'cron lesson-join-parity-daily MISSING';
  ELSIF NOT COALESCE(v_active,false) THEN
    v_status := 'critical'; v_detail := 'cron exists but INACTIVE';
  ELSIF v_last_run IS NULL THEN
    v_status := 'warn'; v_detail := 'cron exists, no run recorded yet';
  ELSIF v_age > v_threshold THEN
    v_status := 'warn'; v_detail := format('last run %sh ago > %sh threshold', v_age, v_threshold);
  ELSE
    v_status := 'ok'; v_detail := format('last run %sh ago', v_age);
  END IF;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('parity_cron_guard','system', v_status, v_detail,
    jsonb_build_object('jobid',v_jobid,'active',v_active,'schedule',v_schedule,
      'last_run_at',v_last_run,'age_hours',v_age,'threshold_hours',v_threshold,'checked_at',now()));

  RETURN jsonb_build_object('status',v_status,'detail',v_detail,'jobid',v_jobid,'active',v_active,
    'schedule',v_schedule,'last_run_at',v_last_run,'age_hours',v_age,'threshold_hours',v_threshold);
END;$$;
REVOKE ALL ON FUNCTION public.fn_run_parity_cron_guard() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_run_parity_cron_guard() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_parity_cron_health()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object('last_check_at',l.created_at,'status',l.result_status,
    'detail',l.result_detail,'metadata',l.metadata) INTO v
  FROM auto_heal_log l WHERE l.action_type='parity_cron_guard'
  ORDER BY l.created_at DESC LIMIT 1;
  RETURN COALESCE(v, jsonb_build_object('last_check_at',null,'status','unknown','detail','no run yet'));
END;$$;
REVOKE ALL ON FUNCTION public.admin_get_parity_cron_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_parity_cron_health() TO authenticated;

CREATE OR REPLACE FUNCTION public.fn_run_heal_alert_evaluator()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_mismatch int := 0; v_enq int := 0;
  v_th_m numeric; v_th_r numeric;
  v_alerts jsonb := '[]'::jsonb;
  v_last auto_heal_log%ROWTYPE;
BEGIN
  SELECT threshold INTO v_th_m FROM heal_alert_config WHERE alert_key='parity_mismatch_count';
  SELECT threshold INTO v_th_r FROM heal_alert_config WHERE alert_key='parity_enqueue_rate_per_run';
  v_th_m := COALESCE(v_th_m,0); v_th_r := COALESCE(v_th_r,5);

  SELECT * INTO v_last FROM auto_heal_log
   WHERE action_type='lesson_join_parity_check' ORDER BY created_at DESC LIMIT 1;

  IF v_last.id IS NOT NULL THEN
    v_mismatch := COALESCE((v_last.metadata->>'mismatch_count')::int,0);
    v_enq      := COALESCE((v_last.metadata->>'enqueued')::int,0);
    IF v_mismatch > v_th_m THEN
      v_alerts := v_alerts || jsonb_build_object('alert_key','parity_mismatch_count','severity','warn',
        'value',v_mismatch,'threshold',v_th_m,
        'message',format('Parity mismatches=%s > threshold %s', v_mismatch, v_th_m),
        'deep_link','/admin/heal-cockpit?tab=diagnostics&card=parity');
    END IF;
    IF v_enq > v_th_r THEN
      v_alerts := v_alerts || jsonb_build_object('alert_key','parity_enqueue_rate_per_run','severity','warn',
        'value',v_enq,'threshold',v_th_r,
        'message',format('Heal enqueue rate=%s > threshold %s', v_enq, v_th_r),
        'deep_link','/admin/heal-cockpit?tab=diagnostics&card=parity');
    END IF;
  END IF;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('parity_mismatch_alert','system',
    CASE WHEN jsonb_array_length(v_alerts)=0 THEN 'ok' ELSE 'alert' END,
    format('%s alert(s) raised', jsonb_array_length(v_alerts)),
    jsonb_build_object('alerts',v_alerts,'evaluated_at',now(),
      'mismatch_count',v_mismatch,'enqueued',v_enq));

  RETURN jsonb_build_object('alerts',v_alerts,'mismatch_count',v_mismatch,'enqueued',v_enq);
END;$$;
REVOKE ALL ON FUNCTION public.fn_run_heal_alert_evaluator() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_run_heal_alert_evaluator() TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_heal_alerts_summary()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT jsonb_build_object(
    'last_eval_at', l.created_at,
    'status', l.result_status,
    'alerts', COALESCE(l.metadata->'alerts','[]'::jsonb),
    'mismatch_count', COALESCE((l.metadata->>'mismatch_count')::int,0),
    'enqueued', COALESCE((l.metadata->>'enqueued')::int,0),
    'config', (SELECT jsonb_object_agg(alert_key, jsonb_build_object('threshold',threshold,'enabled',enabled,'channels',channels))
               FROM heal_alert_config)
  ) INTO v FROM auto_heal_log l
  WHERE l.action_type='parity_mismatch_alert'
  ORDER BY l.created_at DESC LIMIT 1;
  RETURN COALESCE(v, jsonb_build_object('last_eval_at',null,'status','unknown','alerts','[]'::jsonb));
END;$$;
REVOKE ALL ON FUNCTION public.admin_get_heal_alerts_summary() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_heal_alerts_summary() TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_update_heal_alert_config(
  p_alert_key text, p_threshold numeric, p_enabled boolean
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO heal_alert_config (alert_key, threshold, enabled, updated_by, updated_at)
  VALUES (p_alert_key, p_threshold, COALESCE(p_enabled,true), auth.uid(), now())
  ON CONFLICT (alert_key) DO UPDATE
    SET threshold=EXCLUDED.threshold, enabled=EXCLUDED.enabled,
        updated_by=auth.uid(), updated_at=now();
  INSERT INTO auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
  VALUES ('heal_alert_config_update','system','ok',
    format('alert_key=%s threshold=%s enabled=%s', p_alert_key, p_threshold, p_enabled),
    jsonb_build_object('alert_key',p_alert_key,'threshold',p_threshold,'enabled',p_enabled,'actor',auth.uid()));
END;$$;
REVOKE ALL ON FUNCTION public.admin_update_heal_alert_config(text,numeric,boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_update_heal_alert_config(text,numeric,boolean) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_heal_queue_audit(p_hours integer DEFAULT 48)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  WITH q AS (
    SELECT heal_action, status, COUNT(*) AS n
    FROM admin_course_auto_heal_queue
    WHERE created_at > now() - make_interval(hours => GREATEST(p_hours,1))
      AND source = 'lesson_join_parity'
    GROUP BY heal_action, status
  ), pivot AS (
    SELECT heal_action,
      SUM(CASE WHEN status='pending'    THEN n ELSE 0 END)::int AS pending,
      SUM(CASE WHEN status='processing' THEN n ELSE 0 END)::int AS processing,
      SUM(CASE WHEN status='done'       THEN n ELSE 0 END)::int AS done,
      SUM(CASE WHEN status='failed'     THEN n ELSE 0 END)::int AS failed,
      SUM(CASE WHEN status='cancelled'  THEN n ELSE 0 END)::int AS cancelled,
      SUM(n)::int AS total
    FROM q GROUP BY heal_action
  )
  SELECT jsonb_build_object(
    'window_hours', p_hours,
    'rows', COALESCE(jsonb_agg(jsonb_build_object(
      'heal_action', heal_action,
      'pending', pending, 'processing', processing,
      'done', done, 'failed', failed, 'cancelled', cancelled, 'total', total,
      'completion_pct', CASE WHEN total=0 THEN 0 ELSE ROUND((100.0 * done / total)::numeric,1) END
    ) ORDER BY heal_action), '[]'::jsonb)
  ) INTO v FROM pivot;
  RETURN v;
END;$$;
REVOKE ALL ON FUNCTION public.admin_get_heal_queue_audit(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_heal_queue_audit(integer) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_get_drift_coverage_matrix()
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin') THEN RAISE EXCEPTION 'forbidden'; END IF;
  v := jsonb_build_array(
    jsonb_build_object('domain','Lesson-Join Parity',
      'drift_risk','curriculum_id vs course_id Lesson-Counts driften',
      'check','fn_run_lesson_join_parity_check','cron','lesson-join-parity-daily (03:17 UTC)',
      'audit','auto_heal_log.action_type=lesson_join_parity_check',
      'guard','scripts/guards/lesson-join-parity-contract-guard.mjs',
      'self_heal','admin_course_auto_heal_queue.heal_action=repair_lessons',
      'cockpit','LessonJoinParityCard','status','automated'),
    jsonb_build_object('domain','Parity-Cron Health',
      'drift_risk','Cron deaktiviert/gelöscht/stale',
      'check','fn_run_parity_cron_guard','cron','parity-cron-guard-daily (04:07 UTC)',
      'audit','auto_heal_log.action_type=parity_cron_guard',
      'guard','scripts/guards/lesson-join-parity-contract-guard.mjs',
      'self_heal','manual reschedule','cockpit','ParityCronGuardCard','status','automated'),
    jsonb_build_object('domain','Mismatch + Enqueue-Rate Alerts',
      'drift_risk','Mismatch oder Enqueue-Rate über Schwelle unbemerkt',
      'check','fn_run_heal_alert_evaluator','cron','heal-alerts-15min',
      'audit','auto_heal_log.action_type=parity_mismatch_alert',
      'guard','—','self_heal','heal_alert_config thresholds',
      'cockpit','HealAlertConfigCard','status','automated'),
    jsonb_build_object('domain','Heal-Queue Processing',
      'drift_risk','enqueued repair_lessons bleibt in pending',
      'check','admin_get_heal_queue_audit','cron','admin_course_auto_heal worker (existing)',
      'audit','admin_course_auto_heal_queue.status','guard','—',
      'self_heal','reprocess via worker','cockpit','HealQueueAuditCard','status','semi-automated'),
    jsonb_build_object('domain','Heal-Run Audit-Trail',
      'drift_risk','Heal-Runs ohne Audit nicht rückverfolgbar',
      'check','fn_record_heal_run_audit','cron','—',
      'audit','auto_heal_log.action_type=heal_run_audit','guard','—',
      'self_heal','—','cockpit','HealRunAuditTrailCard','status','automated')
  );
  RETURN jsonb_build_object('matrix',v,'generated_at',now());
END;$$;
REVOKE ALL ON FUNCTION public.admin_get_drift_coverage_matrix() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_drift_coverage_matrix() TO authenticated;

DO $$
DECLARE v_jobid integer;
BEGIN
  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='parity-cron-guard-daily';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule('parity-cron-guard-daily','7 4 * * *',
    $cron$ SELECT public.fn_run_parity_cron_guard(); $cron$);

  SELECT jobid INTO v_jobid FROM cron.job WHERE jobname='heal-alerts-15min';
  IF v_jobid IS NOT NULL THEN PERFORM cron.unschedule(v_jobid); END IF;
  PERFORM cron.schedule('heal-alerts-15min','*/15 * * * *',
    $cron$ SELECT public.fn_run_heal_alert_evaluator(); $cron$);
END $$;

SELECT public.fn_run_parity_cron_guard();
SELECT public.fn_run_heal_alert_evaluator();
