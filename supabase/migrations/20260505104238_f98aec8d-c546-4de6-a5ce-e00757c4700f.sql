
CREATE OR REPLACE FUNCTION public.fn_test_status_revert_guards()
RETURNS TABLE(test_name text, passed boolean, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pkg uuid := gen_random_uuid();
  v_status text;
BEGIN
  -- Setup: synthetic package + 50 approved questions to trigger demote-protect
  INSERT INTO course_packages (id, title, package_key, status, build_progress, feature_flags)
  VALUES (v_pkg, '__test_revert_guard__', '__test_revert_guard_'||substr(v_pkg::text,1,8), 'building', 80, '{}'::jsonb);

  -- Inject 50 approved questions (minimal valid rows)
  INSERT INTO exam_questions (id, package_id, status, question_text, question_type, correct_answer, explanation)
  SELECT gen_random_uuid(), v_pkg, 'approved', 'q'||g, 'single_choice', 'A', 'e'
  FROM generate_series(1,50) g;

  -- TEST 1: building → queued (no admin source) must be blocked → forced back to building
  BEGIN
    PERFORM set_config('app.transition_source', 'producer_test', true);
    UPDATE course_packages SET status = 'queued' WHERE id = v_pkg;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT status INTO v_status FROM course_packages WHERE id = v_pkg;
  test_name := 'building→queued blocked'; passed := (v_status = 'building');
  detail := 'status='||v_status; RETURN NEXT;

  -- TEST 2: building → blocked (no admin source) must be blocked
  BEGIN
    PERFORM set_config('app.transition_source', 'producer_test', true);
    UPDATE course_packages SET status = 'blocked' WHERE id = v_pkg;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT status INTO v_status FROM course_packages WHERE id = v_pkg;
  test_name := 'building→blocked blocked'; passed := (v_status = 'building');
  detail := 'status='||v_status; RETURN NEXT;

  -- TEST 3: building → draft (no admin source) must be blocked
  BEGIN
    PERFORM set_config('app.transition_source', 'producer_test', true);
    UPDATE course_packages SET status = 'draft' WHERE id = v_pkg;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT status INTO v_status FROM course_packages WHERE id = v_pkg;
  test_name := 'building→draft blocked'; passed := (v_status = 'building');
  detail := 'status='||v_status; RETURN NEXT;

  -- TEST 4: admin_manual bypass allows building → queued
  PERFORM set_config('app.transition_source', 'admin_manual', true);
  UPDATE course_packages SET status = 'queued' WHERE id = v_pkg;
  SELECT status INTO v_status FROM course_packages WHERE id = v_pkg;
  test_name := 'admin_manual bypass'; passed := (v_status = 'queued');
  detail := 'status='||v_status; RETURN NEXT;

  -- Setup TEST 5: promote to published (admin)
  PERFORM set_config('app.transition_source', 'admin_force_publish', true);
  UPDATE course_packages SET status = 'published' WHERE id = v_pkg;

  -- TEST 5: published → building (no admin) must be blocked → reverted to published
  BEGIN
    PERFORM set_config('app.transition_source', 'producer_test', true);
    UPDATE course_packages SET status = 'building' WHERE id = v_pkg;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT status INTO v_status FROM course_packages WHERE id = v_pkg;
  test_name := 'published→building blocked'; passed := (v_status = 'published');
  detail := 'status='||v_status; RETURN NEXT;

  -- TEST 6: published → archived (no admin) must be blocked
  BEGIN
    PERFORM set_config('app.transition_source', 'producer_test', true);
    UPDATE course_packages SET status = 'archived' WHERE id = v_pkg;
  EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT status INTO v_status FROM course_packages WHERE id = v_pkg;
  test_name := 'published→archived blocked'; passed := (v_status = 'published');
  detail := 'status='||v_status; RETURN NEXT;

  -- TEST 7: fn_can_demote_package_status returns allowed=false for building→queued (protected)
  PERFORM set_config('app.transition_source', 'admin_force_rebuild', true);
  UPDATE course_packages SET status = 'building' WHERE id = v_pkg;
  test_name := 'precheck rejects protected demote';
  passed := NOT ((fn_can_demote_package_status(v_pkg, 'queued', 'producer_test')->>'allowed')::boolean);
  detail := (fn_can_demote_package_status(v_pkg, 'queued', 'producer_test'))::text;
  RETURN NEXT;

  -- TEST 8: precheck allows admin source
  test_name := 'precheck allows admin_manual';
  passed := ((fn_can_demote_package_status(v_pkg, 'queued', 'admin_manual')->>'allowed')::boolean);
  detail := (fn_can_demote_package_status(v_pkg, 'queued', 'admin_manual'))::text;
  RETURN NEXT;

  -- Cleanup
  DELETE FROM exam_questions WHERE package_id = v_pkg;
  DELETE FROM course_packages WHERE id = v_pkg;
END $$;

REVOKE ALL ON FUNCTION public.fn_test_status_revert_guards() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_test_status_revert_guards() TO service_role;
