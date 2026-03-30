
CREATE OR REPLACE FUNCTION public.map_reason_codes_to_heal_action(p_reason_codes text[])
RETURNS text
LANGUAGE plpgsql IMMUTABLE
AS $$
BEGIN
  IF p_reason_codes IS NULL OR array_length(p_reason_codes, 1) IS NULL THEN
    RETURN 'manual_review';
  END IF;

  -- Exam pool quantity
  IF 'too_few_questions' = ANY(p_reason_codes) OR 'low_question_buffer' = ANY(p_reason_codes) THEN
    RETURN 'repair_exam_pool';
  END IF;

  -- Exam pool quality (QC flags, coverage gaps)
  IF 'exam_qc_flags_unresolved' = ANY(p_reason_codes) OR 'exam_pool_quality_low' = ANY(p_reason_codes) OR 'exam_coverage_gap' = ANY(p_reason_codes) THEN
    RETURN 'repair_exam_pool_quality';
  END IF;

  -- Learning content missing
  IF 'no_lessons' = ANY(p_reason_codes) OR 'low_lesson_count' = ANY(p_reason_codes) THEN
    RETURN 'repair_learning_content';
  END IF;

  -- Lessons QC failures (tier1_failed, needs_revision)
  IF 'lessons_qc_failed' = ANY(p_reason_codes) OR 'lessons_tier1_failed' = ANY(p_reason_codes) OR 'lessons_needs_revision' = ANY(p_reason_codes) THEN
    RETURN 'repair_lessons';
  END IF;

  -- Handbook issues
  IF 'handbook_incomplete' = ANY(p_reason_codes) OR 'handbook_shallow' = ANY(p_reason_codes) OR 'handbook_missing' = ANY(p_reason_codes) THEN
    RETURN 'repair_handbook';
  END IF;

  -- Minichecks issues
  IF 'minichecks_missing' = ANY(p_reason_codes) OR 'minichecks_failed' = ANY(p_reason_codes) THEN
    RETURN 'repair_minichecks';
  END IF;

  -- Oral exam issues
  IF 'oral_exam_missing' = ANY(p_reason_codes) OR 'oral_exam_incomplete' = ANY(p_reason_codes) THEN
    RETURN 'repair_oral_exam';
  END IF;

  -- Tutor index
  IF 'missing_tutor_index' = ANY(p_reason_codes) THEN
    RETURN 'repair_tutor_index';
  END IF;

  -- Integrity check
  IF 'integrity_failed' = ANY(p_reason_codes) THEN
    RETURN 'rerun_integrity';
  END IF;

  -- Quality council
  IF 'council_not_approved' = ANY(p_reason_codes) THEN
    RETURN 'rerun_quality_council';
  END IF;

  -- Pipeline flow issues
  IF 'finalization_stall' = ANY(p_reason_codes) THEN
    RETURN 'heal_finalization_stall';
  END IF;

  IF 'non_building_stuck' = ANY(p_reason_codes) OR 'stuck_not_building' = ANY(p_reason_codes) THEN
    RETURN 'heal_non_building';
  END IF;

  IF 'step_stalled' = ANY(p_reason_codes) OR 'step_stuck' = ANY(p_reason_codes) THEN
    RETURN 'retry_stalled_step';
  END IF;

  RETURN 'manual_review';
END;
$$;
