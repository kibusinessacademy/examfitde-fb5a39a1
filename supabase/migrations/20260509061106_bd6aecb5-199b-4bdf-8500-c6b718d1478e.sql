-- S4 Hotfix: harden lane param, COALESCE JSON casts, INSERT-or-UPDATE trigger
-- ============================================================

-- 1. fn_auto_recovery_pulse_decide: pass lane='control' to burst sizing
CREATE OR REPLACE FUNCTION public.fn_auto_recovery_pulse_decide()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pending int;
  v_oldest_min int;
  v_failed_15m int;
  v_total_15m int;
  v_global_failure_rate numeric;
  v_lane_failure_rate numeric;
  v_failure_rate numeric;
  v_reaper_churn int;
  v_gate jsonb;
  v_burst int;
  v_pulsed_ids uuid[];
  v_pulse_count int := 0;
  v_decision text;
BEGIN
  SELECT COUNT(*)::int,
         COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)))/60,0)::int
    INTO v_pending, v_oldest_min
    FROM public.job_queue
   WHERE status='pending'
     AND (run_after IS NULL OR run_after <= now())
     AND COALESCE(worker_pool,'default')='default';

  SELECT COUNT(*) FILTER (WHERE status='failed')::int,
         COUNT(*)::int
    INTO v_failed_15m, v_total_15m
    FROM public.job_queue
   WHERE COALESCE(completed_at, updated_at) > now() - interval '15 minutes';

  v_global_failure_rate := CASE WHEN v_total_15m>0
    THEN v_failed_15m::numeric / v_total_15m ELSE 0 END;

  v_lane_failure_rate := public.fn_lane_failure_rate_15m('control', 'default');
  v_failure_rate := v_lane_failure_rate;

  SELECT COUNT(*)::int INTO v_reaper_churn
    FROM public.auto_heal_log
   WHERE action_type IN ('reap_stale_processing_job','stale_reap')
     AND created_at > now() - interval '5 minutes';

  v_gate  := public.fn_worker_health_gate();
  -- HOTFIX: pass lane='control' so the v2 cap of 35 actually applies
  v_burst := public.fn_adaptive_burst_size_v2(v_pending, v_failure_rate, v_reaper_churn, 'control', 'default');

  IF v_pending <= 100 THEN
    v_decision := 'noop_below_threshold';
  ELSIF v_oldest_min < 10 THEN
    v_decision := 'noop_oldest_under_10min';
  ELSIF NOT (v_gate->>'healthy')::boolean THEN
    v_decision := 'noop_gate_unhealthy';
  ELSIF v_failure_rate > 0.30 AND COALESCE((v_gate->>'healthy')::boolean, false) IS FALSE THEN
    v_decision := 'noop_failure_rate_too_high';
  ELSE
    SELECT array_agg(j.id) INTO v_pulsed_ids FROM public.claim_recovery_pulse(
      'auto_recovery_pulse_cron', LEAST(v_burst, 50), 'default'
    ) j;
    v_pulse_count := COALESCE(array_length(v_pulsed_ids,1),0);
    v_decision := CASE
      WHEN v_global_failure_rate > 0.30 AND v_lane_failure_rate <= 0.30
        THEN 'pulse_allowed_lane_healthy_global_failure_ignored'
      ELSE 'pulsed'
    END;
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('auto_recovery_pulse_decide','system',
          CASE WHEN v_decision LIKE 'pulse%' THEN 'success' ELSE 'noop' END,
          jsonb_build_object(
            'decision', v_decision,
            'pending', v_pending,
            'oldest_min', v_oldest_min,
            'failure_rate_scope', 'lane',
            'lane', 'control',
            'pool', 'default',
            'failure_rate_15m', v_failure_rate,
            'global_failure_rate_15m', v_global_failure_rate,
            'lane_failure_rate_15m', v_lane_failure_rate,
            'reaper_churn_5m', v_reaper_churn,
            'gate', v_gate,
            'burst_size', v_burst,
            'pulsed', v_pulse_count,
            'burst_version', 'v2',
            'gate_version', 's4_hotfix'
          ));

  RETURN jsonb_build_object(
    'decision', v_decision, 'pending', v_pending, 'oldest_min', v_oldest_min,
    'failure_rate_15m', v_failure_rate,
    'global_failure_rate_15m', v_global_failure_rate,
    'lane_failure_rate_15m', v_lane_failure_rate,
    'reaper_churn_5m', v_reaper_churn,
    'burst_size', v_burst, 'pulsed', v_pulse_count, 'gate', v_gate
  );
