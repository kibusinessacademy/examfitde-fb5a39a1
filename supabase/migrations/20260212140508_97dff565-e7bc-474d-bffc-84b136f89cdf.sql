
-- Enhanced validate_course_integrity with exam, oral, handbook, tutor checks
CREATE OR REPLACE FUNCTION public.validate_course_integrity_v2(
  p_course_id UUID,
  p_package_id UUID DEFAULT NULL,
  p_options JSONB DEFAULT '{}'::JSONB
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id UUID;
  v_certification_id UUID;
  -- Lessons & Modules
  v_total_comps INTEGER;
  v_expected_lessons INTEGER;
  v_actual_lessons INTEGER;
  v_actual_modules INTEGER;
  v_expected_modules INTEGER;
  v_duplicate_lessons INTEGER;
  v_missing_minichecks INTEGER;
  -- Exam
  v_exam_question_count INTEGER;
  v_exam_approved_count INTEGER;
  v_exam_difficulty_dist JSONB;
  v_exam_lf_coverage JSONB;
  v_total_lf INTEGER;
  v_covered_lf INTEGER;
  -- Oral
  v_oral_question_count INTEGER;
  -- Handbook
  v_handbook_chapter_count INTEGER;
  v_handbook_section_count INTEGER;
  -- Tutor
  v_tutor_index_exists BOOLEAN := FALSE;
  -- Scoring
  v_issues JSONB := '[]'::JSONB;
  v_warnings JSONB := '[]'::JSONB;
  v_score INTEGER := 100;
  v_passed BOOLEAN := TRUE;
  -- Targets
  v_exam_target INTEGER := COALESCE((p_options->>'exam_target')::INTEGER, 800);
  v_oral_target INTEGER := COALESCE((p_options->>'oral_target')::INTEGER, 20);
  v_handbook_target INTEGER := COALESCE((p_options->>'handbook_chapter_target')::INTEGER, 5);
BEGIN
  -- Get curriculum_id
  SELECT curriculum_id, certification_id INTO v_curriculum_id, v_certification_id
  FROM courses WHERE id = p_course_id;

  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object('passed', FALSE, 'error', 'Course not found or no curriculum');
  END IF;

  -- ═══════════════════════════════════════
  -- 1. LESSON & MODULE INTEGRITY (weight: 30)
  -- ═══════════════════════════════════════
  SELECT COUNT(DISTINCT comp.id) INTO v_total_comps
  FROM learning_fields lf
  JOIN competencies comp ON comp.learning_field_id = lf.id
  WHERE lf.curriculum_id = v_curriculum_id;

  v_expected_lessons := v_total_comps * 5;

  SELECT COUNT(*) INTO v_actual_lessons
  FROM lessons l JOIN modules m ON m.id = l.module_id
  WHERE m.course_id = p_course_id;

  SELECT COUNT(*) INTO v_actual_modules FROM modules WHERE course_id = p_course_id;

  SELECT COUNT(DISTINCT lf.id) INTO v_expected_modules
  FROM learning_fields lf WHERE lf.curriculum_id = v_curriculum_id;

  SELECT COUNT(*) INTO v_duplicate_lessons FROM (
    SELECT module_id, competency_id, step
    FROM lessons l JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = p_course_id AND l.competency_id IS NOT NULL
    GROUP BY module_id, competency_id, step HAVING COUNT(*) > 1
  ) sub;

  SELECT COUNT(*) INTO v_missing_minichecks
  FROM competencies comp
  JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id
  AND NOT EXISTS (
    SELECT 1 FROM lessons l JOIN modules m ON m.id = l.module_id
    WHERE m.course_id = p_course_id AND l.competency_id = comp.id AND l.step = 'mini_check'
  );

  IF v_actual_lessons < v_expected_lessons THEN
    v_passed := FALSE; v_score := v_score - 15;
    v_issues := v_issues || jsonb_build_object('type', 'lesson_count_mismatch', 'expected', v_expected_lessons, 'actual', v_actual_lessons, 'severity', 'critical');
  END IF;

  IF v_actual_modules < v_expected_modules THEN
    v_passed := FALSE; v_score := v_score - 10;
    v_issues := v_issues || jsonb_build_object('type', 'module_count_mismatch', 'expected', v_expected_modules, 'actual', v_actual_modules, 'severity', 'critical');
  END IF;

  IF v_duplicate_lessons > 0 THEN
    v_passed := FALSE; v_score := v_score - 10;
    v_issues := v_issues || jsonb_build_object('type', 'duplicate_lessons', 'count', v_duplicate_lessons, 'severity', 'critical');
  END IF;

  IF v_missing_minichecks > 0 THEN
    v_score := v_score - LEAST(v_missing_minichecks, 5);
    v_warnings := v_warnings || jsonb_build_object('type', 'missing_minichecks', 'count', v_missing_minichecks, 'severity', 'warning');
  END IF;

  -- ═══════════════════════════════════════
  -- 2. EXAM QUESTIONS (weight: 25)
  -- ═══════════════════════════════════════
  SELECT COUNT(*) INTO v_exam_question_count
  FROM exam_questions WHERE curriculum_id = v_curriculum_id;

  SELECT COUNT(*) INTO v_exam_approved_count
  FROM exam_questions WHERE curriculum_id = v_curriculum_id AND status = 'approved';

  -- Difficulty distribution
  SELECT COALESCE(jsonb_object_agg(difficulty, cnt), '{}'::JSONB) INTO v_exam_difficulty_dist
  FROM (
    SELECT COALESCE(difficulty, 'unknown') AS difficulty, COUNT(*) AS cnt
    FROM exam_questions WHERE curriculum_id = v_curriculum_id
    GROUP BY difficulty
  ) sub;

  -- Learning field coverage
  SELECT COUNT(DISTINCT lf.id), COUNT(DISTINCT eq.learning_field_id)
  INTO v_total_lf, v_covered_lf
  FROM learning_fields lf
  LEFT JOIN exam_questions eq ON eq.learning_field_id = lf.id
  WHERE lf.curriculum_id = v_curriculum_id;

  IF v_exam_question_count < v_exam_target THEN
    IF v_exam_question_count < v_exam_target * 0.5 THEN
      v_passed := FALSE; v_score := v_score - 15;
      v_issues := v_issues || jsonb_build_object('type', 'exam_questions_insufficient', 'target', v_exam_target, 'actual', v_exam_question_count, 'severity', 'critical');
    ELSE
      v_score := v_score - 5;
      v_warnings := v_warnings || jsonb_build_object('type', 'exam_questions_below_target', 'target', v_exam_target, 'actual', v_exam_question_count, 'severity', 'warning');
    END IF;
  END IF;

  IF v_total_lf > 0 AND v_covered_lf < v_total_lf THEN
    v_score := v_score - 5;
    v_warnings := v_warnings || jsonb_build_object('type', 'exam_lf_coverage_gap', 'total_lf', v_total_lf, 'covered_lf', v_covered_lf, 'severity', 'warning');
  END IF;

  -- ═══════════════════════════════════════
  -- 3. ORAL EXAM (weight: 15)
  -- ═══════════════════════════════════════
  SELECT COUNT(*) INTO v_oral_question_count
  FROM oral_exam_questions WHERE curriculum_id = v_curriculum_id;

  IF v_oral_question_count < v_oral_target THEN
    IF v_oral_question_count = 0 THEN
      v_passed := FALSE; v_score := v_score - 10;
      v_issues := v_issues || jsonb_build_object('type', 'oral_exam_missing', 'target', v_oral_target, 'actual', 0, 'severity', 'critical');
    ELSE
      v_score := v_score - 5;
      v_warnings := v_warnings || jsonb_build_object('type', 'oral_exam_below_target', 'target', v_oral_target, 'actual', v_oral_question_count, 'severity', 'warning');
    END IF;
  END IF;

  -- ═══════════════════════════════════════
  -- 4. HANDBOOK (weight: 15)
  -- ═══════════════════════════════════════
  SELECT COUNT(*) INTO v_handbook_chapter_count
  FROM handbook_chapters WHERE curriculum_id = v_curriculum_id;

  SELECT COUNT(*) INTO v_handbook_section_count
  FROM handbook_sections hs
  JOIN handbook_chapters hc ON hc.id = hs.chapter_id
  WHERE hc.curriculum_id = v_curriculum_id;

  IF v_handbook_chapter_count < v_handbook_target THEN
    IF v_handbook_chapter_count = 0 THEN
      v_passed := FALSE; v_score := v_score - 10;
      v_issues := v_issues || jsonb_build_object('type', 'handbook_missing', 'target', v_handbook_target, 'actual', 0, 'severity', 'critical');
    ELSE
      v_score := v_score - 3;
      v_warnings := v_warnings || jsonb_build_object('type', 'handbook_below_target', 'target', v_handbook_target, 'actual', v_handbook_chapter_count, 'severity', 'warning');
    END IF;
  END IF;

  -- ═══════════════════════════════════════
  -- 5. AI TUTOR INDEX (weight: 15)
  -- ═══════════════════════════════════════
  IF p_package_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM ai_tutor_context_index WHERE package_id = p_package_id) INTO v_tutor_index_exists;
  END IF;

  IF p_package_id IS NOT NULL AND NOT v_tutor_index_exists THEN
    v_score := v_score - 5;
    v_warnings := v_warnings || jsonb_build_object('type', 'tutor_index_missing', 'severity', 'warning');
  END IF;

  -- ═══════════════════════════════════════
  -- Final score clamping
  -- ═══════════════════════════════════════
  v_score := GREATEST(v_score, 0);
  IF v_score < 60 THEN v_passed := FALSE; END IF;

  -- Auto-unpublish on fail
  IF NOT v_passed THEN
    UPDATE courses
    SET publishing_status = 'integrity_error',
        status = CASE WHEN status = 'published' THEN 'draft' ELSE status END
    WHERE id = p_course_id
    AND (publishing_status = 'published' OR status = 'published');
  END IF;

  -- Store report on package
  IF p_package_id IS NOT NULL THEN
    UPDATE course_packages
    SET integrity_report = jsonb_build_object(
      'score', v_score,
      'passed', v_passed,
      'validated_at', now(),
      'lessons', jsonb_build_object('expected', v_expected_lessons, 'actual', v_actual_lessons, 'duplicates', v_duplicate_lessons),
      'modules', jsonb_build_object('expected', v_expected_modules, 'actual', v_actual_modules),
      'exam', jsonb_build_object('total', v_exam_question_count, 'approved', v_exam_approved_count, 'target', v_exam_target, 'difficulty', v_exam_difficulty_dist, 'lf_coverage', jsonb_build_object('total', v_total_lf, 'covered', v_covered_lf)),
      'oral', jsonb_build_object('total', v_oral_question_count, 'target', v_oral_target),
      'handbook', jsonb_build_object('chapters', v_handbook_chapter_count, 'sections', v_handbook_section_count, 'target', v_handbook_target),
      'tutor_index', v_tutor_index_exists,
      'issues', v_issues,
      'warnings', v_warnings
    ),
    integrity_passed = v_passed
    WHERE id = p_package_id;
  END IF;

  RETURN jsonb_build_object(
    'course_id', p_course_id,
    'package_id', p_package_id,
    'passed', v_passed,
    'score', v_score,
    'lessons', jsonb_build_object('expected', v_expected_lessons, 'actual', v_actual_lessons, 'duplicates', v_duplicate_lessons, 'missing_minichecks', v_missing_minichecks),
    'modules', jsonb_build_object('expected', v_expected_modules, 'actual', v_actual_modules),
    'exam', jsonb_build_object('total', v_exam_question_count, 'approved', v_exam_approved_count, 'target', v_exam_target, 'difficulty', v_exam_difficulty_dist, 'lf_coverage', jsonb_build_object('total', v_total_lf, 'covered', v_covered_lf)),
    'oral', jsonb_build_object('total', v_oral_question_count, 'target', v_oral_target),
    'handbook', jsonb_build_object('chapters', v_handbook_chapter_count, 'sections', v_handbook_section_count, 'target', v_handbook_target),
    'tutor_index', v_tutor_index_exists,
    'issues', v_issues,
    'warnings', v_warnings,
    'validated_at', now()
  );
END;
$$;
