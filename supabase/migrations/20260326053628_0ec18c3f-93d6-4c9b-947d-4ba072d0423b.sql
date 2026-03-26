
-- ============================================================
-- Batch-Fix A: heal_finalization_stall
-- Finds packages where content exists but finalize/validate steps are stuck
-- Requeues them safely with idempotency guards
-- ============================================================
CREATE OR REPLACE FUNCTION public.heal_finalization_stall(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed jsonb := '[]'::jsonb;
  v_pkg record;
  v_step record;
  v_content_count int;
  v_active_jobs int;
  v_now timestamptz := now();
BEGIN
  -- Find packages with finalize/validate steps NOT done, but content exists
  FOR v_pkg IN
    SELECT DISTINCT cp.id AS package_id, cp.status AS pkg_status, cp.build_progress
    FROM course_packages cp
    JOIN package_steps ps ON ps.package_id = cp.id
    WHERE cp.status IN ('building', 'queued', 'blocked', 'quality_gate_failed')
      AND ps.step_key IN ('finalize_learning_content', 'validate_learning_content')
      AND ps.status NOT IN ('done', 'skipped')
      -- Only packages with real content
      AND EXISTS (
        SELECT 1 FROM lessons l
        JOIN modules m ON m.id = l.module_id
        WHERE m.course_id = cp.course_id
          AND l.content IS NOT NULL
          AND length(l.content::text) > 100
      )
    ORDER BY cp.build_progress DESC
    LIMIT p_limit
  LOOP
    -- Count generated lessons
    SELECT count(*) INTO v_content_count
    FROM lessons l
    JOIN modules m ON m.id = l.module_id
    JOIN course_packages cp2 ON cp2.course_id = m.course_id
    WHERE cp2.id = v_pkg.package_id
      AND l.content IS NOT NULL
      AND length(l.content::text) > 100;

    -- Count active content jobs (don't heal if generation still running)
    SELECT count(*) INTO v_active_jobs
    FROM job_queue jq
    WHERE jq.package_id = v_pkg.package_id
      AND jq.job_type IN ('lesson_generate_content', 'lesson_generate_content_shard', 'package_generate_learning_content')
      AND jq.status IN ('pending', 'queued', 'processing');

    IF v_active_jobs > 0 THEN
      CONTINUE; -- Still generating, skip
    END IF;

    IF v_content_count < 3 THEN
      CONTINUE; -- Not enough content to finalize
    END IF;

    -- Check prerequisite: generate_learning_content must be done
    SELECT ps.* INTO v_step
    FROM package_steps ps
    WHERE ps.package_id = v_pkg.package_id
      AND ps.step_key = 'generate_learning_content';

    IF v_step IS NOT NULL AND v_step.status NOT IN ('done', 'skipped') THEN
      -- Check total lessons vs generated for material completion
      DECLARE
        v_total_lessons int;
        v_ratio numeric;
      BEGIN
        SELECT count(*) INTO v_total_lessons
        FROM lessons l
        JOIN modules m ON m.id = l.module_id
        JOIN course_packages cp3 ON cp3.course_id = m.course_id
        WHERE cp3.id = v_pkg.package_id;

        IF v_total_lessons > 0 THEN
          v_ratio := v_content_count::numeric / v_total_lessons;
        ELSE
          v_ratio := 0;
        END IF;

        -- Material completion >= 95%: mark generate step done
        IF v_ratio >= 0.95 THEN
          UPDATE package_steps
          SET status = 'done',
              started_at = COALESCE(started_at, v_now - interval '1 minute'),
              finished_at = v_now,
              last_error = NULL,
              meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
                'heal_finalization_reconciled', true,
                'heal_at', v_now::text,
                'heal_ratio', round(v_ratio, 3),
                'heal_content_count', v_content_count,
                'heal_total_lessons', v_total_lessons
              )
          WHERE package_id = v_pkg.package_id
            AND step_key = 'generate_learning_content';
        ELSE
          CONTINUE; -- Content not sufficient, skip package
        END IF;
      END;
    END IF;

    -- Now requeue finalize_learning_content if not done
    UPDATE package_steps
    SET status = 'queued',
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'heal_finalization_requeued', true,
          'heal_at', v_now::text,
          'heal_reason', 'batch_finalization_recovery'
        )
    WHERE package_id = v_pkg.package_id
      AND step_key = 'finalize_learning_content'
      AND status NOT IN ('done', 'skipped');

    -- Requeue validate_learning_content too (it depends on finalize)
    UPDATE package_steps
    SET status = 'queued',
        started_at = NULL,
        finished_at = NULL,
        last_error = NULL,
        meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
          'heal_finalization_requeued', true,
          'heal_at', v_now::text,
          'heal_reason', 'batch_finalization_recovery'
        )
    WHERE package_id = v_pkg.package_id
      AND step_key = 'validate_learning_content'
      AND status NOT IN ('done', 'skipped');

    -- Ensure package is in building status
    IF v_pkg.pkg_status NOT IN ('building') THEN
      UPDATE course_packages
      SET status = 'building',
          blocked_reason = NULL,
          last_error = NULL,
          updated_at = v_now
      WHERE id = v_pkg.package_id
        AND status NOT IN ('done', 'published');
    END IF;

    v_healed := v_healed || jsonb_build_object(
      'package_id', v_pkg.package_id,
      'pkg_status', v_pkg.pkg_status,
      'content_count', v_content_count,
      'action', 'finalization_requeued'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'healed_count', jsonb_array_length(v_healed),
    'healed', v_healed,
    'ts', v_now
  );
