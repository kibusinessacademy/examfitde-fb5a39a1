-- Phase 1: SSOT Drain RPC for stuck EMPTY_RESULT growth jobs
CREATE OR REPLACE FUNCTION public.fn_drain_stuck_empty_result_growth_jobs(
  p_threshold int DEFAULT 5,
  p_limit int DEFAULT 25,
  p_trigger_source text DEFAULT 'manual'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_drained int := 0;
  v_candidates int := 0;
  v_by_type jsonb := '{}'::jsonb;
  v_by_pkg jsonb := '{}'::jsonb;
  v_drained_ids uuid[] := ARRAY[]::uuid[];
  v_t text; v_n int;
  v_pkg uuid;
BEGIN
  -- Allow: cron/service-role (auth.uid() IS NULL) OR admin
  IF v_uid IS NOT NULL AND NOT public.has_role(v_uid, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  IF p_threshold < 1 THEN p_threshold := 1; END IF;
  IF p_limit < 1 OR p_limit > 500 THEN p_limit := 25; END IF;

  -- Count candidates (visibility, not throttled)
  SELECT COUNT(*) INTO v_candidates
  FROM public.job_queue
  WHERE status = 'pending'
    AND job_type IN ('seo_internal_links','seo_sitemap_refresh','seo_indexnow_submit')
    AND attempts >= p_threshold
    AND last_error LIKE 'EMPTY_RESULT%';

  -- Drain (limit-capped). Transition pending -> failed is allowed by terminal-status guard.
  WITH drained AS (
    UPDATE public.job_queue jq
    SET status = 'failed',
        last_error_code = 'DLQ_EMPTY_RESULT_LOOP',
        last_error = format('DLQ_EMPTY_RESULT_LOOP attempts=%s prev=%s',
                            jq.attempts, COALESCE(jq.last_error,'')),
        completed_at = now(),
        updated_at = now()
    WHERE jq.id IN (
      SELECT id FROM public.job_queue
      WHERE status = 'pending'
        AND job_type IN ('seo_internal_links','seo_sitemap_refresh','seo_indexnow_submit')
        AND attempts >= p_threshold
        AND last_error LIKE 'EMPTY_RESULT%'
      ORDER BY attempts DESC, updated_at ASC
      LIMIT p_limit
    )
    RETURNING jq.id, jq.job_type, jq.package_id
  )
  SELECT
    COUNT(*)::int,
    array_agg(id),
    COALESCE(jsonb_object_agg(job_type, n) FILTER (WHERE n IS NOT NULL), '{}'::jsonb)
  INTO v_drained, v_drained_ids, v_by_type
  FROM (
    SELECT id, job_type, package_id,
           COUNT(*) OVER (PARTITION BY job_type) AS n
    FROM drained
  ) s;

  -- Audit (always — even noop — for observability)
  INSERT INTO public.auto_heal_log(
    action_type, trigger_source, target_type, result_status, result_detail, metadata
  ) VALUES (
    'growth_empty_result_drain',
    p_trigger_source,
    'job_queue',
    CASE WHEN v_drained > 0 THEN 'completed' ELSE 'noop' END,
    format('drained=%s candidates=%s threshold=%s limit=%s',
           v_drained, v_candidates, p_threshold, p_limit),
    jsonb_build_object(
      'drained', v_drained,
      'candidates', v_candidates,
      'threshold', p_threshold,
      'limit', p_limit,
      'by_type', v_by_type,
      'drained_job_ids', COALESCE(v_drained_ids, ARRAY[]::uuid[]),
      'actor_uid', v_uid
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'drained', v_drained,
    'candidates', v_candidates,
    'threshold', p_threshold,
    'limit', p_limit,
    'by_type', v_by_type,
    'drained_job_ids', COALESCE(v_drained_ids, ARRAY[]::uuid[])
  );
END $function$;

-- Lock down: service_role only (cron uses postgres/SECURITY DEFINER bypass, admin via has_role)
REVOKE ALL ON FUNCTION public.fn_drain_stuck_empty_result_growth_jobs(int,int,text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_drain_stuck_empty_result_growth_jobs(int,int,text) TO service_role;

-- Schedule cron every 15 minutes
DO $$
BEGIN
  PERFORM cron.unschedule('growth-empty-result-drain-15min');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'growth-empty-result-drain-15min',
  '*/15 * * * *',
  $cron$ SELECT public.fn_drain_stuck_empty_result_growth_jobs(5, 25, 'cron:growth-empty-result-drain-15min'); $cron$
);

-- Immediate one-shot drain through the same SSOT path
SELECT public.fn_drain_stuck_empty_result_growth_jobs(5, 25, 'migration:phase1_initial_drain');