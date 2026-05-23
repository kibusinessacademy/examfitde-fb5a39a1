-- =====================================================================
-- Learning Progression Regression Guard v1 — SQL Smoke Tests
-- Verifies check_lesson_progression treats badge SSOT (learning_progress.completed)
-- and mastery SSOT (lesson_outcomes.status) as equally valid unlock signals,
-- while still blocking on explicit not_mastered.
--
-- Cases:
--   A: learning_progress.completed=true, no lesson_outcomes  → allowed
--   B: lesson_outcomes.status=mastered, no learning_progress → allowed
--   C: lesson_outcomes.status=not_mastered                   → blocked (Mini-Check)
--   D: no signals at all                                     → blocked (Lernschritt)
--   E: completed=true persisted (reload-stable)              → still allowed
--
-- Run inside a transaction with ROLLBACK at the end (no persistent state).
-- =====================================================================

BEGIN;

DO $$
DECLARE
  v_course_id uuid;
  v_module_id uuid := gen_random_uuid();
  v_prev_lesson uuid := gen_random_uuid();
  v_next_lesson uuid := gen_random_uuid();
  v_user_id uuid;
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

  INSERT INTO public.lessons(id, module_id, title, step, sort_order, status)
  VALUES
    (v_prev_lesson, v_module_id, '__smoke_prev', 'einstieg', 1, 'draft'),
    (v_next_lesson, v_module_id, '__smoke_next', 'verstehen', 2, 'draft');

  -- Case A: learning_progress.completed=true, NO lesson_outcomes → allowed
  INSERT INTO public.learning_progress(user_id, lesson_id, completed, completed_at)
  VALUES (v_user_id, v_prev_lesson, true, now());

  v_result := public.check_lesson_progression(v_user_id, v_next_lesson);
  v_label := 'A: learning_progress.completed only';
  IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
    v_failures := v_failures + 1;
    RAISE WARNING 'FAIL %: %', v_label, v_result;
  ELSE RAISE NOTICE 'PASS %', v_label;
  END IF;

  -- Case E: persistence (reload-stable): same query again still allowed
  v_result := public.check_lesson_progression(v_user_id, v_next_lesson);
  v_label := 'E: reload — completed persisted still allowed';
  IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
    v_failures := v_failures + 1;
    RAISE WARNING 'FAIL %: %', v_label, v_result;
  ELSE RAISE NOTICE 'PASS %', v_label;
  END IF;

  -- Case B: lesson_outcomes.status=mastered, NO learning_progress → allowed
  DELETE FROM public.learning_progress WHERE user_id=v_user_id AND lesson_id=v_prev_lesson;
  INSERT INTO public.lesson_outcomes(user_id, lesson_id, status)
  VALUES (v_user_id, v_prev_lesson, 'mastered');

  v_result := public.check_lesson_progression(v_user_id, v_next_lesson);
  v_label := 'B: lesson_outcomes.mastered only';
  IF (v_result->>'allowed')::boolean IS NOT TRUE THEN
    v_failures := v_failures + 1;
    RAISE WARNING 'FAIL %: %', v_label, v_result;
  ELSE RAISE NOTICE 'PASS %', v_label;
  END IF;

  -- Case C: lesson_outcomes.status=not_mastered → blocked (Mini-Check text)
  UPDATE public.lesson_outcomes
    SET status='not_mastered'
    WHERE user_id=v_user_id AND lesson_id=v_prev_lesson;

  v_result := public.check_lesson_progression(v_user_id, v_next_lesson);
  v_label := 'C: not_mastered → blocked';
  IF (v_result->>'allowed')::boolean IS NOT FALSE
     OR COALESCE(v_result->>'reason','') NOT ILIKE '%Mini-Check%' THEN
    v_failures := v_failures + 1;
    RAISE WARNING 'FAIL %: %', v_label, v_result;
  ELSE RAISE NOTICE 'PASS %', v_label;
  END IF;

  -- Case D: no signals at all → blocked (Lernschritt text)
  DELETE FROM public.lesson_outcomes WHERE user_id=v_user_id AND lesson_id=v_prev_lesson;

  v_result := public.check_lesson_progression(v_user_id, v_next_lesson);
  v_label := 'D: no signals → blocked';
  IF (v_result->>'allowed')::boolean IS NOT FALSE
     OR COALESCE(v_result->>'reason','') NOT ILIKE '%Lernschritt%' THEN
    v_failures := v_failures + 1;
    RAISE WARNING 'FAIL %: %', v_label, v_result;
  ELSE RAISE NOTICE 'PASS %', v_label;
  END IF;

  IF v_failures > 0 THEN
    RAISE EXCEPTION 'learning_progression_regression_v1 smoke FAILED: % case(s)', v_failures;
  END IF;
  RAISE NOTICE 'learning_progression_regression_v1 smoke: ALL PASS';
END $$;

ROLLBACK;
