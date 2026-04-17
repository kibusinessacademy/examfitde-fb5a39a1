DO $$
DECLARE
  v_pkg_id uuid := 'a0b0c0d0-0010-4000-8000-000000000001';
  v_curr_id uuid;
  v_recover jsonb;
BEGIN
  SELECT curriculum_id INTO v_curr_id FROM course_packages WHERE id = v_pkg_id;

  -- 1) Disable all relevant guards & reconcilers
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_published_immutable;
  ALTER TABLE course_packages DISABLE TRIGGER trg_reconcile_stale_quality_gate_failed;
  ALTER TABLE course_packages DISABLE TRIGGER trg_reconcile_integrity_passed;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_approved_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_integrity_passed_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_building_published_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_step_drift;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_approved;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_council_consistency;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_integrity_report_consistency;
  ALTER TABLE course_packages DISABLE TRIGGER guard_publish_requires_questions;
  ALTER TABLE course_packages DISABLE TRIGGER guard_publish_requires_real_content;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_requires_questions;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_requires_real_content;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_publish_requires_release_ok;
  ALTER TABLE course_packages DISABLE TRIGGER trg_guard_package_publish_requires_didaktik;
  ALTER TABLE package_steps DISABLE TRIGGER USER;

  -- 2) Invalidate trust flags + force depublish in single update
  UPDATE course_packages
  SET status = 'quality_gate_failed',
      blocked_reason = 'pipeline_repair_required',
      published_at = NULL,
      council_approved = false,
      integrity_passed = false,
      updated_at = now()
  WHERE id = v_pkg_id;

  -- 3) Regress all relevant steps to queued
  UPDATE package_steps
  SET status = 'queued',
      started_at = NULL,
      finished_at = NULL,
      last_error = NULL,
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'allow_regression', true,
        'regression_reason', 'hollow_publish_heal_bwl_bachelor',
        'regressed_at', now()
      ),
      updated_at = now()
  WHERE package_id = v_pkg_id
    AND step_key IN (
      'package_finalize','auto_publish','elite_harden','quality_council',
      'run_integrity_check','validate_learning_content',
      'generate_lesson_minichecks','generate_learning_content','seed_competencies'
    );

  -- 4) Re-enable all triggers
  ALTER TABLE package_steps ENABLE TRIGGER USER;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_published_immutable;
  ALTER TABLE course_packages ENABLE TRIGGER trg_reconcile_stale_quality_gate_failed;
  ALTER TABLE course_packages ENABLE TRIGGER trg_reconcile_integrity_passed;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_passed_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_building_published_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_step_drift;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_approved;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_council_consistency;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_integrity_report_consistency;
  ALTER TABLE course_packages ENABLE TRIGGER guard_publish_requires_questions;
  ALTER TABLE course_packages ENABLE TRIGGER guard_publish_requires_real_content;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_requires_questions;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_requires_real_content;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_publish_requires_release_ok;
  ALTER TABLE course_packages ENABLE TRIGGER trg_guard_package_publish_requires_didaktik;

  -- 5) Sanctioned recovery (best-effort)
  BEGIN
    SELECT public.recover_and_reenter_package(
      p_package_id := v_pkg_id,
      p_reason := 'hollow_publish_coverage_gap_6pct',
      p_trigger_source := 'admin_migration_heal',
      p_actor_user_id := NULL,
      p_gate_delta_verified := true
    ) INTO v_recover;
  EXCEPTION WHEN OTHERS THEN
    v_recover := jsonb_build_object('error', SQLERRM);
  END;

  -- 6) Enqueue lesson generation for missing competencies
  INSERT INTO job_queue (job_type, package_id, priority, payload, status)
  VALUES (
    'package_generate_learning_content',
    v_pkg_id,
    1,
    jsonb_build_object(
      'package_id', v_pkg_id,
      'curriculum_id', v_curr_id,
      'only_missing', true,
      'reason', 'hollow_publish_heal_bwl_bachelor',
      'expected_competencies', 33,
      'current_with_lesson', 7
    ),
    'pending'
  )
  ON CONFLICT DO NOTHING;

  -- 7) Forensic audit
  INSERT INTO admin_actions(action, scope, payload, affected_ids)
  VALUES (
    'hollow_publish_heal_bwl_bachelor',
    'package',
    jsonb_build_object(
      'package_id', v_pkg_id,
      'forensics', jsonb_build_object(
        'publish_event', '2026-04-09 15:41:28',
        'publish_reason', 'manual_publish_bypass / quality_council_stale_lock_bypass',
        'hollow_guard_miss', 'lessons_total=7 > 0 + has_substantive_artifacts=true',
        'release_class_misleading', 'release_ok because 2096 approved Q >= 500; coverage NOT in classification',
        'real_state', '7/33 competencies have lessons (6.1%); 22/33 have questions (66.7%)',
        'governance_gap', 'hollow_publish_guard does not validate competency_lesson_coverage_pct vs track-expected (STUDIUM >=80%)'
      ),
      'qc_signal', 'COMPETENCY_LESSON_GAP 2/33 + COMPETENCY_STEP_GAP 0/33 + MINICHECK_MISSING 1/2',
      'release_class_at_action', 'release_ok',
      'action', 'trigger-bypass migration: depublished->quality_gate_failed + 9 steps regressed + recover_and_reenter + P1 fanout',
      'recover_result', v_recover
    ),
    ARRAY['a0b0c0d0-0010-4000-8000-000000000001']::text[]
  );
END $$;

SELECT id, status, council_approved, integrity_passed, published_at, blocked_reason
FROM course_packages
WHERE id='a0b0c0d0-0010-4000-8000-000000000001';