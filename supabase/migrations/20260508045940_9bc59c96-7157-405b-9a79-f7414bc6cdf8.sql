
CREATE OR REPLACE FUNCTION public.admin_regenerate_oral_exam_pool(
  p_package_id uuid,
  p_reason text DEFAULT 'manual_admin_bypass'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg RECORD;
  v_active int;
  v_job_id uuid;
  v_gen_reset int := 0;
  v_val_reset int := 0;
  v_jobs_cancelled int := 0;
BEGIN
  -- Authorization: admin only
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  SELECT id, status::text AS status, curriculum_id, archived
  INTO v_pkg
  FROM course_packages
  WHERE id = p_package_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'package_not_found');
  END IF;

  IF v_pkg.curriculum_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_curriculum');
  END IF;

  -- Don't run on top of an in-flight oral-exam job
  SELECT count(*) INTO v_active
  FROM job_queue
  WHERE payload->>'package_id' = p_package_id::text
    AND job_type IN ('package_generate_oral_exam','package_validate_oral_exam')
    AND status IN ('pending','queued','processing','running','batch_pending','retry_scheduled');

  IF v_active > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'oral_jobs_active',
      'active_jobs', v_active,
      'hint', 'cancel pending oral jobs first or wait until they settle'
    );
  END IF;

  -- Cancel old non-active oral validate jobs (housekeeping)
  UPDATE job_queue
  SET status = 'cancelled',
      last_error = COALESCE(last_error,'') ||
        format(' [admin_regenerate_oral_exam_pool: superseded by manual regen at %s]', now())
  WHERE payload->>'package_id' = p_package_id::text
    AND job_type IN ('package_validate_oral_exam')
    AND status IN ('failed','pending');
  GET DIAGNOSTICS v_jobs_cancelled = ROW_COUNT;

  -- Reset oral steps
  UPDATE package_steps
  SET status = 'queued'::step_status,
      attempts = 0,
      last_error = NULL,
      started_at = NULL,
      finished_at = NULL,
      runner_id = NULL,
      job_id = NULL,
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'admin_regen_at', to_jsonb(now()),
        'admin_regen_reason', p_reason
      )
  WHERE package_id = p_package_id
    AND step_key = 'generate_oral_exam';
  GET DIAGNOSTICS v_gen_reset = ROW_COUNT;

  UPDATE package_steps
  SET status = 'queued'::step_status,
      attempts = 0,
      last_error = NULL,
      started_at = NULL,
      finished_at = NULL,
      runner_id = NULL,
      job_id = NULL,
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'admin_regen_at', to_jsonb(now()),
        'admin_regen_reason', p_reason
      )
  WHERE package_id = p_package_id
    AND step_key = 'validate_oral_exam';
  GET DIAGNOSTICS v_val_reset = ROW_COUNT;

  -- Enqueue fresh generate job with admin bypass markers
  INSERT INTO job_queue (job_type, payload, status, max_attempts, priority)
  VALUES (
    'package_generate_oral_exam',
    jsonb_build_object(
      'package_id', p_package_id,
      'curriculum_id', v_pkg.curriculum_id,
      'step_key', 'generate_oral_exam',
      'enqueue_source', 'admin_oral_pool_regen',
      'bronze_lock_override', true,
      'admin_regen_reason', p_reason,
      'admin_regen_at', to_jsonb(now())
    ),
    'pending',
    3,
    5
  )
  RETURNING id INTO v_job_id;

  -- Audit
  INSERT INTO auto_heal_log (
    trigger_source, action_type, target_id, target_type,
    result_status, result_detail, metadata
  )
  VALUES (
    'admin_regenerate_oral_exam_pool',
    'oral_exam_pool_manual_regen',
    p_package_id::text, 'package',
    'success',
    format('Manual oral-exam pool regen enqueued (job=%s)', v_job_id),
    jsonb_build_object(
      'package_id', p_package_id,
      'job_id', v_job_id,
      'reason', p_reason,
      'gen_step_reset', v_gen_reset,
      'val_step_reset', v_val_reset,
      'jobs_cancelled', v_jobs_cancelled,
      'invoked_by', auth.uid()
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'job_id', v_job_id,
    'gen_step_reset', v_gen_reset,
    'val_step_reset', v_val_reset,
    'jobs_cancelled', v_jobs_cancelled,
    'reason', p_reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.admin_regenerate_oral_exam_pool(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_regenerate_oral_exam_pool(uuid, text) TO authenticated, service_role;

COMMENT ON FUNCTION public.admin_regenerate_oral_exam_pool(uuid, text) IS
'Admin-only manual bypass to regenerate the oral-exam pool for a single package. Resets generate_oral_exam + validate_oral_exam steps and enqueues a fresh package_generate_oral_exam job with bronze_lock_override + enqueue_source=admin_oral_pool_regen. Audited in auto_heal_log.';
