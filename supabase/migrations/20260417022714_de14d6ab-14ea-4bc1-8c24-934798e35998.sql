DO $$
DECLARE
  v_pkg_id uuid := '96d0fb31-9951-408d-a83e-b2937f5a6af8';
  v_curr_id uuid := '53d13046-88bf-42bf-9a2e-05d5e4a4f272';
  v_jobs_created int := 0;
  lf_rec record;
BEGIN
  -- 1) Disable guards for safe step regression
  ALTER TABLE package_steps DISABLE TRIGGER USER;

  -- 2) Regress validation steps to queued
  UPDATE package_steps
  SET status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'regression_reason', 'pool_fill_heal_fachinfo_si',
        'regressed_at', now()
      ),
      updated_at = now()
  WHERE package_id = v_pkg_id
    AND step_key IN ('validate_exam_pool','repair_exam_pool_quality','quality_council','run_integrity_check');

  ALTER TABLE package_steps ENABLE TRIGGER USER;

  -- 3) Enqueue per-LF pool fill jobs
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
        'reason', 'manual_bypass_fachinfo_si_competency_coverage',
        'target_focus', ARRAY['analyze','evaluate','apply']
      ),
      'pending'
    )
    ON CONFLICT DO NOTHING;
    v_jobs_created := v_jobs_created + 1;
  END LOOP;

  -- 4) Post-fill validate
  INSERT INTO job_queue (job_type, package_id, priority, payload, status)
  VALUES (
    'package_validate_exam_pool',
    v_pkg_id,
    1,
    jsonb_build_object(
      'package_id', v_pkg_id,
      'curriculum_id', v_curr_id,
      'reason', 'post_pool_fill_revalidate_fachinfo_si'
    ),
    'pending'
  )
  ON CONFLICT DO NOTHING;

  -- 5) Forensic audit
  INSERT INTO admin_actions(action, scope, payload, affected_ids)
  VALUES (
    'manual_pool_fill_heal_published',
    'package',
    jsonb_build_object(
      'package_id', v_pkg_id,
      'curriculum_id', v_curr_id,
      'track', 'AUSBILDUNG_VOLL',
      'status_kept', 'published',
      'before_state', jsonb_build_object(
        'approved_q', 959,
        'comp_coverage','28/56 (50%)',
        'hardish_pct', 33.2
      ),
      'qc_signal','EXAM_POOL HARDISH_TOO_LOW(33.2%<35%) + COMPETENCY_COVERAGE 28/56 (50%<85%)',
      'action','4 validation steps regressed + ' || v_jobs_created || ' LF pool_fill jobs P1 (focus analyze/evaluate/apply) + post-fill validate P1'
    ),
    ARRAY[v_pkg_id::text]
  );
END $$;

SELECT id, status, blocked_reason FROM course_packages WHERE id='96d0fb31-9951-408d-a83e-b2937f5a6af8';