END;
$$;

-- ============================================================
-- Batch-Fix B: heal_non_building_packages
-- Finds packages stuck in queued/blocked that should be building
-- Normalizes status, clears stale reasons, requeues first open step
-- ============================================================
CREATE OR REPLACE FUNCTION public.heal_non_building_packages(p_limit int DEFAULT 20)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_healed jsonb := '[]'::jsonb;
  v_pkg record;
  v_first_open_step record;
  v_now timestamptz := now();
  v_active_jobs int;
BEGIN
  FOR v_pkg IN
    SELECT cp.id AS package_id, cp.status, cp.blocked_reason, cp.last_error,
           cp.build_progress, cp.integrity_passed, cp.council_approved
    FROM course_packages cp
    WHERE cp.status IN ('queued', 'blocked', 'quality_gate_failed')
      AND cp.status NOT IN ('done', 'published', 'cancelled')
      -- Must have at least one non-done step (not terminal)
      AND EXISTS (
        SELECT 1 FROM package_steps ps
        WHERE ps.package_id = cp.id
          AND ps.status NOT IN ('done', 'skipped')
      )
      -- Skip packages with legitimate hard blocks
      AND (cp.blocked_reason IS NULL
           OR cp.blocked_reason NOT LIKE '%HARD_FAIL%'
           OR cp.blocked_reason NOT LIKE '%COUNCIL_REJECTED%')
      -- Must not have a very recent block (< 30 min = might be intentional)
      AND cp.updated_at < v_now - interval '30 minutes'
    ORDER BY cp.build_progress DESC
    LIMIT p_limit
  LOOP
    -- Check for active jobs — if jobs are running, package isn't truly stuck
    SELECT count(*) INTO v_active_jobs
    FROM job_queue jq
    WHERE jq.package_id = v_pkg.package_id
      AND jq.status IN ('pending', 'queued', 'processing');

    -- Find first actionable open step (by DAG order approximation via created_at)
    SELECT ps.* INTO v_first_open_step
    FROM package_steps ps
    WHERE ps.package_id = v_pkg.package_id
      AND ps.status NOT IN ('done', 'skipped')
    ORDER BY ps.created_at ASC
    LIMIT 1;

    IF v_first_open_step IS NULL THEN
      CONTINUE; -- No open steps, skip
    END IF;

    -- Normalize package status to building
    UPDATE course_packages
    SET status = 'building',
        blocked_reason = NULL,
        last_error = NULL,
        stuck_reason = NULL,
        updated_at = v_now
    WHERE id = v_pkg.package_id;

    -- If no active jobs and first step is failed/stuck, requeue it
    IF v_active_jobs = 0 AND v_first_open_step.status IN ('failed', 'queued') THEN
      UPDATE package_steps
      SET status = 'queued',
          started_at = NULL,
          finished_at = NULL,
          last_error = NULL,
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'heal_non_building_requeued', true,
            'heal_at', v_now::text,
            'heal_prev_pkg_status', v_pkg.status,
            'heal_prev_blocked_reason', v_pkg.blocked_reason
          )
      WHERE id = v_first_open_step.id;
    END IF;

    -- Cancel stale failed jobs for this package (> 2h old)
    UPDATE job_queue
    SET status = 'cancelled',
        completed_at = v_now,
        updated_at = v_now,
        last_error = '[HEAL_NON_BUILDING] ' || v_now::text || ' cancelled for recovery'
    WHERE package_id = v_pkg.package_id
      AND status = 'failed'
      AND updated_at < v_now - interval '2 hours';

    v_healed := v_healed || jsonb_build_object(
      'package_id', v_pkg.package_id,
      'prev_status', v_pkg.status,
      'prev_blocked_reason', v_pkg.blocked_reason,
      'first_open_step', v_first_open_step.step_key,
      'active_jobs', v_active_jobs,
      'action', 'normalized_to_building'
    );
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'healed_count', jsonb_array_length(v_healed),
    'healed', v_healed,
    'ts', v_now
  );
