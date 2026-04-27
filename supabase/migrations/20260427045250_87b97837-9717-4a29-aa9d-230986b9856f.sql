-- =========================================================================
-- 1) GRANT EXECUTE für bestehende SECURITY DEFINER RPCs (sie haben interne Admin-Checks bereits)
-- =========================================================================

-- admin_reap_stale_processing_now: interne Admin-Gate sicherstellen
CREATE OR REPLACE FUNCTION public.admin_reap_stale_processing_now(
  p_max_age_seconds integer DEFAULT 300,
  p_max_cancels integer DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_cutoff timestamptz := now() - make_interval(secs => p_max_age_seconds);
  v_requeued int := 0;
  v_failed   int := 0;
  v_jobs jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;

  PERFORM set_config('app.transition_source',
    'admin_ui:reap_stale_now:' || COALESCE(v_uid::text,'?'), true);

  WITH stale AS (
    SELECT id, job_type, package_id, attempts, max_attempts
    FROM public.job_queue
    WHERE status = 'processing'
      AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
    ORDER BY COALESCE(last_heartbeat_at, locked_at, started_at) ASC
    LIMIT GREATEST(p_max_cancels, 1)
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET
      status = CASE
        WHEN jq.attempts >= jq.max_attempts THEN 'failed'
        ELSE 'pending'
      END,
      run_after = CASE
        WHEN jq.attempts >= jq.max_attempts THEN jq.run_after
        ELSE now() + interval '60 seconds'
      END,
      locked_at = NULL,
      locked_by = NULL,
      started_at = CASE
        WHEN jq.attempts >= jq.max_attempts THEN jq.started_at
        ELSE NULL
      END,
      last_error = CASE
        WHEN jq.attempts >= jq.max_attempts
          THEN COALESCE(jq.last_error,'') || ' | STALE_PROCESSING_EXHAUSTED (admin_reap_now)'
        ELSE COALESCE(jq.last_error,'') || ' | STALE_PROCESSING_REAPED (admin_reap_now)'
      END,
      updated_at = now()
    FROM stale s
    WHERE jq.id = s.id
    RETURNING jq.id, jq.job_type, jq.status, jq.package_id, jq.attempts
  )
  SELECT
    coalesce(sum(case when status='pending' then 1 else 0 end),0),
    coalesce(sum(case when status='failed'  then 1 else 0 end),0),
    coalesce(jsonb_agg(jsonb_build_object(
      'job_id',id,'job_type',job_type,'package_id',package_id,
      'attempts',attempts,'new_status',status
    )), '[]'::jsonb)
  INTO v_requeued, v_failed, v_jobs
  FROM upd;

  INSERT INTO public.admin_actions(action, payload, performed_by)
  VALUES ('admin_reap_stale_processing_now',
          jsonb_build_object('cutoff_seconds',p_max_age_seconds,
                             'max_cancels',p_max_cancels,
                             'requeued',v_requeued,'failed',v_failed,
                             'jobs',v_jobs),
          v_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'requeued', v_requeued,
    'failed_terminal', v_failed,
    'jobs', v_jobs,
    'cutoff_seconds', p_max_age_seconds
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_reap_stale_processing_now(integer,integer) TO authenticated;

-- admin_get_queue_throughput: ebenfalls grant + admin-gate erzwingen
CREATE OR REPLACE FUNCTION public.admin_get_queue_throughput(p_window_hours integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_window interval;
  v_result jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;

  v_window := make_interval(hours => GREATEST(p_window_hours,1));

  SELECT jsonb_build_object(
    'window_hours', p_window_hours,
    'completed_total',
      (SELECT count(*) FROM job_queue WHERE status='completed' AND completed_at >= now()-v_window),
    'failed_total',
      (SELECT count(*) FROM job_queue WHERE status='failed' AND updated_at >= now()-v_window),
    'jobs_per_hour',
      (SELECT round(count(*)::numeric / GREATEST(p_window_hours,1), 2)
       FROM job_queue WHERE status='completed' AND completed_at >= now()-v_window),
    'duration_p50_sec',
      (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at-started_at)))::numeric, 1)
       FROM job_queue WHERE status='completed' AND completed_at >= now()-v_window AND started_at IS NOT NULL),
    'duration_p95_sec',
      (SELECT round(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at-started_at)))::numeric, 1)
       FROM job_queue WHERE status='completed' AND completed_at >= now()-v_window AND started_at IS NOT NULL),
    'lifecycle_p50_sec',
      (SELECT round(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at-created_at)))::numeric, 1)
       FROM job_queue WHERE status='completed' AND completed_at >= now()-v_window),
    'lifecycle_p95_sec',
      (SELECT round(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at-created_at)))::numeric, 1)
       FROM job_queue WHERE status='completed' AND completed_at >= now()-v_window),
    'by_type', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'job_type', job_type,
        'completed', cnt,
        'duration_p50_sec', d_p50,
        'duration_p95_sec', d_p95
      ) ORDER BY cnt DESC)
      FROM (
        SELECT job_type,
               count(*) AS cnt,
               round(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at-started_at)))::numeric,1) AS d_p50,
               round(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (completed_at-started_at)))::numeric,1) AS d_p95
        FROM job_queue
        WHERE status='completed' AND completed_at >= now()-v_window AND started_at IS NOT NULL
        GROUP BY job_type
      ) t
    ), '[]'::jsonb)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_queue_throughput(integer) TO authenticated;

