
-- Fix repair_exam_pool_quality to also reconcile approved+tier1_passed SSOT mismatch
CREATE OR REPLACE FUNCTION public.repair_exam_pool_quality(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_promoted int := 0;
  v_reconciled int := 0;
  v_flagged int := 0;
  v_missing_lf_count int := 0;
  v_result jsonb;
BEGIN
  -- A) SSOT Reconciliation: questions already status=approved but qc_status still tier1_passed
  WITH reconciled AS (
    UPDATE exam_questions eq
    SET qc_status = 'approved'
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.status = 'approved'
      AND eq.qc_status = 'tier1_passed'
    RETURNING eq.id
  )
  SELECT count(*) INTO v_reconciled FROM reconciled;

  -- B) Auto-promote draft questions that pass elite guards
  WITH promotable AS (
    SELECT eq.id
    FROM exam_questions eq
    WHERE eq.curriculum_id = p_curriculum_id
      AND eq.status = 'draft'
      AND eq.qc_status IN ('tier1_passed', 'pending')
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
    SET status = 'approved', qc_status = 'approved'
    FROM promotable p
    WHERE eq.id = p.id
    RETURNING eq.id
  )
  SELECT count(*) INTO v_promoted FROM promoted;

  -- C) Count missing LF coverage
  SELECT count(*) INTO v_missing_lf_count
  FROM learning_fields lf
  WHERE lf.curriculum_id = p_curriculum_id
    AND NOT EXISTS (
      SELECT 1 FROM exam_questions eq
      WHERE eq.learning_field_id = lf.id
        AND eq.curriculum_id = p_curriculum_id
        AND eq.status = 'approved'
    );

  -- D) Fix missing trap_type on questions marked is_trap
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
    'qc_status_reconciled', v_reconciled,
    'promoted_to_approved', v_promoted,
    'trap_types_fixed', v_flagged,
    'missing_lf_coverage', v_missing_lf_count,
    'curriculum_id', p_curriculum_id
  );

  RETURN v_result;
END;
$$;