END;
$$;

-- ============================================================
-- Ops view: finalization stall candidates
-- ============================================================
CREATE OR REPLACE VIEW public.ops_finalization_stall AS
SELECT
  cp.id AS package_id,
  cp.status AS pkg_status,
  cp.build_progress,
  ps_fin.status AS finalize_status,
  ps_val.status AS validate_status,
  ps_gen.status AS generate_status,
  (SELECT count(*) FROM lessons l JOIN modules m ON m.id = l.module_id
   WHERE m.course_id = cp.course_id AND l.content IS NOT NULL AND length(l.content::text) > 100
  ) AS content_lessons,
  (SELECT count(*) FROM lessons l JOIN modules m ON m.id = l.module_id
   WHERE m.course_id = cp.course_id
  ) AS total_lessons,
  (SELECT count(*) FROM job_queue jq
   WHERE jq.package_id = cp.id
     AND jq.job_type IN ('lesson_generate_content', 'lesson_generate_content_shard')
     AND jq.status IN ('pending', 'queued', 'processing')
  ) AS active_content_jobs,
  cp.updated_at
FROM course_packages cp
LEFT JOIN package_steps ps_fin ON ps_fin.package_id = cp.id AND ps_fin.step_key = 'finalize_learning_content'
LEFT JOIN package_steps ps_val ON ps_val.package_id = cp.id AND ps_val.step_key = 'validate_learning_content'
LEFT JOIN package_steps ps_gen ON ps_gen.package_id = cp.id AND ps_gen.step_key = 'generate_learning_content'
WHERE cp.status IN ('building', 'queued', 'blocked', 'quality_gate_failed')
  AND (ps_fin.status IS NULL OR ps_fin.status NOT IN ('done', 'skipped'))
  AND ps_gen.status = 'done'
ORDER BY cp.build_progress DESC;

-- ============================================================
-- Ops view: non-building recoverable packages
-- ============================================================
CREATE OR REPLACE VIEW public.ops_non_building_recoverable AS
SELECT
  cp.id AS package_id,
  cp.status,
  cp.blocked_reason,
  cp.last_error,
  cp.build_progress,
  cp.updated_at,
  (SELECT count(*) FROM package_steps ps
   WHERE ps.package_id = cp.id AND ps.status NOT IN ('done', 'skipped')
  ) AS open_steps,
  (SELECT ps2.step_key FROM package_steps ps2
   WHERE ps2.package_id = cp.id AND ps2.status NOT IN ('done', 'skipped')
   ORDER BY ps2.created_at ASC LIMIT 1
  ) AS first_open_step,
  (SELECT count(*) FROM job_queue jq
   WHERE jq.package_id = cp.id AND jq.status IN ('pending', 'queued', 'processing')
  ) AS active_jobs,
  (SELECT count(*) FROM job_queue jq
   WHERE jq.package_id = cp.id AND jq.status = 'failed'
     AND jq.updated_at > now() - interval '7 days'
  ) AS recent_failed_jobs
FROM course_packages cp
WHERE cp.status IN ('queued', 'blocked', 'quality_gate_failed')
  AND EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = cp.id AND ps.status NOT IN ('done', 'skipped')
  )
  AND cp.updated_at < now() - interval '30 minutes'
ORDER BY cp.build_progress DESC;

-- Grant service_role access
GRANT EXECUTE ON FUNCTION public.heal_finalization_stall TO service_role;
GRANT EXECUTE ON FUNCTION public.heal_non_building_packages TO service_role;
GRANT SELECT ON public.ops_finalization_stall TO service_role;
GRANT SELECT ON public.ops_non_building_recoverable TO service_role;

NOTIFY pgrst, 'reload schema';
