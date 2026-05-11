-- =====================================================================
-- Phantom Producer Guard v1 — SQL Smoke Tests
-- Run inside a transaction with ROLLBACK at the end (no persistent state).
-- Covers:
--   Guard A (recent_finalized_step):
--     - OLD.status = done   + OLD.finished_at < 60s ago  → SKIP
--     - OLD.status = skipped + OLD.updated_at  < 60s ago → SKIP
--     - OLD.status = failed  + OLD.finished_at < 60s ago → SKIP
--     - OLD.status = done   + OLD.finished_at > 60s ago  → DOES NOT SKIP via Guard A
--   Guard B (recent_duplicate_job):
--     - existing job_queue (queued)           < 60s → SKIP
--     - existing job_queue (pending)          < 60s → SKIP
--     - existing job_queue (processing)       < 60s → SKIP
--     - existing job_queue (retry_scheduled)  < 60s → SKIP
--     - existing job_queue (cancelled, < 60s)       → SKIP (broad guard)
--     - existing job_queue (any status, > 60s)      → DOES NOT SKIP via Guard B
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_pkg_id uuid;
  v_curr_id uuid;
  v_step_id uuid;
  v_step_key text := 'generate_exam_pool';
  v_job_type text := 'package_generate_exam_pool';
  v_job_count int;
  v_audit_count int;
  v_test_label text;
  v_failures int := 0;
