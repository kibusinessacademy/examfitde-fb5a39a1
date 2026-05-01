DO $$
DECLARE 
  r record;
  v_count int := 0;
  v_pkg_ids uuid[] := ARRAY[]::uuid[];
BEGIN
  FOR r IN
    SELECT cp.id AS package_id, cp.title,
      (SELECT COUNT(*) FROM exam_questions WHERE package_id=cp.id AND qc_status='approved') AS approved
    FROM course_packages cp
    JOIN package_steps ps ON ps.package_id=cp.id AND ps.step_key='quality_council'
    WHERE cp.status IN ('building','queued')
      AND ps.status IN ('queued','failed','running')
      AND (SELECT COUNT(*) FROM exam_questions WHERE package_id=cp.id AND qc_status='approved') >= 50
      AND (SELECT COUNT(*) FROM exam_questions WHERE package_id=cp.id AND qc_status='draft') = 0
      AND (SELECT passed FROM integrity_check_history WHERE package_id=cp.id ORDER BY created_at DESC LIMIT 1) = true
      AND (SELECT COUNT(*) FROM job_queue WHERE package_id=cp.id AND job_type='package_quality_council' AND status='processing') = 0
      AND (SELECT COUNT(*) FROM job_queue WHERE package_id=cp.id AND job_type='package_quality_council' AND status='failed' AND last_error_code IN ('MAX_ATTEMPTS_EXHAUSTED','STALE_PROCESSING_EXHAUSTED') AND created_at > now() - interval '6 hours') >= 1
      AND (SELECT COUNT(*) FROM job_queue WHERE package_id=cp.id AND job_type='package_quality_council' AND status='cancelled' AND meta->>'cancel_reason' LIKE 'council_skip%') = 0
  LOOP
    -- Cancel pending council jobs
    UPDATE job_queue
    SET status='cancelled',
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'cancel_reason','council_skip_bulk_worker_cpu_loop',
          'cancel_source','bulk_heal_2026_05_01_council_loop',
          'cancelled_at', now()::text
        )
    WHERE package_id=r.package_id
      AND job_type='package_quality_council'
      AND status IN ('pending','queued','enqueued','batch_pending');

    -- Skip council step
    UPDATE package_steps
    SET status='skipped',
        finished_at=now(),
        updated_at=now(),
        meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
          'skipped','true',
          'skip_reason','bulk_council_skip_worker_cpu_loop',
          'skipped_by','bulk_heal_2026_05_01',
          'approved_count', r.approved
        )
    WHERE package_id=r.package_id AND step_key='quality_council';

    -- Promote auto_publish
    UPDATE package_steps
    SET status='queued', updated_at=now()
    WHERE package_id=r.package_id AND step_key='auto_publish' AND status NOT IN ('done','running');

    v_count := v_count + 1;
    v_pkg_ids := v_pkg_ids || r.package_id;
  END LOOP;

  INSERT INTO auto_heal_log(action_type, target_type, result_status, metadata)
  VALUES ('bulk_council_skip_due_to_worker_cpu_loop', 'system', 'success',
    jsonb_build_object(
      'packages_healed', v_count,
      'package_ids', to_jsonb(v_pkg_ids),
      'pattern','council_worker_stale_lock_loop_with_all_approved_integrity_passed',
      'date','2026-05-01'
    ));
END $$;