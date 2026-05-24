-- =====================================================================
-- P1.1 Governance Recovery Verifier — SQL Smoke Tests
-- Wrapped in BEGIN/ROLLBACK; no persistent state.
--
-- Covers (per spec):
--   1. recovered classification → audit row 'governance_completion_recovery_verified'
--   2. stuck classification     → audit row 'governance_completion_recovery_stuck'
--   3. no mutation invariant    → only auto_heal_log changes; course_packages
--                                  and job_queue rows are byte-identical pre/post
--   4. no integrity dispatch    → no new rows in job_queue
--   5. no duplicate audit spam  → second run produces 0 new audit rows
--   6. dry-run mode             → would_verify/would_stuck > 0 but 0 audits written
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_curr_id uuid;
  v_curr_id2 uuid;
  v_pkg_recovered uuid := gen_random_uuid();
  v_pkg_stuck uuid := gen_random_uuid();
  v_job_recovered uuid := gen_random_uuid();
  v_job_stuck uuid := gen_random_uuid();
  v_dispatched_at timestamptz := now() - interval '125 minutes';

  v_cp_hash_before text;
  v_cp_hash_after  text;
  v_jq_hash_before text;
  v_jq_hash_after  text;
  v_jq_count_before int;
  v_jq_count_after  int;
  v_audit_before int;

  v_result jsonb;
  v_dry_result jsonb;

  v_verified_audit int;
  v_stuck_audit int;
  v_failures int := 0;

  v_run2 jsonb;
