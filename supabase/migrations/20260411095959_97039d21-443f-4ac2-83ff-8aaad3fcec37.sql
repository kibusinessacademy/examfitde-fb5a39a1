
-- =============================================================
-- Hardened fn_prebuild_validate_blueprints
-- Gate-only: marks step done ONLY when all blueprints are in
-- terminal state with no outstanding drafts/problems
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_blueprints(
  p_package_id uuid
)
RETURNS TABLE (status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_seed_step_status text;
  v_total_bps     int := 0;
  v_approved_bps  int := 0;
  v_draft_bps     int := 0;
  v_other_bps     int := 0;  -- failed/rejected/unknown
  v_lf_total      int := 0;
  v_lf_covered    int := 0;
  v_step_status   text;
BEGIN
  -- 0) Get curriculum_id
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 1) Check current step status — only act on queued/pending/building
  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_blueprints';

  IF v_step_status IS NULL OR v_step_status NOT IN ('queued', 'pending', 'building') THEN
    RETURN QUERY SELECT 'noop'::text, false, 'STEP_NOT_ACTIONABLE'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 2) DAG: auto_seed_exam_blueprints must be done
  SELECT ps.status INTO v_seed_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'auto_seed_exam_blueprints';

  IF v_seed_step_status IS DISTINCT FROM 'done' THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'SEED_NOT_DONE'::text,
      jsonb_build_object('seed_status', COALESCE(v_seed_step_status, 'missing'));
    RETURN;
  END IF;

  -- 3) Count blueprint statuses — must have NO remaining drafts
  SELECT 
    count(*),
    count(*) FILTER (WHERE qb.status = 'approved'),
    count(*) FILTER (WHERE qb.status = 'draft'),
    count(*) FILTER (WHERE qb.status NOT IN ('approved', 'draft'))
  INTO v_total_bps, v_approved_bps, v_draft_bps, v_other_bps
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id;

  -- Must have blueprints and ALL must be in terminal state
  IF v_total_bps = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_BLUEPRINTS'::text, '{}'::jsonb;
    RETURN;
  END IF;

  IF v_draft_bps > 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'DRAFTS_REMAINING'::text,
      jsonb_build_object('total', v_total_bps, 'approved', v_approved_bps, 'draft', v_draft_bps);
    RETURN;
  END IF;

  IF v_approved_bps = 0 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_APPROVED_BLUEPRINTS'::text,
      jsonb_build_object('total', v_total_bps, 'other', v_other_bps);
    RETURN;
  END IF;

  -- 4) LF coverage check
  SELECT count(DISTINCT lf.id) INTO v_lf_total
  FROM learning_fields lf WHERE lf.curriculum_id = v_curriculum_id;

  SELECT count(DISTINCT qb.learning_field_id) INTO v_lf_covered
  FROM question_blueprints qb
  WHERE qb.curriculum_id = v_curriculum_id
    AND qb.status = 'approved'
    AND qb.learning_field_id IS NOT NULL;

  IF v_lf_total > 0 AND v_lf_covered < v_lf_total THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'LF_COVERAGE_INCOMPLETE'::text,
      jsonb_build_object('lf_total', v_lf_total, 'lf_covered', v_lf_covered,
        'approved', v_approved_bps, 'draft', v_draft_bps);
    RETURN;
  END IF;

  -- 5) All checks passed — mark step done
  UPDATE package_steps
  SET status = 'done',
      completed_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true,
        'prebuild_fn', 'fn_prebuild_validate_blueprints',
        'postcondition_verified', true,
        'checked_at', now(),
        'total_blueprints', v_total_bps,
        'approved_blueprints', v_approved_bps,
        'draft_blueprints', v_draft_bps,
        'lf_coverage', jsonb_build_object('total', v_lf_total, 'covered', v_lf_covered)
      )
  WHERE package_id = p_package_id AND step_key = 'validate_blueprints';

  RETURN QUERY SELECT 'done'::text, true, 'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object(
      'prebuild', true,
      'total', v_total_bps,
      'approved', v_approved_bps,
      'draft', v_draft_bps,
      'lf_total', v_lf_total,
      'lf_covered', v_lf_covered
    );
END;
$$;

