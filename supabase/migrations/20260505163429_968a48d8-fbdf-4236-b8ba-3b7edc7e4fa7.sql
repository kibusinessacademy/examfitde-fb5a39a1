CREATE OR REPLACE VIEW public.v_admin_course_pipeline_readiness AS
WITH course_modules AS (
  SELECT c.id AS course_id, c.title, c.status::text AS course_status,
         c.curriculum_id, c.published_at,
         COUNT(m.id)::int AS modules
  FROM public.courses c
  LEFT JOIN public.modules m ON m.course_id = c.id
  GROUP BY c.id, c.title, c.status, c.curriculum_id, c.published_at
),
course_lessons AS (
  SELECT c.id AS course_id,
         COUNT(l.id)::int AS lessons_total,
         COUNT(*) FILTER (
           WHERE l.generation_status = 'completed' OR l.status = 'ready'
         )::int AS lessons_ready,
         COUNT(*) FILTER (
           WHERE COALESCE(l.content->>'placeholder','false') = 'true'
              OR l.generation_status = 'queued'
         )::int AS placeholder_lessons
  FROM public.courses c
  LEFT JOIN public.modules m ON m.course_id = c.id
  LEFT JOIN public.lessons l ON l.module_id = m.id
  GROUP BY c.id
),
course_jobs AS (
  SELECT c.id AS course_id,
    COUNT(*) FILTER (
      WHERE j.status IN ('pending','queued','processing')
        AND j.job_type IN ('lesson_generate_content',
                           'package_generate_lesson_minichecks',
                           'council_recompute_course_ready')
    )::int AS pending_jobs,
    COUNT(*) FILTER (
      WHERE j.status IN ('failed','cancelled')
        AND j.job_type IN ('lesson_generate_content',
                           'package_generate_lesson_minichecks',
                           'council_recompute_course_ready')
    )::int AS failed_jobs
  FROM public.courses c
  LEFT JOIN public.job_queue j
    ON NULLIF(j.payload->>'course_id','')::uuid = c.id
  GROUP BY c.id
),
course_minichecks AS (
  SELECT c.id AS course_id,
         COUNT(eq.id)::int AS minichecks_total
  FROM public.courses c
  LEFT JOIN public.modules m ON m.course_id = c.id
  LEFT JOIN public.lessons l ON l.module_id = m.id
  LEFT JOIN public.exam_questions eq ON eq.competency_id = l.competency_id
  GROUP BY c.id
)
SELECT
  cm.course_id, cm.title, cm.course_status, cm.curriculum_id, cm.published_at,
  cm.modules, cl.lessons_total, cl.lessons_ready, cl.placeholder_lessons,
  cmc.minichecks_total, cj.pending_jobs, cj.failed_jobs,
  CASE
    WHEN cm.modules = 0 OR cl.lessons_total = 0 THEN 'empty'
    WHEN cl.placeholder_lessons = cl.lessons_total OR cl.lessons_ready = 0 THEN 'skeleton'
    WHEN cj.failed_jobs > 0 THEN 'content_failed'
    WHEN cj.pending_jobs > 0 THEN 'content_pending'
    WHEN cmc.minichecks_total = 0 THEN 'minicheck_missing'
    ELSE 'ready_to_publish'
  END AS readiness_level,
  CASE
    WHEN cm.modules = 0 THEN 'NO_MODULES'
    WHEN cl.lessons_total = 0 THEN 'NO_LESSONS'
    WHEN cl.lessons_ready = 0 THEN 'NO_READY_LESSONS'
    WHEN cl.placeholder_lessons > 0 THEN 'PLACEHOLDER_LESSONS'
    WHEN cj.failed_jobs > 0 THEN 'JOBS_FAILED'
    WHEN cj.pending_jobs > 0 THEN 'JOBS_PENDING'
    WHEN cmc.minichecks_total = 0 THEN 'MINICHECKS_MISSING'
    ELSE NULL
  END AS primary_blocker
FROM course_modules cm
JOIN course_lessons cl ON cl.course_id = cm.course_id
JOIN course_jobs cj ON cj.course_id = cm.course_id
JOIN course_minichecks cmc ON cmc.course_id = cm.course_id;

