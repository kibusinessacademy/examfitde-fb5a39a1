CREATE OR REPLACE FUNCTION public.admin_get_l2_enforce_readiness()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total int;
  v_ready int;
  v_blockers jsonb;
  v_minicheck_pending int;
  v_minicheck_failed int;
  v_warned_24h int;
  v_blocked_24h int;
  v_bypassed_24h int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT COUNT(*),
         COUNT(*) FILTER (WHERE readiness_level = 'ready_to_publish')
    INTO v_total, v_ready
    FROM public.v_admin_course_pipeline_readiness
   WHERE course_status = 'published';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'readiness_level', readiness_level,
           'primary_blocker', primary_blocker,
           'count', n
         ) ORDER BY n DESC), '[]'::jsonb)
    INTO v_blockers
    FROM (
      SELECT readiness_level, primary_blocker, COUNT(*) AS n
        FROM public.v_admin_course_pipeline_readiness
       WHERE course_status = 'published'
         AND readiness_level <> 'ready_to_publish'
       GROUP BY readiness_level, primary_blocker
    ) s;

  SELECT
    COUNT(*) FILTER (WHERE status IN ('pending','queued','running','retry')),
    COUNT(*) FILTER (WHERE status IN ('failed','dead_letter'))
    INTO v_minicheck_pending, v_minicheck_failed
    FROM public.job_queue
   WHERE job_type IN (
     'package_generate_lesson_minichecks',
     'package_validate_lesson_minichecks'
   );

  SELECT
    COUNT(*) FILTER (WHERE action_type = 'course_publish_readiness_l2_warned'),
    COUNT(*) FILTER (WHERE action_type = 'course_publish_readiness_l2_blocked'),
    COUNT(*) FILTER (WHERE action_type = 'course_publish_readiness_l2_bypassed')
    INTO v_warned_24h, v_blocked_24h, v_bypassed_24h
    FROM public.auto_heal_log
   WHERE created_at > now() - interval '24 hours'
     AND action_type LIKE 'course_publish_readiness_l2_%';

  RETURN jsonb_build_object(
    'total_published', v_total,
    'ready_to_publish', v_ready,
    'ready_pct', CASE WHEN v_total > 0
                      THEN ROUND((v_ready::numeric * 100.0) / v_total, 1)
                      ELSE 0 END,
    'blockers', v_blockers,
    'minicheck_jobs_pending', v_minicheck_pending,
    'minicheck_jobs_failed', v_minicheck_failed,
    'l2_warned_24h', v_warned_24h,
    'l2_blocked_24h', v_blocked_24h,
    'l2_bypassed_24h', v_bypassed_24h,
    'safe_to_enforce',
      v_minicheck_failed = 0
      AND COALESCE((SELECT COUNT(*) FROM public.v_admin_course_pipeline_readiness
                     WHERE course_status='published' AND readiness_level='empty'), 0) = 0,
    'computed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_l2_enforce_readiness() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_l2_enforce_readiness() TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_get_l2_enforce_readiness() IS
  'Promotion metric for course publish guard L2: counts/blockers/job-state + 24h L2 audit summary. safe_to_enforce=true → flip app.publish_guard_level2 to enforce.';