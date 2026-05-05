
CREATE OR REPLACE FUNCTION public.fn_test_status_revert_guards()
RETURNS TABLE(test_name text, passed boolean, detail text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_pkg uuid := gen_random_uuid();
  v_curr uuid;
  v_status text;
BEGIN
  SELECT id INTO v_curr FROM curricula LIMIT 1;
  IF v_curr IS NULL THEN
    test_name := 'setup'; passed := false; detail := 'no curriculum available'; RETURN NEXT; RETURN;
  END IF;

  INSERT INTO course_packages (id, title, package_key, curriculum_id, status, build_progress, feature_flags)
  VALUES (v_pkg, '__test_revert_guard__', '__test_revert_guard_'||substr(v_pkg::text,1,8), v_curr, 'building', 80, '{}'::jsonb);

  INSERT INTO exam_questions (id, package_id, curriculum_id, status, question_text, options, correct_answer, explanation, question_type)
  SELECT gen_random_uuid(), v_pkg, v_curr, 'approved', 'q'||g,
         '[{"id":"a","text":"A"},{"id":"b","text":"B"}]'::jsonb, 0, 'e', 'concept'
  FROM generate_series(1,50) g;

  -- TEST 1
  BEGIN PERFORM set_config('app.transition_source', 'producer_test', true);
        UPDATE course_packages SET status='queued' WHERE id=v_pkg; EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT status INTO v_status FROM course_packages WHERE id=v_pkg;
  test_name:='building→queued blocked'; passed:=(v_status='building'); detail:='status='||v_status; RETURN NEXT;

  -- TEST 2
  BEGIN PERFORM set_config('app.transition_source', 'producer_test', true);
        UPDATE course_packages SET status='blocked' WHERE id=v_pkg; EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT status INTO v_status FROM course_packages WHERE id=v_pkg;
  test_name:='building→blocked blocked'; passed:=(v_status='building'); detail:='status='||v_status; RETURN NEXT;

  -- TEST 3
  BEGIN PERFORM set_config('app.transition_source', 'producer_test', true);
        UPDATE course_packages SET status='draft' WHERE id=v_pkg; EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT status INTO v_status FROM course_packages WHERE id=v_pkg;
  test_name:='building→draft blocked'; passed:=(v_status='building'); detail:='status='||v_status; RETURN NEXT;

  PERFORM set_config('app.transition_source', 'admin_manual', true);
  UPDATE course_packages SET status='queued' WHERE id=v_pkg;
  SELECT status INTO v_status FROM course_packages WHERE id=v_pkg;
  test_name:='admin_manual bypass'; passed:=(v_status='queued'); detail:='status='||v_status; RETURN NEXT;

  PERFORM set_config('app.transition_source', 'admin_force_publish', true);
  UPDATE course_packages SET status='published' WHERE id=v_pkg;

  BEGIN PERFORM set_config('app.transition_source', 'producer_test', true);
        UPDATE course_packages SET status='building' WHERE id=v_pkg; EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT status INTO v_status FROM course_packages WHERE id=v_pkg;
  test_name:='published→building blocked'; passed:=(v_status='published'); detail:='status='||v_status; RETURN NEXT;

  BEGIN PERFORM set_config('app.transition_source', 'producer_test', true);
        UPDATE course_packages SET status='archived' WHERE id=v_pkg; EXCEPTION WHEN OTHERS THEN NULL; END;
  SELECT status INTO v_status FROM course_packages WHERE id=v_pkg;
  test_name:='published→archived blocked'; passed:=(v_status='published'); detail:='status='||v_status; RETURN NEXT;

  PERFORM set_config('app.transition_source', 'admin_force_rebuild', true);
  UPDATE course_packages SET status='building' WHERE id=v_pkg;

  test_name:='precheck rejects protected demote';
  passed:= NOT ((fn_can_demote_package_status(v_pkg,'queued','producer_test')->>'allowed')::boolean);
  detail:= (fn_can_demote_package_status(v_pkg,'queued','producer_test'))::text; RETURN NEXT;

  test_name:='precheck allows admin_manual';
  passed:= ((fn_can_demote_package_status(v_pkg,'queued','admin_manual')->>'allowed')::boolean);
  detail:= (fn_can_demote_package_status(v_pkg,'queued','admin_manual'))::text; RETURN NEXT;

  DELETE FROM exam_questions WHERE package_id=v_pkg;
  DELETE FROM course_packages WHERE id=v_pkg;
END $$;
