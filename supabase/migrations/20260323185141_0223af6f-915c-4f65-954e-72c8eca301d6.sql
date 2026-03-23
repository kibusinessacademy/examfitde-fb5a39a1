
-- =========================================================
-- Fix 1: Helper function to check if learning content is materialized
-- (artifact-SSOT: real lesson count overrides job history)
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_package_learning_content_materialized(
  p_package_id uuid
)
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
AS $fn$
DECLARE
  v_total integer;
  v_generated integer;
  v_needs_regen integer;
  v_ratio numeric;
  v_active_jobs integer;
  v_curriculum_id uuid;
BEGIN
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM public.course_packages cp WHERE cp.id = p_package_id;
  
  IF v_curriculum_id IS NULL THEN
    total_lessons := 0; generated_lessons := 0; needs_regen_count := 0;
    completion_ratio := 0; no_active_content_jobs := true; materialized := false;
    RETURN NEXT; RETURN;
  END IF;

  SELECT COUNT(*) INTO v_total
  FROM public.lessons l
  JOIN public.chapters ch ON ch.id = l.chapter_id
  WHERE ch.curriculum_id = v_curriculum_id;

  SELECT COUNT(*) INTO v_generated
  FROM public.lessons l
  JOIN public.chapters ch ON ch.id = l.chapter_id
  WHERE ch.curriculum_id = v_curriculum_id
    AND COALESCE(NULLIF(BTRIM(l.content), ''), '') <> '';

  SELECT COUNT(*) INTO v_needs_regen
  FROM public.lessons l
  JOIN public.chapters ch ON ch.id = l.chapter_id
  WHERE ch.curriculum_id = v_curriculum_id
    AND COALESCE(l.needs_regen, false) = true;

  v_ratio := CASE WHEN v_total > 0 THEN v_generated::numeric / v_total::numeric ELSE 0 END;

  SELECT COUNT(*) INTO v_active_jobs
  FROM public.job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type IN ('package_generate_learning_content', 'lesson_regen_repair')
    AND jq.status IN ('pending', 'processing');

  total_lessons := v_total;
  generated_lessons := v_generated;
  needs_regen_count := v_needs_regen;
  completion_ratio := ROUND(v_ratio, 4);
  no_active_content_jobs := (v_active_jobs = 0);
  materialized := (v_total > 0 AND v_ratio >= 0.95 AND v_needs_regen = 0 AND v_active_jobs = 0);
  RETURN NEXT;
END;
$fn$;

-- =========================================================
-- Fix 2: DB Guard — integrity_report_version without payload is illegal
-- =========================================================
CREATE OR REPLACE FUNCTION public.fn_guard_integrity_report_consistency()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
            'loop_guard_reset_at', now()::text
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
$fn$;

DROP TRIGGER IF EXISTS trg_guard_integrity_report_consistency ON public.course_packages;

CREATE TRIGGER trg_guard_integrity_report_consistency
BEFORE UPDATE ON public.course_packages
FOR EACH ROW
WHEN (
  NEW.integrity_report_version IS NOT NULL AND NEW.integrity_report IS NULL
  AND (OLD.integrity_report_version IS DISTINCT FROM NEW.integrity_report_version
       OR OLD.integrity_report IS DISTINCT FROM NEW.integrity_report)
)
EXECUTE FUNCTION public.fn_guard_integrity_report_consistency();

-- =========================================================
-- Fix 3: Helper function for true-stall detection
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
AS $fn$
DECLARE
  v_step record;
  v_has_active_job boolean;
  v_prereqs_done boolean;
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

  -- No active job for this step
  SELECT EXISTS(
    SELECT 1 FROM public.job_queue jq
    JOIN public.ops_jobtype_step_map m ON m.job_type = jq.job_type
    WHERE m.step_key = p_step_key
      AND jq.package_id = p_package_id
      AND jq.status IN ('pending', 'processing')
  ) INTO v_has_active_job;
  
  IF v_has_active_job THEN RETURN false; END IF;

  -- All DAG predecessors must be done
  SELECT NOT EXISTS(
    SELECT 1 FROM public.pipeline_dag_edges e
    JOIN public.package_steps ps ON ps.package_id = p_package_id AND ps.step_key = e.from_step
    WHERE e.to_step = p_step_key
      AND ps.status NOT IN ('done', 'skipped')
  ) INTO v_prereqs_done;
  
  RETURN v_prereqs_done;
END;
$fn$;

-- Also fix any current integrity_report_version/report mismatches
UPDATE public.course_packages
SET integrity_report_version = NULL,
    integrity_passed = false
WHERE integrity_report_version IS NOT NULL
  AND integrity_report IS NULL;
