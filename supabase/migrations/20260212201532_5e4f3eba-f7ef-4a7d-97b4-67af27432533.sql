-- Add handbook section target scoring to validate_course_integrity_v2
-- Currently only checks chapters < target, but not sections
-- This adds a section-level penalty when sections < 10

-- We need to update the existing function to add section scoring
-- The function signature has 3 params: p_course_id, p_package_id, p_options
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
  v_score INTEGER := 100;
  v_passed BOOLEAN := TRUE;
  -- Targets
  v_exam_target INTEGER := COALESCE((p_options->>'exam_target')::INTEGER, 1000);
  v_oral_target INTEGER := COALESCE((p_options->>'oral_target')::INTEGER, 20);
  v_handbook_target INTEGER := COALESCE((p_options->>'handbook_chapter_target')::INTEGER, 5);
  v_handbook_section_target INTEGER := COALESCE((p_options->>'handbook_section_target')::INTEGER, 10);
  -- Lessons
  v_expected_lessons INTEGER;
  v_actual_lessons INTEGER;
  v_expected_modules INTEGER;
  v_actual_modules INTEGER;
  v_duplicate_lessons INTEGER;
  v_missing_minichecks INTEGER;
  -- Exam
  v_exam_question_count INTEGER;
  v_exam_approved_count INTEGER;
  v_exam_via_join INTEGER;
  v_exam_difficulty_dist JSONB;
  v_total_lf INTEGER;
  v_covered_lf INTEGER;
  -- Oral
  v_oral_question_count INTEGER;
  -- Handbook
  v_handbook_chapter_count INTEGER;
  v_handbook_section_count INTEGER;
  -- Tutor
  v_tutor_index_exists BOOLEAN;
  -- Issues
  v_issues JSONB := '[]'::JSONB;
  v_warnings JSONB := '[]'::JSONB;
