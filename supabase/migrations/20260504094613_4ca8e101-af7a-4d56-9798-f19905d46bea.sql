
-- ════════════════════════════════════════════════════════════════════════════
-- 1) Phantom-Guard Exception for competency_coverage_repair / targeted_competency_fill
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_step_already_terminal(p_job_type text, p_package_id uuid, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN p_package_id IS NULL OR p_job_type NOT LIKE 'package_%' THEN false
    -- Repair-mode exception: competency_coverage_repair runs in scoped repair branch
    -- (no markStepDone, no upstream contamination), so done-step must NOT block it.
    WHEN COALESCE(p_payload->>'_origin','') = 'competency_coverage_repair' THEN false
    WHEN COALESCE(p_payload->>'mode','') = 'targeted_competency_fill' THEN false
    WHEN COALESCE(p_payload->>'enqueue_source','') = 'competency_coverage_repair' THEN false
    ELSE EXISTS (
      SELECT 1 FROM public.package_steps ps
      WHERE ps.package_id = p_package_id
        AND ps.step_key = replace(p_job_type, 'package_', '')
        AND ps.status IN ('done','skipped')
    )
  END;
$function$;

-- Backwards-compat overload (callers without payload)
CREATE OR REPLACE FUNCTION public.fn_step_already_terminal(p_job_type text, p_package_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT public.fn_step_already_terminal(p_job_type, p_package_id, '{}'::jsonb);
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2) claim_pending_jobs_by_types: skip phantom-cancel for repair-mode jobs
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.claim_pending_jobs_by_types(
  p_job_types text[],
  p_limit integer,
  p_worker_id text,
  p_worker_pool text DEFAULT 'default'::text
)
RETURNS SETOF job_queue
LANGUAGE plpgsql
AS $function$
BEGIN
  -- Phantom-Sweep: cancel jobs whose step is already done/skipped
  -- EXCEPTION: repair-mode jobs (competency_coverage_repair / targeted_competency_fill)
  -- do not call markStepDone and are explicitly designed to fill gaps post-step.
  WITH phantoms AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND jq.job_type LIKE 'package_%'
      AND (jq.payload->>'package_id') IS NOT NULL
      -- Repair-mode exception
      AND COALESCE(jq.payload->>'_origin','') <> 'competency_coverage_repair'
      AND COALESCE(jq.payload->>'mode','') <> 'targeted_competency_fill'
      AND COALESCE(jq.payload->>'enqueue_source','') <> 'competency_coverage_repair'
      AND EXISTS (
        SELECT 1 FROM public.package_steps ps
        WHERE ps.package_id = (jq.payload->>'package_id')::uuid
          AND ps.step_key = replace(jq.job_type, 'package_', '')
          AND ps.status IN ('done','skipped')
      )
      -- AND no concurrent tail-step processing to avoid racing with publish
      AND NOT EXISTS (
        SELECT 1 FROM public.job_queue jq2
        WHERE jq2.package_id = (jq.payload->>'package_id')::uuid
          AND jq2.job_type IN ('package_validate_exam_pool','package_auto_publish')
          AND jq2.status = 'processing'
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
        -- Repair-mode exception (mirror of phantom-sweep)
        AND COALESCE(jq.payload->>'_origin','') <> 'competency_coverage_repair'
        AND COALESCE(jq.payload->>'mode','') <> 'targeted_competency_fill'
        AND COALESCE(jq.payload->>'enqueue_source','') <> 'competency_coverage_repair'
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
        -- DAG-prereq guard: skip for repair-mode (it runs after generate_exam_pool is done by definition)
        OR COALESCE(jq.payload->>'_origin','') = 'competency_coverage_repair'
        OR COALESCE(jq.payload->>'mode','') = 'targeted_competency_fill'
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
      liveness_status = 'healthy'
  FROM fair f
  WHERE jq.id = f.id
  RETURNING jq.*;
END;
$function$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3) Post-Completion Trigger: reset tail steps when targeted_competency_fill completes
-- ════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_competency_repair_tail_reset()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid;
  v_curriculum_id uuid;
  v_remaining int;
  v_steps_reset int := 0;
  v_validate_job_id uuid;
BEGIN
  -- Only fire on completed package_generate_exam_pool with repair-tags + tail-requeue-flag
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;
  IF NEW.job_type <> 'package_generate_exam_pool' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.payload->>'_origin','') <> 'competency_coverage_repair'
     AND COALESCE(NEW.payload->>'mode','') <> 'targeted_competency_fill' THEN
    RETURN NEW;
  END IF;
  IF COALESCE((NEW.payload->>'requeue_tail_after_success')::boolean, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_pkg_id := COALESCE((NEW.payload->>'package_id')::uuid, NEW.package_id);
  v_curriculum_id := (NEW.payload->>'curriculum_id')::uuid;

  -- Only reset if generator reported targeted_fill_complete (no remaining)
  v_remaining := COALESCE((NEW.result->>'remaining_target_competencies')::int, -1);
  IF v_remaining > 0 THEN
    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'competency_filter_generation_completed',
      'course_package', v_pkg_id::text, 'partial',
      format('targeted_competency_fill partial: %s remaining (continuation handled by worker)', v_remaining),
      jsonb_build_object(
        'package_id', v_pkg_id, 'job_id', NEW.id,
        'remaining_target_competencies', v_remaining,
        'continuation_depth', COALESCE((NEW.payload->>'continuation_depth')::int, 0)
      )
    );
    RETURN NEW;
  END IF;

  -- Reset tail steps with allow_regression marker
  UPDATE public.package_steps
  SET status = 'queued',
      started_at = NULL,
      updated_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'allow_regression_by', 'repair_rpc',
        'reset_by', 'fn_competency_repair_tail_reset',
        'reset_source_job_id', NEW.id::text,
        'reset_at', now()::text,
        'reset_reason', 'targeted_competency_fill_completed'
      )
  WHERE package_id = v_pkg_id
    AND step_key IN ('validate_exam_pool','run_integrity_check','quality_council','auto_publish')
    AND status IN ('done','failed','blocked','skipped');

  GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

  -- Enqueue validate_exam_pool to drive the tail forward
  IF v_steps_reset > 0 THEN
    INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload, meta)
    VALUES (
      'package_validate_exam_pool', v_pkg_id, 'pending', 20, 3,
      jsonb_build_object(
        'package_id', v_pkg_id,
        'curriculum_id', v_curriculum_id,
        'step_key', 'validate_exam_pool',
        'enqueue_source', 'competency_coverage_repair_tail_reset',
        'triggered_by_repair_job', NEW.id::text
      ),
      jsonb_build_object(
        'origin', 'competency_repair_tail_reset',
        'parent_job_id', NEW.id
      )
    )
    RETURNING id INTO v_validate_job_id;
  END IF;

  -- Audit success
  INSERT INTO public.auto_heal_log
    (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'competency_coverage_repair_materialized',
    'course_package', v_pkg_id::text, 'success',
    format('targeted_competency_fill complete; reset %s tail steps + enqueued validate_exam_pool', v_steps_reset),
    jsonb_build_object(
      'package_id', v_pkg_id, 'curriculum_id', v_curriculum_id,
      'source_job_id', NEW.id,
      'tail_steps_reset', v_steps_reset,
      'validate_job_id', v_validate_job_id,
      'continuation_depth', COALESCE((NEW.payload->>'continuation_depth')::int, 0)
    )
  );

  -- Also emit completed audit
  INSERT INTO public.auto_heal_log
    (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'competency_filter_generation_completed',
    'course_package', v_pkg_id::text, 'success',
    'targeted_competency_fill completed (no remaining competencies)',
    jsonb_build_object(
      'package_id', v_pkg_id, 'job_id', NEW.id,
      'inserted_questions', COALESCE((NEW.result->>'inserted_questions')::int, 0),
      'processed_competencies', COALESCE((NEW.result->>'processed_competencies')::int, 0)
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_competency_repair_tail_reset ON public.job_queue;
CREATE TRIGGER trg_competency_repair_tail_reset
  AFTER UPDATE OF status ON public.job_queue
  FOR EACH ROW
  WHEN (NEW.status = 'completed' AND NEW.job_type = 'package_generate_exam_pool')
  EXECUTE FUNCTION public.fn_competency_repair_tail_reset();

COMMENT ON FUNCTION public.fn_competency_repair_tail_reset IS
  'Triggered when a targeted_competency_fill / competency_coverage_repair generate_exam_pool job completes. Resets validate_exam_pool→auto_publish steps + enqueues validate_exam_pool. Audits via competency_filter_generation_completed + competency_coverage_repair_materialized.';

COMMENT ON FUNCTION public.fn_step_already_terminal(text, uuid, jsonb) IS
  'Phantom-step gate. Repair-mode jobs (_origin/mode/enqueue_source = competency_coverage_repair / targeted_competency_fill) bypass the done-step block — they run in the scoped repair branch and do not call markStepDone.';
