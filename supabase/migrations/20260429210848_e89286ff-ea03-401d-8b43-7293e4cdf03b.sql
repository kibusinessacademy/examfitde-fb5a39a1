DO $$
DECLARE
  v_run_id uuid := gen_random_uuid();
  v_pkg_id uuid;
  v_curr_id uuid;
  v_count int := 0;
  
  c_coverage CURSOR FOR
    SELECT id, curriculum_id FROM course_packages 
    WHERE id IN (
      '0b98da0b-00e0-417a-8070-1260eb4f5c35',
      '396567e6-6c3f-44d4-8088-6fef52b14629',
      'beb241ed-58dc-4ddc-930d-ca041dbde99f'
    );
  
  c_integrity CURSOR FOR
    SELECT id, curriculum_id FROM course_packages
    WHERE id IN (
      '060fa7ef-f9b9-4b5e-8590-de8f667ee34d',
      '04634848-89a3-4726-af1f-2f04aa4eacf7'
    );

BEGIN
  OPEN c_coverage;
  LOOP
    FETCH c_coverage INTO v_pkg_id, v_curr_id;
    EXIT WHEN NOT FOUND;
    
    INSERT INTO job_queue (job_type, status, package_id, payload, priority, run_after, lane, worker_pool)
    VALUES (
      'package_repair_exam_pool_competency_coverage', 'pending', v_pkg_id,
      jsonb_build_object('package_id', v_pkg_id, 'curriculum_id', v_curr_id, 'source', 'manual_bulk_heal_v4'),
      85, now(), 'recovery', 'recovery'
    );
    
    UPDATE package_steps 
    SET status = 'queued', last_error = NULL, finished_at = NULL, started_at = NULL, attempts = 0,
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('allow_regression', true, 'allow_regression_by', 'admin_manual', 'regression_reason', 'manual_bulk_heal_v4_coverage_repair')
    WHERE package_id = v_pkg_id AND step_key = 'auto_publish';
    
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, metadata)
    VALUES ('manual_bulk_heal_2026_04_29_v4', 'enqueue_coverage_repair', v_pkg_id, 'course_package',
      'success', jsonb_build_object('run_id', v_run_id, 'reason', 'COVERAGE_GAP <80%'));
    v_count := v_count + 1;
  END LOOP;
  CLOSE c_coverage;
  
  OPEN c_integrity;
  LOOP
    FETCH c_integrity INTO v_pkg_id, v_curr_id;
    EXIT WHEN NOT FOUND;
    
    INSERT INTO job_queue (job_type, status, package_id, payload, priority, run_after, lane, worker_pool)
    VALUES (
      'package_run_integrity_check', 'pending', v_pkg_id,
      jsonb_build_object('package_id', v_pkg_id, 'curriculum_id', v_curr_id, 'source', 'manual_bulk_heal_v4'),
      85, now(), 'control', 'control'
    );
    
    UPDATE package_steps 
    SET status = 'queued', last_error = NULL, finished_at = NULL, started_at = NULL, attempts = 0,
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object('allow_regression', true, 'allow_regression_by', 'admin_manual', 'regression_reason', 'manual_bulk_heal_v4_integrity_refresh')
    WHERE package_id = v_pkg_id AND step_key IN ('run_integrity_check','auto_publish');
    
    INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type, result_status, metadata)
    VALUES ('manual_bulk_heal_2026_04_29_v4', 'enqueue_integrity_refresh', v_pkg_id, 'course_package',
      'success', jsonb_build_object('run_id', v_run_id, 'reason', 'integrity_passed=false stale'));
    v_count := v_count + 1;
  END LOOP;
  CLOSE c_integrity;
  
  RAISE NOTICE 'Targeted Heal v4: % jobs enqueued, run_id=%', v_count, v_run_id;
END $$;