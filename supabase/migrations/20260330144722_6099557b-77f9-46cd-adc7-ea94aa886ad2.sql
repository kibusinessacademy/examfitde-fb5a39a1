
-- Fix: repair_exam_pool_quality references updated_at on exam_questions, but that column doesn't exist.
-- Option: Remove updated_at references from the function since exam_questions has no updated_at column.

CREATE OR REPLACE FUNCTION public.repair_exam_pool_quality(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoted int := 0;
  v_flagged int := 0;
  v_missing_lf_count int := 0;
  v_result jsonb;
BEGIN
  -- A) Auto-promote draft questions that already pass elite guards
  WITH promotable AS (
    SELECT eq.id
    FROM exam_questions eq
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.status = 'draft'
      AND eq.qc_status = 'tier1_passed'
      AND eq.question_text IS NOT NULL
      AND length(eq.question_text) >= 60
      AND eq.correct_answer IS NOT NULL
      AND eq.difficulty IS NOT NULL
      AND eq.cognitive_level IS NOT NULL
      AND eq.learning_field_id IS NOT NULL
      AND eq.competency_id IS NOT NULL
      AND eq.exam_part IS NOT NULL
      AND jsonb_array_length(COALESCE(eq.options, '[]'::jsonb)) >= 4
      AND eq.explanation IS NOT NULL
      AND length(eq.explanation) >= 80
  ),
  promoted AS (
    UPDATE exam_questions eq
    SET status = 'approved'
    FROM promotable p
    WHERE eq.id = p.id
    RETURNING eq.id
  )
  SELECT count(*) INTO v_promoted FROM promoted;

  -- B) Count missing LF coverage
  SELECT count(*) INTO v_missing_lf_count
  FROM learning_fields lf
  WHERE lf.curriculum_id = p_curriculum_id
    AND NOT EXISTS (
      SELECT 1 FROM exam_questions eq
      WHERE eq.learning_field_id = lf.id
        AND eq.curriculum_id = p_curriculum_id
        AND eq.status = 'approved'
    );

  -- C) Fix missing trap_type on questions marked is_trap
  WITH fixed_traps AS (
    UPDATE exam_questions eq
    SET trap_type = 'typical_error'
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.is_trap = true
      AND eq.trap_type IS NULL
    RETURNING eq.id
  )
  SELECT count(*) INTO v_flagged FROM fixed_traps;

  v_result := jsonb_build_object(
    'promoted_to_approved', v_promoted,
    'trap_types_fixed', v_flagged,
    'missing_lf_coverage', v_missing_lf_count,
    'curriculum_id', p_curriculum_id
  );

  RETURN v_result;
END;
$$;
