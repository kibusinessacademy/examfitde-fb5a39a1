DO $$
DECLARE
  v_pkg uuid; v_retry jsonb; v_nudge jsonb;
  v_publish_retry int := 0; v_nudge_ok int := 0; v_reset_steps int := 0;
BEGIN
  -- 1) Retry auto_publish failed
  FOR v_pkg IN
    SELECT DISTINCT ps.package_id FROM package_steps ps
    JOIN course_packages cp ON cp.id=ps.package_id
    WHERE cp.status='building' AND COALESCE(cp.archived,false)=false
      AND ps.step_key='auto_publish' AND ps.status::text='failed'
  LOOP
    BEGIN
      SELECT public.admin_retry_failed_step(v_pkg, 'auto_publish', 'bypass_building_stall_heal_wave2') INTO v_retry;
      v_publish_retry := v_publish_retry + 1;
      INSERT INTO auto_heal_log (target_id, action_type, target_type, result_status, trigger_source, result_detail)
      VALUES (v_pkg, 'bypass_building_stall_heal_wave2', 'package', 'success', 'one_time_sql_bypass',
              jsonb_build_object('retry_auto_publish', v_retry));
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO auto_heal_log (target_id, action_type, target_type, result_status, trigger_source, error_message)
      VALUES (v_pkg, 'bypass_building_stall_heal_wave2', 'package', 'failed', 'one_time_sql_bypass', SQLERRM);
    END;
  END LOOP;

  -- 2) Tail-Step Debounce-Reset für alle stallenden Pakete
  WITH stalled AS (
    SELECT cp.id FROM course_packages cp
    WHERE cp.status='building' AND COALESCE(cp.archived,false)=false
      AND NOT EXISTS (SELECT 1 FROM job_queue j WHERE j.package_id=cp.id AND j.status IN ('pending','processing','queued','retry_scheduled','batch_pending'))
  ), upd AS (
    UPDATE package_steps ps
    SET meta = COALESCE(meta,'{}'::jsonb) - 'last_atomic_enqueue_at',
        attempts = 0, last_error = NULL, updated_at = now()
    FROM stalled s
    WHERE ps.package_id = s.id
      AND ps.step_key IN ('quality_council','run_integrity_check','auto_publish','repair_exam_pool_quality','validate_tutor_index','validate_oral_exam')
      AND ps.status::text IN ('queued','pending_enqueue','failed','blocked','timeout')
    RETURNING ps.package_id, ps.step_key
  )
  SELECT COUNT(*) INTO v_reset_steps FROM upd;

  -- 3) Nudge alle stalled
  FOR v_pkg IN
    SELECT cp.id FROM course_packages cp
    WHERE cp.status='building' AND COALESCE(cp.archived,false)=false
      AND NOT EXISTS (SELECT 1 FROM job_queue j WHERE j.package_id=cp.id AND j.status IN ('pending','processing','queued','retry_scheduled','batch_pending'))
  LOOP
    BEGIN
      SELECT public.admin_nudge_atomic_trigger(v_pkg, false) INTO v_nudge;
      v_nudge_ok := v_nudge_ok + 1;
    EXCEPTION WHEN OTHERS THEN NULL; END;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, trigger_source, result_detail)
  VALUES ('bypass_building_stall_run_summary_wave2', 'system', 'success', 'one_time_sql_bypass',
    jsonb_build_object('publish_retry', v_publish_retry, 'reset_steps', v_reset_steps,
                       'nudge_ok', v_nudge_ok, 'finished_at', now()));
END $$;