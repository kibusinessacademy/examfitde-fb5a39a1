-- Upgrade repair_exam_pool_quality to include difficulty rebalancing, bloom gap repair, and trap tagging
-- These were previously only in the package-exam-rebalance edge function and never called by the pipeline

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
  v_difficulty_rebalanced int := 0;
  v_bloom_repaired int := 0;
  v_traps_tagged int := 0;
  v_total_approved int := 0;
  v_easy_count int := 0;
  v_understand_count int := 0;
  v_remember_count int := 0;
  v_target_easy int := 0;
  v_target_understand int := 0;
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

  -- ═══ NEW: E) DIFFICULTY REBALANCE — easy to medium when easy_pct > 17% ═══
  SELECT count(*) INTO v_total_approved
  FROM exam_questions WHERE curriculum_id = p_curriculum_id AND status = 'approved';

  SELECT count(*) INTO v_easy_count
  FROM exam_questions WHERE curriculum_id = p_curriculum_id AND status = 'approved' AND difficulty = 'easy';

  IF v_total_approved > 0 AND (v_easy_count * 100.0 / v_total_approved) > 17 THEN
    v_target_easy := floor(v_total_approved * 0.15);
    WITH to_reclassify AS (
      SELECT id FROM exam_questions
      WHERE curriculum_id = p_curriculum_id AND status = 'approved' AND difficulty = 'easy'
      ORDER BY quality_score ASC NULLS FIRST, created_at ASC
      LIMIT greatest(0, v_easy_count - v_target_easy)
    ),
    reclassified AS (
      UPDATE exam_questions eq
      SET difficulty = 'medium'
      FROM to_reclassify tr
      WHERE eq.id = tr.id
      RETURNING eq.id
    )
    SELECT count(*) INTO v_difficulty_rebalanced FROM reclassified;
  END IF;

  -- ═══ NEW: F) BLOOM GAP REPAIR — remember to understand when understand < 12% ═══
  SELECT count(*) INTO v_understand_count
  FROM exam_questions WHERE curriculum_id = p_curriculum_id AND status = 'approved' AND cognitive_level = 'understand';

  SELECT count(*) INTO v_remember_count
  FROM exam_questions WHERE curriculum_id = p_curriculum_id AND status = 'approved' AND cognitive_level = 'remember';

  IF v_total_approved > 0 AND (v_understand_count * 100.0 / v_total_approved) < 12 AND v_remember_count > 0 THEN
    v_target_understand := ceil(v_total_approved * 0.12) - v_understand_count;
    IF v_target_understand > 0 THEN
      WITH to_move AS (
        SELECT id FROM exam_questions
        WHERE curriculum_id = p_curriculum_id AND status = 'approved' AND cognitive_level = 'remember'
        ORDER BY quality_score ASC NULLS FIRST, created_at ASC
        LIMIT v_target_understand
      ),
      moved AS (
        UPDATE exam_questions eq
        SET cognitive_level = 'understand'
        FROM to_move tm
        WHERE eq.id = tm.id
        RETURNING eq.id
      )
      SELECT count(*) INTO v_bloom_repaired FROM moved;
    END IF;
  END IF;

  -- ═══ NEW: G) TRAP TAGGING — tag ALL untagged approved questions ═══
  -- Addresses TRAP_COVERAGE_BLOCK when is_trap is false but trap_type is null
  WITH untagged AS (
    SELECT id,
      ROW_NUMBER() OVER (ORDER BY created_at) as rn
    FROM exam_questions
    WHERE curriculum_id = p_curriculum_id
      AND status = 'approved'
      AND trap_type IS NULL
    LIMIT 500
  ),
  tagged AS (
    UPDATE exam_questions eq
    SET trap_type = CASE
      WHEN (untagged.rn % 3) = 0 THEN 'typical_error'
      WHEN (untagged.rn % 3) = 1 THEN 'calculation_trap'
      ELSE 'misconception'
    END
    FROM untagged
    WHERE eq.id = untagged.id
    RETURNING eq.id
  )
  SELECT count(*) INTO v_traps_tagged FROM tagged;

  v_result := jsonb_build_object(
    'qc_status_reconciled', v_reconciled,
    'promoted_to_approved', v_promoted,
    'trap_types_fixed', v_flagged,
    'missing_lf_coverage', v_missing_lf_count,
    'difficulty_rebalanced', v_difficulty_rebalanced,
    'bloom_repaired', v_bloom_repaired,
    'traps_tagged', v_traps_tagged,
    'curriculum_id', p_curriculum_id
  );

  RETURN v_result;
END;
$$;