DO $$
DECLARE
  v_pkg_id uuid := 'c5000000-0004-4000-8000-000000000001';
  v_curr_id uuid;
  v_existing uuid;
BEGIN
  SELECT curriculum_id INTO v_curr_id FROM course_packages WHERE id=v_pkg_id;

  UPDATE package_steps
  SET status='queued', updated_at=now(),
      meta = COALESCE(meta,'{}'::jsonb) || jsonb_build_object(
        'recovery_at', now(),
        'recovery_reason', 'wirtschaftsinf_auto_publish_unblock_2026_05_01',
        'allow_regression', true)
  WHERE package_id=v_pkg_id AND step_key='auto_publish';

  UPDATE course_packages
  SET status='building', last_progress_at=now(),
      blocked_reason=NULL, manual_heal_cooldown_until=NULL
  WHERE id=v_pkg_id AND status='queued';

  SELECT id INTO v_existing FROM job_queue
  WHERE (payload->>'package_id')=v_pkg_id::text
    AND job_type='package_auto_publish'
    AND status IN ('pending','queued','processing');

  IF v_existing IS NULL THEN
    INSERT INTO job_queue (job_type, status, attempts, max_attempts, payload, run_after, priority)
    VALUES ('package_auto_publish', 'pending', 0, 25,
      jsonb_build_object('package_id', v_pkg_id, 'curriculum_id', v_curr_id,
                         'manual_recovery', true,
                         'recovery_reason', 'wirtschaftsinf_2026_05_01'),
      now(), 5);
  END IF;

  INSERT INTO auto_heal_log (trigger_source, action_type, target_id, target_type,
                             result_status, result_detail, metadata)
  VALUES ('manual_migration', 'wirtschaftsinf_auto_publish_unblock', v_pkg_id, 'package',
          'success', 'auto_publish unblocked + job enqueued',
          jsonb_build_object('package_id', v_pkg_id));
END $$;