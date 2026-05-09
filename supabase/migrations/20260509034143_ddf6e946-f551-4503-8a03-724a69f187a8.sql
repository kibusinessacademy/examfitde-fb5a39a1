
-- =====================================================================
-- S1: Adaptive Burst v2 + Quality Gate Decisions
-- =====================================================================

-- 1) fn_adaptive_burst_size_v2 — multi-input, lane/pool-aware, health-shedding
CREATE OR REPLACE FUNCTION public.fn_adaptive_burst_size_v2(
  p_pending int,
  p_failure_rate_15m numeric DEFAULT 0,
  p_reaper_churn_5m int DEFAULT 0,
  p_lane text DEFAULT NULL,
  p_pool text DEFAULT 'default'
)
RETURNS int
LANGUAGE plpgsql IMMUTABLE
SET search_path TO 'public'
AS $$
DECLARE
  v_base int;
BEGIN
  -- Base tier by pending volume
  v_base := CASE
    WHEN p_pending > 1000 THEN 75
    WHEN p_pending >  500 THEN 50
    WHEN p_pending >  100 THEN 35
    ELSE 25
  END;

  -- Shed under failure pressure
  IF COALESCE(p_failure_rate_15m,0) > 0.20 THEN
    v_base := GREATEST(5, floor(v_base * 0.5)::int);
  ELSIF COALESCE(p_failure_rate_15m,0) > 0.10 THEN
    v_base := GREATEST(10, floor(v_base * 0.75)::int);
  END IF;

  -- Shed under reaper churn (worker instability)
  IF COALESCE(p_reaper_churn_5m,0) > 10 THEN
    v_base := GREATEST(5, floor(v_base * 0.5)::int);
  ELSIF COALESCE(p_reaper_churn_5m,0) > 5 THEN
    v_base := GREATEST(10, floor(v_base * 0.7)::int);
  END IF;

  -- Lane-specific caps/floors
  IF p_lane = 'control' THEN
    v_base := LEAST(v_base, 35);   -- governance: never burst hard
  ELSIF p_lane = 'recovery' THEN
    v_base := GREATEST(v_base, 35); -- recovery drains aggressively
  END IF;

  -- Non-default pools are usually small (e.g. high-cost); cap
  IF COALESCE(p_pool,'default') <> 'default' THEN
    v_base := LEAST(v_base, 25);
  END IF;

  RETURN GREATEST(5, LEAST(100, v_base));
END $$;

REVOKE ALL ON FUNCTION public.fn_adaptive_burst_size_v2(int, numeric, int, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_adaptive_burst_size_v2(int, numeric, int, text, text) TO service_role;

-- Inline truth-table smoke (DO block)
DO $$
DECLARE
  r1 int; r2 int; r3 int; r4 int; r5 int; r6 int;
BEGIN
  r1 := public.fn_adaptive_burst_size_v2(50,    0,    0, NULL,      'default');  -- 25
  r2 := public.fn_adaptive_burst_size_v2(1500,  0,    0, NULL,      'default');  -- 75
  r3 := public.fn_adaptive_burst_size_v2(1500,  0.30, 0, NULL,      'default');  -- 75 → 37 (×0.5)
  r4 := public.fn_adaptive_burst_size_v2(1500,  0,   12, NULL,      'default');  -- 75 → 37
  r5 := public.fn_adaptive_burst_size_v2(1500,  0,    0, 'control', 'default');  -- 75 → 35
  r6 := public.fn_adaptive_burst_size_v2(50,    0,    0, 'recovery','default');  -- 25 → 35

  IF r1<>25 OR r2<>75 OR r3>40 OR r4>40 OR r5<>35 OR r6<>35 THEN
    RAISE EXCEPTION 'fn_adaptive_burst_size_v2 truth-table failed: %, %, %, %, %, %', r1,r2,r3,r4,r5,r6;
  END IF;
END $$;

-- 2) Update fn_auto_recovery_pulse_decide to use v2 with live signals
CREATE OR REPLACE FUNCTION public.fn_auto_recovery_pulse_decide()
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_pending int;
  v_oldest_min int;
  v_failed_15m int;
  v_total_15m int;
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

  v_failure_rate := CASE WHEN v_total_15m>0 THEN v_failed_15m::numeric / v_total_15m ELSE 0 END;

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
  ELSIF v_failure_rate > 0.30 THEN
    v_decision := 'noop_failure_rate_too_high';
  ELSE
    SELECT array_agg(j.id) INTO v_pulsed_ids FROM public.claim_recovery_pulse(
      'auto_recovery_pulse_cron', LEAST(v_burst, 50), 'default'
    ) j;
    v_pulse_count := COALESCE(array_length(v_pulsed_ids,1),0);
    v_decision := 'pulsed';
  END IF;

  INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('auto_recovery_pulse_decide','system',
          CASE WHEN v_decision='pulsed' THEN 'success' ELSE 'noop' END,
          jsonb_build_object(
            'decision', v_decision,
            'pending', v_pending,
            'oldest_min', v_oldest_min,
            'failure_rate_15m', v_failure_rate,
            'reaper_churn_5m', v_reaper_churn,
            'gate', v_gate,
            'burst_size', v_burst,
            'pulsed', v_pulse_count,
            'burst_version', 'v2'
          ));

  RETURN jsonb_build_object(
    'decision', v_decision, 'pending', v_pending, 'oldest_min', v_oldest_min,
    'failure_rate_15m', v_failure_rate, 'reaper_churn_5m', v_reaper_churn,
    'burst_size', v_burst, 'pulsed', v_pulse_count, 'gate', v_gate
  );
