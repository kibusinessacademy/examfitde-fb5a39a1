
-- ============================================================
-- S4.1 Lane-aware failure-rate helper
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_lane_failure_rate_15m(
  p_lane text DEFAULT 'control',
  p_pool text DEFAULT 'default'
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH j AS (
    SELECT status
    FROM public.job_queue
    WHERE COALESCE(lane, 'default') = COALESCE(p_lane, 'default')
      AND COALESCE(worker_pool, 'default') = COALESCE(p_pool, 'default')
      AND COALESCE(completed_at, updated_at, created_at) > now() - interval '15 minutes'
  )
  SELECT CASE
    WHEN COUNT(*) = 0 THEN 0::numeric
    ELSE COUNT(*) FILTER (WHERE status = 'failed')::numeric / COUNT(*)::numeric
  END
  FROM j;
$$;
REVOKE ALL ON FUNCTION public.fn_lane_failure_rate_15m(text,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_lane_failure_rate_15m(text,text) TO service_role;

-- ============================================================
-- S4.2 Lane-aware Auto-Pulse decision
-- ============================================================
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
  -- backlog scope
  SELECT COUNT(*)::int,
         COALESCE(EXTRACT(EPOCH FROM (now() - MIN(created_at)))/60,0)::int
    INTO v_pending, v_oldest_min
    FROM public.job_queue
   WHERE status='pending'
     AND (run_after IS NULL OR run_after <= now())
     AND COALESCE(worker_pool,'default')='default';

  -- global failure (kept for audit only)
  SELECT COUNT(*) FILTER (WHERE status='failed')::int,
         COUNT(*)::int
    INTO v_failed_15m, v_total_15m
    FROM public.job_queue
   WHERE COALESCE(completed_at, updated_at) > now() - interval '15 minutes';

  v_global_failure_rate := CASE WHEN v_total_15m>0
    THEN v_failed_15m::numeric / v_total_15m ELSE 0 END;

  -- lane-aware: only the control lane / default pool matters for the pulse decision
  v_lane_failure_rate := public.fn_lane_failure_rate_15m('control', 'default');
  v_failure_rate := v_lane_failure_rate;  -- decision input

  SELECT COUNT(*)::int INTO v_reaper_churn
    FROM public.auto_heal_log
   WHERE action_type IN ('reap_stale_processing_job','stale_reap')
     AND created_at > now() - interval '5 minutes';

  v_gate  := public.fn_worker_health_gate();
  v_burst := public.fn_adaptive_burst_size_v2(v_pending, v_failure_rate, v_reaper_churn, NULL, 'default');

  IF v_pending <= 100 THEN
    v_decision := 'noop_below_threshold';
  ELSIF v_oldest_min < 10 THEN
    v_decision := 'noop_oldest_under_10min';
  ELSIF NOT (v_gate->>'healthy')::boolean THEN
    v_decision := 'noop_gate_unhealthy';
  ELSIF v_failure_rate > 0.30 AND COALESCE((v_gate->>'healthy')::boolean, false) IS FALSE THEN
    -- only suppress when BOTH lane unhealthy AND gate unhealthy
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
            'gate_version', 's4'
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

-- ============================================================
-- S4.3 Bronze Quarantine (stale-reap terminal)
-- ============================================================

-- 3a. Extend bronze-locked check to include quarantine (so the existing
--     fn_guard_bronze_lock_on_job_enqueue trigger automatically blocks
--     phantom enqueues for quarantined packages).
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
         (feature_flags->'bronze'->>'requires_review')::boolean = true
         OR (feature_flags->'bronze'->>'repair_attempts')::int >= 1
         OR (feature_flags->'bronze'->>'final_state') IN ('requires_review','manual_review_required')
         -- S4: quarantine = bronze-locked unless explicitly cleared
         OR (feature_flags->'bronze_quarantine'->>'active')::boolean = true
       )
       AND NOT (feature_flags ? 'admin_force_building_at')
       AND COALESCE((feature_flags->'bronze'->>'manual_bypass')::boolean, false) = false
       AND COALESCE((feature_flags->'bronze_quarantine'->>'manual_bypass')::boolean, false) = false
  );
$function$;

