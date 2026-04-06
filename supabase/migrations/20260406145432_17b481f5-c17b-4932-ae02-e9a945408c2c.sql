
-- ═══════════════════════════════════════════════════════════════
-- FIX 1: True Idempotency Guard in fn_reconcile_orphan_steps
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_reconcile_orphan_steps()
RETURNS jsonb
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_reconciled int := 0;
  v_details jsonb[] := ARRAY[]::jsonb[];
  rec record;
  v_job_type text;
  v_pool text;
  v_step_jobs jsonb := '{
    "scaffold_learning_course": "package_scaffold_learning_course",
    "generate_glossary": "package_generate_glossary",
    "fanout_learning_content": "package_fanout_learning_content",
    "generate_learning_content": "package_generate_learning_content",
    "finalize_learning_content": "package_finalize_learning_content",
    "validate_learning_content": "package_validate_learning_content",
    "auto_seed_exam_blueprints": "package_auto_seed_exam_blueprints",
    "validate_blueprints": "package_validate_blueprints",
    "generate_blueprint_variants": "package_generate_blueprint_variants",
    "validate_blueprint_variants": "package_validate_blueprint_variants",
    "promote_blueprint_variants": "package_promote_blueprint_variants",
    "generate_exam_pool": "package_generate_exam_pool",
    "validate_exam_pool": "package_validate_exam_pool",
    "repair_exam_pool_quality": "package_repair_exam_pool_quality",
    "build_ai_tutor_index": "package_build_ai_tutor_index",
    "validate_tutor_index": "package_validate_tutor_index",
    "generate_oral_exam": "package_generate_oral_exam",
    "validate_oral_exam": "package_validate_oral_exam",
    "generate_lesson_minichecks": "package_generate_lesson_minichecks",
    "validate_lesson_minichecks": "package_validate_lesson_minichecks",
    "generate_handbook": "package_generate_handbook",
    "validate_handbook": "package_validate_handbook",
    "enqueue_handbook_expand": "package_enqueue_handbook_expand",
    "expand_handbook": "handbook_expand_section",
    "validate_handbook_depth": "package_validate_handbook_depth",
    "elite_harden": "package_elite_harden",
    "run_integrity_check": "package_run_integrity_check",
    "quality_council": "package_quality_council",
    "auto_publish": "package_auto_publish"
  }'::jsonb;
BEGIN
  FOR rec IN
    SELECT ps.package_id, ps.step_key, cp.priority, cp.curriculum_id, c.title, cp.course_id
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    LEFT JOIN courses c ON c.id = cp.course_id
    WHERE ps.status = 'queued'
      AND cp.status = 'building'
      AND cp.curriculum_id IS NOT NULL
      -- ═══ TRUE IDEMPOTENCY GUARD ═══
      -- Block 1: No active job (pending / processing)
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = (v_step_jobs ->> ps.step_key)
          AND jq.status IN ('pending', 'processing', 'batch_pending')
      )
      -- Block 2: No recently failed job of ANY kind (10-min cooldown)
      -- This prevents re-flooding after transient failures, not just PREREQ
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id = ps.package_id
          AND jq.job_type = (v_step_jobs ->> ps.step_key)
          AND jq.status = 'failed'
          AND jq.updated_at > now() - interval '10 minutes'
      )
      AND (v_step_jobs ->> ps.step_key) IS NOT NULL
      AND ps.updated_at < now() - interval '10 minutes'
    ORDER BY cp.priority, ps.package_id
    LIMIT 20
  LOOP
    v_job_type := v_step_jobs ->> rec.step_key;
    v_pool := CASE
      WHEN v_job_type IN ('package_generate_learning_content','package_generate_glossary',
        'package_generate_handbook','package_generate_oral_exam','package_generate_lesson_minichecks',
        'package_generate_exam_pool','package_generate_blueprint_variants',
        'lesson_generate_content_shard','handbook_expand_section') THEN 'content'
      ELSE 'core'
    END;
    
    INSERT INTO job_queue (package_id, job_type, worker_pool, status, priority, meta, payload)
    VALUES (
      rec.package_id, v_job_type, v_pool, 'pending', rec.priority,
      jsonb_build_object('source', 'orphan_reconciler', 'step_key', rec.step_key),
      jsonb_build_object(
        'package_id', rec.package_id::text,
        'curriculum_id', rec.curriculum_id::text,
        'course_id', rec.course_id::text,
        'source', 'orphan_reconciler'
      )
    )
    ON CONFLICT DO NOTHING;
    
    IF FOUND THEN
      v_reconciled := v_reconciled + 1;
      INSERT INTO system_heal_log (heal_type, package_id, step_key, details)
      VALUES ('orphan_step', rec.package_id, rec.step_key,
              jsonb_build_object('job_type', v_job_type, 'pool', v_pool, 'title', rec.title));
      v_details := array_append(v_details, jsonb_build_object(
        'step', rec.step_key, 'package', rec.package_id, 'job_type', v_job_type, 'title', rec.title));
    END IF;
  END LOOP;
  RETURN jsonb_build_object('reconciled', v_reconciled, 'items', to_jsonb(v_details));
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- FIX 2: Claim-Time Package Status Guard in claim_pending_jobs_v4
-- ═══════════════════════════════════════════════════════════════

