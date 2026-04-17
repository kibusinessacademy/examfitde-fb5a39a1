-- 1) Track-thresholds helper
CREATE OR REPLACE FUNCTION public.fn_track_min_coverage_thresholds(p_track text)
RETURNS TABLE(min_lesson_coverage_pct numeric, min_competency_question_coverage_pct numeric)
LANGUAGE sql
IMMUTABLE
SET search_path TO 'public'
AS $$
  SELECT
    CASE upper(coalesce(p_track,''))
      WHEN 'STUDIUM' THEN 80.0
      WHEN 'AUSBILDUNG_VOLL' THEN 75.0
      WHEN 'EXAM_FIRST_PLUS' THEN 60.0
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
$$;

-- 2) Compute coverage for a package (joins via learning_fields per SSOT)
CREATE OR REPLACE FUNCTION public.fn_compute_package_coverage(p_package_id uuid)
RETURNS TABLE(
  track text,
  comp_total int,
  comp_with_lesson int,
  comp_with_question int,
  lesson_coverage_pct numeric,
  competency_question_coverage_pct numeric
)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_curr uuid;
  v_track text;
  v_comp_total int;
  v_comp_with_lesson int;
  v_comp_with_q int;
BEGIN
  SELECT cp.curriculum_id, cp.track INTO v_curr, v_track
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_curr IS NULL THEN
    RETURN QUERY SELECT NULL::text, 0, 0, 0, 0::numeric, 0::numeric;
    RETURN;
  END IF;

  SELECT count(*) INTO v_comp_total
  FROM competencies c
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curr;

  SELECT count(DISTINCT l.competency_id) INTO v_comp_with_lesson
  FROM lessons l
  JOIN competencies c ON c.id = l.competency_id
  JOIN learning_fields lf ON lf.id = c.learning_field_id
  WHERE lf.curriculum_id = v_curr;

  SELECT count(DISTINCT eq.competency_id) INTO v_comp_with_q
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_curr AND eq.qc_status = 'approved';

  RETURN QUERY SELECT
    v_track,
    v_comp_total,
    v_comp_with_lesson,
    v_comp_with_q,
    CASE WHEN v_comp_total > 0 THEN round((v_comp_with_lesson::numeric / v_comp_total) * 100, 1) ELSE 0 END,
    CASE WHEN v_comp_total > 0 THEN round((v_comp_with_q::numeric / v_comp_total) * 100, 1) ELSE 0 END;
END;
$$;

-- 3) Extend fn_should_hollow_quarantine_package with COVERAGE_GAP detection
CREATE OR REPLACE FUNCTION public.fn_should_hollow_quarantine_package(p_package_id uuid)
RETURNS TABLE(should_quarantine boolean, reason_code text, reason_detail jsonb)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v v_package_hollow_guard_ssot%ROWTYPE;
  v_all_lessons_placeholder boolean;
  v_no_real_lessons boolean;
  v_no_exam_pool boolean;
  v_no_substantive_artifacts boolean;
  v_cov record;
  v_thr record;
  v_lesson_gap boolean;
  v_q_gap boolean;
