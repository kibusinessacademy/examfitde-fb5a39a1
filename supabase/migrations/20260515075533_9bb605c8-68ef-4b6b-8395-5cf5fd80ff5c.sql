-- Hotfix: claim_pending_jobs_by_types references non-existent column worker_id.
-- Replace with locked_by/locked_at (current schema, used by claim_pending_jobs_v5).
-- Drop & recreate to keep return-type stable.

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
  -- LF-bypass audit (unchanged)
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
        'repair_lf_coverage','fanout_blueprint_variants','ensure_variant_inventory',
        'question_gap_bridge'
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
    SELECT 'phantom_guard_lf_repair_bypass','job',lb.id::text,'bypassed',
      jsonb_build_object('job_type',lb.job_type,'package_id',lb.package_id,'origin',lb.origin,
        'learning_field_filter',lb.lf,'gap_class',lb.gap_class,
        'reason','LF-scoped repair child — phantom guard suppressed'),
      now()
    FROM lf_bypass lb RETURNING 1
  )
  SELECT count(*) INTO v_bypass_count FROM bypass_audit;

  -- Phantom cancel (unchanged predicates; no schema-drift columns referenced)
  WITH phantoms AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND jq.job_type LIKE 'package_%'
      AND (jq.payload->>'package_id') IS NOT NULL
      AND COALESCE(jq.payload->>'_origin','') NOT IN (
        'competency_coverage_repair','targeted_fill_blueprint_recovery','bronze_targeted_repair',
        'repair_lf_coverage','enqueue_lf_coverage_repair','variant_approval_bridge',
        'question_gap_bridge'
      )
      AND COALESCE(jq.payload->>'mode','') NOT IN (
        'targeted_competency_fill','targeted_blueprint_fill','bronze_targeted_repair',
        'targeted_lf_fill','targeted_question_fill'
      )
      AND COALESCE(jq.payload->>'enqueue_source','') NOT IN (
        'competency_coverage_repair','targeted_fill_blueprint_recovery','bronze_targeted_repair',
        'repair_lf_coverage','enqueue_lf_coverage_repair','variant_approval_bridge',
        'question_gap_bridge'
      )
      AND COALESCE(jq.meta->>'enqueue_source','') NOT IN (
        'bronze_targeted_repair','repair_lf_coverage','variant_approval_bridge','question_gap_bridge'
      )
      AND NOT (
        (jq.payload->>'learning_field_filter') IS NOT NULL
        AND COALESCE(jq.payload->>'_origin','') IN (
          'repair_lf_coverage','fanout_blueprint_variants','ensure_variant_inventory',
          'question_gap_bridge'
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
  SET status='cancelled', completed_at=now(),
      last_error='STEP_ALREADY_DONE_PHANTOM: target step already done/skipped',
      last_error_code='STEP_ALREADY_DONE_PHANTOM',
      meta = COALESCE(jq.meta,'{}'::jsonb) || jsonb_build_object('cancelled_by','claim_phantom_guard','cancelled_at',now()::text)
  FROM phantoms p WHERE jq.id = p.id;

  -- ── HOTFIX: locked_by/locked_at instead of non-existent worker_id ──
  RETURN QUERY
  WITH candidates AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status='pending' AND jq.job_type = ANY(p_job_types)
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (jq.worker_pool = p_worker_pool OR p_worker_pool='default')
    ORDER BY COALESCE(jq.priority,5) DESC, jq.created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.job_queue jq
  SET status='processing',
      started_at=now(),
      locked_by=p_worker_id,           -- was: worker_id (column missing)
      locked_at=now(),                  -- was: worker_id only
      last_heartbeat_at=now(),
      updated_at=now(),
      attempts = COALESCE(jq.attempts,0)+1
  FROM candidates c WHERE jq.id=c.id
  RETURNING jq.*;
END;
$function$;

-- Audit
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, result_detail, metadata)
VALUES (
  'worker_claim_schema_drift_hotfix','system','success',
  'claim_pending_jobs_by_types: replaced worker_id with locked_by/locked_at to match current schema',
  jsonb_build_object(
    'function','claim_pending_jobs_by_types',
    'symptom','column "worker_id" of relation "job_queue" does not exist',
    'detected_in','job-runner edge-fn logs (control + recovery lanes, every minute)',
    'pending_at_fix', (SELECT count(*) FROM public.job_queue WHERE lane='control' AND status='pending'),
    'baseline_throughput','~8 jobs / 5min (auto-recovery-pulse only)',
    'expected_throughput','25 jobs / minute (job-runner restored)'
  )
);