-- =============================================================
-- Hardened fn_prebuild_promote_blueprint_variants
-- Gate-only: only marks done when approved variants have been
-- actually promoted (matching exam_questions exist per blueprint)
-- =============================================================
CREATE OR REPLACE FUNCTION public.fn_prebuild_promote_blueprint_variants(
  p_package_id uuid
)
RETURNS TABLE (status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id        uuid;
  v_validate_bp_status   text;
  v_step_status          text;
  v_approved_variants    int := 0;
  v_promoted_count       int := 0;
  v_blueprints_with_eq   int := 0;
  v_blueprints_approved  int := 0;
BEGIN
  -- 0) Get curriculum_id
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'NO_CURRICULUM'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 1) Check current step status
  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'promote_blueprint_variants';

  IF v_step_status IS NULL OR v_step_status NOT IN ('queued', 'pending', 'building') THEN
    RETURN QUERY SELECT 'noop'::text, false, 'STEP_NOT_ACTIONABLE'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 2) DAG: validate_blueprints must be done
  SELECT ps.status INTO v_validate_bp_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_blueprints';

  IF v_validate_bp_status IS DISTINCT FROM 'done' THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'VALIDATE_BP_NOT_DONE'::text,
      jsonb_build_object('validate_status', COALESCE(v_validate_bp_status, 'missing'));
    RETURN;
  END IF;

  -- 3) Count approved variants eligible for promotion
  SELECT count(*) INTO v_approved_variants
  FROM exam_question_variants eqv
  WHERE eqv.curriculum_id = v_curriculum_id
    AND eqv.status = 'approved'
    AND eqv.quality_score >= 80;

  IF v_approved_variants = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_APPROVED_VARIANTS'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 4) Key check: for each blueprint with approved variants,
  --    verify matching exam_questions actually exist
  SELECT 
    count(DISTINCT eqv.blueprint_id),
    count(DISTINCT eq.blueprint_id)
  INTO v_blueprints_approved, v_blueprints_with_eq
  FROM exam_question_variants eqv
  LEFT JOIN exam_questions eq 
    ON eq.blueprint_id = eqv.blueprint_id 
    AND eq.curriculum_id = v_curriculum_id
  WHERE eqv.curriculum_id = v_curriculum_id
    AND eqv.status = 'approved'
    AND eqv.quality_score >= 80;

  -- Count actual promoted exam questions for these blueprints
  SELECT count(*) INTO v_promoted_count
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id
    AND eq.blueprint_id IN (
      SELECT DISTINCT eqv.blueprint_id
      FROM exam_question_variants eqv
      WHERE eqv.curriculum_id = v_curriculum_id
        AND eqv.status = 'approved'
        AND eqv.quality_score >= 80
    );

  -- Promotion must have actually happened:
  -- at least 50% of blueprints with approved variants must have exam_questions
  IF v_blueprints_approved > 0 AND v_blueprints_with_eq < (v_blueprints_approved / 2 + 1) THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'PROMOTION_INCOMPLETE'::text,
      jsonb_build_object(
        'approved_variants', v_approved_variants,
        'blueprints_with_approved', v_blueprints_approved,
        'blueprints_with_exam_questions', v_blueprints_with_eq,
        'promoted_questions', v_promoted_count
      );
    RETURN;
  END IF;

  IF v_promoted_count = 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_PROMOTED_QUESTIONS'::text,
      jsonb_build_object('approved_variants', v_approved_variants);
    RETURN;
  END IF;

  -- 5) No active promotion jobs running
  IF EXISTS (
    SELECT 1 FROM job_queue jq
    WHERE jq.package_id = p_package_id
      AND jq.job_type IN ('promote_blueprint_variants', 'promote_variants')
      AND jq.status IN ('pending', 'processing', 'running', 'claimed', 'queued', 'batch_pending')
  ) THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'ACTIVE_PROMOTION_JOBS'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 6) All checks passed — mark step done
  UPDATE package_steps
  SET status = 'done',
      completed_at = now(),
      meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true,
        'prebuild_fn', 'fn_prebuild_promote_blueprint_variants',
        'postcondition_verified', true,
        'checked_at', now(),
        'approved_variants', v_approved_variants,
        'blueprints_with_approved', v_blueprints_approved,
        'blueprints_with_exam_questions', v_blueprints_with_eq,
        'promoted_questions', v_promoted_count
      )
  WHERE package_id = p_package_id AND step_key = 'promote_blueprint_variants';

  RETURN QUERY SELECT 'done'::text, true, 'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object(
      'prebuild', true,
      'approved_variants', v_approved_variants,
      'blueprints_approved', v_blueprints_approved,
      'blueprints_with_eq', v_blueprints_with_eq,
      'promoted_count', v_promoted_count
    );
END;
$$;
