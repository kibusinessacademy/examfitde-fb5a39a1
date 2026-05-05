
CREATE OR REPLACE FUNCTION public.admin_test_heal_contract(p_package_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
DECLARE
  v_dag_block jsonb;
  v_retry jsonb;
  v_step_status_before text;
  v_step_status_after  text;
  v_jobs_before int := 0;
  v_jobs_after  int := 0;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM course_packages WHERE id = p_package_id) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'package_not_found');
  END IF;

  -- Test 1: DAG-Block-Pfad
  BEGIN
    INSERT INTO job_queue (job_type, status, payload, package_id, created_at)
    VALUES ('package_quality_council', 'running',
            jsonb_build_object('package_id', p_package_id, 'step_key','quality_council','_test', true),
            p_package_id, now());
    v_dag_block := admin_retry_failed_step(p_package_id, 'quality_council', 'self_test_dag_block');
    RAISE EXCEPTION 'EXAMFIT_ROLLBACK_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'EXAMFIT_ROLLBACK_OK' AND v_dag_block IS NULL THEN
      v_dag_block := jsonb_build_object('ok', false, 'reason', SQLERRM);
    END IF;
  END;

  -- Test 2: Retry-Pfad
  BEGIN
    SELECT status::text INTO v_step_status_before
      FROM package_steps
     WHERE package_id = p_package_id AND step_key = 'quality_council';

    SELECT COUNT(*) INTO v_jobs_before
      FROM job_queue
     WHERE package_id = p_package_id AND job_type = 'package_quality_council';

    UPDATE package_steps
       SET status = 'failed'::step_status,
           last_error = 'self_test_setup',
           updated_at = now()
     WHERE package_id = p_package_id AND step_key = 'quality_council';

    v_retry := admin_retry_failed_step(p_package_id, 'quality_council', 'self_test_retry');

    SELECT status::text INTO v_step_status_after
      FROM package_steps
     WHERE package_id = p_package_id AND step_key = 'quality_council';

    SELECT COUNT(*) INTO v_jobs_after
      FROM job_queue
     WHERE package_id = p_package_id AND job_type = 'package_quality_council';

    RAISE EXCEPTION 'EXAMFIT_ROLLBACK_OK';
  EXCEPTION WHEN OTHERS THEN
    IF SQLERRM <> 'EXAMFIT_ROLLBACK_OK' AND v_retry IS NULL THEN
      v_retry := jsonb_build_object('ok', false, 'reason', SQLERRM);
    END IF;
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'package_id', p_package_id,
    'dag_block', jsonb_build_object(
      'rpc_result', v_dag_block,
      'expected_skipped', true,
      'pass',
        COALESCE((v_dag_block->>'skipped')::boolean, false) = true
        AND v_dag_block->>'reason' = 'jobs_already_running'
    ),
    'retry', jsonb_build_object(
      'rpc_result', v_retry,
      'step_status_before', v_step_status_before,
      'step_status_after',  v_step_status_after,
      'jobs_before', v_jobs_before,
      'jobs_after',  v_jobs_after,
      'job_enqueued', v_jobs_after > v_jobs_before,
      'pass',
        COALESCE((v_retry->>'ok')::boolean, false) = true
        AND v_step_status_after IN ('queued','pending_enqueue','running')
        AND v_jobs_after > v_jobs_before
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_test_heal_contract(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_test_heal_contract(uuid) TO service_role;
