
-- Fix fn_package_learning_content_materialized: lessons table has no needs_regen column
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

  -- Count lessons needing regen: empty/broken content or tier1_failed QC
  SELECT COUNT(*) INTO v_needs_regen
  FROM public.lessons l
  JOIN public.modules m ON m.id = l.module_id
  WHERE m.course_id = v_course_id
    AND (
      l.content IS NULL
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