-- Repair-eligible job types that may run for non-building packages
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_v4(
  p_worker_id text,
  p_limit int DEFAULT 5,
  p_lock_timeout_minutes int DEFAULT 10,
  p_worker_pool text DEFAULT NULL
)
RETURNS SETOF public.job_queue
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_repair_types text[] := ARRAY[
    'package_repair_exam_pool_quality',
    'package_exam_rebalance',
    'pool_fill_bloom_gaps',
    'pool_fill_lf_gaps',
    'pool_fill_trap_gaps',
    'package_run_integrity_check',
    'package_validate_exam_pool',
    'package_quality_council'
  ];
BEGIN
  -- 1. Stale lock recovery
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = format('Stale lock released (locked_by=%s, locked_at=%s)', locked_by, locked_at)
  WHERE status = 'processing'
    AND locked_at IS NOT NULL
    AND locked_at < now() - (p_lock_timeout_minutes || ' minutes')::interval
    AND (p_worker_pool IS NULL OR worker_pool = p_worker_pool);

  -- 2. Ghost recovery
  UPDATE public.job_queue
  SET status = 'pending', locked_at = NULL, locked_by = NULL, updated_at = now(),
      last_error = 'Ghost recovery: processing without lock'
  WHERE status = 'processing'
    AND locked_at IS NULL
    AND updated_at < now() - interval '5 minutes'
    AND (p_worker_pool IS NULL OR worker_pool = p_worker_pool);

  -- 3. AUTO-LEASE HEALING
  INSERT INTO public.package_leases (package_id, runner_id, acquired_at, lease_until, renewed_at)
  SELECT DISTINCT jq.package_id,
         'auto-heal-' || p_worker_id,
         now(),
         now() + interval '5 minutes',
         now()
  FROM public.job_queue jq
  JOIN public.course_packages cp ON cp.id = jq.package_id
  WHERE jq.status = 'pending'
    AND jq.package_id IS NOT NULL
    AND (jq.run_after IS NULL OR jq.run_after <= now())
    AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
    AND (
      cp.status = 'building'
      OR (
        cp.status IN ('blocked', 'quality_gate_failed')
        AND jq.job_type = ANY(v_repair_types)
      )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.package_leases pl
      WHERE pl.package_id = jq.package_id
        AND pl.lease_until > now()
    )
  ON CONFLICT (package_id) DO UPDATE
    SET lease_until = GREATEST(package_leases.lease_until, now() + interval '5 minutes'),
        renewed_at = now(),
        runner_id = 'auto-heal-' || p_worker_id;

  -- 4. Claim jobs — NOW WITH PACKAGE STATUS GUARD
  RETURN QUERY
  WITH picked AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND (jq.run_after IS NULL OR jq.run_after <= now())
      AND (p_worker_pool IS NULL OR jq.worker_pool = p_worker_pool)
      AND (
        -- Non-package jobs: always claimable
        jq.package_id IS NULL
        OR (
          -- Package jobs: must have active lease AND valid package status
          EXISTS (
            SELECT 1 FROM public.package_leases pl
            WHERE pl.package_id = jq.package_id
              AND pl.lease_until > now()
          )
          AND (
            -- Building packages: all job types allowed
            EXISTS (
              SELECT 1 FROM public.course_packages cp
              WHERE cp.id = jq.package_id AND cp.status = 'building'
            )
            OR
            -- Non-building packages: only repair types allowed
            (
              jq.job_type = ANY(v_repair_types)
              AND EXISTS (
                SELECT 1 FROM public.course_packages cp
                WHERE cp.id = jq.package_id AND cp.status IN ('blocked', 'quality_gate_failed')
              )
            )
          )
        )
      )
    ORDER BY jq.priority DESC, jq.run_after ASC NULLS FIRST, jq.created_at ASC
    FOR UPDATE SKIP LOCKED
    LIMIT p_limit
  )
  UPDATE public.job_queue jq
  SET status = 'processing',
      locked_at = now(),
      locked_by = p_worker_id,
      started_at = now(),
      updated_at = now()
  WHERE jq.id IN (SELECT id FROM picked)
  RETURNING jq.*;
END;
$$;


-- ═══════════════════════════════════════════════════════════════
-- FIX 3: Attempt-safe return-to-pending RPC
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_return_job_to_pending_no_burn(
  p_job_id uuid,
  p_backoff_seconds int DEFAULT 300,
  p_reason text DEFAULT 'PREREQ_NOT_DONE'
)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  UPDATE job_queue
  SET status = 'pending',
      run_after = now() + (p_backoff_seconds || ' seconds')::interval,
      last_error = p_reason,
      locked_at = NULL,
      locked_by = NULL,
      updated_at = now(),
      -- DO NOT touch attempts — this is a deferred retry, not a failure
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'prereq_deferred_at', now()::text,
        'prereq_backoff_s', p_backoff_seconds,
        'prereq_reason', p_reason
      )
  WHERE id = p_job_id
    AND status = 'processing';
END;
$$;
