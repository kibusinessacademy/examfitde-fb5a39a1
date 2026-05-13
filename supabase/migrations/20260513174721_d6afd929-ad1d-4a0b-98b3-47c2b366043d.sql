-- Bug B: STEP_ALREADY_DONE_PHANTOM LF-aware bypass for repair-origin children
-- Allows claim_phantom_guard to NOT cancel jobs when:
--   _origin IN (repair_lf_coverage, fanout_blueprint_variants, ensure_variant_inventory)
--   AND payload.learning_field_filter IS NOT NULL
-- Logs bypass to auto_heal_log as 'phantom_guard_lf_repair_bypass'.
-- Out of scope: parent parked_awaiting_children (Bug C), repair-origin-aware atomic enqueue.

CREATE OR REPLACE FUNCTION public.claim_pending_jobs_by_types(
  p_job_types text[],
  p_limit integer,
  p_worker_id text,
  p_worker_pool text DEFAULT 'default'::text
)
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bypass_count int := 0;
BEGIN
  -- LF-aware repair bypass: log + skip phantom-cancel for LF-scoped repair children
  WITH lf_bypass AS (
    SELECT jq.id, jq.job_type,
           (jq.payload->>'package_id')::uuid AS package_id,
           jq.payload->>'_origin' AS origin,
           jq.payload->>'learning_field_filter' AS lf,
           jq.payload->>'gap_class' AS gap_class
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND jq.job_type LIKE 'package_%'
      AND (jq.payload->>'package_id') IS NOT NULL
      AND (jq.payload->>'learning_field_filter') IS NOT NULL
      AND COALESCE(jq.payload->>'_origin','') IN (
        'repair_lf_coverage',
        'fanout_blueprint_variants',
        'ensure_variant_inventory'
      )
      AND EXISTS (
        SELECT 1 FROM public.package_steps ps
        WHERE ps.package_id = (jq.payload->>'package_id')::uuid
          AND ps.step_key = regexp_replace(jq.job_type, '^package_', '')
          AND ps.status IN ('done','skipped')
      )
    LIMIT 200
  ),
  bypass_audit AS (
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata, created_at)
    SELECT
      'phantom_guard_lf_repair_bypass',
      'job',
      lb.id::text,
      'bypassed',
      jsonb_build_object(
        'job_type', lb.job_type,
        'package_id', lb.package_id,
        'origin', lb.origin,
        'learning_field_filter', lb.lf,
        'gap_class', lb.gap_class,
        'reason', 'LF-scoped repair child — phantom guard suppressed'
      ),
      now()
    FROM lf_bypass lb
    RETURNING 1
  )
  SELECT count(*) INTO v_bypass_count FROM bypass_audit;

  -- Standard phantom-cancel pass, with LF-bypass excluded
  WITH phantoms AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND jq.job_type LIKE 'package_%'
      AND (jq.payload->>'package_id') IS NOT NULL
      AND COALESCE(jq.payload->>'_origin','') NOT IN (
        'competency_coverage_repair',
        'targeted_fill_blueprint_recovery',
        'bronze_targeted_repair',
        'repair_lf_coverage',
        'enqueue_lf_coverage_repair'
      )
      AND COALESCE(jq.payload->>'mode','') NOT IN (
        'targeted_competency_fill',
        'targeted_blueprint_fill',
        'bronze_targeted_repair',
        'targeted_lf_fill'
      )
      AND COALESCE(jq.payload->>'enqueue_source','') NOT IN (
        'competency_coverage_repair',
        'targeted_fill_blueprint_recovery',
        'bronze_targeted_repair',
        'repair_lf_coverage',
        'enqueue_lf_coverage_repair'
      )
      AND COALESCE(jq.meta->>'enqueue_source','') NOT IN (
        'bronze_targeted_repair',
        'repair_lf_coverage'
      )
      -- Bug B: LF-scoped repair bypass
      AND NOT (
        (jq.payload->>'learning_field_filter') IS NOT NULL
        AND COALESCE(jq.payload->>'_origin','') IN (
          'repair_lf_coverage',
          'fanout_blueprint_variants',
          'ensure_variant_inventory'
        )
      )
      AND EXISTS (
        SELECT 1 FROM public.package_steps ps
        WHERE ps.package_id = (jq.payload->>'package_id')::uuid
          AND ps.step_key = regexp_replace(jq.job_type, '^package_', '')
          AND ps.status IN ('done','skipped')
      )
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq2
        WHERE jq2.package_id = (jq.payload->>'package_id')::uuid
          AND jq2.job_type IN ('package_validate_exam_pool','package_auto_publish')
          AND jq2.status = 'processing'
      )
    LIMIT 100
  )
  UPDATE public.job_queue jq
  SET status = 'cancelled', completed_at = now(),
      last_error = 'STEP_ALREADY_DONE_PHANTOM: target step already done/skipped',
      last_error_code = 'STEP_ALREADY_DONE_PHANTOM',
      meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
        'cancelled_by','claim_phantom_guard','cancelled_at', now()::text)
  FROM phantoms p
  WHERE jq.id = p.id;

  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id, jq.job_type, (jq.payload->>'package_id')::uuid AS pkg_id
    FROM public.job_queue jq
    LEFT JOIN public.course_packages cp ON cp.id = (jq.payload->>'package_id')::uuid
    LEFT JOIN public.job_type_policies jtp ON jtp.job_type = jq.job_type
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (
        CASE WHEN p_worker_pool IS NOT NULL THEN
             COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = p_worker_pool
        ELSE COALESCE(jq.worker_pool, COALESCE(jtp.worker_pool, 'default')) = 'default'
        END
      )
      AND (cp.id IS NULL OR cp.status = 'building' OR COALESCE(jtp.can_run_when_not_building, false))
      AND NOT EXISTS (
        SELECT 1 FROM public.package_job_quarantine q
        WHERE q.package_id = (jq.payload->>'package_id')::uuid
          AND q.job_type = jq.job_type AND q.cleared_at IS NULL AND q.blocked_until > now()
      )
    ORDER BY jq.priority ASC NULLS LAST, jq.created_at ASC
    FOR UPDATE OF jq SKIP LOCKED
    LIMIT p_limit * 4
  )
  UPDATE public.job_queue q
  SET status='processing', locked_at=now(), locked_by=p_worker_id,
      started_at=now(), attempts=COALESCE(q.attempts,0)+1, updated_at=now(),
      liveness_status='healthy'
  FROM candidates c
  WHERE q.id = c.id
  RETURNING q.*;
END;
$function$;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata, created_at)
VALUES ('bug_b_phantom_guard_lf_bypass_installed', 'system', 'ok',
        jsonb_build_object('origins', jsonb_build_array('repair_lf_coverage','fanout_blueprint_variants','ensure_variant_inventory'),
                           'requires', 'learning_field_filter IS NOT NULL'),
        now());