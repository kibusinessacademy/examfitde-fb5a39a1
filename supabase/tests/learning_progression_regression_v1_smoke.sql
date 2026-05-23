-- =====================================================================
-- Learning Progression Regression Guard v1 — SQL Smoke Tests
-- Verifies check_lesson_progression treats badge SSOT (learning_progress.completed)
-- and mastery SSOT (lesson_outcomes.status) as equally valid unlock signals,
-- while still blocking on explicit not_mastered.
--
-- Cases (each uses a separate prev/next lesson pair to avoid DELETE):
--   A: learning_progress.completed=true, no lesson_outcomes  → allowed
--   B: lesson_outcomes.status=mastered, no learning_progress → allowed
--   C: lesson_outcomes.status=not_mastered                   → blocked (Mini-Check)
--   D: no signals at all                                     → blocked (Lernschritt)
--   E: reload — re-running case A query stays allowed
--
-- Run inside a transaction with ROLLBACK at the end (no persistent state).
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_course_id uuid;
  v_module_id uuid := gen_random_uuid();
  v_user_id uuid;
  v_a_prev uuid := gen_random_uuid(); v_a_next uuid := gen_random_uuid();
  v_b_prev uuid := gen_random_uuid(); v_b_next uuid := gen_random_uuid();
  v_c_prev uuid := gen_random_uuid(); v_c_next uuid := gen_random_uuid();
  v_d_prev uuid := gen_random_uuid(); v_d_next uuid := gen_random_uuid();
  v_result jsonb;
  v_failures int := 0;
  v_label text;
BEGIN
  SELECT id INTO v_course_id FROM public.courses LIMIT 1;
  IF v_course_id IS NULL THEN RAISE EXCEPTION 'no courses available'; END IF;

  SELECT user_id INTO v_user_id FROM public.profiles LIMIT 1;
  IF v_user_id IS NULL THEN RAISE EXCEPTION 'no profiles available'; END IF;

  INSERT INTO public.modules(id, course_id, title, sort_order)
  VALUES (v_module_id, v_course_id, '__smoke_progression_v1', 999999);

  INSERT INTO public.lessons(id, module_id, title, step, sort_order, status) VALUES
    (v_a_prev, v_module_id, '__a_prev', 'einstieg',   1, 'draft'),
    (v_a_next, v_module_id, '__a_next', 'verstehen',  2, 'draft'),
    (v_b_prev, v_module_id, '__b_prev', 'einstieg',   3, 'draft'),
    (v_b_next, v_module_id, '__b_next', 'verstehen',  4, 'draft'),
    (v_c_prev, v_module_id, '__c_prev', 'einstieg',   5, 'draft'),
    (v_c_next, v_module_id, '__c_next', 'verstehen',  6, 'draft'),
    (v_d_prev, v_module_id, '__d_prev', 'einstieg',   7, 'draft'),
    (v_d_next, v_module_id, '__d_next', 'verstehen',  8, 'draft');

  -- Case A: learning_progress.completed=true (no lesson_outcomes) → allowed
  INSERT INTO public.learning_progress(user_id, lesson_id, completed, completed_at)
  VALUES (v_user_id, v_a_prev, true, now());

  v_result := public.check_lesson_progression(v_user_id, v_a_next);
  v_label := 'A: learning_progress.completed only';
  IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
    v_failures := v_failures + 1; RAISE WARNING 'FAIL %: %', v_label, v_result;
  ELSE RAISE NOTICE 'PASS %', v_label; END IF;

  -- Case E: reload — same call returns allowed
  v_result := public.check_lesson_progression(v_user_id, v_a_next);
  v_label := 'E: reload — completed persisted still allowed';
  IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
    v_failures := v_failures + 1; RAISE WARNING 'FAIL %: %', v_label, v_result;
  ELSE RAISE NOTICE 'PASS %', v_label; END IF;

  -- Case B: lesson_outcomes.mastered (no learning_progress) → allowed
  INSERT INTO public.lesson_outcomes(user_id, lesson_id, status)
  VALUES (v_user_id, v_b_prev, 'mastered');

  v_result := public.check_lesson_progression(v_user_id, v_b_next);
  v_label := 'B: lesson_outcomes.mastered only';
  IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
    v_failures := v_failures + 1; RAISE WARNING 'FAIL %: %', v_label, v_result;
  ELSE RAISE NOTICE 'PASS %', v_label; END IF;

  -- Case C: lesson_outcomes.not_mastered → blocked (Mini-Check)
  INSERT INTO public.lesson_outcomes(user_id, lesson_id, status)
  VALUES (v_user_id, v_c_prev, 'not_mastered');

  v_result := public.check_lesson_progression(v_user_id, v_c_next);
  v_label := 'C: not_mastered → blocked';
  IF (v_result->>'allowed')::boolean IS NOT FALSE
     OR COALESCE(v_result->>'reason','') NOT ILIKE '%Mini-Check%' THEN
    v_failures := v_failures + 1; RAISE WARNING 'FAIL %: %', v_label, v_result;
  ELSE RAISE NOTICE 'PASS %', v_label; END IF;

  -- Case D: no signals → blocked (Lernschritt)
  v_result := public.check_lesson_progression(v_user_id, v_d_next);
  v_label := 'D: no signals → blocked';
  IF (v_result->>'allowed')::boolean IS NOT FALSE
     OR COALESCE(v_result->>'reason','') NOT ILIKE '%Lernschritt%' THEN
    v_failures := v_failures + 1; RAISE WARNING 'FAIL %: %', v_label, v_result;
  ELSE RAISE NOTICE 'PASS %', v_label; END IF;

  IF v_failures > 0 THEN
    RAISE EXCEPTION 'learning_progression_regression_v1 smoke FAILED: % case(s)', v_failures;
  END IF;
  RAISE NOTICE 'learning_progression_regression_v1 smoke: ALL PASS (5/5)';
END $$;

ROLLBACK;