END $$;

-- 3) v_quality_gate_decision_per_pkg — SSOT für Publish/Repair-Entscheidungen
CREATE OR REPLACE VIEW public.v_quality_gate_decision_per_pkg AS
WITH latest_score AS (
  SELECT package_id, score, badge, score_version, updated_at
    FROM public.package_quality_scores
), latest_qreport AS (
  SELECT DISTINCT ON (package_id)
         package_id, score AS report_score, status AS report_status,
         rules_failed, rules_warned, rules_passed, created_at AS report_at
    FROM public.package_quality_reports
   ORDER BY package_id, created_at DESC
), bronze_lock AS (
  SELECT id AS package_id,
         COALESCE((feature_flags->'bronze'->>'locked')::boolean, false) AS bronze_locked
    FROM public.course_packages
)
SELECT
  cp.id                               AS package_id,
  cp.package_key,
  cp.status                           AS package_status,
  cp.course_id,
  ls.score                            AS quality_score,
  ls.badge                            AS quality_badge,
  ls.score_version,
  ls.updated_at                       AS scored_at,
  lr.report_score,
  lr.report_status,
  lr.rules_failed,
  lr.rules_warned,
  lr.report_at,
  bl.bronze_locked,
  CASE
    WHEN cp.status='published'                                            THEN 'PUBLISHED'
    WHEN bl.bronze_locked                                                 THEN 'BRONZE_REVIEW_LOCKED'
    WHEN ls.score IS NULL                                                 THEN 'NOT_SCORED'
    WHEN ls.score >= 90                                                   THEN 'READY_TO_PUBLISH'
    WHEN ls.score BETWEEN 75 AND 89                                       THEN 'REVIEW_REQUIRED'
    WHEN ls.score BETWEEN 60 AND 74                                       THEN 'REPAIR_RECOMMENDED'
    ELSE                                                                       'REPAIR_REQUIRED'
  END AS gate_decision,
  CASE
    WHEN COALESCE(lr.rules_failed,0) > 0 THEN 'has_failed_rules'
    WHEN COALESCE(lr.rules_warned,0) > 5 THEN 'high_warn_count'
    ELSE NULL
  END AS report_signal
FROM public.course_packages cp
LEFT JOIN latest_score   ls ON ls.package_id = cp.id
LEFT JOIN latest_qreport lr ON lr.package_id = cp.id
LEFT JOIN bronze_lock    bl ON bl.package_id = cp.id;

-- Lock view (admin-only via RPC)
REVOKE ALL ON public.v_quality_gate_decision_per_pkg FROM PUBLIC, anon, authenticated;
GRANT  SELECT ON public.v_quality_gate_decision_per_pkg TO service_role;

-- 4) admin_get_quality_gate_decisions — RPC wrapper with has_role gate
CREATE OR REPLACE FUNCTION public.admin_get_quality_gate_decisions(
  p_decision text DEFAULT NULL,
  p_limit int DEFAULT 200
)
RETURNS TABLE (
  package_id uuid,
  package_key text,
  package_status text,
  course_id uuid,
  quality_score smallint,
  quality_badge text,
  scored_at timestamptz,
  report_status text,
  rules_failed int,
  rules_warned int,
  bronze_locked boolean,
  gate_decision text,
  report_signal text
)
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  SELECT v.package_id, v.package_key, v.package_status, v.course_id,
         v.quality_score, v.quality_badge, v.scored_at,
         v.report_status, v.rules_failed, v.rules_warned,
         v.bronze_locked, v.gate_decision, v.report_signal
    FROM public.v_quality_gate_decision_per_pkg v
   WHERE p_decision IS NULL OR v.gate_decision = p_decision
   ORDER BY
     CASE v.gate_decision
       WHEN 'REPAIR_REQUIRED'      THEN 1
       WHEN 'REPAIR_RECOMMENDED'   THEN 2
       WHEN 'BRONZE_REVIEW_LOCKED' THEN 3
       WHEN 'REVIEW_REQUIRED'      THEN 4
       WHEN 'NOT_SCORED'           THEN 5
       WHEN 'READY_TO_PUBLISH'     THEN 6
       WHEN 'PUBLISHED'            THEN 7
       ELSE 8
     END,
     v.scored_at DESC NULLS LAST
   LIMIT GREATEST(1, LEAST(p_limit, 1000));
END $$;

REVOKE ALL ON FUNCTION public.admin_get_quality_gate_decisions(text, int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_quality_gate_decisions(text, int) TO authenticated, service_role;

-- 5) Audit-Tag for the migration itself
INSERT INTO public.auto_heal_log(action_type, target_type, result_status, metadata)
VALUES ('s1_burst_v2_and_gate_decisions_deployed','system','success',
        jsonb_build_object(
          'burst_version','v2',
          'view','v_quality_gate_decision_per_pkg',
          'rpc','admin_get_quality_gate_decisions',
          'auto_pulse_uses_v2', true,
          'rollback_hint','DROP FUNCTION fn_adaptive_burst_size_v2(int,numeric,int,text,text); DROP VIEW v_quality_gate_decision_per_pkg CASCADE; DROP FUNCTION admin_get_quality_gate_decisions(text,int);'
        ));
