-- Manual DAG-Bypass Heal: Free 54 blocked jobs by reviving missing parents
DO $$
DECLARE
  v_resets int := 0;
  v_enqueued int := 0;
  v_rec record;
BEGIN
  -- Phase 1: Reset failed parents whose children are pending and no active job exists
  WITH pending_children AS (
    SELECT DISTINCT (jq.payload->>'package_id')::uuid AS pkg_id,
           replace(jq.job_type,'package_','') AS child_step
    FROM job_queue jq
    WHERE jq.status='pending' AND jq.job_type LIKE 'package_%'
      AND (jq.payload->>'package_id') IS NOT NULL
  ),
  needed_parents AS (
    SELECT DISTINCT pc.pkg_id, dag.depends_on AS parent_step
    FROM pending_children pc
    JOIN step_dag_edges dag ON dag.step_key=pc.child_step
  ),
  to_reset AS (
    SELECT np.pkg_id, np.parent_step
    FROM needed_parents np
    JOIN package_steps ps ON ps.package_id=np.pkg_id AND ps.step_key=np.parent_step
    WHERE ps.status::text='failed'
  )
  UPDATE package_steps ps
  SET status='queued', last_error=NULL, attempts=0,
      meta = COALESCE(ps.meta,'{}'::jsonb) - 'last_atomic_enqueue_at'
                 || jsonb_build_object('manual_dag_bypass_at', now(),
                                       'manual_dag_bypass_by','operator-2026-05-07'),
      updated_at=now()
  FROM to_reset t
  WHERE ps.package_id=t.pkg_id AND ps.step_key=t.parent_step;
  GET DIAGNOSTICS v_resets = ROW_COUNT;

  -- Phase 2: Enqueue missing parent jobs (queued OR newly-reset, no active job)
  FOR v_rec IN
    WITH pending_children AS (
      SELECT DISTINCT (jq.payload->>'package_id')::uuid AS pkg_id,
             replace(jq.job_type,'package_','') AS child_step
      FROM job_queue jq
      WHERE jq.status='pending' AND jq.job_type LIKE 'package_%'
        AND (jq.payload->>'package_id') IS NOT NULL
    ),
    needed_parents AS (
      SELECT DISTINCT pc.pkg_id, dag.depends_on AS parent_step
      FROM pending_children pc
      JOIN step_dag_edges dag ON dag.step_key=pc.child_step
    )
    SELECT np.pkg_id, np.parent_step, cp.curriculum_id
    FROM needed_parents np
    JOIN package_steps ps ON ps.package_id=np.pkg_id AND ps.step_key=np.parent_step
    JOIN course_packages cp ON cp.id=np.pkg_id
    WHERE ps.status::text IN ('queued','pending_enqueue')
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq2
        WHERE jq2.job_type='package_'||np.parent_step
          AND (jq2.payload->>'package_id')::uuid=np.pkg_id
          AND jq2.status IN ('pending','processing')
      )
  LOOP
    BEGIN
      INSERT INTO job_queue(job_type,status,payload,priority,max_attempts,lane,worker_pool,
                            package_id,run_after,created_at,updated_at,meta)
      VALUES('package_'||v_rec.parent_step,'pending',
             jsonb_build_object('package_id',v_rec.pkg_id,
                                'curriculum_id',v_rec.curriculum_id,
                                'step_key',v_rec.parent_step,
                                'bronze_lock_override',true,
                                '_origin','manual_dag_bypass_heal'),
             50,8,
             CASE WHEN v_rec.parent_step IN ('run_integrity_check','validate_lesson_minichecks','validate_tutor_index','validate_exam_pool')
                  THEN 'recovery' ELSE 'control' END,
             'default',v_rec.pkg_id,now(),now(),now(),
             jsonb_build_object('enqueue_source','manual_dag_bypass_heal',
                                'bronze_lock_override',true,
                                'trigger_source','manual:operator-2026-05-07'));
      v_enqueued := v_enqueued + 1;
      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,trigger_source,metadata)
      VALUES('manual_dag_bypass_heal','package',v_rec.pkg_id,'enqueued',
             'manual:operator-2026-05-07',
             jsonb_build_object('parent_step',v_rec.parent_step,
                                'job_type','package_'||v_rec.parent_step));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,trigger_source,error_message,metadata)
      VALUES('manual_dag_bypass_heal','package',v_rec.pkg_id,'failed',
             'manual:operator-2026-05-07',SQLERRM,
             jsonb_build_object('parent_step',v_rec.parent_step));
    END;
  END LOOP;

  INSERT INTO auto_heal_log(action_type,target_type,target_id,result_status,trigger_source,metadata)
  VALUES('manual_dag_bypass_heal_summary','system',NULL,'success',
         'manual:operator-2026-05-07',
         jsonb_build_object('failed_parents_reset',v_resets,'parents_enqueued',v_enqueued));
END $$;