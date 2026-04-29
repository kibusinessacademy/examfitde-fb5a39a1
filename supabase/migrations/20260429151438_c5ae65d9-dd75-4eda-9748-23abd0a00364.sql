CREATE OR REPLACE FUNCTION public.admin_reap_stale_processing_now(
  p_max_age_seconds integer DEFAULT 300,
  p_max_cancels integer DEFAULT 50,
  p_lane text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
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

  IF p_lane IS NOT NULL AND p_lane NOT IN ('control','build','recovery') THEN
    RAISE EXCEPTION 'invalid lane: %, must be control|build|recovery', p_lane;
  END IF;

  PERFORM set_config('app.transition_source',
    'admin_ui:reap_stale_now:' || COALESCE(p_lane,'all') || ':' || COALESCE(v_uid::text,'?'), true);

  WITH stale AS (
    SELECT id, job_type, package_id, attempts, max_attempts
    FROM public.job_queue
    WHERE status = 'processing'
      AND COALESCE(last_heartbeat_at, locked_at, started_at) < v_cutoff
      AND (p_lane IS NULL OR lane = p_lane)
    ORDER BY COALESCE(last_heartbeat_at, locked_at, started_at) ASC
    LIMIT GREATEST(p_max_cancels, 1)
  ),
  upd AS (
    UPDATE public.job_queue jq
    SET
      status = CASE WHEN jq.attempts >= jq.max_attempts THEN 'failed' ELSE 'pending' END,
      run_after = CASE
        WHEN jq.attempts >= jq.max_attempts THEN jq.run_after
        ELSE now() + interval '60 seconds'
      END,
      locked_at = NULL,
      locked_by = NULL,
      started_at = CASE
        WHEN jq.attempts >= jq.max_attempts THEN jq.started_at ELSE NULL
      END,
      last_error = CASE
        WHEN jq.attempts >= jq.max_attempts
          THEN COALESCE(jq.last_error,'') || ' | STALE_PROCESSING_EXHAUSTED (admin_reap_now' ||
               COALESCE(':lane=' || p_lane, '') || ')'
        ELSE COALESCE(jq.last_error,'') || ' | STALE_PROCESSING_REAPED (admin_reap_now' ||
             COALESCE(':lane=' || p_lane, '') || ')'
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

  INSERT INTO public.admin_actions(action, payload, user_id)
  VALUES ('admin_reap_stale_processing_now',
          jsonb_build_object('cutoff_seconds',p_max_age_seconds,
                             'max_cancels',p_max_cancels,
                             'lane', p_lane,
                             'requeued',v_requeued,
                             'failed_terminal',v_failed,
                             'jobs',v_jobs),
          v_uid);

  RETURN jsonb_build_object(
    'ok', true,
    'lane', p_lane,
    'requeued', v_requeued,
    'failed_terminal', v_failed,
    'cutoff_seconds', p_max_age_seconds
  );
END;
$function$;