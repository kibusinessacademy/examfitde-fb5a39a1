DO $$
DECLARE
  v_pkg_ids uuid[] := ARRAY[
    'd2000001-0009-4000-8000-000000000001'::uuid,
    '3f416f2f-4364-460c-8924-caa2316a12d0'::uuid,
    'a0b0c0d0-0010-4000-8000-000000000001'::uuid
  ];
  v_steps text[] := ARRAY[
    'generate_learning_content',
    'finalize_learning_content',
    'validate_learning_content',
    'generate_lesson_minichecks',
    'validate_lesson_minichecks',
    'generate_exam_pool',
    'validate_exam_pool',
    'repair_exam_pool_quality',
    'generate_oral_exam',
    'validate_oral_exam',
    'build_ai_tutor_index',
    'validate_tutor_index',
    'quality_council',
    'run_integrity_check',
    'auto_publish'
  ];
  v_reset_count int;
  v_cancelled_count int;
BEGIN
  UPDATE public.package_steps ps
  SET status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      last_heartbeat_at = NULL,
      last_error = 'phase_a_v2_HOLLOW_LEARNING_CONTENT',
      job_id = NULL,
      runner_id = NULL,
      meta = COALESCE(ps.meta, '{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'allow_regression_by', 'ops_sweep',
        'reset_reason', 'HOLLOW_LEARNING_CONTENT',
        'reset_phase', 'A_v2_post_phase_B_hardening',
        'reset_at', now()::text
      ),
      updated_at = now()
  WHERE ps.package_id = ANY(v_pkg_ids)
    AND ps.step_key = ANY(v_steps);
  GET DIAGNOSTICS v_reset_count = ROW_COUNT;

  UPDATE public.job_queue jq
  SET status = 'cancelled',
      completed_at = COALESCE(jq.completed_at, now()),
      result = COALESCE(jq.result, '{}'::jsonb) || jsonb_build_object(
        'cancelled_by', 'phase_a_v2_hollow_heal',
        'cancelled_reason', 'HOLLOW_LEARNING_CONTENT_RESET',
        'cancelled_at', now()::text
      )
  WHERE jq.package_id = ANY(v_pkg_ids)
    AND jq.status IN ('pending', 'enqueued', 'failed')
    AND jq.job_type IN (
      'package_generate_learning_content',
      'package_finalize_learning_content',
      'package_validate_learning_content',
      'package_generate_lesson_minichecks',
      'package_validate_lesson_minichecks',
      'package_generate_exam_pool',
      'package_validate_exam_pool',
      'package_generate_oral_exam',
      'package_validate_oral_exam',
      'package_build_ai_tutor_index',
      'package_validate_tutor_index',
      'package_quality_council',
      'package_run_integrity_check',
      'package_auto_publish'
    );
  GET DIAGNOSTICS v_cancelled_count = ROW_COUNT;

  UPDATE public.course_packages
  SET status = CASE WHEN status IN ('blocked','paused') THEN 'queued' ELSE status END,
      updated_at = now()
  WHERE id = ANY(v_pkg_ids);

  INSERT INTO public.admin_actions (action, scope, payload, affected_ids)
  VALUES (
    'phase_a_v2_hollow_learning_content_heal',
    'pipeline',
    jsonb_build_object(
      'reason', 'HOLLOW_LEARNING_CONTENT',
      'phase', 'A_v2_post_phase_B_hardening',
      'reset_steps', v_reset_count,
      'cancelled_jobs', v_cancelled_count,
      'pkg_ids', v_pkg_ids,
      'guard_thresholds', jsonb_build_object(
        'substantive_ratio_min', 0.90,
        'placeholders_max', 0,
        'pending_jobs_max', 0,
        'avg_len_min', 600
      ),
      'executed_at', now()::text
    ),
    v_pkg_ids
  );

  RAISE NOTICE 'Phase A v2 complete: % steps reset, % jobs cancelled across % packages',
    v_reset_count, v_cancelled_count, array_length(v_pkg_ids, 1);
END $$;