END $function$;

-- 2. fn_is_bronze_locked: COALESCE all JSON casts to survive missing keys
CREATE OR REPLACE FUNCTION public.fn_is_bronze_locked(p_package_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1
      FROM course_packages
     WHERE id = p_package_id
       AND (
         COALESCE((feature_flags->'bronze'->>'requires_review')::boolean, false) = true
         OR COALESCE((feature_flags->'bronze'->>'repair_attempts')::int, 0) >= 1
         OR (feature_flags->'bronze'->>'final_state') IN ('requires_review','manual_review_required')
         OR COALESCE((feature_flags->'bronze_quarantine'->>'active')::boolean, false) = true
       )
       AND NOT (feature_flags ? 'admin_force_building_at')
       AND COALESCE((feature_flags->'bronze'->>'manual_bypass')::boolean, false) = false
       AND COALESCE((feature_flags->'bronze_quarantine'->>'manual_bypass')::boolean, false) = false
  );
$function$;

-- 3. admin_requeue_bronze_quarantine: COALESCE the quarantine-active check
CREATE OR REPLACE FUNCTION public.admin_requeue_bronze_quarantine(
  p_package_id uuid,
  p_reason text DEFAULT 'manual_admin_requeue'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg record; v_curr_id uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin')
     AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'PERMISSION_DENIED: admin role required';
  END IF;

  SELECT * INTO v_pkg FROM course_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PACKAGE_NOT_FOUND: %', p_package_id;
  END IF;
  IF NOT COALESCE((v_pkg.feature_flags->'bronze_quarantine'->>'active')::boolean, false) THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'NOT_QUARANTINED');
  END IF;
  v_curr_id := v_pkg.curriculum_id;

  UPDATE course_packages
     SET feature_flags = jsonb_set(
           COALESCE(feature_flags, '{}'::jsonb),
           '{bronze_quarantine}',
           COALESCE(feature_flags->'bronze_quarantine', '{}'::jsonb)
             || jsonb_build_object(
               'active', false,
               'cleared_at', now(),
               'cleared_by', auth.uid(),
               'cleared_reason', p_reason,
               'manual_bypass', true),
           true)
   WHERE id = p_package_id;

  INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, idempotency_key)
  VALUES (
    'package_run_integrity_check', p_package_id, 'pending', 6,
    jsonb_build_object(
      'package_id', p_package_id,
      'curriculum_id', v_curr_id,
      'enqueue_source','bronze_targeted_repair',
      '_origin','bronze_quarantine_requeue',
      'bronze_lock_override', true,
      'requeue_reason', p_reason
    ),
    jsonb_build_object(
      'enqueue_source','bronze_targeted_repair',
      'bronze_lock_override', true,
      'requeue_reason', p_reason),
    'bronze_quarantine_requeue:' || p_package_id::text || ':' || extract(epoch from now())::bigint::text
  )
  ON CONFLICT (idempotency_key) DO NOTHING;

  INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata, actor_id)
  VALUES ('bronze_quarantine_requeue','package', p_package_id::text, 'success',
          jsonb_build_object(
            'package_id', p_package_id,
            'reason', p_reason,
            'cleared_by', auth.uid()),
          auth.uid());

  RETURN jsonb_build_object('ok', true, 'package_id', p_package_id, 'reason', p_reason);
END $$;

-- 4. Trigger now also fires on INSERT (jobs that land directly as failed)
DROP TRIGGER IF EXISTS trg_quarantine_on_stale_reap_terminal ON public.job_queue;
CREATE TRIGGER trg_quarantine_on_stale_reap_terminal
AFTER INSERT OR UPDATE OF status, last_error ON public.job_queue
FOR EACH ROW
WHEN (NEW.status = 'failed')
EXECUTE FUNCTION public.fn_quarantine_on_stale_reap_terminal();

-- ============================================================
-- Smoke
-- ============================================================
DO $$
DECLARE r jsonb;
BEGIN
  PERFORM public.fn_lane_failure_rate_15m('control','default');
  r := public.fn_auto_recovery_pulse_decide();
  RAISE NOTICE 's4_hotfix_smoke decision=%', r->>'decision';
END $$;