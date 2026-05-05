-- 1) Blocked publish attempts list
CREATE OR REPLACE FUNCTION public.admin_get_publish_blocked_attempts(_limit int DEFAULT 100)
RETURNS TABLE(
  log_id uuid,
  course_id uuid,
  course_title text,
  course_status text,
  curriculum_id uuid,
  modules int,
  lessons int,
  source text,
  result_status text,
  created_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    l.id,
    NULLIF(l.target_id,'')::uuid AS course_id,
    c.title AS course_title,
    c.status::text AS course_status,
    NULLIF(l.metadata->>'curriculum_id','')::uuid AS curriculum_id,
    COALESCE((l.metadata->>'modules')::int, 0) AS modules,
    COALESCE((l.metadata->>'lessons')::int, 0) AS lessons,
    COALESCE(l.metadata->>'source', '') AS source,
    l.result_status,
    l.created_at
  FROM public.auto_heal_log l
  LEFT JOIN public.courses c
    ON c.id = NULLIF(l.target_id,'')::uuid
  WHERE l.action_type IN (
          'course_publish_readiness_blocked',
          'course_publish_readiness_bypassed'
        )
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY l.created_at DESC
  LIMIT GREATEST(1, LEAST(COALESCE(_limit,100), 500));
$$;
REVOKE ALL ON FUNCTION public.admin_get_publish_blocked_attempts(int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_publish_blocked_attempts(int) TO authenticated, service_role;

-- 2) Skeleton-backfill follow-up jobs summary
CREATE OR REPLACE FUNCTION public.admin_get_skeleton_backfill_jobs_summary()
RETURNS TABLE(
  job_type text,
  status text,
  job_count bigint,
  oldest timestamptz,
  latest timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT
    j.job_type,
    j.status,
    COUNT(*)::bigint AS job_count,
    MIN(j.created_at) AS oldest,
    MAX(j.updated_at) AS latest
  FROM public.job_queue j
  WHERE j.job_type IN (
          'lesson_generate_content',
          'package_generate_lesson_minichecks',
          'council_recompute_course_ready'
        )
    AND public.has_role(auth.uid(), 'admin'::public.app_role)
  GROUP BY j.job_type, j.status
  ORDER BY j.job_type, j.status;
$$;
REVOKE ALL ON FUNCTION public.admin_get_skeleton_backfill_jobs_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_skeleton_backfill_jobs_summary() TO authenticated, service_role;

-- 3) Audited admin force-publish (production-grade)
CREATE OR REPLACE FUNCTION public.admin_force_publish_course(_course_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE = '42501';
  END IF;
  IF _reason IS NULL OR length(trim(_reason)) < 5 THEN
    RAISE EXCEPTION 'reason required (min 5 chars)' USING ERRCODE = '22023';
  END IF;

  PERFORM set_config('app.transition_source', 'admin_force_publish', true);

  UPDATE public.courses SET status = 'published'
  WHERE id = _course_id
  RETURNING status INTO v_status;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'course_not_found');
  END IF;

  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'course_publish_readiness_force_publish',
    'course', _course_id::text, 'bypassed',
    jsonb_build_object(
      'reason', _reason,
      'admin_id', auth.uid(),
      'source', 'admin_force_publish_course'
    )
  );

  RETURN jsonb_build_object('ok', true, 'course_id', _course_id, 'status', v_status);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_force_publish_course(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_force_publish_course(uuid, text) TO authenticated, service_role;