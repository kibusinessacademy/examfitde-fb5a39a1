
-- =========================================================
-- 1. Fix fn_is_true_stall: replace missing ops_jobtype_step_map with inline mapping
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_is_true_stall(
  p_package_id uuid,
  p_step_key text,
  p_stale_minutes integer DEFAULT 15
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_step record;
  v_has_active_job boolean;
  v_prereqs_done boolean;
  v_job_type text;
BEGIN
  SELECT status, updated_at INTO v_step
  FROM public.package_steps
  WHERE package_id = p_package_id AND step_key = p_step_key;

  IF v_step IS NULL OR v_step.status <> 'queued' THEN
    RETURN false;
  END IF;

  -- Must be stale (older than threshold)
  IF v_step.updated_at > (now() - (p_stale_minutes || ' minutes')::interval) THEN
    RETURN false;
  END IF;

  -- Derive job_type from step_key using the canonical naming convention
  v_job_type := 'package_' || p_step_key;

  -- No active job for this step (check both canonical and known variants)
  SELECT EXISTS(
    SELECT 1 FROM public.job_queue jq
    WHERE jq.package_id = p_package_id
      AND jq.status IN ('pending', 'processing')
      AND (
        jq.job_type = v_job_type
        OR jq.job_type = p_step_key
      )
  ) INTO v_has_active_job;

  IF v_has_active_job THEN RETURN false; END IF;

  -- All DAG predecessors must be done or skipped
  SELECT NOT EXISTS(
    SELECT 1 FROM public.pipeline_dag_edges e
    JOIN public.package_steps ps ON ps.package_id = p_package_id AND ps.step_key = e.depends_on
    WHERE e.step_key = p_step_key
      AND ps.status NOT IN ('done', 'skipped')
  ) INTO v_prereqs_done;

  RETURN v_prereqs_done;
END;
$function$;

-- =========================================================
-- 2. Harden integrity trigger: use semantic meta keys
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_guard_integrity_report_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- If version is set but report is NULL, auto-clear the version
  -- and reset the integrity step to queued for re-evaluation
  IF NEW.integrity_report_version IS NOT NULL AND NEW.integrity_report IS NULL THEN
    -- Only act if this is not an explicit report write (which would set both)
    IF OLD.integrity_report IS NOT NULL AND NEW.integrity_report IS NULL THEN
      -- Report was stripped (e.g. by invalidation trigger) — clear version too
      NEW.integrity_report_version := NULL;
      NEW.integrity_passed := false;

      -- Reset the integrity step to queued
      UPDATE public.package_steps
      SET status = 'queued',
          started_at = NULL,
          finished_at = NULL,
          updated_at = now(),
          last_error = 'AUTO_REQUEUE: integrity_report stripped but version remained',
          meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
            'integrity_consistency_guard_at', now(),
            'integrity_auto_requeue_at', now()::text
          )
      WHERE package_id = NEW.id
        AND step_key = 'run_integrity_check'
        AND status IN ('done', 'failed');
    ELSIF OLD.integrity_report_version IS NULL THEN
      -- Someone set version without report — reject by clearing
      NEW.integrity_report_version := NULL;
      NEW.integrity_passed := false;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

-- =========================================================
-- 3. Audit view for integrity report mismatches
-- =========================================================
CREATE OR REPLACE VIEW public.ops_integrity_report_mismatch AS
SELECT
  id AS package_id,
  title,
  status,
  integrity_report_version,
  integrity_passed,
  updated_at
FROM public.course_packages
WHERE integrity_report_version IS NOT NULL
  AND integrity_report IS NULL;

-- =========================================================
-- 4. Harden fn_package_learning_content_materialized:
--    Add explicit needs_regen check on lesson.needs_regen column
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_package_learning_content_materialized(p_package_id uuid)
RETURNS TABLE (
  total_lessons integer,
  generated_lessons integer,
  needs_regen_count integer,
  completion_ratio numeric,
  no_active_content_jobs boolean,
  materialized boolean
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_total integer;
  v_generated integer;
  v_needs_regen integer;
  v_ratio numeric;
  v_active_jobs integer;
  v_course_id uuid;
BEGIN
  SELECT cp.course_id INTO v_course_id
  FROM public.course_packages cp WHERE cp.id = p_package_id;

  IF v_course_id IS NULL THEN
    total_lessons := 0; generated_lessons := 0; needs_regen_count := 0;
    completion_ratio := 0; no_active_content_jobs := true; materialized := false;
    RETURN NEXT; RETURN;
  END IF;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE l.content IS NOT NULL AND l.content::text NOT IN ('null', '""', '') AND length(l.content::text) > 10)
  INTO v_total, v_generated
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id;

  -- Count needs_regen using BOTH the flag AND content quality checks
  SELECT COUNT(*) INTO v_needs_regen
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id
    AND (
      COALESCE(l.needs_regen, false) = true
      OR l.content IS NULL
      OR l.content::text IN ('null', '""', '')
      OR length(l.content::text) <= 10
      OR l.qc_status = 'tier1_failed'
    );

  v_ratio := CASE WHEN v_total > 0 THEN v_generated::numeric / v_total::numeric ELSE 0 END;

  SELECT COUNT(*) INTO v_active_jobs
  FROM public.job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type IN ('package_generate_learning_content', 'lesson_regen_repair', 'lesson_generate_content', 'lesson_generate_content_shard', 'package_fanout_learning_content')
    AND jq.status IN ('pending', 'processing');

  total_lessons := v_total;
  generated_lessons := v_generated;
  needs_regen_count := v_needs_regen;
  completion_ratio := ROUND(v_ratio, 4);
  no_active_content_jobs := (v_active_jobs = 0);
  materialized := (v_total > 0 AND v_ratio >= 0.95 AND v_needs_regen = 0 AND v_active_jobs = 0);
  RETURN NEXT;
END;
$function$;
