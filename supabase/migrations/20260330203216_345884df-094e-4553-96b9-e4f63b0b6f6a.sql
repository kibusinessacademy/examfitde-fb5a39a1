
-- RPC function: get_exam_pool_validation_metrics
-- Returns current pool metrics for a given package/curriculum pair.
CREATE OR REPLACE FUNCTION public.get_exam_pool_validation_metrics(
  p_package_id uuid,
  p_curriculum_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_result jsonb;
  v_approved int := 0;
  v_review int := 0;
  v_draft int := 0;
  v_rejected int := 0;
  v_tier1_failed int := 0;
  v_needs_revision int := 0;
  v_total_lf int := 0;
  v_covered_lf int := 0;
  v_total_comp int := 0;
  v_covered_comp int := 0;
  v_missing_trap int := 0;
  v_missing_bloom int := 0;
BEGIN
  -- Count by qc_status
  SELECT
    COUNT(*) FILTER (WHERE qc_status = 'approved' OR (qc_status IS NULL AND status = 'approved')),
    COUNT(*) FILTER (WHERE qc_status IN ('pending', 'tier1_passed')),
    COUNT(*) FILTER (WHERE qc_status = 'draft' OR (qc_status IS NULL AND status = 'draft')),
    COUNT(*) FILTER (WHERE qc_status IN ('rejected', 'pruned_quality')),
    COUNT(*) FILTER (WHERE qc_status = 'tier1_failed'),
    COUNT(*) FILTER (WHERE qc_status = 'needs_revision')
  INTO v_approved, v_review, v_draft, v_rejected, v_tier1_failed, v_needs_revision
  FROM public.exam_questions
  WHERE curriculum_id = p_curriculum_id;

  -- LF coverage
  SELECT COUNT(*) INTO v_total_lf
  FROM public.learning_fields
  WHERE curriculum_id = p_curriculum_id;

  SELECT COUNT(DISTINCT learning_field_id) INTO v_covered_lf
  FROM public.exam_questions
  WHERE curriculum_id = p_curriculum_id
    AND (qc_status = 'approved' OR (qc_status IS NULL AND status = 'approved'))
    AND learning_field_id IS NOT NULL;

  -- Competency coverage
  SELECT COUNT(*) INTO v_total_comp
  FROM public.competencies
  WHERE curriculum_id = p_curriculum_id;

  SELECT COUNT(DISTINCT competency_id) INTO v_covered_comp
  FROM public.exam_questions
  WHERE curriculum_id = p_curriculum_id
    AND (qc_status = 'approved' OR (qc_status IS NULL AND status = 'approved'))
    AND competency_id IS NOT NULL;

  -- Missing trap metadata (approved questions with is_trap=true but no trap_type)
  SELECT COUNT(*) INTO v_missing_trap
  FROM public.exam_questions
  WHERE curriculum_id = p_curriculum_id
    AND (qc_status = 'approved' OR (qc_status IS NULL AND status = 'approved'))
    AND is_trap = true
    AND (trap_type IS NULL OR trap_type = '');

  -- Missing bloom metadata (approved questions without cognitive_level)
  SELECT COUNT(*) INTO v_missing_bloom
  FROM public.exam_questions
  WHERE curriculum_id = p_curriculum_id
    AND (qc_status = 'approved' OR (qc_status IS NULL AND status = 'approved'))
    AND cognitive_level IS NULL;

  v_result := jsonb_build_object(
    'approved_count', v_approved,
    'review_count', v_review,
    'draft_count', v_draft,
    'rejected_count', v_rejected,
    'unresolved_quality_flags', v_tier1_failed + v_needs_revision,
    'missing_lf_coverage', GREATEST(v_total_lf - v_covered_lf, 0),
    'missing_competency_coverage', GREATEST(v_total_comp - v_covered_comp, 0),
    'missing_trap_metadata', v_missing_trap,
    'missing_bloom_metadata', v_missing_bloom,
    'repairable_issue_count', v_tier1_failed + v_needs_revision + v_missing_trap + v_missing_bloom
  );

  RETURN v_result;
END;
$$;
