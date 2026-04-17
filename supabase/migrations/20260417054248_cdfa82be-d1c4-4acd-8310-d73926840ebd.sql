DO $$
DECLARE
  v_pkg uuid := '176f51ad-fe34-596e-9b3d-d1c9cd23b0a9';
  v_curr uuid := 'c448a7f5-b677-55bf-8a60-1c762317045c';
  v_course uuid := '02c79f53-ceac-5b81-aae0-181ce8391c7a';
BEGIN
  UPDATE package_steps
  SET status = 'queued', attempts = 0, last_error = NULL, updated_at = now()
  WHERE package_id = v_pkg
    AND step_key IN (
      'generate_exam_pool','validate_exam_pool','repair_exam_pool_quality',
      'generate_oral_exam','validate_oral_exam',
      'build_ai_tutor_index','validate_tutor_index',
      'elite_harden','run_integrity_check','quality_council','auto_publish'
    );

  UPDATE course_packages
  SET status = 'queued',
      build_progress = 30,
      integrity_report = COALESCE(integrity_report, '{}'::jsonb) || jsonb_build_object(
        'manual_heal_at', now(),
        'manual_heal_by', 'heal_personalfachk_2026_04_17',
        'manual_heal_reason', 'pool_gap_215of500_only_2of8_lfs_covered_restart_pipeline'
      ),
      updated_at = now()
  WHERE id = v_pkg;

  INSERT INTO job_queue (job_type, package_id, payload, status, priority, max_attempts)
  VALUES (
    'package_generate_exam_pool',
    v_pkg,
    jsonb_build_object(
      'mode','factory',
      'course_id',v_course,
      'package_id',v_pkg,
      'curriculum_id',v_curr,
      'source','manual_heal_personalfachk_2026_04_17',
      'target_lfs_with_gap',true,
      'feature_flags', jsonb_build_object(
        'has_ai_tutor', true,
        'has_handbook', false,
        'ai_tutor_mode','limited_exam',
        'has_minichecks', false,
        'has_exam_trainer', true,
        'oral_trainer_mode','didactic_viva',
        'has_exam_simulation', true,
        'has_learning_course', false,
        'oral_trainer_enabled', true,
        'has_oral_exam_trainer', true,
        'has_practice_course_h5p', false
      )
    ),
    'pending', 9, 3
  );

  INSERT INTO admin_actions (action, scope, payload, affected_ids)
  VALUES (
    'manual_heal_personalfachkaufmann_pool_restart',
    'package',
    jsonb_build_object(
      'package_id', v_pkg,
      'reason', 'release_block: only 2/8 LFs covered (LF01=120, LF05=95), need 6 more LFs to reach Gate >=500',
      'new_status', 'queued',
      'enqueued_job', 'package_generate_exam_pool'
    ),
    ARRAY[v_pkg::text]
  );
END $$;