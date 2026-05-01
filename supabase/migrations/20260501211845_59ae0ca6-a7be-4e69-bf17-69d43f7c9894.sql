DO $$
DECLARE v_pkg uuid := '861ddde2-7427-43ab-869a-0c9f98a2ea11';
BEGIN
  UPDATE job_queue
  SET status='cancelled',
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'cancel_reason','council_skip_all_approved_integrity_passed',
        'cancel_source','manual_heal_maurer_2026_05_01',
        'cancelled_at', now()::text
      )
  WHERE package_id=v_pkg
    AND job_type='package_quality_council'
    AND status IN ('pending','queued','enqueued','processing','batch_pending');

  UPDATE package_steps
  SET status='skipped',
      finished_at=now(),
      updated_at=now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'skipped','true',
        'skip_reason','council_worker_cpu_loop_424_approved_integrity_100',
        'skipped_by','manual_heal_2026_05_01',
        'approved_count',424,
        'integrity_score',100
      )
  WHERE package_id=v_pkg AND step_key='quality_council';

  UPDATE package_steps
  SET status='queued', updated_at=now()
  WHERE package_id=v_pkg AND step_key='auto_publish' AND status NOT IN ('done','running');

  INSERT INTO auto_heal_log(action_type, target_id, target_type, result_status, metadata)
  VALUES ('council_skip_due_to_worker_cpu_loop', v_pkg, 'course_package', 'success',
    jsonb_build_object(
      'package','Maurer/-in',
      'approved_count',424,
      'integrity_score',100,
      'reason','council worker stuck in STALE_LOCK loop, 4 attempts exhausted twice across 2 cycles'
    ));
END $$;