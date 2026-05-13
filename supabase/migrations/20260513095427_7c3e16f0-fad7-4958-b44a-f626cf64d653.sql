
-- ═══════════════════════════════════════════════════════════════════════════
-- Bucket F: Repair-Wirksamkeit Gap (Phantom-Guard Whitelist) +
-- Bucket E.2: Edge-Switch NEEDS_REPAIR Handling (Snapshot-Helper Key-Compat)
-- ═══════════════════════════════════════════════════════════════════════════
-- Root Cause Bucket F:
--   admin_dispatch_exam_pool_repair → package_repair_exam_pool_lf_coverage
--   → Edge fan-out package_generate_exam_pool mit _origin='repair_lf_coverage'
--   → claim_pending_jobs_by_types cancelt mit STEP_ALREADY_DONE_PHANTOM,
--     weil 'repair_lf_coverage' (und 'enqueue_lf_coverage_repair') nicht in
--     der Phantom-Whitelist stehen.
--
-- Fix:
--   1. Whitelist erweitern um 'repair_lf_coverage' + 'enqueue_lf_coverage_repair'
--   2. Snapshot-Helper akzeptiert metrics-Keys aus fn_classify_exam_pool_gate
--      (approved | coverage_eligible | total_lfs | covered_lfs)
--      ODER alte Keys (approved_count | total_competencies | ...)
--      → Backward-compat ohne Snapshot-Drift bei korrekter Befüllung.

-- (1) Phantom-Guard Whitelist erweitern
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_by_types(
  p_job_types text[], p_limit integer, p_worker_id text, p_worker_pool text DEFAULT 'default'::text
) RETURNS SETOF job_queue
  LANGUAGE plpgsql SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
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

COMMENT ON FUNCTION public.claim_pending_jobs_by_types(text[], integer, text, text) IS
'Phantom-Guard Whitelist erweitert um repair_lf_coverage + enqueue_lf_coverage_repair (Bucket F: Targeted LF Fan-out aus package-repair-exam-pool-lf-coverage).';

-- (2) Snapshot-Helper: Key-Compat für gate-emitted metrics
CREATE OR REPLACE FUNCTION public.fn_record_exam_pool_validation_snapshot(
  p_package_id uuid, p_curriculum_id uuid, p_job_id uuid,
  p_gate_class text, p_reason_code text, p_metrics jsonb
) RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_snapshot_id uuid;
  v_total_lfs   int := COALESCE((p_metrics->>'total_lfs')::int, 0);
  v_covered_lfs int := COALESCE((p_metrics->>'covered_lfs')::int, 0);
  v_total_comp  int := COALESCE((p_metrics->>'total_competencies')::int, 0);
  v_covered_comp int := COALESCE((p_metrics->>'covered_competencies')::int, 0);
  v_repair_24h  int := COALESCE((p_metrics->>'repair_attempts_24h')::int, 0);
  v_approved    int := COALESCE((p_metrics->>'approved_count')::int,
                                (p_metrics->>'approved')::int,
                                (p_metrics->>'coverage_eligible')::int, 0);
  v_review      int := COALESCE((p_metrics->>'review_count')::int,
                                (p_metrics->>'review')::int, 0);
  v_draft       int := COALESCE((p_metrics->>'draft_count')::int,
                                (p_metrics->>'draft')::int, 0);
  v_rejected    int := COALESCE((p_metrics->>'rejected_count')::int,
                                (p_metrics->>'rejected')::int, 0);
  v_unresolved  int := COALESCE((p_metrics->>'unresolved_quality_flags')::int, 0);
  v_guard_state text;
BEGIN
  IF p_package_id IS NULL THEN
    RAISE EXCEPTION 'fn_record_exam_pool_validation_snapshot: p_package_id is required';
  END IF;

  v_guard_state := CASE
    WHEN p_gate_class = 'PASS' THEN 'healthy'
    WHEN p_gate_class IN ('WAITING_FOR_MATERIALIZATION','WAITING_GENERATION','WAITING_QC') THEN 'recovering'
    WHEN p_gate_class IN ('REPAIRABLE','NEEDS_REPAIR','NEEDS_GENERATION') THEN 'soft_stalled'
    WHEN p_gate_class = 'HARD_FAIL' THEN 'hard_stalled'
    WHEN p_gate_class IN ('ERROR','NO_QUESTIONS','T1_FAIL') THEN 'recovering'
    ELSE 'healthy'
  END;

  INSERT INTO public.exam_pool_validation_snapshots (
    package_id, curriculum_id, job_id,
    approved_count, review_count, draft_count, rejected_count,
    unresolved_quality_flags,
    missing_lf_coverage, missing_competency_coverage,
    missing_trap_metadata, missing_bloom_metadata,
    repairable_issue_count,
    guard_state, reason_code, gate_class, repair_attempts_24h
  ) VALUES (
    p_package_id, p_curriculum_id, p_job_id,
    v_approved, v_review, v_draft, v_rejected, v_unresolved,
    GREATEST(v_total_lfs - v_covered_lfs, 0),
    GREATEST(v_total_comp - v_covered_comp, 0),
    COALESCE((p_metrics->>'missing_trap_metadata')::int, 0),
    COALESCE((p_metrics->>'missing_bloom_metadata')::int, 0),
    COALESCE((p_metrics->>'repairable_issue_count')::int, 0),
    v_guard_state, p_reason_code, p_gate_class, v_repair_24h
  )
  RETURNING id INTO v_snapshot_id;

  BEGIN
    INSERT INTO public.auto_heal_log (
      action_type, target_type, target_id, result_status, metadata
    ) VALUES (
      'exam_pool_snapshot_recorded', 'package', p_package_id, 'success',
      jsonb_build_object(
        'snapshot_id', v_snapshot_id,
        'gate_class', p_gate_class,
        'reason_code', p_reason_code,
        'job_id', p_job_id,
        'guard_state', v_guard_state
      )
    );
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  RETURN v_snapshot_id;
END;
$function$;
