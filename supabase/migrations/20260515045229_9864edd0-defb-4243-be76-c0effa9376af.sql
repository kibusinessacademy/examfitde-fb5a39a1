
-- =====================================================================
-- Variant-Approval-Bridge v1
-- Resolves AWAITING_APPROVAL: re-runs package_validate_blueprint_variants
-- against fresh review-state material WITHOUT reopening package_steps.
-- =====================================================================

-- 1) Phantom-filter whitelist: extend claim_pending_jobs_by_types
--    Add 'variant_approval_bridge' to both NOT IN clauses (origin + enqueue_source).
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_by_types(p_job_types text[], p_limit integer, p_worker_id text, p_worker_pool text DEFAULT 'default'::text)
 RETURNS SETOF job_queue
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_bypass_count int := 0;
BEGIN
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
        'repair_lf_coverage','fanout_blueprint_variants','ensure_variant_inventory'
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

  WITH phantoms AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND jq.job_type LIKE 'package_%'
      AND (jq.payload->>'package_id') IS NOT NULL
      -- WHITELIST: origins that are legitimate re-runs against done steps
      AND COALESCE(jq.payload->>'_origin','') NOT IN (
        'competency_coverage_repair',
        'targeted_fill_blueprint_recovery',
        'bronze_targeted_repair',
        'repair_lf_coverage',
        'enqueue_lf_coverage_repair',
        'variant_approval_bridge'           -- NEW
      )
      AND COALESCE(jq.payload->>'mode','') NOT IN (
        'targeted_competency_fill','targeted_blueprint_fill','bronze_targeted_repair','targeted_lf_fill'
      )
      AND COALESCE(jq.payload->>'enqueue_source','') NOT IN (
        'competency_coverage_repair','targeted_fill_blueprint_recovery','bronze_targeted_repair',
        'repair_lf_coverage','enqueue_lf_coverage_repair',
        'variant_approval_bridge'           -- NEW
      )
      AND COALESCE(jq.meta->>'enqueue_source','') NOT IN (
        'bronze_targeted_repair','repair_lf_coverage',
        'variant_approval_bridge'           -- NEW
      )
      AND NOT (
        (jq.payload->>'learning_field_filter') IS NOT NULL
        AND COALESCE(jq.payload->>'_origin','') IN (
          'repair_lf_coverage','fanout_blueprint_variants','ensure_variant_inventory'
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
  SET status='processing', started_at=now(), worker_id=p_worker_id, last_heartbeat_at=now(),
      attempts = COALESCE(jq.attempts,0)+1
  FROM candidates c WHERE jq.id=c.id
  RETURNING jq.*;
END;
$function$;

-- 2) Per-package dispatcher
CREATE OR REPLACE FUNCTION public.admin_dispatch_variant_approval_bridge(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_lf_count int := 0;
  v_review_total int := 0;
  v_idem text;
  v_existing_job uuid;
  v_new_job uuid;
  v_pkg_status text;
BEGIN
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT status INTO v_pkg_status FROM course_packages WHERE id = p_package_id;
  IF v_pkg_status IS NULL THEN
    RETURN jsonb_build_object('skipped',true,'reason','package_not_found');
  END IF;

  SELECT count(*), COALESCE(sum(review_variant_count),0)
  INTO v_lf_count, v_review_total
  FROM v_exam_pool_lf_repair_gap_classification
  WHERE package_id = p_package_id
    AND variant_pipeline_state = 'AWAITING_APPROVAL';

  IF v_lf_count = 0 THEN
    RETURN jsonb_build_object('skipped',true,'reason','no_awaiting_approval_lfs','package_id',p_package_id);
  END IF;

  -- Active-job dedup
  SELECT id INTO v_existing_job
  FROM job_queue
  WHERE job_type = 'package_validate_blueprint_variants'
    AND (payload->>'package_id')::uuid = p_package_id
    AND status IN ('pending','processing')
  LIMIT 1;
  IF v_existing_job IS NOT NULL THEN
    RETURN jsonb_build_object('skipped',true,'reason','active_job_exists','existing_job_id',v_existing_job);
  END IF;

  v_idem := 'var_appr_bridge:' || p_package_id::text || ':' || to_char(now(),'YYYYMMDDHH24');

  IF EXISTS (SELECT 1 FROM job_queue WHERE idempotency_key = v_idem) THEN
    RETURN jsonb_build_object('skipped',true,'reason','idempotency_hit','idempotency_key',v_idem);
  END IF;

  INSERT INTO job_queue (job_type, status, priority, run_after, payload, meta, idempotency_key, package_id, worker_pool, job_name)
  VALUES (
    'package_validate_blueprint_variants','pending',7,now(),
    jsonb_build_object(
      'package_id', p_package_id,
      '_origin','variant_approval_bridge',
      'enqueue_source','variant_approval_bridge',
      'awaiting_approval_lf_count', v_lf_count,
      'review_variant_total', v_review_total
    ),
    jsonb_build_object('enqueue_source','variant_approval_bridge'),
    v_idem, p_package_id, 'core',
    'validate_variants_approval_bridge'
  ) RETURNING id INTO v_new_job;

  INSERT INTO auto_heal_log(trigger_source, action_type, target_id, target_type, result_status, metadata)
  VALUES ('admin_rpc','variant_approval_bridge_enqueued', p_package_id::text, 'course_package','enqueued',
    jsonb_build_object('package_id',p_package_id,'job_id',v_new_job,'idempotency_key',v_idem,
      'awaiting_approval_lf_count',v_lf_count,'review_variant_total',v_review_total));

  RETURN jsonb_build_object('enqueued',true,'job_id',v_new_job,'lf_count',v_lf_count,'review_total',v_review_total);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_dispatch_variant_approval_bridge(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_dispatch_variant_approval_bridge(uuid) TO authenticated, service_role;

-- 3) Bulk auto-dispatcher (WIP-cap 5 packages/run)
CREATE OR REPLACE FUNCTION public.fn_auto_dispatch_variant_approval_bridge()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkg uuid;
  v_dispatched int := 0;
  v_skipped int := 0;
  v_results jsonb := '[]'::jsonb;
  v_res jsonb;
  v_wip_cap int := 5;
BEGIN
  FOR v_pkg IN
    SELECT DISTINCT package_id
    FROM v_exam_pool_lf_repair_gap_classification
    WHERE variant_pipeline_state = 'AWAITING_APPROVAL'
      AND review_variant_count > 0
    ORDER BY package_id
    LIMIT v_wip_cap
  LOOP
    v_res := public.admin_dispatch_variant_approval_bridge(v_pkg);
    v_results := v_results || jsonb_build_array(jsonb_build_object('package_id',v_pkg,'result',v_res));
    IF (v_res->>'enqueued')::bool IS TRUE THEN v_dispatched := v_dispatched + 1;
    ELSE v_skipped := v_skipped + 1; END IF;
  END LOOP;

  INSERT INTO auto_heal_log(trigger_source, action_type, target_id, target_type, result_status, metadata)
  VALUES ('cron','variant_approval_bridge_bulk_run','system','system',
    CASE WHEN v_dispatched > 0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object('dispatched',v_dispatched,'skipped',v_skipped,'wip_cap',v_wip_cap,'results',v_results));

  RETURN jsonb_build_object('dispatched',v_dispatched,'skipped',v_skipped,'results',v_results);
END;
$$;

REVOKE ALL ON FUNCTION public.fn_auto_dispatch_variant_approval_bridge() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.fn_auto_dispatch_variant_approval_bridge() TO service_role;

-- 4) Cron: every 30 minutes
SELECT cron.schedule(
  'variant-approval-bridge-30min',
  '*/30 * * * *',
  $$ SELECT public.fn_auto_dispatch_variant_approval_bridge(); $$
);
