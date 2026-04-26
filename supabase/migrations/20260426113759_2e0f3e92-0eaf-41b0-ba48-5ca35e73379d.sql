CREATE OR REPLACE FUNCTION public.claim_pending_jobs_by_types(p_job_types text[], p_limit integer, p_worker_id text, p_worker_pool text DEFAULT 'default'::text)
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- Phantom-Sweep: cancel jobs whose step is already done/skipped
  WITH phantoms AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND jq.job_type LIKE 'package_%'
      AND (jq.payload->>'package_id') IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM public.package_steps ps
        WHERE ps.package_id = (jq.payload->>'package_id')::uuid
          AND ps.step_key = replace(jq.job_type, 'package_', '')
          AND ps.status IN ('done','skipped')
      )
    LIMIT 100
  )
  UPDATE public.job_queue jq
  SET 
    status = 'cancelled',
    completed_at = now(),
    last_error = 'STEP_ALREADY_DONE_PHANTOM: target step already done/skipped',
    last_error_code = 'STEP_ALREADY_DONE_PHANTOM',
    meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
      'cancelled_by', 'claim_phantom_guard',
      'cancelled_at', now()::text
    )
  FROM phantoms p
  WHERE jq.id = p.id;

  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id, jq.job_type,
           (jq.payload->>'package_id')::uuid AS pkg_id
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp
      ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN public.job_type_policies jtp
      ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (
        CASE
          WHEN p_worker_pool IS NOT NULL THEN
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
          ELSE
            COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = 'default'
        END
      )
      AND (
        cp.id IS NULL
        OR cp.status = 'building'
        OR COALESCE(jtp.can_run_when_not_building, false)
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.package_job_quarantine q
        WHERE q.package_id = (jq.payload->>'package_id')::uuid
          AND q.job_type = jq.job_type
          AND q.cleared_at IS NULL
          AND q.blocked_until > now()
      )
      AND NOT (
        jq.job_type LIKE 'package_%'
        AND (jq.payload->>'package_id') IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM public.package_steps ps
          WHERE ps.package_id = (jq.payload->>'package_id')::uuid
            AND ps.step_key = replace(jq.job_type, 'package_', '')
            AND ps.status IN ('done','skipped')
        )
      )
      AND (
        jq.job_type NOT LIKE 'package_%'
        OR (jq.payload->>'package_id') IS NULL
        OR NOT EXISTS (
          SELECT 1
          FROM public.step_dag_edges dag
          JOIN public.package_steps ps
            ON ps.package_id = (jq.payload->>'package_id')::uuid
            AND ps.step_key = dag.depends_on
          WHERE dag.step_key = replace(jq.job_type, 'package_', '')
            AND ps.status NOT IN ('done', 'skipped')
        )
      )
    ORDER BY jq.priority ASC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    LIMIT p_limit * 4
  ),
  fair AS (
    SELECT c.id
    FROM (
      SELECT id, pkg_id,
             row_number() OVER (PARTITION BY pkg_id ORDER BY id) AS rn
      FROM candidates
    ) c
    WHERE c.rn <= 2
    LIMIT p_limit
  )
  UPDATE public.job_queue jq
  SET status = 'processing',
      started_at = COALESCE(jq.started_at, now()),
      locked_at = now(),
      locked_by = p_worker_id,
      attempts = COALESCE(jq.attempts, 0) + 1,
      last_heartbeat_at = now(),
      liveness_status = 'healthy'  -- ✅ FIX: was 'alive' (rejected by check constraint)
  FROM fair f
  WHERE jq.id = f.id
  RETURNING jq.*;
END;
$function$;