-- =========================================================================
-- 2) admin_quarantine_hotloop_jobs(threshold, dry_run)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.admin_quarantine_hotloop_jobs(
  p_attempt_threshold integer DEFAULT 10,
  p_dry_run boolean DEFAULT true,
  p_job_types text[] DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_candidates jsonb;
  v_cancel_count int := 0;
  v_step_defer_count int := 0;
  v_by_type jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;

  -- Kandidaten ermitteln (immer)
  WITH cand AS (
    SELECT id, job_type, package_id, status, attempts, max_attempts,
           left(coalesce(last_error,''), 200) AS last_error_trim,
           meta->>'step_key' AS step_key
    FROM public.job_queue
    WHERE status IN ('pending','queued','processing','running','batch_pending','failed')
      AND attempts >= p_attempt_threshold
      AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
  )
  SELECT
    coalesce(jsonb_agg(jsonb_build_object(
      'job_id', id, 'job_type', job_type, 'package_id', package_id,
      'status', status, 'attempts', attempts, 'max_attempts', max_attempts,
      'last_error', last_error_trim, 'step_key', step_key
    ) ORDER BY attempts DESC), '[]'::jsonb),
    coalesce(jsonb_object_agg(job_type, cnt) FILTER (WHERE job_type IS NOT NULL), '{}'::jsonb)
  INTO v_candidates, v_by_type
  FROM (
    SELECT id, job_type, package_id, status, attempts, max_attempts, last_error_trim, step_key,
           count(*) OVER (PARTITION BY job_type) AS cnt
    FROM cand
  ) x;

  IF p_dry_run THEN
    INSERT INTO public.admin_actions(action, payload, performed_by)
    VALUES ('admin_quarantine_hotloop_jobs:dry_run',
            jsonb_build_object('threshold',p_attempt_threshold,
                               'job_types',p_job_types,
                               'candidates',v_candidates,
                               'by_type',v_by_type),
            v_uid);

    RETURN jsonb_build_object(
      'ok', true, 'dry_run', true,
      'candidate_count', jsonb_array_length(v_candidates),
      'by_type', v_by_type,
      'candidates', v_candidates
    );
  END IF;

  PERFORM set_config('app.transition_source',
    'admin_ui:quarantine_hotloop:' || COALESCE(v_uid::text,'?'), true);

  -- Jobs cancellen
  WITH cand AS (
    SELECT id, package_id, meta->>'step_key' AS step_key
    FROM public.job_queue
    WHERE status IN ('pending','queued','processing','running','batch_pending','failed')
      AND attempts >= p_attempt_threshold
      AND (p_job_types IS NULL OR job_type = ANY(p_job_types))
  ),
  cancelled AS (
    UPDATE public.job_queue jq
    SET status='cancelled',
        completed_at = COALESCE(jq.completed_at, now()),
        locked_at = NULL,
        locked_by = NULL,
        last_error = COALESCE(jq.last_error,'') || ' | HOTLOOP_QUARANTINE_CANCELLED (attempts>=' || p_attempt_threshold || ')',
        updated_at = now()
    FROM cand c
    WHERE jq.id = c.id
    RETURNING jq.id, jq.package_id, c.step_key
  )
  SELECT count(*) INTO v_cancel_count FROM cancelled;

  -- Steps deferren, damit Atomic-Trigger keine neuen Jobs nachlegen
  WITH cand_steps AS (
    SELECT DISTINCT package_id, step_key
    FROM public.job_queue jq
    WHERE jq.status='cancelled'
      AND jq.last_error LIKE '%HOTLOOP_QUARANTINE_CANCELLED%'
      AND jq.updated_at >= now() - interval '5 seconds'
      AND meta->>'step_key' IS NOT NULL
  ),
  upd_steps AS (
    UPDATE public.package_steps ps
    SET status='deferred',
        last_error='HOTLOOP_QUARANTINE_AUTODEFER',
        updated_at = now()
    FROM cand_steps c
    WHERE ps.package_id = c.package_id
      AND ps.step_key = c.step_key
      AND ps.status NOT IN ('done','skipped','deferred')
    RETURNING ps.package_id, ps.step_key
  )
  SELECT count(*) INTO v_step_defer_count FROM upd_steps;

  INSERT INTO public.admin_actions(action, payload, performed_by)
  VALUES ('admin_quarantine_hotloop_jobs:execute',
          jsonb_build_object('threshold',p_attempt_threshold,
                             'job_types',p_job_types,
                             'cancelled',v_cancel_count,
                             'steps_deferred',v_step_defer_count,
                             'by_type',v_by_type,
                             'candidates',v_candidates),
          v_uid);

  RETURN jsonb_build_object(
    'ok', true, 'dry_run', false,
    'cancelled', v_cancel_count,
    'steps_deferred', v_step_defer_count,
    'by_type', v_by_type
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_quarantine_hotloop_jobs(integer, boolean, text[]) TO authenticated;

-- =========================================================================
-- 3) admin_get_queue_throughput_v2 (mit pending/processing snapshots)
-- =========================================================================

CREATE OR REPLACE FUNCTION public.admin_get_queue_throughput_v2(p_window_hours integer DEFAULT 6)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_window interval;
  v_base jsonb;
  v_pending_p50 numeric;
  v_pending_p95 numeric;
  v_processing_oldest_sec numeric;
BEGIN
  IF v_uid IS NULL OR NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'unauthorized: admin required';
  END IF;

  v_base := public.admin_get_queue_throughput(p_window_hours);
  v_window := make_interval(hours => GREATEST(p_window_hours,1));

  SELECT
    round(percentile_cont(0.5) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now()-created_at)))::numeric,1),
    round(percentile_cont(0.95) WITHIN GROUP (ORDER BY EXTRACT(EPOCH FROM (now()-created_at)))::numeric,1)
  INTO v_pending_p50, v_pending_p95
  FROM public.job_queue
  WHERE status IN ('pending','queued');

  SELECT round(EXTRACT(EPOCH FROM (now()-min(COALESCE(last_heartbeat_at,locked_at,started_at,created_at))))::numeric,1)
  INTO v_processing_oldest_sec
  FROM public.job_queue WHERE status='processing';

  RETURN v_base
    || jsonb_build_object(
      'pending_wait_p50_sec', COALESCE(v_pending_p50,0),
      'pending_wait_p95_sec', COALESCE(v_pending_p95,0),
      'processing_oldest_sec', COALESCE(v_processing_oldest_sec,0)
    );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_queue_throughput_v2(integer) TO authenticated;