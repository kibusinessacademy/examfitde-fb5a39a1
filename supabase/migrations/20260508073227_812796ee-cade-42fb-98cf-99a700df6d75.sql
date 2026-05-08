
CREATE OR REPLACE FUNCTION public.admin_bronze_repair_finalize(
  p_package_id uuid, p_repair_summary jsonb DEFAULT '{}'::jsonb
) RETURNS jsonb
  LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_pkg record; v_curriculum_id uuid; v_step_id uuid; v_job_id uuid;
  v_idem text;
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND NOT has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'PERMISSION_DENIED';
  END IF;

  SELECT * INTO v_pkg FROM course_packages WHERE id = p_package_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'PACKAGE_NOT_FOUND: %', p_package_id; END IF;
  v_curriculum_id := v_pkg.curriculum_id;

  UPDATE course_packages
     SET feature_flags = jsonb_set(COALESCE(feature_flags,'{}'::jsonb),'{bronze}',
           COALESCE(feature_flags->'bronze','{}'::jsonb) || jsonb_build_object(
             'repair_active', false,
             'last_repair_completed_at', now(),
             'last_repair_summary', p_repair_summary), true)
   WHERE id = p_package_id;

  -- Direct step reset; allow_regression flag in meta for any guards
  UPDATE package_steps
     SET status='queued', updated_at=now(), started_at=NULL, finished_at=NULL,
         last_error=NULL,
         meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
           'reset_by','admin_bronze_repair_finalize',
           'reset_at', now(),
           'reset_reason','bronze_targeted_repair_completed',
           'allow_regression', true)
   WHERE package_id = p_package_id AND step_key = 'run_integrity_check'
   RETURNING id INTO v_step_id;

  v_idem := 'bronze_repair_integrity:v3:' || p_package_id::text || ':' ||
            COALESCE((v_pkg.feature_flags->'bronze'->>'repair_attempts'),'1');

  BEGIN
    INSERT INTO job_queue (job_type, package_id, status, priority, payload, meta, idempotency_key)
    VALUES (
      'package_run_integrity_check', p_package_id, 'pending', 6,
      jsonb_build_object(
        'package_id', p_package_id,
        'curriculum_id', v_curriculum_id,
        '_origin','bronze_targeted_repair',
        'mode','bronze_targeted_repair',
        'enqueue_source','bronze_targeted_repair',
        'bronze_lock_override', true),
      jsonb_build_object('bronze_repair_followup', true,
        'enqueue_source','bronze_targeted_repair','bronze_lock_override', true),
      v_idem
    ) RETURNING id INTO v_job_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_job_id FROM job_queue WHERE idempotency_key = v_idem LIMIT 1;
  END;

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, result_detail, metadata)
  VALUES ('admin_bronze_repair_finalize','bronze_repair_finalized',
          p_package_id::text,'package','success',
          format('Bronze repair finalized; integrity_check requeued (job %s)', v_job_id),
          jsonb_build_object('package_id', p_package_id,'integrity_job_id', v_job_id,
            'step_id', v_step_id,'summary', p_repair_summary));

  RETURN jsonb_build_object('ok', true,'integrity_job_id', v_job_id,'step_reset', v_step_id);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.admin_bronze_repair_finalize(uuid,jsonb) TO service_role;
