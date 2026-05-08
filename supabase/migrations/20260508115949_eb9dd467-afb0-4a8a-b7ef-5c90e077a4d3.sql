DO $$
DECLARE
  v_pkg RECORD; v_repair jsonb; v_nudge jsonb; v_retry jsonb;
  v_has_failed_publish boolean;
  v_count int := 0; v_repair_ok int := 0; v_nudge_ok int := 0;
  v_publish_retry int := 0; v_errors int := 0;
BEGIN
  INSERT INTO auto_heal_log (action_type, target_type, result_status, trigger_source, result_detail)
  SELECT 'bypass_building_stall_forensics', 'system', 'success', 'one_time_sql_bypass',
    jsonb_build_object(
      'snapshot_at', now(),
      'stalled_packages', (
        SELECT jsonb_agg(jsonb_build_object(
          'id', cp.id, 'package_key', cp.package_key,
          'approved_q', (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved'),
          'auto_publish_failed', EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id=cp.id AND ps.step_key='auto_publish' AND ps.status::text='failed')
        ))
        FROM course_packages cp
        WHERE cp.status='building' AND COALESCE(cp.archived,false)=false
          AND NOT EXISTS (SELECT 1 FROM job_queue j WHERE j.package_id=cp.id AND j.status IN ('pending','processing','queued','retry_scheduled','batch_pending'))
          AND EXISTS (SELECT 1 FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved')
      )
    );

  FOR v_pkg IN
    SELECT cp.id, cp.package_key
    FROM course_packages cp
    WHERE cp.status='building' AND COALESCE(cp.archived,false)=false
      AND NOT EXISTS (SELECT 1 FROM job_queue j WHERE j.package_id=cp.id AND j.status IN ('pending','processing','queued','retry_scheduled','batch_pending'))
      AND EXISTS (SELECT 1 FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved')
    ORDER BY (SELECT COUNT(*) FROM exam_questions eq WHERE eq.package_id=cp.id AND eq.status='approved') DESC
  LOOP
    v_count := v_count + 1;
    BEGIN
      SELECT public.admin_content_repair_workflow(v_pkg.id, false) INTO v_repair;
      v_repair_ok := v_repair_ok + 1;
    EXCEPTION WHEN OTHERS THEN
      v_repair := jsonb_build_object('error', SQLERRM); v_errors := v_errors + 1;
    END;

    SELECT EXISTS (SELECT 1 FROM package_steps ps WHERE ps.package_id=v_pkg.id AND ps.step_key='auto_publish' AND ps.status::text='failed') INTO v_has_failed_publish;
    IF v_has_failed_publish THEN
      BEGIN
        SELECT public.admin_retry_failed_step(v_pkg.id, 'auto_publish', 'bypass_building_stall_heal') INTO v_retry;
        v_publish_retry := v_publish_retry + 1;
      EXCEPTION WHEN OTHERS THEN v_retry := jsonb_build_object('error', SQLERRM); END;
    ELSE v_retry := NULL; END IF;

    BEGIN
      SELECT public.admin_nudge_atomic_trigger(v_pkg.id, false) INTO v_nudge;
      v_nudge_ok := v_nudge_ok + 1;
    EXCEPTION WHEN OTHERS THEN v_nudge := jsonb_build_object('error', SQLERRM); END;

    INSERT INTO auto_heal_log (target_id, action_type, target_type, result_status, trigger_source, result_detail)
    VALUES (v_pkg.id, 'bypass_building_stall_heal', 'package',
      CASE WHEN (v_repair ? 'error') OR (v_nudge ? 'error') THEN 'partial' ELSE 'success' END,
      'one_time_sql_bypass',
      jsonb_build_object('package_key', v_pkg.package_key, 'content_repair', v_repair,
                         'auto_publish_retry', v_retry, 'atomic_nudge', v_nudge));
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, result_status, trigger_source, result_detail)
  VALUES ('bypass_building_stall_run_summary', 'system', 'success', 'one_time_sql_bypass',
    jsonb_build_object('processed', v_count, 'content_repair_ok', v_repair_ok,
                       'atomic_nudge_ok', v_nudge_ok, 'auto_publish_retried', v_publish_retry,
                       'errors', v_errors, 'finished_at', now()));
END $$;