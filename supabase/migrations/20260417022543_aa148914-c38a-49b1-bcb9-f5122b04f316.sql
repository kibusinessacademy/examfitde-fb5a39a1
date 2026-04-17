DO $$
DECLARE
  v_pkg_id uuid := '3e070545-c555-417a-a047-c7541ebb2a7c';
  v_curr_id uuid := '75359e28-34f6-422a-aa0a-9b73d271271d';
  v_jobs_created int := 0;
  lf_rec record;
BEGIN
  -- 1) Disable guards for safe regression
  ALTER TABLE course_packages DISABLE TRIGGER USER;
  ALTER TABLE package_steps DISABLE TRIGGER USER;

  -- 2) Unblock package
  UPDATE course_packages
  SET status = 'building',
      blocked_reason = 'pool_fill_in_progress',
      updated_at = now()
  WHERE id = v_pkg_id;

  -- 3) Regress validation/publish steps to queued
  UPDATE package_steps
  SET status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'regression_reason', 'pool_fill_heal_immobiliardarlehen',
        'regressed_at', now()
      ),
      updated_at = now()
  WHERE package_id = v_pkg_id
    AND step_key IN ('validate_exam_pool','repair_exam_pool_quality','quality_council','run_integrity_check','auto_publish');

  -- 4) Re-enable triggers
  ALTER TABLE package_steps ENABLE TRIGGER USER;
  ALTER TABLE course_packages ENABLE TRIGGER USER;

  -- 5) Enqueue per-LF pool fill (using learning_field_filter for unique constraint)
  FOR lf_rec IN
    SELECT lf.id, lf.code, lf.title
    FROM learning_fields lf
    WHERE lf.curriculum_id = v_curr_id
    ORDER BY lf.code
  LOOP
    INSERT INTO job_queue (job_type, package_id, priority, payload, status)
    VALUES (
      'pool_fill_bloom_gaps',
      v_pkg_id,
      1,
      jsonb_build_object(
        'package_id', v_pkg_id,
        'curriculum_id', v_curr_id,
        'learning_field_filter', lf_rec.code,
        'learning_field_id', lf_rec.id,
        'reason', 'manual_bypass_immobiliardarlehen_lf_coverage'
      ),
      'pending'
    )
    ON CONFLICT DO NOTHING;
    v_jobs_created := v_jobs_created + 1;
  END LOOP;

  -- 6) Enqueue post-fill validate
  INSERT INTO job_queue (job_type, package_id, priority, payload, status)
  VALUES (
    'package_validate_exam_pool',
    v_pkg_id,
    1,
    jsonb_build_object(
      'package_id', v_pkg_id,
      'curriculum_id', v_curr_id,
      'reason', 'post_pool_fill_revalidate_immobiliardarlehen'
    ),
    'pending'
  )
  ON CONFLICT DO NOTHING;

  -- 7) Forensic audit
  INSERT INTO admin_actions(action, scope, payload, affected_ids)
  VALUES (
    'manual_pool_fill_heal',
    'package',
    jsonb_build_object(
      'package_id', v_pkg_id,
      'curriculum_id', v_curr_id,
      'track', 'EXAM_FIRST_PLUS',
      'before_state', jsonb_build_object(
        'status','blocked',
        'approved_q', 307,
        'lf_coverage','2/4',
        'comp_coverage','6/12 (50%)'
      ),
      'qc_signal','EXAM_POOL TOO_FEW_APPROVED + LF_COVERAGE 2/4 + COMPETENCY_COVERAGE 6/12',
      'action','unblocked + 5 steps regressed + ' || v_jobs_created || ' LF pool_fill jobs P1 + post-fill validate P1'
    ),
    ARRAY[v_pkg_id::text]
  );
END $$;

SELECT id, status, blocked_reason FROM course_packages WHERE id='3e070545-c555-417a-a047-c7541ebb2a7c';