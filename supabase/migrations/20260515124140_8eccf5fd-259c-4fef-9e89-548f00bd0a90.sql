-- Read-only diagnostic RPC: compare failed-job rate before/after Fix B
CREATE OR REPLACE FUNCTION public.admin_get_requeue_park_guard_effect(
  p_window_minutes integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_win interval := make_interval(mins => GREATEST(p_window_minutes, 15));
  v_after_start timestamptz;
  v_before_start timestamptz;
  v_failed_after jsonb;
  v_failed_before jsonb;
  v_failed_after_total int;
  v_failed_before_total int;
  v_skipped_total int;
  v_skipped_by_source jsonb;
  v_top_packages jsonb;
  v_integrity_after int;
  v_verdict text;
  v_bronze_pkgs uuid[];
  v_phantom_on_bronze int;
BEGIN
  -- Admin gate
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;

  v_after_start  := v_now - v_win;
  v_before_start := v_now - (v_win * 2);

  -- Failed jobs in current window (after Fix B)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('job_type', job_type, 'n', n) ORDER BY n DESC), '[]'::jsonb),
         COALESCE(SUM(n), 0)::int
  INTO v_failed_after, v_failed_after_total
  FROM (
    SELECT job_type, COUNT(*)::int AS n
    FROM job_queue
    WHERE status = 'failed'
      AND updated_at >= v_after_start
      AND updated_at <  v_now
    GROUP BY job_type
  ) s;

  -- Failed jobs in prior window of equal length (baseline)
  SELECT COALESCE(jsonb_agg(jsonb_build_object('job_type', job_type, 'n', n) ORDER BY n DESC), '[]'::jsonb),
         COALESCE(SUM(n), 0)::int
  INTO v_failed_before, v_failed_before_total
  FROM (
    SELECT job_type, COUNT(*)::int AS n
    FROM job_queue
    WHERE status = 'failed'
      AND updated_at >= v_before_start
      AND updated_at <  v_after_start
    GROUP BY job_type
  ) s;

  -- requeue_skipped_park audit aggregates
  SELECT COUNT(*)::int
  INTO v_skipped_total
  FROM auto_heal_log
  WHERE action_type = 'requeue_skipped_park'
    AND created_at >= v_after_start;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('trigger_source', src, 'n', n) ORDER BY n DESC), '[]'::jsonb)
  INTO v_skipped_by_source
  FROM (
    SELECT COALESCE(metadata->>'trigger_source', 'unknown') AS src, COUNT(*)::int AS n
    FROM auto_heal_log
    WHERE action_type = 'requeue_skipped_park'
      AND created_at >= v_after_start
    GROUP BY 1
  ) s;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('package_id', pkg, 'n', n) ORDER BY n DESC), '[]'::jsonb)
  INTO v_top_packages
  FROM (
    SELECT (metadata->>'package_id')::uuid AS pkg, COUNT(*)::int AS n
    FROM auto_heal_log
    WHERE action_type = 'requeue_skipped_park'
      AND created_at >= v_after_start
      AND metadata ? 'package_id'
    GROUP BY 1
    ORDER BY 2 DESC
    LIMIT 10
  ) s;

  -- Acceptance check: package_run_integrity_check failures in window
  SELECT COALESCE(SUM(n), 0)::int INTO v_integrity_after
  FROM (
    SELECT 1 AS n
    FROM job_queue
    WHERE status = 'failed'
      AND job_type = 'package_run_integrity_check'
      AND updated_at >= v_after_start
  ) s;

  -- Acceptance check: phantom requeues on bronze-locked packages
  SELECT ARRAY_AGG(id) INTO v_bronze_pkgs
  FROM course_packages
  WHERE COALESCE((feature_flags->'bronze'->>'locked')::boolean, false) = true;

  SELECT COUNT(*)::int INTO v_phantom_on_bronze
  FROM job_queue jq
  WHERE jq.created_at >= v_after_start
    AND jq.job_type IN ('package_run_integrity_check','package_quality_council','package_auto_publish')
    AND jq.package_id = ANY(COALESCE(v_bronze_pkgs, ARRAY[]::uuid[]));

  -- Verdict
  IF v_failed_before_total = 0 AND v_failed_after_total = 0 AND v_skipped_total = 0 THEN
    v_verdict := 'insufficient_data';
  ELSIF v_failed_after_total < v_failed_before_total AND v_skipped_total > 0 THEN
    v_verdict := 'improved';
  ELSIF v_failed_after_total > v_failed_before_total THEN
    v_verdict := 'worse';
  ELSE
    v_verdict := 'unchanged';
  END IF;

  RETURN jsonb_build_object(
    'window_minutes', p_window_minutes,
    'window_after',  jsonb_build_object('from', v_after_start,  'to', v_now),
    'window_before', jsonb_build_object('from', v_before_start, 'to', v_after_start),
    'failed_jobs_after',  jsonb_build_object('total', v_failed_after_total,  'by_type', v_failed_after),
    'failed_jobs_before', jsonb_build_object('total', v_failed_before_total, 'by_type', v_failed_before),
    'requeue_skipped_park', jsonb_build_object(
      'total', v_skipped_total,
      'by_trigger_source', v_skipped_by_source,
      'top_packages', v_top_packages
    ),
    'acceptance', jsonb_build_object(
      'integrity_failed_after', v_integrity_after,
      'integrity_threshold_2h', 50,
      'integrity_under_threshold', (v_integrity_after < 50),
      'skipped_park_positive', (v_skipped_total > 0),
      'bronze_locked_pkg_count', COALESCE(array_length(v_bronze_pkgs, 1), 0),
      'phantom_requeues_on_bronze', v_phantom_on_bronze,
      'no_phantom_on_bronze', (v_phantom_on_bronze = 0)
    ),
    'effect_verdict', v_verdict,
    'computed_at', v_now
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_requeue_park_guard_effect(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_requeue_park_guard_effect(integer) TO authenticated;

COMMENT ON FUNCTION public.admin_get_requeue_park_guard_effect(integer) IS
  'Read-only observability: compares failed_jobs / requeue_skipped_park before vs after Fix B park-helper rollout. No mutations.';

-- Optional snapshot wrapper: persists the computed report into auto_heal_log
CREATE OR REPLACE FUNCTION public.admin_snapshot_requeue_park_guard_effect(
  p_window_minutes integer DEFAULT 120
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_report jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin required';
  END IF;

  v_report := public.admin_get_requeue_park_guard_effect(p_window_minutes);

  INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, metadata)
  VALUES (
    'requeue_park_guard_effect_snapshot',
    'admin_rpc',
    'system',
    COALESCE(v_report->>'effect_verdict', 'unknown'),
    v_report
  );

  RETURN v_report;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_snapshot_requeue_park_guard_effect(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_snapshot_requeue_park_guard_effect(integer) TO authenticated;

COMMENT ON FUNCTION public.admin_snapshot_requeue_park_guard_effect(integer) IS
  'Read-only snapshot: writes admin_get_requeue_park_guard_effect output to auto_heal_log (no pipeline mutations).';