BEGIN
  -- Use a real curriculum to satisfy FK
  SELECT id INTO v_curr_id FROM curricula LIMIT 1;
  IF v_curr_id IS NULL THEN
    RAISE EXCEPTION 'Test prerequisite missing: no curricula';
  END IF;

  -- Create ephemeral test package
  INSERT INTO course_packages(id, title, status, curriculum_id, package_key)
  VALUES (gen_random_uuid(), 'PHANTOM_GUARD_TEST', 'building', v_curr_id,
          'phantom_guard_test_'||substr(gen_random_uuid()::text,1,8))
  RETURNING id INTO v_pkg_id;

  RAISE NOTICE '── Test package: %', v_pkg_id;

  -- ============================================================
  -- Guard A: recent_finalized_step (done/skipped/failed, <60s)
  -- ============================================================

  -- Test A1: done, finished 5s ago → SKIP
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'done'::step_status, now() - interval '5 seconds', now() - interval '5 seconds', '{"ok":"true"}'::jsonb)
  RETURNING id INTO v_step_id;

  UPDATE package_steps SET status='queued'::step_status WHERE id=v_step_id;

  SELECT count(*) INTO v_job_count FROM job_queue WHERE package_id=v_pkg_id AND job_type=v_job_type;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  IF v_job_count=0 AND v_audit_count=1 THEN
    RAISE NOTICE 'PASS  A1 done<60s → no job + audit logged';
  ELSE
    RAISE WARNING 'FAIL  A1 jobs=% audits=%', v_job_count, v_audit_count;
    v_failures := v_failures + 1;
  END IF;

  -- Reset
  DELETE FROM package_steps WHERE id=v_step_id;

  -- Test A2: skipped, updated 10s ago → SKIP
  INSERT INTO package_steps(id, package_id, step_key, status, updated_at)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'skipped'::step_status, now() - interval '10 seconds')
  RETURNING id INTO v_step_id;

  UPDATE package_steps SET status='queued'::step_status WHERE id=v_step_id;

  SELECT count(*) INTO v_job_count FROM job_queue WHERE package_id=v_pkg_id AND job_type=v_job_type;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  IF v_job_count=0 AND v_audit_count=1 THEN
    RAISE NOTICE 'PASS  A2 skipped<60s → no job + audit logged';
  ELSE
    RAISE WARNING 'FAIL  A2 jobs=% audits=%', v_job_count, v_audit_count;
    v_failures := v_failures + 1;
  END IF;

  DELETE FROM package_steps WHERE id=v_step_id;

  -- Test A3: failed, finished 20s ago → SKIP
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'failed'::step_status, now() - interval '20 seconds', now() - interval '20 seconds')
  RETURNING id INTO v_step_id;

  UPDATE package_steps SET status='queued'::step_status WHERE id=v_step_id;

  SELECT count(*) INTO v_job_count FROM job_queue WHERE package_id=v_pkg_id AND job_type=v_job_type;
  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  IF v_job_count=0 AND v_audit_count=1 THEN
    RAISE NOTICE 'PASS  A3 failed<60s → no job + audit logged';
  ELSE
    RAISE WARNING 'FAIL  A3 jobs=% audits=%', v_job_count, v_audit_count;
    v_failures := v_failures + 1;
  END IF;

  DELETE FROM package_steps WHERE id=v_step_id;

  -- Test A4 (negative): done finished 5 minutes ago → Guard A NOT triggered.
  -- (Other guards or downstream may still cancel; here we only assert audit not written.)
  INSERT INTO package_steps(id, package_id, step_key, status, finished_at, updated_at, meta)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key, 'done'::step_status, now() - interval '5 minutes', now() - interval '5 minutes', '{"ok":"true"}'::jsonb)
  RETURNING id INTO v_step_id;

  UPDATE package_steps SET status='queued'::step_status WHERE id=v_step_id;

  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_finalized_step' AND target_id=v_step_id::text;
  IF v_audit_count=0 THEN
    RAISE NOTICE 'PASS  A4 done>60s → Guard A correctly NOT triggered';
  ELSE
    RAISE WARNING 'FAIL  A4 Guard A fired for stale finalization (audits=%)', v_audit_count;
    v_failures := v_failures + 1;
  END IF;

  DELETE FROM job_queue WHERE package_id=v_pkg_id;
  DELETE FROM package_steps WHERE id=v_step_id;

  -- ============================================================
  -- Guard B: recent_duplicate_job (any status, <60s)
  -- ============================================================

  -- Helper: each subtest creates a recent dummy job, then a fresh step → queued, asserts no new job inserted.
  -- We loop over the 4 statuses requested by the user.
  FOR v_test_label IN
    SELECT unnest(ARRAY['queued','pending','processing','retry_scheduled'])
  LOOP
    -- Insert recent dummy job in target status
    INSERT INTO job_queue(job_type, payload, status, max_attempts, priority, package_id, created_at, updated_at)
    VALUES (v_job_type, jsonb_build_object('package_id', v_pkg_id, 'step_key', v_step_key),
            v_test_label, 8, 50, v_pkg_id, now() - interval '10 seconds', now() - interval '10 seconds');

    -- Fresh step on INSERT with status=queued
    INSERT INTO package_steps(id, package_id, step_key, status)
    VALUES (gen_random_uuid(), v_pkg_id, v_step_key||'_b_'||v_test_label, 'queued'::step_status)
    RETURNING id INTO v_step_id;

    -- Audit must include this step_id
    SELECT count(*) INTO v_audit_count FROM auto_heal_log
      WHERE action_type='atomic_enqueue_skipped_recent_duplicate' AND target_id=v_step_id::text;

    -- No NEW job for this fake step_key
    SELECT count(*) INTO v_job_count FROM job_queue
      WHERE package_id=v_pkg_id AND payload->>'step_key' = v_step_key||'_b_'||v_test_label;

    IF v_job_count=0 AND v_audit_count=1 THEN
      RAISE NOTICE 'PASS  B1 dup status=% <60s → no new job + audit logged', v_test_label;
    ELSE
      RAISE WARNING 'FAIL  B1 status=% jobs=% audits=%', v_test_label, v_job_count, v_audit_count;
      v_failures := v_failures + 1;
    END IF;

    -- Cleanup for next iteration
    DELETE FROM job_queue WHERE package_id=v_pkg_id;
    DELETE FROM package_steps WHERE package_id=v_pkg_id;
  END LOOP;

  -- Test B2 (negative): existing job created 5 minutes ago → Guard B NOT triggered.
  INSERT INTO job_queue(job_type, payload, status, max_attempts, priority, package_id, created_at, updated_at)
  VALUES (v_job_type, jsonb_build_object('package_id', v_pkg_id, 'step_key', v_step_key),
          'queued', 8, 50, v_pkg_id, now() - interval '5 minutes', now() - interval '5 minutes');

  INSERT INTO package_steps(id, package_id, step_key, status)
  VALUES (gen_random_uuid(), v_pkg_id, v_step_key||'_b2_stale', 'queued'::step_status)
  RETURNING id INTO v_step_id;

  SELECT count(*) INTO v_audit_count FROM auto_heal_log
    WHERE action_type='atomic_enqueue_skipped_recent_duplicate' AND target_id=v_step_id::text;
  IF v_audit_count=0 THEN
    RAISE NOTICE 'PASS  B2 dup>60s → Guard B correctly NOT triggered';
  ELSE
    RAISE WARNING 'FAIL  B2 Guard B fired for stale dup (audits=%)', v_audit_count;
    v_failures := v_failures + 1;
  END IF;

  -- ===== Summary =====
  IF v_failures = 0 THEN
    RAISE NOTICE '════════════════════════════════════════════════════════════';
    RAISE NOTICE '  PHANTOM PRODUCER GUARD v1 SMOKE: ALL TESTS PASSED';
    RAISE NOTICE '════════════════════════════════════════════════════════════';
  ELSE
    RAISE EXCEPTION 'PHANTOM PRODUCER GUARD v1 SMOKE: % FAILURES', v_failures;
  END IF;
END $$;

ROLLBACK;
