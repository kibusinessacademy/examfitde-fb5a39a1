-- Sustainable system fix: EXAM_FIRST_PLUS has no lessons by design (track_step_applicability),
-- so min_lesson_coverage_pct must be 0 (same as EXAM_FIRST), not 60.
-- This was the root cause of repeated heal-loops for §34i and would block §34f and any other
-- EXAM_FIRST_PLUS package from publishing as well.

CREATE OR REPLACE FUNCTION public.fn_track_min_coverage_thresholds(p_track text)
 RETURNS TABLE(min_lesson_coverage_pct numeric, min_competency_question_coverage_pct numeric)
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT
    CASE upper(coalesce(p_track,''))
      WHEN 'STUDIUM' THEN 80.0
      WHEN 'AUSBILDUNG_VOLL' THEN 75.0
      WHEN 'EXAM_FIRST_PLUS' THEN 0.0   -- FIX: track has no lessons (parity with EXAM_FIRST)
      WHEN 'EXAM_FIRST' THEN 0.0
      ELSE 60.0
    END,
    CASE upper(coalesce(p_track,''))
      WHEN 'STUDIUM' THEN 80.0
      WHEN 'AUSBILDUNG_VOLL' THEN 80.0
      WHEN 'EXAM_FIRST_PLUS' THEN 80.0
      WHEN 'EXAM_FIRST' THEN 80.0
      ELSE 75.0
    END;
$function$;

COMMENT ON FUNCTION public.fn_track_min_coverage_thresholds(text) IS
'SSOT track-aware coverage thresholds for publish guard. EXAM_FIRST and EXAM_FIRST_PLUS skip all learning_content steps per track_step_applicability, therefore min_lesson_coverage_pct must be 0 for both. Bug fix 2026-04-24: EXAM_FIRST_PLUS was 60.0 — caused publish-loops for §34i and would block §34f.';