-- 3b. Trigger fn: when a job updates to status='failed' with STALE_REAP_LOOP_TERMINAL,
--     write the quarantine flag onto the package (idempotent).
CREATE OR REPLACE FUNCTION public.fn_quarantine_on_stale_reap_terminal()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg_id uuid;
  v_already boolean;
BEGIN
  IF NEW.status IS DISTINCT FROM 'failed' THEN RETURN NEW; END IF;
  IF NEW.last_error IS NULL OR NEW.last_error NOT LIKE '%STALE_REAP_LOOP_TERMINAL%' THEN
    RETURN NEW;
  END IF;
  v_pkg_id := COALESCE(NEW.package_id, NULLIF(NEW.payload->>'package_id','')::uuid);
  IF v_pkg_id IS NULL THEN RETURN NEW; END IF;

  SELECT (feature_flags->'bronze_quarantine'->>'active')::boolean
    INTO v_already
  FROM course_packages WHERE id = v_pkg_id;

  IF COALESCE(v_already, false) THEN
    -- bump occurrence counter only
    UPDATE course_packages
       SET feature_flags = jsonb_set(
            feature_flags, '{bronze_quarantine,occurrences}',
            to_jsonb(COALESCE((feature_flags->'bronze_quarantine'->>'occurrences')::int,1) + 1),
            true)
     WHERE id = v_pkg_id;
    RETURN NEW;
  END IF;

  UPDATE course_packages
     SET feature_flags = COALESCE(feature_flags, '{}'::jsonb)
       || jsonb_build_object(
         'bronze_quarantine', jsonb_build_object(
           'active', true,
           'reason', 'STALE_REAP_LOOP_TERMINAL',
           'since', now(),
           'source_job_id', NEW.id,
           'source_job_type', NEW.job_type,
           'last_error_excerpt', LEFT(NEW.last_error, 240),
           'occurrences', 1,
           'manual_bypass', false
         ))
   WHERE id = v_pkg_id;

  INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata, trigger_source)
  VALUES ('bronze_quarantine_set','package', v_pkg_id::text, 'success',
          jsonb_build_object(
            'package_id', v_pkg_id,
            'reason','STALE_REAP_LOOP_TERMINAL',
            'job_id', NEW.id,
            'job_type', NEW.job_type),
          'fn_quarantine_on_stale_reap_terminal');

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quarantine_on_stale_reap_terminal ON public.job_queue;
CREATE TRIGGER trg_quarantine_on_stale_reap_terminal
AFTER UPDATE OF status, last_error ON public.job_queue
FOR EACH ROW
WHEN (NEW.status = 'failed')
EXECUTE FUNCTION public.fn_quarantine_on_stale_reap_terminal();