BEGIN
  
  SELECT id INTO v_curr_id FROM curricula ORDER BY id LIMIT 1;
  SELECT id INTO v_curr_id2 FROM curricula ORDER BY id OFFSET 1 LIMIT 1;
  IF v_curr_id IS NULL OR v_curr_id2 IS NULL THEN
    RAISE EXCEPTION 'Test prerequisite missing: need >=2 curricula';
  END IF;

  -- Fixture 1: recovered package — quality_report present, job completed
  INSERT INTO course_packages(id, title, status, curriculum_id, package_key,
                              quality_report, council_approved)
  VALUES (v_pkg_recovered, '__verifier_smoke_recovered__', 'building',
          v_curr_id, 'verifier_smoke_recovered_' || extract(epoch from now())::bigint,
          jsonb_build_object('overall_score', 88, 'verdict', 'PASS'),
          true);

  INSERT INTO job_queue(id, job_type, status, package_id, payload, result, created_at, completed_at)
  VALUES (v_job_recovered, 'package_quality_council', 'completed',
          v_pkg_recovered, jsonb_build_object('curriculum_id', v_curr_id, 'package_id', v_pkg_recovered),
          jsonb_build_object('ok', true), v_dispatched_at, v_dispatched_at + interval '10 minutes');

  -- Fixture 2: stuck package — no quality_report, job failed, dispatched >60min ago
  INSERT INTO course_packages(id, title, status, curriculum_id, package_key,
                              quality_report, council_approved)
  VALUES (v_pkg_stuck, '__verifier_smoke_stuck__', 'building',
          v_curr_id2, 'verifier_smoke_stuck_' || extract(epoch from now())::bigint,
          NULL, false);

  INSERT INTO job_queue(id, job_type, status, package_id, payload, last_error, created_at)
  VALUES (v_job_stuck, 'package_quality_council', 'failed',
          v_pkg_stuck, jsonb_build_object('curriculum_id', v_curr_id2, 'package_id', v_pkg_stuck), 'council validator timeout', v_dispatched_at);

  -- Dispatch audit rows (this is what the verifier reads)
  INSERT INTO auto_heal_log(action_type, target_id, target_type, result_status, metadata, created_at)
  VALUES
    ('governance_completion_recovery_dispatched',
     v_pkg_recovered::text, 'course_package', 'success',
     jsonb_build_object('package_key', 'verifier_smoke_recovered',
                        'job_id', v_job_recovered,
                        'reason_codes', jsonb_build_array('no_quality_report'),
                        'risk_level', 'low'),
     v_dispatched_at),
    ('governance_completion_recovery_dispatched',
     v_pkg_stuck::text, 'course_package', 'success',
     jsonb_build_object('package_key', 'verifier_smoke_stuck',
                        'job_id', v_job_stuck,
                        'reason_codes', jsonb_build_array('no_quality_report'),
                        'risk_level', 'low'),
     v_dispatched_at);

  -- Snapshot state pre-run for mutation invariant
  SELECT md5(string_agg(c::text, '|' ORDER BY c::text))
    INTO v_cp_hash_before
    FROM course_packages c
    WHERE id IN (v_pkg_recovered, v_pkg_stuck);
  SELECT md5(string_agg(j::text, '|' ORDER BY j::text))
    INTO v_jq_hash_before
    FROM job_queue j
    WHERE id IN (v_job_recovered, v_job_stuck);
  SELECT count(*) INTO v_jq_count_before FROM job_queue;
  SELECT count(*) INTO v_audit_before FROM auto_heal_log;

  -- =========================================================
  -- TEST A: dry-run mode — must NOT write audits
  -- =========================================================
  v_dry_result := public.fn_verify_governance_completion_recovery(true);

  IF (v_dry_result->>'would_verify')::int < 1 THEN
    RAISE WARNING 'TEST A FAIL: dry-run did not project a verified row, got %', v_dry_result;
    v_failures := v_failures + 1;
  END IF;
  IF (v_dry_result->>'would_stuck')::int < 1 THEN
    RAISE WARNING 'TEST A FAIL: dry-run did not project a stuck row, got %', v_dry_result;
    v_failures := v_failures + 1;
  END IF;
  IF (v_dry_result->>'verified')::int <> 0 OR (v_dry_result->>'stuck')::int <> 0 THEN
    RAISE WARNING 'TEST A FAIL: dry-run wrote audits, got %', v_dry_result;
    v_failures := v_failures + 1;
  END IF;
  IF (SELECT count(*) FROM auto_heal_log) <> v_audit_before THEN
    RAISE WARNING 'TEST A FAIL: dry-run mutated auto_heal_log';
    v_failures := v_failures + 1;
  END IF;

  -- =========================================================
  -- TEST B: live run — classifies recovered + stuck, writes audits
  -- =========================================================
  v_result := public.fn_verify_governance_completion_recovery(false);

  IF (v_result->>'verified')::int < 1 THEN
    RAISE WARNING 'TEST B FAIL: expected verified>=1, got %', v_result;
    v_failures := v_failures + 1;
  END IF;
  IF (v_result->>'stuck')::int < 1 THEN
    RAISE WARNING 'TEST B FAIL: expected stuck>=1, got %', v_result;
    v_failures := v_failures + 1;
  END IF;

  SELECT count(*) INTO v_verified_audit FROM auto_heal_log
   WHERE action_type = 'governance_completion_recovery_verified'
     AND target_id = v_pkg_recovered::text;
  SELECT count(*) INTO v_stuck_audit FROM auto_heal_log
   WHERE action_type = 'governance_completion_recovery_stuck'
     AND target_id = v_pkg_stuck::text;

  IF v_verified_audit <> 1 THEN
    RAISE WARNING 'TEST B FAIL: expected exactly 1 verified audit, got %', v_verified_audit;
    v_failures := v_failures + 1;
  END IF;
  IF v_stuck_audit <> 1 THEN
    RAISE WARNING 'TEST B FAIL: expected exactly 1 stuck audit, got %', v_stuck_audit;
    v_failures := v_failures + 1;
  END IF;

  -- =========================================================
  -- TEST C: no mutation invariant — package + job rows unchanged
  -- =========================================================
  SELECT md5(string_agg(c::text, '|' ORDER BY c::text))
    INTO v_cp_hash_after
    FROM course_packages c
    WHERE id IN (v_pkg_recovered, v_pkg_stuck);
  SELECT md5(string_agg(j::text, '|' ORDER BY j::text))
    INTO v_jq_hash_after
    FROM job_queue j
    WHERE id IN (v_job_recovered, v_job_stuck);
  SELECT count(*) INTO v_jq_count_after FROM job_queue;

  IF v_cp_hash_before IS DISTINCT FROM v_cp_hash_after THEN
    RAISE WARNING 'TEST C FAIL: course_packages was mutated';
    v_failures := v_failures + 1;
  END IF;
  IF v_jq_hash_before IS DISTINCT FROM v_jq_hash_after THEN
    RAISE WARNING 'TEST C FAIL: job_queue rows were mutated';
    v_failures := v_failures + 1;
  END IF;
  IF v_jq_count_after <> v_jq_count_before THEN
    RAISE WARNING 'TEST C FAIL: job_queue gained/lost rows (no integrity dispatch invariant)';
    v_failures := v_failures + 1;
  END IF;

  -- =========================================================
  -- TEST D: no duplicate audit spam — second run yields 0 new
  -- =========================================================
  v_run2 := public.fn_verify_governance_completion_recovery(false);
  IF (v_run2->>'verified')::int <> 0 OR (v_run2->>'stuck')::int <> 0 THEN
    RAISE WARNING 'TEST D FAIL: re-run wrote duplicate audits, got %', v_run2;
    v_failures := v_failures + 1;
  END IF;
  IF (v_run2->>'skipped_duplicate')::int < 2 THEN
    RAISE WARNING 'TEST D FAIL: re-run skipped_duplicate < 2, got %', v_run2;
    v_failures := v_failures + 1;
  END IF;

  IF v_failures > 0 THEN
    RAISE EXCEPTION 'governance_recovery_verifier_v1_smoke: % test(s) failed', v_failures;
  END IF;

  RAISE NOTICE 'governance_recovery_verifier_v1_smoke: ALL TESTS PASSED (dry=%, live=%, rerun=%)',
    v_dry_result, v_result, v_run2;
END;
$$;

ROLLBACK;
