DO $$
DECLARE
  v_pkg uuid; v_nudge jsonb;
  v_pkg_count int := 0; v_steps_reset int := 0; v_nudge_ok int := 0; v_nudge_err int := 0;
BEGIN
  WITH eligible AS (
    SELECT cp.id FROM course_packages cp
    WHERE cp.status='building' AND COALESCE(cp.archived,false)=false
      AND NOT EXISTS (SELECT 1 FROM job_queue j WHERE j.package_id=cp.id AND j.status IN ('pending','processing','queued','retry_scheduled','batch_pending'))
      AND (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved') >= 50
  ), upd AS (
    UPDATE package_steps ps
    SET status = 'queued',
        attempts = 0, last_error = NULL,
        meta = COALESCE(ps.meta,'{}'::jsonb) - 'last_atomic_enqueue_at'
              || jsonb_build_object('reset_reason','bypass_wave3_skipped_to_queued','reset_at', now()),
        updated_at = now()
    FROM eligible e
    WHERE ps.package_id=e.id
      AND ps.step_key IN ('quality_council','run_integrity_check','auto_publish')
      AND ps.status::text = 'skipped'
    RETURNING ps.package_id
  )
  SELECT COUNT(*), COUNT(DISTINCT package_id) INTO v_steps_reset, v_pkg_count FROM upd;

  FOR v_pkg IN
    SELECT cp.id FROM course_packages cp
    WHERE cp.status='building' AND COALESCE(cp.archived,false)=false
      AND (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved') >= 50
  LOOP
    BEGIN
      SELECT public.admin_nudge_atomic_trigger(v_pkg, false) INTO v_nudge;
      v_nudge_ok := v_nudge_ok + 1;
      INSERT INTO auto_heal_log (target_id, action_type, target_type, result_status, trigger_source, result_detail)
      VALUES (v_pkg, 'bypass_building_stall_heal_wave3', 'package', 'success', 'one_time_sql_bypass', v_nudge);
    EXCEPTION WHEN OTHERS THEN
      v_nudge_err := v_nudge_err + 1;
      INSERT INTO auto_heal_log (target_id, action_type, target_type, result_status, trigger_source, error_message)
      VALUES (v_pkg, 'bypass_building_stall_heal_wave3', 'package', 'failed', 'one_time_sql_bypass', SQLERRM);
    END;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, trigger_source, result_detail)
  VALUES ('bypass_building_stall_run_summary_wave3', 'system', 'success', 'one_time_sql_bypass',
    jsonb_build_object('packages_reset', v_pkg_count, 'steps_reset', v_steps_reset,
                       'nudge_ok', v_nudge_ok, 'nudge_err', v_nudge_err, 'finished_at', now()));
END $$;