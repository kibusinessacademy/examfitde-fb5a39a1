
-- Fix fn_package_learning_content_materialized: use correct schema (lessons → modules → course_id)
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

  SELECT COUNT(*) INTO v_needs_regen
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id
    AND (l.content IS NULL OR l.content::text IN ('null', '""', '') OR length(l.content::text) <= 10 OR l.qc_status = 'tier1_failed');

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

-- Fix fn_is_true_stall: use correct DAG column names (step_key/depends_on)
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

  -- All DAG predecessors must be done (columns: step_key, depends_on)
  SELECT NOT EXISTS(
    SELECT 1 FROM public.pipeline_dag_edges e
    JOIN public.package_steps ps ON ps.package_id = p_package_id AND ps.step_key = e.depends_on
    WHERE e.step_key = p_step_key
      AND ps.status NOT IN ('done', 'skipped')
  ) INTO v_prereqs_done;
  
  RETURN v_prereqs_done;
END;
$fn$;