-- 3c. Admin RPCs (admin-gated, SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.admin_get_bronze_quarantine(
  p_reason text DEFAULT NULL,
  p_limit int DEFAULT 100
)
RETURNS TABLE(
  package_id uuid,
  package_key text,
  title text,
  status text,
  reason text,
  since timestamptz,
  occurrences int,
  source_job_type text,
  last_error_excerpt text,
  curriculum_id uuid,
  manual_bypass boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    cp.id,
    cp.package_key,
    cp.title,
    cp.status,
    cp.feature_flags->'bronze_quarantine'->>'reason',
    (cp.feature_flags->'bronze_quarantine'->>'since')::timestamptz,
    COALESCE((cp.feature_flags->'bronze_quarantine'->>'occurrences')::int, 1),
    cp.feature_flags->'bronze_quarantine'->>'source_job_type',
    cp.feature_flags->'bronze_quarantine'->>'last_error_excerpt',
    cp.curriculum_id,
    COALESCE((cp.feature_flags->'bronze_quarantine'->>'manual_bypass')::boolean, false)
  FROM course_packages cp
  WHERE public.has_role(auth.uid(), 'admin')
    AND (cp.feature_flags->'bronze_quarantine'->>'active')::boolean = true
    AND (p_reason IS NULL OR cp.feature_flags->'bronze_quarantine'->>'reason' = p_reason)
  ORDER BY (cp.feature_flags->'bronze_quarantine'->>'since')::timestamptz DESC NULLS LAST
  LIMIT GREATEST(1, LEAST(coalesce(p_limit, 100), 500));
$$;
REVOKE ALL ON FUNCTION public.admin_get_bronze_quarantine(text,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_bronze_quarantine(text,int) TO authenticated, service_role;

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
  IF NOT (v_pkg.feature_flags->'bronze_quarantine'->>'active')::boolean THEN
    RETURN jsonb_build_object('skipped', true, 'reason', 'NOT_QUARANTINED');
  END IF;
  v_curr_id := v_pkg.curriculum_id;

  -- clear quarantine, mark history, set manual_bypass so guard lets re-enqueue through
  UPDATE course_packages
     SET feature_flags = jsonb_set(
           feature_flags,
           '{bronze_quarantine}',
           (feature_flags->'bronze_quarantine')
             || jsonb_build_object(
               'active', false,
               'cleared_at', now(),
               'cleared_by', auth.uid(),
               'cleared_reason', p_reason,
               'manual_bypass', true),
           true)
   WHERE id = p_package_id;

  -- enqueue an integrity check with bronze_lock_override so the new state is re-validated
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
REVOKE ALL ON FUNCTION public.admin_requeue_bronze_quarantine(uuid,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_requeue_bronze_quarantine(uuid,text) TO authenticated, service_role;

-- ============================================================
-- S4.4 Backfill: quarantine packages with historic STALE_REAP_LOOP_TERMINAL
-- ============================================================
WITH src AS (
  SELECT DISTINCT ON (COALESCE(jq.package_id, NULLIF(jq.payload->>'package_id','')::uuid))
    COALESCE(jq.package_id, NULLIF(jq.payload->>'package_id','')::uuid) AS pkg_id,
    jq.id AS job_id,
    jq.job_type,
    jq.last_error,
    jq.updated_at
  FROM job_queue jq
  WHERE jq.status='failed'
    AND jq.last_error LIKE '%STALE_REAP_LOOP_TERMINAL%'
    AND jq.updated_at > now() - interval '30 days'
  ORDER BY COALESCE(jq.package_id, NULLIF(jq.payload->>'package_id','')::uuid),
           jq.updated_at DESC
), upd AS (
  UPDATE course_packages cp
     SET feature_flags = COALESCE(cp.feature_flags, '{}'::jsonb)
       || jsonb_build_object(
         'bronze_quarantine', jsonb_build_object(
           'active', true,
           'reason', 'STALE_REAP_LOOP_TERMINAL',
           'since', s.updated_at,
           'source_job_id', s.job_id,
           'source_job_type', s.job_type,
           'last_error_excerpt', LEFT(s.last_error, 240),
           'occurrences', 1,
           'manual_bypass', false,
           'backfilled', true
         ))
   FROM src s
   WHERE cp.id = s.pkg_id
     AND cp.id IS NOT NULL
     AND COALESCE((cp.feature_flags->'bronze_quarantine'->>'active')::boolean, false) = false
   RETURNING cp.id
)
INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
SELECT 's4_bronze_quarantine_backfill','system','success',
       jsonb_build_object('packages_quarantined', COUNT(*),
                          'reason','STALE_REAP_LOOP_TERMINAL',
                          'window','30d')
FROM upd;

-- ============================================================
-- S4.5 Smoke test
-- ============================================================
DO $$
DECLARE v_rate numeric; v_decision_fn_exists boolean; v_quarantined int;
BEGIN
  v_rate := public.fn_lane_failure_rate_15m('control','default');
  IF v_rate IS NULL OR v_rate < 0 OR v_rate > 1 THEN
    RAISE EXCEPTION 'SMOKE_FAILED: lane_failure_rate out of bounds: %', v_rate;
  END IF;

  SELECT COUNT(*) INTO v_quarantined
    FROM course_packages
   WHERE (feature_flags->'bronze_quarantine'->>'active')::boolean = true;

  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('s4_migration_smoke','system','success',
          jsonb_build_object(
            'lane_failure_rate_control', v_rate,
            'packages_quarantined_now', v_quarantined,
            'rollback_hint','to revert: drop trg_quarantine_on_stale_reap_terminal + restore prior fn_auto_recovery_pulse_decide + clear feature_flags->bronze_quarantine'));
END $$;