BEGIN
  -- Get curriculum_id from course
  SELECT curriculum_id INTO v_curriculum_id FROM courses WHERE id = p_course_id;
  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object('passed', FALSE, 'score', 0, 'error', 'NO_CURRICULUM');
  END IF;

  -- ========== LESSONS ==========
  SELECT COUNT(DISTINCT c.id) INTO v_expected_lessons
  FROM competencies c
  JOIN learning_fields lf ON c.learning_field_id = lf.id
  WHERE lf.curriculum_id = v_curriculum_id;
  v_expected_lessons := v_expected_lessons * 5;

  SELECT COUNT(*) INTO v_actual_lessons
  FROM lessons l
  JOIN modules m ON l.module_id = m.id
  WHERE m.course_id = p_course_id;

  SELECT COUNT(*) INTO v_expected_modules
  FROM learning_fields WHERE curriculum_id = v_curriculum_id;

  SELECT COUNT(*) INTO v_actual_modules FROM modules WHERE course_id = p_course_id;

  -- Duplicate check
  SELECT COUNT(*) INTO v_duplicate_lessons
  FROM (
    SELECT module_id, competency_id, step, COUNT(*) as cnt
    FROM lessons l
    JOIN modules m ON l.module_id = m.id
    WHERE m.course_id = p_course_id
    GROUP BY module_id, competency_id, step
    HAVING COUNT(*) > 1
  ) dupes;

  -- MiniCheck coverage
  SELECT COUNT(*) INTO v_missing_minichecks
  FROM lessons l
  JOIN modules m ON l.module_id = m.id
  WHERE m.course_id = p_course_id
    AND l.step = 'mini_check'
    AND l.minicheck_parsed IS NOT TRUE;

  IF v_actual_lessons < v_expected_lessons THEN
    IF v_actual_lessons < v_expected_lessons * 0.8 THEN
      v_passed := FALSE; v_score := v_score - 15;
      v_issues := v_issues || jsonb_build_object('type', 'lessons_insufficient', 'expected', v_expected_lessons, 'actual', v_actual_lessons, 'severity', 'critical');
    ELSE
      v_score := v_score - 5;
      v_warnings := v_warnings || jsonb_build_object('type', 'lessons_below_target', 'expected', v_expected_lessons, 'actual', v_actual_lessons, 'severity', 'warning');
    END IF;
  END IF;

  IF v_duplicate_lessons > 0 THEN
    v_score := v_score - 10;
    v_issues := v_issues || jsonb_build_object('type', 'duplicate_lessons', 'count', v_duplicate_lessons, 'severity', 'critical');
  END IF;

  IF v_missing_minichecks > 0 THEN
    v_score := v_score - 5;
    v_warnings := v_warnings || jsonb_build_object('type', 'missing_minichecks', 'count', v_missing_minichecks, 'severity', 'warning');
  END IF;

  -- ========== EXAM (counts TOTAL, not just approved) ==========
  SELECT COUNT(*), COUNT(*) FILTER (WHERE eq.status = 'approved')
  INTO v_exam_question_count, v_exam_approved_count
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id;

  -- Secondary count via join (for diagnostics)
  SELECT COUNT(*) INTO v_exam_via_join
  FROM exam_questions eq
  JOIN competencies c ON eq.competency_id = c.id
  JOIN learning_fields lf ON c.learning_field_id = lf.id
  WHERE lf.curriculum_id = v_curriculum_id;

  SELECT jsonb_build_object(
    'easy', COUNT(*) FILTER (WHERE eq.difficulty = 'easy'),
    'medium', COUNT(*) FILTER (WHERE eq.difficulty = 'medium'),
    'hard', COUNT(*) FILTER (WHERE eq.difficulty = 'hard')
  ) INTO v_exam_difficulty_dist
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id;

  SELECT COUNT(DISTINCT lf.id), COUNT(DISTINCT lf.id) FILTER (WHERE eq.id IS NOT NULL)
  INTO v_total_lf, v_covered_lf
  FROM learning_fields lf
  LEFT JOIN competencies c ON c.learning_field_id = lf.id
  LEFT JOIN exam_questions eq ON eq.competency_id = c.id
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

  IF v_covered_lf < v_total_lf THEN
    v_score := v_score - 10;
    v_issues := v_issues || jsonb_build_object('type', 'exam_lf_coverage_gap', 'total', v_total_lf, 'covered', v_covered_lf, 'severity', 'critical');
  END IF;

  -- ========== ORAL ==========
  SELECT COUNT(*) INTO v_oral_question_count
  FROM oral_exam_blueprints
  WHERE curriculum_id = v_curriculum_id;

  IF v_oral_question_count < v_oral_target THEN
    IF v_oral_question_count < v_oral_target * 0.5 THEN
      v_passed := FALSE; v_score := v_score - 10;
      v_issues := v_issues || jsonb_build_object('type', 'oral_blueprints_insufficient', 'target', v_oral_target, 'actual', v_oral_question_count, 'severity', 'critical');
    ELSE
      v_score := v_score - 5;
      v_warnings := v_warnings || jsonb_build_object('type', 'oral_blueprints_below_target', 'target', v_oral_target, 'actual', v_oral_question_count, 'severity', 'warning');
    END IF;
  END IF;

  -- ========== HANDBOOK (chapters + sections) ==========
  SELECT COUNT(*) INTO v_handbook_chapter_count
  FROM handbook_chapters
  WHERE curriculum_id = v_curriculum_id;

  SELECT COUNT(*) INTO v_handbook_section_count
  FROM handbook_sections hs
  JOIN handbook_chapters hc ON hs.chapter_id = hc.id
  WHERE hc.curriculum_id = v_curriculum_id;

  -- Gate on chapters
  IF v_handbook_section_count = 0 AND v_handbook_chapter_count > 0 THEN
    v_passed := FALSE; v_score := v_score - 10;
    v_issues := v_issues || jsonb_build_object('type', 'handbook_empty_chapters', 'chapters', v_handbook_chapter_count, 'sections', 0, 'severity', 'critical');
  ELSIF v_handbook_chapter_count < v_handbook_target THEN
    v_score := v_score - 10;
    v_issues := v_issues || jsonb_build_object('type', 'handbook_chapters_insufficient', 'target', v_handbook_target, 'actual', v_handbook_chapter_count, 'severity', 'critical');
  END IF;

  -- Gate on sections (NEW: section-level scoring)
  IF v_handbook_section_count > 0 AND v_handbook_section_count < v_handbook_section_target THEN
    v_score := v_score - 5;
    v_warnings := v_warnings || jsonb_build_object('type', 'handbook_sections_below_target', 'target', v_handbook_section_target, 'actual', v_handbook_section_count, 'severity', 'warning');
  END IF;

  -- ========== TUTOR INDEX ==========
  v_tutor_index_exists := FALSE;
  IF p_package_id IS NOT NULL THEN
    SELECT EXISTS(SELECT 1 FROM ai_tutor_context_index WHERE package_id = p_package_id) INTO v_tutor_index_exists;
  END IF;

  IF NOT v_tutor_index_exists AND p_package_id IS NOT NULL THEN
    v_score := v_score - 5;
    v_warnings := v_warnings || jsonb_build_object('type', 'tutor_index_missing', 'severity', 'warning');
  END IF;

  -- ========== FINAL SCORE ==========
  v_score := GREATEST(v_score, 0);
  IF v_score < 60 THEN v_passed := FALSE; END IF;

  -- Update package if provided
  IF p_package_id IS NOT NULL THEN
    UPDATE course_packages SET
      integrity_passed = v_passed,
      integrity_report = jsonb_build_object(
        'score', v_score, 'passed', v_passed,
        'lessons', jsonb_build_object('expected', v_expected_lessons, 'actual', v_actual_lessons, 'duplicates', v_duplicate_lessons, 'missing_minichecks', v_missing_minichecks),
        'modules', jsonb_build_object('expected', v_expected_modules, 'actual', v_actual_modules),
        'exam', jsonb_build_object('total', v_exam_question_count, 'approved', v_exam_approved_count, 'via_join', v_exam_via_join, 'target', v_exam_target, 'difficulty', v_exam_difficulty_dist, 'lf_coverage', jsonb_build_object('total', v_total_lf, 'covered', v_covered_lf)),
        'oral', jsonb_build_object('total', v_oral_question_count, 'target', v_oral_target),
        'handbook', jsonb_build_object('chapters', v_handbook_chapter_count, 'sections', v_handbook_section_count, 'target_chapters', v_handbook_target, 'target_sections', v_handbook_section_target),
        'tutor_index', v_tutor_index_exists,
        'issues', v_issues, 'warnings', v_warnings
      )
    WHERE id = p_package_id;
  END IF;

  RETURN jsonb_build_object(
    'passed', v_passed,
    'score', v_score,
    'lessons', jsonb_build_object('expected', v_expected_lessons, 'actual', v_actual_lessons, 'duplicates', v_duplicate_lessons, 'missing_minichecks', v_missing_minichecks),
    'modules', jsonb_build_object('expected', v_expected_modules, 'actual', v_actual_modules),
    'exam', jsonb_build_object('total', v_exam_question_count, 'approved', v_exam_approved_count, 'via_join', v_exam_via_join, 'target', v_exam_target, 'difficulty', v_exam_difficulty_dist, 'lf_coverage', jsonb_build_object('total', v_total_lf, 'covered', v_covered_lf)),
    'oral', jsonb_build_object('total', v_oral_question_count, 'target', v_oral_target),
    'handbook', jsonb_build_object('chapters', v_handbook_chapter_count, 'sections', v_handbook_section_count, 'target_chapters', v_handbook_target, 'target_sections', v_handbook_section_target),
    'tutor_index', v_tutor_index_exists,
    'issues', v_issues,
    'warnings', v_warnings
  );
END;
$$;