CREATE OR REPLACE FUNCTION public.fn_detect_and_heal_dag_enqueue_drift()
RETURNS TABLE(packages_healed int, jobs_enqueued int, steps_reset int)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pkgs_healed int := 0;
  v_jobs_enq int := 0;
  v_steps_reset int := 0;
  v_rec record;
BEGIN
  WITH targets AS (
    SELECT ps.package_id, ps.step_key
    FROM package_steps ps
    WHERE ps.status = 'failed'
      AND COALESCE(ps.attempts, 0) < 5
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.payload->>'package_id' = ps.package_id::text
          AND jq.job_type = 'package_' || ps.step_key
          AND jq.status IN ('pending','processing','queued')
      )
      AND ps.step_key IN ('quality_council','run_integrity_check','validate_lesson_minichecks','generate_learning_content','generate_exam_pool')
  )
  UPDATE package_steps ps
  SET status='queued', attempts=0, last_error=NULL, updated_at=now()
  FROM targets t
  WHERE ps.package_id=t.package_id AND ps.step_key=t.step_key;
  GET DIAGNOSTICS v_steps_reset = ROW_COUNT;

  FOR v_rec IN
    SELECT DISTINCT ps.package_id, ps.step_key, 'package_' || ps.step_key AS job_type
    FROM package_steps ps
    JOIN course_packages cp ON cp.id = ps.package_id
    WHERE ps.status = 'queued'
      AND cp.status = 'building'
      AND ps.step_key IN ('quality_council','run_integrity_check','validate_lesson_minichecks','generate_learning_content','generate_exam_pool','auto_publish','finalize_learning_content')
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.payload->>'package_id' = ps.package_id::text
          AND jq.job_type = 'package_' || ps.step_key
          AND jq.status IN ('pending','processing','queued')
      )
  LOOP
    BEGIN
      INSERT INTO job_queue(job_type, status, payload, priority, max_attempts, lane, worker_pool, enqueue_source, run_after, created_at, updated_at)
      VALUES (
        v_rec.job_type, 'pending',
        jsonb_build_object('package_id', v_rec.package_id, 'step_key', v_rec.step_key),
        100, 8,
        CASE WHEN v_rec.step_key IN ('run_integrity_check','validate_lesson_minichecks') THEN 'recovery' ELSE 'control' END,
        'default',
        'pattern_x13_drift_heal',
        now(), now(), now()
      );
      v_jobs_enq := v_jobs_enq + 1;
      v_pkgs_healed := v_pkgs_healed + 1;
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, metadata)
      VALUES('pattern_x13_council_drift_heal','package',v_rec.package_id,'enqueued',
             jsonb_build_object('step_key',v_rec.step_key,'job_type',v_rec.job_type,'pattern','X13'));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(action_type, target_type, target_id, result_status, error_message, metadata)
      VALUES('pattern_x13_council_drift_heal','package',v_rec.package_id,'error',SQLERRM,
             jsonb_build_object('step_key',v_rec.step_key,'pattern','X13'));
    END;
  END LOOP;

  RETURN QUERY SELECT v_pkgs_healed, v_jobs_enq, v_steps_reset;
END;
$$;

REVOKE ALL ON FUNCTION public.fn_detect_and_heal_dag_enqueue_drift() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_detect_and_heal_dag_enqueue_drift() TO service_role;

SELECT * FROM public.fn_detect_and_heal_dag_enqueue_drift();