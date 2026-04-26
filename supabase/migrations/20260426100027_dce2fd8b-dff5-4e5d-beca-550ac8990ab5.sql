-- =========================================================
-- A) PHANTOM-CANCEL: 3 stuck package_generate_exam_pool jobs
--    where step is already done (Finanzanlagenvermittler)
-- =========================================================
UPDATE public.job_queue jq
SET 
  status = 'cancelled',
  completed_at = now(),
  last_error = 'STEP_ALREADY_DONE_PHANTOM: generate_exam_pool already done — auto-cancelled by phantom guard',
  last_error_code = 'STEP_ALREADY_DONE_PHANTOM',
  meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
    'cancelled_by', 'phantom_guard_migration',
    'cancelled_at', now()::text,
    'cancel_reason', 'step_already_done'
  )
WHERE jq.status = 'pending'
  AND jq.job_type LIKE 'package_%'
  AND jq.payload ? 'package_id'
  AND EXISTS (
    SELECT 1 FROM public.package_steps ps
    WHERE ps.package_id = (jq.payload->>'package_id')::uuid
      AND ps.step_key = replace(jq.job_type, 'package_', '')
      AND ps.status IN ('done','skipped')
  );

-- =========================================================
-- C) PHANTOM-GUARD im Claim-RPC: Jobs mit Step bereits done
--    werden vor dem Claim direkt cancelled (CTE-Bypass).
-- =========================================================
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_by_types(
  p_job_types text[],
  p_limit integer,
  p_worker_id text,
  p_worker_pool text DEFAULT 'default'::text
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Phantom-Sweep: cancel jobs whose step is already done/skipped
  -- (idempotent, runs at most once per claim cycle, scoped to requested job types)
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
    LIMIT 100  -- per-cycle sweep cap
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
      -- Hot-Loop Quarantäne-Filter
      AND NOT EXISTS (
        SELECT 1 FROM public.package_job_quarantine q
        WHERE q.package_id = (jq.payload->>'package_id')::uuid
          AND q.job_type = jq.job_type
          AND q.cleared_at IS NULL
          AND q.blocked_until > now()
      )
      -- Phantom-Guard inline (defense-in-depth)
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
      -- DAG predecessor check
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
    WHERE c.rn <= 2  -- per-package fair-share
    LIMIT p_limit
  )
  UPDATE public.job_queue jq
  SET status = 'processing',
      started_at = COALESCE(jq.started_at, now()),
      locked_at = now(),
      locked_by = p_worker_id,
      attempts = COALESCE(jq.attempts, 0) + 1,
      last_heartbeat_at = now(),
      liveness_status = 'alive'
  FROM fair f
  WHERE jq.id = f.id
  RETURNING jq.*;
END;
$function$;

-- =========================================================
-- D) AUTO-PUBLISH DAG ENTLASTEN: Heal failed quality_councils
-- =========================================================
CREATE OR REPLACE FUNCTION public.admin_heal_failed_quality_councils()
RETURNS TABLE(
  package_id uuid,
  package_title text,
  action text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_pkg RECORD;
BEGIN
  FOR v_pkg IN
    SELECT cp.id, cp.title
    FROM public.course_packages cp
    JOIN public.package_steps ps ON ps.package_id = cp.id
    WHERE ps.step_key = 'quality_council'
      AND ps.status = 'failed'
      AND cp.status = 'building'
      AND EXISTS (
        SELECT 1 FROM public.package_steps ps_pre
        WHERE ps_pre.package_id = cp.id
          AND ps_pre.step_key = 'run_integrity_check'
          AND ps_pre.status IN ('done','skipped')
      )
  LOOP
    UPDATE public.package_steps ps
    SET status = 'queued',
        meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
          'allow_regression', true,
          'allow_regression_by', 'admin_heal_failed_quality_council',
          'reset_reason', 'auto_heal_failed_council_unblock_publish',
          'reset_at', now()::text
        )
    WHERE ps.package_id = v_pkg.id
      AND ps.step_key = 'quality_council';

    package_id := v_pkg.id;
    package_title := v_pkg.title;
    action := 'reset_quality_council_to_queued';
    RETURN NEXT;
  END LOOP;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_heal_failed_quality_councils() TO service_role;

-- Run it now to unstick the 3 currently-stuck packages
SELECT * FROM public.admin_heal_failed_quality_councils();