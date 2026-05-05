-- Course Pipeline Readiness: MiniCheck retry/requeue RPCs
-- Mirror to skeleton-backfill RPCs but for minicheck_generation jobs.

-- Per-course MiniCheck job list
CREATE OR REPLACE FUNCTION public.admin_get_minicheck_jobs_for_course(_course_id uuid)
RETURNS TABLE(
  job_id uuid,
  job_type text,
  status text,
  attempts int,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    j.id AS job_id,
    j.job_type,
    j.status,
    COALESCE(j.attempts, 0) AS attempts,
    COALESCE(j.last_error, j.error) AS last_error,
    j.created_at,
    j.updated_at
  FROM public.job_queue j
  WHERE public.has_role(auth.uid(), 'admin')
    AND j.job_type IN (
      'package_generate_lesson_minichecks',
      'mini_check_generation',
      'upgrade_minichecks_v1',
      'lesson_minicheck_generation'
    )
    AND (
      (j.payload ->> 'course_id')::uuid = _course_id
      OR (j.payload ->> 'curriculum_id')::uuid = (
        SELECT curriculum_id FROM public.courses WHERE id = _course_id
      )
    )
  ORDER BY j.created_at DESC
  LIMIT 100;
$$;

-- Single retry: failed/cancelled minicheck job → pending
CREATE OR REPLACE FUNCTION public.admin_retry_minicheck_job(_job_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.job_queue%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT * INTO v_job FROM public.job_queue WHERE id = _job_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
  END IF;

  IF v_job.job_type NOT IN (
    'package_generate_lesson_minichecks',
    'mini_check_generation',
    'upgrade_minichecks_v1',
    'lesson_minicheck_generation'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_a_minicheck_job');
  END IF;

  IF v_job.status NOT IN ('failed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_retryable', 'status', v_job.status);
  END IF;

  PERFORM set_config('app.transition_source', 'admin_ui:retry_minicheck:' || COALESCE(v_uid::text,'system'), true);

  UPDATE public.job_queue
     SET status = 'pending',
         attempts = 0,
         run_after = now(),
         last_error = NULL,
         updated_at = now()
   WHERE id = _job_id;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'minicheck_job_retried',
    'job',
    _job_id,
    'success',
    jsonb_build_object(
      'job_type', v_job.job_type,
      'previous_status', v_job.status,
      'previous_attempts', v_job.attempts,
      'admin_user_id', v_uid
    )
  );

  RETURN jsonb_build_object('ok', true, 'job_id', _job_id);
END;
$$;

-- Bulk requeue: all failed/cancelled minicheck jobs for a course → pending
CREATE OR REPLACE FUNCTION public.admin_requeue_minicheck_jobs_for_course(_course_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_curriculum uuid;
  v_count int := 0;
BEGIN
  IF NOT public.has_role(v_uid, 'admin') THEN
    RAISE EXCEPTION 'forbidden';
  END IF;

  SELECT curriculum_id INTO v_curriculum FROM public.courses WHERE id = _course_id;

  PERFORM set_config('app.transition_source', 'admin_ui:requeue_minichecks:' || COALESCE(v_uid::text,'system'), true);

  WITH upd AS (
    UPDATE public.job_queue
       SET status = 'pending',
           attempts = 0,
           run_after = now(),
           last_error = NULL,
           updated_at = now()
     WHERE job_type IN (
             'package_generate_lesson_minichecks',
             'mini_check_generation',
             'upgrade_minichecks_v1',
             'lesson_minicheck_generation'
           )
       AND status IN ('failed', 'cancelled')
       AND (
         (payload ->> 'course_id')::uuid = _course_id
         OR (v_curriculum IS NOT NULL AND (payload ->> 'curriculum_id')::uuid = v_curriculum)
       )
     RETURNING id
  )
  SELECT count(*) INTO v_count FROM upd;

  INSERT INTO public.auto_heal_log(action_type, target_type, target_id, result_status, metadata)
  VALUES (
    'minicheck_jobs_requeued',
    'course',
    _course_id,
    CASE WHEN v_count > 0 THEN 'success' ELSE 'noop' END,
    jsonb_build_object(
      'jobs_requeued', v_count,
      'curriculum_id', v_curriculum,
      'admin_user_id', v_uid
    )
  );

  RETURN jsonb_build_object('ok', true, 'jobs_requeued', v_count);
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_minicheck_jobs_for_course(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_retry_minicheck_job(uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.admin_requeue_minicheck_jobs_for_course(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_minicheck_jobs_for_course(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_retry_minicheck_job(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_requeue_minicheck_jobs_for_course(uuid) TO authenticated;