BEGIN
  SELECT *
  INTO v
  FROM v_package_hollow_guard_ssot
  WHERE package_id = p_package_id;

  IF NOT FOUND THEN
    RETURN QUERY SELECT false, 'PACKAGE_NOT_FOUND'::text, jsonb_build_object('package_id', p_package_id);
    RETURN;
  END IF;

  IF v.legacy_exempt_from_hollow_guard IS TRUE THEN
    RETURN QUERY SELECT false, 'LEGACY_EXEMPT'::text, jsonb_build_object('package_id', p_package_id);
    RETURN;
  END IF;

  IF v.status <> 'published' THEN
    RETURN QUERY SELECT false, 'NOT_PUBLISHED'::text, jsonb_build_object('status', v.status);
    RETURN;
  END IF;

  v_all_lessons_placeholder :=
    v.lessons_total > 0 AND v.lessons_placeholder = v.lessons_total;

  v_no_real_lessons :=
    v.lessons_expected
    AND v.lessons_total > 0
    AND v.lessons_real = 0;

  v_no_exam_pool :=
    v.approved_questions < 10
    AND v.total_blueprints < 10;

  v_no_substantive_artifacts :=
    NOT v.has_substantive_artifacts;

  -- Case 1: 100% placeholder lessons
  IF v_all_lessons_placeholder THEN
    RETURN QUERY SELECT true, 'ALL_LESSONS_PLACEHOLDER'::text,
      jsonb_build_object('lessons_total', v.lessons_total, 'lessons_placeholder', v.lessons_placeholder);
    RETURN;
  END IF;

  -- Case 2: lessons expected but none real AND no exam pool
  IF v_no_real_lessons AND v_no_exam_pool THEN
    RETURN QUERY SELECT true, 'NO_REAL_LESSONS_AND_NO_EXAM_POOL'::text,
      jsonb_build_object('lessons_total', v.lessons_total, 'lessons_real', v.lessons_real,
        'approved_questions', v.approved_questions, 'total_blueprints', v.total_blueprints);
    RETURN;
  END IF;

  -- Case 3: zero substantive artifacts at all
  IF v_no_substantive_artifacts THEN
    RETURN QUERY SELECT true, 'NO_SUBSTANTIVE_ARTIFACTS'::text,
      jsonb_build_object('approved_questions', v.approved_questions, 'handbook_sections', v.handbook_sections,
        'oral_blueprints', v.oral_blueprints, 'minichecks', v.minichecks,
        'tutor_index_rows', v.tutor_index_rows, 'lessons_real', v.lessons_real);
    RETURN;
  END IF;

  -- Case 4 (NEW): coverage below track-expected thresholds
  SELECT * INTO v_cov FROM fn_compute_package_coverage(p_package_id);
  SELECT * INTO v_thr FROM fn_track_min_coverage_thresholds(v_cov.track);

  v_lesson_gap := v_thr.min_lesson_coverage_pct > 0
                  AND v_cov.lesson_coverage_pct < v_thr.min_lesson_coverage_pct;
  v_q_gap := v_cov.competency_question_coverage_pct < v_thr.min_competency_question_coverage_pct;

  IF v_lesson_gap OR v_q_gap THEN
    RETURN QUERY SELECT true, 'COVERAGE_GAP_BELOW_TRACK_THRESHOLD'::text,
      jsonb_build_object(
        'track', v_cov.track,
        'comp_total', v_cov.comp_total,
        'comp_with_lesson', v_cov.comp_with_lesson,
        'comp_with_question', v_cov.comp_with_question,
        'lesson_coverage_pct', v_cov.lesson_coverage_pct,
        'competency_question_coverage_pct', v_cov.competency_question_coverage_pct,
        'min_lesson_coverage_pct', v_thr.min_lesson_coverage_pct,
        'min_competency_question_coverage_pct', v_thr.min_competency_question_coverage_pct,
        'lesson_gap', v_lesson_gap,
        'question_gap', v_q_gap
      );
    RETURN;
  END IF;

  -- Not hollow
  RETURN QUERY SELECT false, 'PACKAGE_NOT_HOLLOW'::text,
    jsonb_build_object('approved_questions', v.approved_questions, 'handbook_sections', v.handbook_sections,
      'oral_blueprints', v.oral_blueprints, 'minichecks', v.minichecks,
      'tutor_index_rows', v.tutor_index_rows, 'lessons_real', v.lessons_real,
      'lesson_coverage_pct', v_cov.lesson_coverage_pct,
      'competency_question_coverage_pct', v_cov.competency_question_coverage_pct);
END;
$function$;

-- 4) BEFORE-UPDATE guard: blocks new publishes with insufficient coverage
CREATE OR REPLACE FUNCTION public.guard_publish_requires_competency_coverage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_cov record;
  v_thr record;
  v_bypass boolean;
BEGIN
  IF NEW.status <> 'published' OR (OLD.status = 'published') THEN
    RETURN NEW;
  END IF;

  v_bypass := COALESCE((NEW.integrity_report->>'bypass_coverage_guard')::boolean, false);
  IF v_bypass THEN
    RETURN NEW;
  END IF;

  SELECT * INTO v_cov FROM fn_compute_package_coverage(NEW.id);
  SELECT * INTO v_thr FROM fn_track_min_coverage_thresholds(v_cov.track);

  IF v_thr.min_lesson_coverage_pct > 0
     AND v_cov.lesson_coverage_pct < v_thr.min_lesson_coverage_pct THEN
    RAISE EXCEPTION 'COVERAGE_GAP_BELOW_TRACK_THRESHOLD: lesson_coverage_pct=% below track-min=% (track=%, comp_with_lesson=%/%)',
      v_cov.lesson_coverage_pct, v_thr.min_lesson_coverage_pct,
      v_cov.track, v_cov.comp_with_lesson, v_cov.comp_total
      USING ERRCODE = 'P0001';
  END IF;

  IF v_cov.competency_question_coverage_pct < v_thr.min_competency_question_coverage_pct THEN
    RAISE EXCEPTION 'COVERAGE_GAP_BELOW_TRACK_THRESHOLD: competency_question_coverage_pct=% below track-min=% (track=%, comp_with_q=%/%)',
      v_cov.competency_question_coverage_pct, v_thr.min_competency_question_coverage_pct,
      v_cov.track, v_cov.comp_with_question, v_cov.comp_total
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_publish_requires_competency_coverage ON public.course_packages;
CREATE TRIGGER trg_guard_publish_requires_competency_coverage
  BEFORE UPDATE OF status ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION guard_publish_requires_competency_coverage();