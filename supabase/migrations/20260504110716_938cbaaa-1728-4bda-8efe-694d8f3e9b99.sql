-- ============================================================
-- 1) PHANTOM-SWEEP: targeted_blueprint_fill-Recovery durchlassen
-- ============================================================
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
  -- EXCEPTION: repair-mode jobs (competency_coverage_repair / targeted_competency_fill / targeted_blueprint_fill)
  WITH phantoms AS (
    SELECT jq.id
    FROM public.job_queue jq
    WHERE jq.status = 'pending'
      AND jq.job_type = ANY(p_job_types)
      AND jq.job_type LIKE 'package_%'
      AND (jq.payload->>'package_id') IS NOT NULL
      -- Repair-mode exceptions (competency-fill + blueprint-fill)
      AND COALESCE(jq.payload->>'_origin','') NOT IN ('competency_coverage_repair','targeted_fill_blueprint_recovery')
      AND COALESCE(jq.payload->>'mode','')    NOT IN ('targeted_competency_fill','targeted_blueprint_fill')
      AND COALESCE(jq.payload->>'enqueue_source','') NOT IN ('competency_coverage_repair','targeted_fill_blueprint_recovery')
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
      -- Mirror Phantom-Filter (also für Repair-Mode-Marker erweitert)
      AND NOT (
        jq.job_type LIKE 'package_%'
        AND (jq.payload->>'package_id') IS NOT NULL
        AND COALESCE(jq.payload->>'_origin','') NOT IN ('competency_coverage_repair','targeted_fill_blueprint_recovery')
        AND COALESCE(jq.payload->>'mode','')    NOT IN ('targeted_competency_fill','targeted_blueprint_fill')
        AND COALESCE(jq.payload->>'enqueue_source','') NOT IN ('competency_coverage_repair','targeted_fill_blueprint_recovery')
        AND EXISTS (
          SELECT 1 FROM public.package_steps ps
          WHERE ps.package_id = (jq.payload->>'package_id')::uuid
            AND ps.step_key = regexp_replace(jq.job_type, '^package_', '')
            AND ps.status IN ('done','skipped')
        )
      )
      -- DAG-prereq guard: skip for all repair-mode payloads
      AND (
        jq.job_type NOT LIKE 'package_%'
        OR (jq.payload->>'package_id') IS NULL
        OR COALESCE(jq.payload->>'_origin','') IN ('competency_coverage_repair','targeted_fill_blueprint_recovery')
        OR COALESCE(jq.payload->>'mode','')    IN ('targeted_competency_fill','targeted_blueprint_fill')
        OR NOT EXISTS (
          SELECT 1
          FROM public.step_dag_edges dag
          JOIN public.package_steps ps
            ON ps.package_id = (jq.payload->>'package_id')::uuid
            AND ps.step_key = dag.depends_on
          WHERE dag.step_key = regexp_replace(jq.job_type, '^package_', '')
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


-- ============================================================
-- 2) TAIL-RESET TRIGGER: zusätzlich Blueprint-Fill-Continuation
--    Nach erfolgreicher targeted_blueprint_fill → fresh targeted_competency_fill enqueue
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_blueprint_fill_completion_continuation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid;
  v_curriculum_id uuid;
  v_target_ids jsonb;
  v_root_job_id uuid;
  v_existing_active int;
  v_continuation_job_id uuid;
  v_next_depth int;
BEGIN
  -- Only on transition to completed
  IF NEW.status <> 'completed' OR OLD.status = 'completed' THEN
    RETURN NEW;
  END IF;
  IF NEW.job_type <> 'package_generate_blueprint_variants' THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.payload->>'mode','') <> 'targeted_blueprint_fill' THEN
    RETURN NEW;
  END IF;
  IF COALESCE((NEW.payload->>'requeue_exam_pool_after_success')::boolean, false) IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_pkg_id := COALESCE((NEW.payload->>'package_id')::uuid, NEW.package_id);
  v_curriculum_id := (NEW.payload->>'curriculum_id')::uuid;
  v_target_ids := COALESCE(NEW.payload->'target_competency_ids', '[]'::jsonb);
  v_root_job_id := COALESCE((NEW.payload->>'root_job_id')::uuid, NEW.id);
  v_next_depth := COALESCE((NEW.payload->>'continuation_depth')::int, 0) + 1;

  IF jsonb_array_length(v_target_ids) = 0 THEN
    RETURN NEW;
  END IF;

  -- Idempotency: skip if a fresh targeted_competency_fill is already pending/processing
  SELECT count(*) INTO v_existing_active
  FROM public.job_queue
  WHERE package_id = v_pkg_id
    AND job_type = 'package_generate_exam_pool'
    AND status IN ('pending','queued','processing')
    AND payload->>'mode' = 'targeted_competency_fill'
    AND payload->>'_origin' = 'competency_coverage_repair';

  IF v_existing_active > 0 THEN
    INSERT INTO public.auto_heal_log
      (action_type, target_type, target_id, result_status, result_detail, metadata)
    VALUES (
      'targeted_blueprint_fill_continuation_skipped',
      'course_package', v_pkg_id::text, 'skipped',
      format('active targeted_competency_fill already pending (%s)', v_existing_active),
      jsonb_build_object('package_id', v_pkg_id, 'source_job_id', NEW.id)
    );
    RETURN NEW;
  END IF;

  INSERT INTO public.job_queue
    (job_type, package_id, status, priority, max_attempts, payload, meta)
  VALUES (
    'package_generate_exam_pool',
    v_pkg_id, 'pending', 25, 3,
    jsonb_build_object(
      'package_id', v_pkg_id,
      'curriculum_id', v_curriculum_id,
      'mode', 'targeted_competency_fill',
      'enqueue_source', 'competency_coverage_repair',
      '_origin', 'competency_coverage_repair',
      'origin', 'targeted_fill_after_blueprint_recovery',
      'reason', 'BLUEPRINT_RECOVERY_COMPLETED_RETRY_TARGETED_FILL',
      'target_competency_ids', v_target_ids,
      'continuation_depth', v_next_depth,
      'requeue_tail_after_success', true,
      'root_job_id', v_root_job_id,
      'parent_job_id', NEW.id,
      'triggered_by', 'fn_blueprint_fill_completion_continuation'
    ),
    jsonb_build_object(
      'origin', 'targeted_fill_after_blueprint_recovery',
      'parent_job_id', NEW.id,
      'root_job_id', v_root_job_id,
      'enqueued_by_trigger', 'fn_blueprint_fill_completion_continuation'
    )
  )
  RETURNING id INTO v_continuation_job_id;

  INSERT INTO public.auto_heal_log
    (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'targeted_blueprint_fill_continuation_enqueued',
    'course_package', v_pkg_id::text, 'success',
    format('fresh targeted_competency_fill enqueued after blueprint recovery (depth=%s, targets=%s)',
           v_next_depth, jsonb_array_length(v_target_ids)),
    jsonb_build_object(
      'package_id', v_pkg_id,
      'parent_job_id', NEW.id,
      'continuation_job_id', v_continuation_job_id,
      'continuation_depth', v_next_depth
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_blueprint_fill_completion_continuation ON public.job_queue;
CREATE TRIGGER trg_blueprint_fill_completion_continuation
AFTER UPDATE OF status ON public.job_queue
FOR EACH ROW
EXECUTE FUNCTION public.fn_blueprint_fill_completion_continuation();


-- ============================================================
-- 3) STALE-DONE STEPS: View + RPCs für Cockpit-Card
-- ============================================================
CREATE OR REPLACE VIEW public.v_stale_done_steps AS
WITH last_approved AS (
  SELECT package_id, MAX(reviewed_at) AS last_approved_at, COUNT(*) AS approved_total
  FROM public.exam_questions
  WHERE qc_status = 'approved' AND reviewed_at IS NOT NULL
  GROUP BY package_id
)
SELECT
  cp.id AS package_id,
  cp.title,
  cp.status AS package_status,
  ps.step_key,
  ps.status AS step_status,
  ps.finished_at,
  la.last_approved_at,
  la.approved_total,
  EXTRACT(EPOCH FROM (la.last_approved_at - ps.finished_at))::bigint AS staleness_seconds
FROM public.course_packages cp
JOIN public.package_steps ps ON ps.package_id = cp.id
JOIN last_approved la ON la.package_id = cp.id
WHERE cp.status IN ('queued','building')
  AND ps.step_key IN ('validate_exam_pool','run_integrity_check','quality_council','auto_publish')
  AND ps.status = 'done'
  AND ps.finished_at IS NOT NULL
  AND la.last_approved_at > ps.finished_at + interval '2 minutes';

REVOKE ALL ON public.v_stale_done_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_stale_done_steps TO service_role;

-- Summary RPC (for KPI badge)
CREATE OR REPLACE FUNCTION public.admin_get_stale_done_steps_summary()
RETURNS TABLE(
  packages_affected int,
  steps_affected int,
  by_step_key jsonb,
  oldest_staleness_minutes int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    COUNT(DISTINCT package_id)::int,
    COUNT(*)::int,
    COALESCE((
      SELECT jsonb_object_agg(step_key, cnt)
      FROM (
        SELECT step_key, COUNT(*) AS cnt
        FROM public.v_stale_done_steps
        GROUP BY step_key
      ) s
    ), '{}'::jsonb),
    COALESCE(MAX(staleness_seconds)/60, 0)::int
  FROM public.v_stale_done_steps;
END;
$$;

-- Detail RPC (for table)
CREATE OR REPLACE FUNCTION public.admin_get_stale_done_steps_detail(p_limit int DEFAULT 100)
RETURNS TABLE(
  package_id uuid,
  title text,
  package_status text,
  step_key text,
  finished_at timestamptz,
  last_approved_at timestamptz,
  approved_total bigint,
  staleness_minutes int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT
    v.package_id, v.title, v.package_status, v.step_key,
    v.finished_at, v.last_approved_at, v.approved_total,
    (v.staleness_seconds/60)::int
  FROM public.v_stale_done_steps v
  ORDER BY v.staleness_seconds DESC
  LIMIT p_limit;
END;
$$;

-- Per-package heal RPC (called from card "Heal" button)
CREATE OR REPLACE FUNCTION public.admin_heal_stale_done_steps_for_package(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_steps_reset int := 0;
  v_validate_job_id uuid;
  v_curriculum_id uuid;
  v_active_jobs int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  -- Block if any tail job is currently active
  SELECT count(*) INTO v_active_jobs
  FROM public.job_queue
  WHERE package_id = p_package_id
    AND job_type IN ('package_validate_exam_pool','package_run_integrity_check',
                     'package_quality_council','package_auto_publish')
    AND status IN ('pending','queued','processing');

  IF v_active_jobs > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'reason', 'ACTIVE_TAIL_JOBS_EXIST',
      'active_jobs', v_active_jobs
    );
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM public.course_packages WHERE id = p_package_id;

  -- Only reset what's actually stale per the SSOT view
  WITH stale AS (
    SELECT step_key FROM public.v_stale_done_steps WHERE package_id = p_package_id
  )
  UPDATE public.package_steps ps
  SET status = 'queued',
      started_at = NULL,
      updated_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'allow_regression_by', 'repair_rpc',
        'reset_by', 'admin_heal_stale_done_steps_for_package',
        'reset_at', now()::text,
        'reset_reason', 'stale_done_after_new_approved_questions'
      )
  WHERE ps.package_id = p_package_id
    AND ps.step_key IN (SELECT step_key FROM stale)
       -- always cascade-reset everything downstream of validate_exam_pool too
    OR (ps.package_id = p_package_id
        AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
        AND ps.status IN ('done','failed','blocked','skipped')
        AND EXISTS (SELECT 1 FROM stale WHERE step_key = 'validate_exam_pool'));

  GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

  IF v_steps_reset > 0 THEN
    INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload, meta)
    VALUES (
      'package_validate_exam_pool', p_package_id, 'pending', 20, 3,
      jsonb_build_object(
        'package_id', p_package_id,
        'curriculum_id', v_curriculum_id,
        'step_key', 'validate_exam_pool',
        'enqueue_source', 'stale_done_steps_heal_rpc'
      ),
      jsonb_build_object('origin', 'stale_done_steps_heal')
    )
    RETURNING id INTO v_validate_job_id;
  END IF;

  INSERT INTO public.auto_heal_log
    (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'stale_done_steps_reset',
    'course_package', p_package_id::text,
    CASE WHEN v_steps_reset > 0 THEN 'success' ELSE 'noop' END,
    format('reset %s stale tail steps', v_steps_reset),
    jsonb_build_object('package_id', p_package_id, 'validate_job_id', v_validate_job_id)
  );

  RETURN jsonb_build_object(
    'ok', true,
    'steps_reset', v_steps_reset,
    'validate_job_id', v_validate_job_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_stale_done_steps_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_get_stale_done_steps_detail(int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.admin_heal_stale_done_steps_for_package(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_stale_done_steps_summary() TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_stale_done_steps_detail(int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_heal_stale_done_steps_for_package(uuid) TO authenticated;


-- ============================================================
-- 4) AUTO-HEAL TRIGGER nach approved exam_questions
--    AFTER UPDATE OF qc_status → reset stale tail steps with cooldown
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_auto_heal_stale_tail_after_approve()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg_id uuid;
  v_last_heal timestamptz;
  v_cooldown_minutes int := 5;
  v_stale_count int;
  v_steps_reset int := 0;
  v_validate_job_id uuid;
  v_curriculum_id uuid;
  v_active_jobs int;
BEGIN
  -- Only react on transition INTO approved (or fresh INSERT as approved)
  IF TG_OP = 'UPDATE' THEN
    IF NEW.qc_status IS NOT DISTINCT FROM OLD.qc_status THEN
      RETURN NEW;
    END IF;
    IF NEW.qc_status <> 'approved' THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    IF NEW.qc_status <> 'approved' THEN
      RETURN NEW;
    END IF;
  END IF;

  v_pkg_id := NEW.package_id;
  IF v_pkg_id IS NULL THEN RETURN NEW; END IF;

  -- Cooldown: don't fire more than once every 5 minutes per package
  SELECT MAX(created_at) INTO v_last_heal
  FROM public.auto_heal_log
  WHERE target_type = 'course_package'
    AND target_id = v_pkg_id::text
    AND action_type = 'auto_heal_stale_tail_after_approve'
    AND created_at > now() - (v_cooldown_minutes || ' minutes')::interval;

  IF v_last_heal IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Need at least one stale tail step
  SELECT COUNT(*) INTO v_stale_count
  FROM public.v_stale_done_steps WHERE package_id = v_pkg_id;

  IF v_stale_count = 0 THEN
    RETURN NEW;
  END IF;

  -- Don't fight active tail jobs
  SELECT count(*) INTO v_active_jobs
  FROM public.job_queue
  WHERE package_id = v_pkg_id
    AND job_type IN ('package_validate_exam_pool','package_run_integrity_check',
                     'package_quality_council','package_auto_publish')
    AND status IN ('pending','queued','processing');

  IF v_active_jobs > 0 THEN
    RETURN NEW;
  END IF;

  SELECT curriculum_id INTO v_curriculum_id FROM public.course_packages WHERE id = v_pkg_id;

  -- Reset stale tail steps + downstream cascade
  WITH stale AS (
    SELECT step_key FROM public.v_stale_done_steps WHERE package_id = v_pkg_id
  )
  UPDATE public.package_steps ps
  SET status = 'queued',
      started_at = NULL,
      updated_at = now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'allow_regression_by', 'repair_rpc',
        'reset_by', 'fn_auto_heal_stale_tail_after_approve',
        'reset_at', now()::text,
        'reset_reason', 'new_approved_questions_after_validation_done'
      )
  WHERE ps.package_id = v_pkg_id
    AND (
      ps.step_key IN (SELECT step_key FROM stale)
      OR (ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
          AND ps.status IN ('done','failed','blocked','skipped')
          AND EXISTS (SELECT 1 FROM stale WHERE step_key = 'validate_exam_pool'))
    );

  GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

  IF v_steps_reset > 0 THEN
    INSERT INTO public.job_queue (job_type, package_id, status, priority, max_attempts, payload, meta)
    VALUES (
      'package_validate_exam_pool', v_pkg_id, 'pending', 20, 3,
      jsonb_build_object(
        'package_id', v_pkg_id,
        'curriculum_id', v_curriculum_id,
        'step_key', 'validate_exam_pool',
        'enqueue_source', 'auto_heal_after_approve_trigger'
      ),
      jsonb_build_object('origin', 'auto_heal_after_approve')
    )
    RETURNING id INTO v_validate_job_id;
  END IF;

  INSERT INTO public.auto_heal_log
    (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'auto_heal_stale_tail_after_approve',
    'course_package', v_pkg_id::text,
    CASE WHEN v_steps_reset > 0 THEN 'success' ELSE 'noop' END,
    format('triggered by approve of question %s; reset %s stale steps', NEW.id, v_steps_reset),
    jsonb_build_object(
      'package_id', v_pkg_id,
      'trigger_question_id', NEW.id,
      'stale_count_before', v_stale_count,
      'steps_reset', v_steps_reset,
      'validate_job_id', v_validate_job_id
    )
  );

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_auto_heal_stale_tail_after_approve ON public.exam_questions;
CREATE TRIGGER trg_auto_heal_stale_tail_after_approve
AFTER INSERT OR UPDATE OF qc_status ON public.exam_questions
FOR EACH ROW
WHEN (NEW.qc_status = 'approved')
EXECUTE FUNCTION public.fn_auto_heal_stale_tail_after_approve();


-- ============================================================
-- 5) CONTINUATION-ENQUEUE FAILURES VIEW (Sichtbarkeit für UQ-Verletzungen)
-- ============================================================
CREATE OR REPLACE VIEW public.v_continuation_enqueue_failures AS
SELECT
  jq.id AS source_job_id,
  jq.package_id,
  cp.title,
  jq.job_type,
  jq.completed_at,
  jq.payload->>'mode' AS mode,
  (jq.payload->>'continuation_depth')::int AS depth,
  jq.result->'continuation'->>'reason' AS continuation_reason,
  jq.result->'continuation'->>'error' AS continuation_error,
  (jq.result->'continuation'->>'remaining_target_competencies')::int AS remaining_targets
FROM public.job_queue jq
JOIN public.course_packages cp ON cp.id = jq.package_id
WHERE jq.status = 'completed'
  AND jq.result->'continuation'->>'reason' = 'CONTINUATION_ENQUEUE_FAILED'
  AND jq.completed_at > now() - interval '24 hours';

REVOKE ALL ON public.v_continuation_enqueue_failures FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_continuation_enqueue_failures TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_continuation_enqueue_failures(p_limit int DEFAULT 50)
RETURNS TABLE(
  source_job_id uuid,
  package_id uuid,
  title text,
  job_type text,
  completed_at timestamptz,
  mode text,
  depth int,
  continuation_reason text,
  continuation_error text,
  remaining_targets int
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  RETURN QUERY
  SELECT * FROM public.v_continuation_enqueue_failures
  ORDER BY completed_at DESC
  LIMIT p_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_continuation_enqueue_failures(int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_continuation_enqueue_failures(int) TO authenticated;