REVOKE ALL ON public.v_admin_course_pipeline_readiness FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_admin_course_pipeline_readiness TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_course_pipeline_readiness(
  _readiness_filter text DEFAULT NULL,
  _limit int DEFAULT 200
)
RETURNS SETOF public.v_admin_course_pipeline_readiness
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT *
  FROM public.v_admin_course_pipeline_readiness v
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND v.course_status = 'published'
    AND (_readiness_filter IS NULL OR v.readiness_level = _readiness_filter)
  ORDER BY
    CASE v.readiness_level
      WHEN 'empty' THEN 1
      WHEN 'skeleton' THEN 2
      WHEN 'content_failed' THEN 3
      WHEN 'minicheck_missing' THEN 4
      WHEN 'content_pending' THEN 5
      ELSE 6
    END,
    v.title NULLS LAST
  LIMIT GREATEST(1, LEAST(COALESCE(_limit,200), 1000));
$$;
REVOKE ALL ON FUNCTION public.admin_get_course_pipeline_readiness(text,int) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_course_pipeline_readiness(text,int) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_retry_skeleton_backfill_job(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_jt text; v_status text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE='42501';
  END IF;
  SELECT job_type, status INTO v_jt, v_status FROM public.job_queue WHERE id = _job_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','job_not_found'); END IF;
  IF v_jt NOT IN ('lesson_generate_content','package_generate_lesson_minichecks','council_recompute_course_ready') THEN
    RETURN jsonb_build_object('ok',false,'error','job_type_not_allowed','job_type',v_jt);
  END IF;
  IF v_status NOT IN ('failed','cancelled') THEN
    RETURN jsonb_build_object('ok',false,'error','job_not_retryable','status',v_status);
  END IF;
  UPDATE public.job_queue
  SET status='pending', attempts=0, run_after=now(),
      last_error=NULL, locked_at=NULL, locked_by=NULL, updated_at=now()
  WHERE id = _job_id;
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('skeleton_backfill_job_retried','job',_job_id::text,'success',
          jsonb_build_object('job_type',v_jt,'admin_id',auth.uid(),'previous_status',v_status));
  RETURN jsonb_build_object('ok',true,'job_id',_job_id);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_retry_skeleton_backfill_job(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_retry_skeleton_backfill_job(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_requeue_skeleton_backfill_jobs_for_course(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE v_count int;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required' USING ERRCODE='42501';
  END IF;
  WITH upd AS (
    UPDATE public.job_queue
    SET status='pending', attempts=0, run_after=now(),
        last_error=NULL, locked_at=NULL, locked_by=NULL, updated_at=now()
    WHERE status IN ('failed','cancelled')
      AND job_type IN ('lesson_generate_content',
                       'package_generate_lesson_minichecks',
                       'council_recompute_course_ready')
      AND NULLIF(payload->>'course_id','')::uuid = _course_id
    RETURNING id
  )
  SELECT COUNT(*)::int INTO v_count FROM upd;
  INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
  VALUES ('skeleton_backfill_jobs_requeued','course',_course_id::text,
          CASE WHEN v_count>0 THEN 'success' ELSE 'noop' END,
          jsonb_build_object('jobs_requeued',v_count,'admin_id',auth.uid()));
  RETURN jsonb_build_object('ok',true,'course_id',_course_id,'jobs_requeued',v_count);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_requeue_skeleton_backfill_jobs_for_course(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_requeue_skeleton_backfill_jobs_for_course(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.admin_get_skeleton_backfill_jobs_for_course(_course_id uuid)
RETURNS TABLE(
  job_id uuid, job_type text, status text, attempts int,
  last_error text, created_at timestamptz, updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT id, job_type, status, attempts, last_error, created_at, updated_at
  FROM public.job_queue
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
    AND job_type IN ('lesson_generate_content',
                     'package_generate_lesson_minichecks',
                     'council_recompute_course_ready')
    AND NULLIF(payload->>'course_id','')::uuid = _course_id
  ORDER BY created_at DESC
  LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.admin_get_skeleton_backfill_jobs_for_course(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_skeleton_backfill_jobs_for_course(uuid) TO authenticated, service_role;