-- ════════════════════════════════════════════════════════════════════
-- D+ Phase 1: Validator-Semantik-Fix + neue Reason-Klasse REPAIR_LF_COVERAGE
-- ════════════════════════════════════════════════════════════════════
-- Root cause: fn_classify_exam_pool_gate klassifiziert Coverage-Lücken
-- als HARD_FAIL_NO_QUESTIONS_AFTER_GENERATION oder verharrt in
-- HARD_FAIL_REPAIR_EXHAUSTED, obwohl die echte Ursache "skewed
-- generation across learning fields" ist. Dies löst Auto-Heal-Loops
-- statt gezielter Repair-Jobs aus.
--
-- Fix: Neue Klassifikation REPAIR_LF_COVERAGE wird VOR HARD_FAIL
-- evaluiert, sobald genügend Fragen existieren aber LF-Coverage < 90%.
-- HARD_FAIL bleibt strikt reserviert für strukturelle Defekte
-- (no_curriculum, no_blueprints, true zero questions).
-- ════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_classify_exam_pool_gate(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_curriculum_id       uuid;
  v_total_questions     int := 0;
  v_approved_count      int := 0;
  v_review_count        int := 0;
  v_draft_count         int := 0;
  v_pending_count       int := 0;
  v_tier1_passed_count  int := 0;
  v_rejected_count      int := 0;
  v_tier1_failed_count  int := 0;
  v_needs_revision_count int := 0;
  v_coverage_eligible   int := 0;
  v_total_lfs           int := 0;
  v_covered_lfs         int := 0;
  v_lf_coverage_pct     numeric := 0;
  v_lf_skew_max_share   numeric := 0;
  v_lf_dominant_id      uuid;
  v_total_competencies  int := 0;
  v_covered_competencies int := 0;
  v_comp_coverage_pct   numeric := 0;
  v_active_gen_jobs     int := 0;
  v_active_repair_jobs  int := 0;
  v_active_lf_repair_jobs int := 0;
  v_recent_repair_count int := 0;
  v_no_effect_repairs   int := 0;
  v_consecutive_no_progress int := 0;
  v_has_blueprints      boolean := false;
  v_reason_codes        text[] := ARRAY[]::text[];
  v_gate_status         text;
  v_repair_action       text;
  v_hard_fail           boolean := false;
  v_is_pass             boolean := true;
  v_unresolved_ratio    numeric := 0;
  v_min_questions_for_lf_eval int := 30;
  v_lf_coverage_threshold     numeric := 90.0;
BEGIN
  -- Resolve curriculum
  SELECT cu.id INTO v_curriculum_id
  FROM course_packages cp
  JOIN curricula cu ON cu.certification_id = cp.certification_id
  WHERE cp.id = p_package_id
  LIMIT 1;

  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object(
      'gate_status','HARD_FAIL',
      'reason_codes',ARRAY['HARD_FAIL_NO_CURRICULUM'],
      'hard_fail',true,
      'recommended_action','manual_review',
      'has_active_upstream_jobs',false,
      'has_active_repair_jobs',false,
      'repair_attempts_24h',0,
      'no_effect_repairs_2h',0,
      'consecutive_no_progress',0,
      'metrics','{}'::jsonb
    );
  END IF;

  -- Blueprint check
  SELECT EXISTS(
    SELECT 1 FROM question_blueprints
    WHERE curriculum_id = v_curriculum_id AND status != 'deprecated'
    LIMIT 1
  ) INTO v_has_blueprints;

  IF NOT v_has_blueprints THEN
    RETURN jsonb_build_object(
      'gate_status','HARD_FAIL',
      'reason_codes',ARRAY['HARD_FAIL_NO_BLUEPRINTS'],
      'hard_fail',true,
      'recommended_action','regenerate_blueprints',
      'has_active_upstream_jobs',false,
      'has_active_repair_jobs',false,
      'repair_attempts_24h',0,
      'no_effect_repairs_2h',0,
      'consecutive_no_progress',0,
      'metrics','{}'::jsonb
    );
  END IF;

  -- QC counts
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE qc_status = 'approved'),
    COUNT(*) FILTER (WHERE qc_status IN ('pending_review','review')),
    COUNT(*) FILTER (WHERE qc_status IN ('draft','pending')),
    COUNT(*) FILTER (WHERE qc_status = 'pending'),
    COUNT(*) FILTER (WHERE qc_status = 'tier1_passed'),
    COUNT(*) FILTER (WHERE qc_status = 'rejected'),
    COUNT(*) FILTER (WHERE qc_status = 'tier1_failed'),
    COUNT(*) FILTER (WHERE qc_status = 'needs_revision')
  INTO v_total_questions, v_approved_count, v_review_count, v_draft_count,
       v_pending_count, v_tier1_passed_count, v_rejected_count,
       v_tier1_failed_count, v_needs_revision_count
  FROM exam_questions
  WHERE curriculum_id = v_curriculum_id;

  v_coverage_eligible := v_approved_count + v_tier1_passed_count;

  -- LF coverage (functional questions only)
  SELECT COUNT(*) INTO v_total_lfs
  FROM learning_fields WHERE curriculum_id = v_curriculum_id;

  SELECT COUNT(DISTINCT lf.id) INTO v_covered_lfs
  FROM exam_questions eq
  JOIN learning_fields lf ON lf.id = eq.learning_field_id
  WHERE eq.curriculum_id = v_curriculum_id
    AND eq.qc_status IN ('approved','tier1_passed');

  IF v_total_lfs > 0 THEN
    v_lf_coverage_pct := round((v_covered_lfs::numeric * 100.0) / v_total_lfs, 1);
  END IF;

  -- LF skew detection (largest LF share)
  IF v_coverage_eligible > 0 AND v_covered_lfs > 0 THEN
    SELECT
      max_share,
      dominant_lf
    INTO v_lf_skew_max_share, v_lf_dominant_id
    FROM (
      SELECT
        round((COUNT(*)::numeric * 100.0) / NULLIF(v_coverage_eligible,0), 1) AS max_share,
        eq.learning_field_id AS dominant_lf
      FROM exam_questions eq
      WHERE eq.curriculum_id = v_curriculum_id
        AND eq.qc_status IN ('approved','tier1_passed')
        AND eq.learning_field_id IS NOT NULL
      GROUP BY eq.learning_field_id
      ORDER BY COUNT(*) DESC
      LIMIT 1
    ) skew_calc;
  END IF;

  -- Competency coverage
  SELECT COUNT(*) INTO v_total_competencies
  FROM competencies comp
  JOIN learning_fields lf ON lf.id = comp.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id;

  SELECT COUNT(DISTINCT competency_id) INTO v_covered_competencies
  FROM exam_questions
  WHERE curriculum_id = v_curriculum_id
    AND competency_id IS NOT NULL
    AND qc_status IN ('approved','tier1_passed');

  IF v_total_competencies > 0 THEN
    v_comp_coverage_pct := round((v_covered_competencies::numeric * 100.0) / v_total_competencies, 1);
  END IF;

  -- Active jobs
  SELECT
    COUNT(*) FILTER (WHERE job_type IN (
      'package_generate_exam_pool','generate_exam_pool_batch',
      'pool_fill_lf_gaps','pool_fill_bloom_gaps'
    ) AND status IN ('pending','queued','processing','running','batch_pending')),
    COUNT(*) FILTER (WHERE job_type IN (
      'package_repair_exam_pool_quality','repair_exam_pool_quality'
    ) AND status IN ('pending','queued','processing','running','batch_pending')),
    COUNT(*) FILTER (WHERE job_type = 'package_repair_exam_pool_lf_coverage'
      AND status IN ('pending','queued','processing','running','batch_pending'))
  INTO v_active_gen_jobs, v_active_repair_jobs, v_active_lf_repair_jobs
  FROM job_queue
  WHERE package_id = p_package_id;

  SELECT COUNT(*) INTO v_recent_repair_count
  FROM job_queue
  WHERE package_id = p_package_id
    AND job_type IN ('package_repair_exam_pool_quality','repair_exam_pool_quality',
                     'package_repair_exam_pool_lf_coverage')
    AND created_at > now() - interval '24 hours';

  -- No-effect repair detection
  SELECT COUNT(*) INTO v_no_effect_repairs
  FROM (
    SELECT s1.id
    FROM exam_pool_validation_snapshots s1
    LEFT JOIN LATERAL (
      SELECT approved_count, missing_lf_coverage, missing_competency_coverage
      FROM exam_pool_validation_snapshots s2
      WHERE s2.package_id = p_package_id AND s2.created_at < s1.created_at
      ORDER BY s2.created_at DESC LIMIT 1
    ) prev ON true
    WHERE s1.package_id = p_package_id
      AND s1.created_at > now() - interval '2 hours'
      AND prev.approved_count IS NOT NULL
      AND abs(COALESCE(s1.approved_count,0) - COALESCE(prev.approved_count,0)) < 2
      AND abs(COALESCE(s1.missing_lf_coverage,0) - COALESCE(prev.missing_lf_coverage,0)) < 1
      AND abs(COALESCE(s1.missing_competency_coverage,0) - COALESCE(prev.missing_competency_coverage,0)) < 1
  ) deltas;

  SELECT COALESCE((meta->>'consecutive_no_progress')::int, 0) INTO v_consecutive_no_progress
  FROM package_steps
  WHERE package_id = p_package_id AND step_key = 'validate_exam_pool';

  -- ══════════════════════════════════════════════════════════════
  -- CLASSIFICATION — D+ semantic order:
  --   1. STRUCTURAL HARD_FAIL (only true defects)
  --   2. WAITING_FOR_MATERIALIZATION (upstream still active)
  --   3. REPAIR_LF_COVERAGE (NEW — coverage gaps with sufficient questions)
  --   4. REPAIRABLE (other quality gaps)
  --   5. PASS
  --   6. HARD_FAIL_REPAIR_EXHAUSTED (only after every other path fails)
  -- ══════════════════════════════════════════════════════════════

  -- 1. True structural HARD_FAIL: zero questions AND generation never ran
  IF v_total_questions = 0 AND v_active_gen_jobs = 0 THEN
    IF NOT EXISTS (
      SELECT 1 FROM job_queue
      WHERE package_id = p_package_id
        AND job_type IN ('package_generate_exam_pool','generate_exam_pool_batch')
        AND status IN ('completed','done')
    ) THEN
      v_gate_status := 'HARD_FAIL';
      v_hard_fail := true;
      v_reason_codes := array_append(v_reason_codes, 'HARD_FAIL_GENERATION_NEVER_RAN');
      v_repair_action := 'enqueue_root_generation';
    ELSE
      -- Generation completed but produced zero questions → still structural
      v_gate_status := 'HARD_FAIL';
      v_hard_fail := true;
      v_reason_codes := array_append(v_reason_codes, 'HARD_FAIL_GENERATION_PRODUCED_ZERO');
      v_repair_action := 'manual_review';
    END IF;
  END IF;

  -- 2. WAITING — upstream generation/repair active, do not fail
  IF v_gate_status IS NULL AND (v_active_gen_jobs > 0 OR v_active_repair_jobs > 0 OR v_active_lf_repair_jobs > 0) THEN
    v_gate_status := 'WAITING_FOR_MATERIALIZATION';
    v_reason_codes := array_append(v_reason_codes, 'UPSTREAM_GENERATION_ACTIVE');
    v_repair_action := 'requeue_with_backoff';
  END IF;

  -- 3. REPAIR_LF_COVERAGE — NEW: enough questions but coverage skewed/missing
  --    Only evaluate once we have a reasonable sample size to avoid premature classification.
  IF v_gate_status IS NULL
     AND v_coverage_eligible >= v_min_questions_for_lf_eval
     AND v_total_lfs > 0
     AND v_lf_coverage_pct < v_lf_coverage_threshold
  THEN
    v_gate_status := 'REPAIRABLE';
    v_reason_codes := array_append(v_reason_codes, 'REPAIR_LF_COVERAGE');
    IF v_lf_skew_max_share > 50 THEN
      v_reason_codes := array_append(v_reason_codes, 'REPAIR_LF_COVERAGE_SKEWED');
    ELSE
      v_reason_codes := array_append(v_reason_codes, 'REPAIR_LF_COVERAGE_MISSING');
    END IF;
    v_repair_action := 'enqueue_lf_coverage_repair';
  END IF;

  -- 4. Other REPAIRABLE quality gaps
  IF v_gate_status IS NULL THEN
    v_unresolved_ratio := CASE
      WHEN v_coverage_eligible > 0
      THEN (v_tier1_failed_count + v_needs_revision_count)::numeric / v_coverage_eligible * 100
      ELSE 100
    END;

    IF v_coverage_eligible < 50 THEN
      v_is_pass := false;
      v_reason_codes := array_append(v_reason_codes, 'REPAIR_INSUFFICIENT_QUESTIONS');
    END IF;
    IF v_comp_coverage_pct < 70 THEN
      v_is_pass := false;
      v_reason_codes := array_append(v_reason_codes, 'REPAIR_COMPETENCY_COVERAGE');
    END IF;
    IF v_unresolved_ratio >= 5 THEN
      v_is_pass := false;
      v_reason_codes := array_append(v_reason_codes, 'REPAIR_QC_RECONCILIATION');
    END IF;

    IF v_is_pass THEN
      v_gate_status := 'PASS';
      v_repair_action := 'allow_promotion';
    ELSE
      -- Repair-exhaustion check ONLY here, not before semantic classification
      IF v_no_effect_repairs >= 3 OR v_consecutive_no_progress >= 3 THEN
        v_gate_status := 'HARD_FAIL';
        v_hard_fail := true;
        v_reason_codes := array_append(v_reason_codes, 'HARD_FAIL_REPAIR_EXHAUSTED');
        v_repair_action := 'manual_review';
      ELSE
        v_gate_status := 'REPAIRABLE';
        v_repair_action := 'enqueue_quality_repair';
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'gate_status', v_gate_status,
    'reason_codes', v_reason_codes,
    'hard_fail', v_hard_fail,
    'recommended_action', v_repair_action,
    'has_active_upstream_jobs', v_active_gen_jobs > 0,
    'has_active_repair_jobs', v_active_repair_jobs > 0 OR v_active_lf_repair_jobs > 0,
    'repair_attempts_24h', v_recent_repair_count,
    'no_effect_repairs_2h', v_no_effect_repairs,
    'consecutive_no_progress', v_consecutive_no_progress,
    'metrics', jsonb_build_object(
      'total_questions', v_total_questions,
      'approved_count', v_approved_count,
      'tier1_passed_count', v_tier1_passed_count,
      'coverage_eligible', v_coverage_eligible,
      'review_count', v_review_count,
      'draft_count', v_draft_count,
      'pending_count', v_pending_count,
      'rejected_count', v_rejected_count,
      'tier1_failed_count', v_tier1_failed_count,
      'needs_revision_count', v_needs_revision_count,
      'total_lfs', v_total_lfs,
      'covered_lfs', v_covered_lfs,
      'lf_coverage_pct', v_lf_coverage_pct,
      'lf_skew_max_share', v_lf_skew_max_share,
      'lf_dominant_id', v_lf_dominant_id,
      'total_competencies', v_total_competencies,
      'covered_competencies', v_covered_competencies,
      'comp_coverage_pct', v_comp_coverage_pct,
      'unresolved_ratio', v_unresolved_ratio
    )
  );
END;
$function$;

-- ════════════════════════════════════════════════════════════════════
-- Helper: identify missing/under-represented LFs for targeted repair
-- ════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.fn_get_lf_coverage_deficit(p_package_id uuid, p_target_per_lf int DEFAULT 15)
RETURNS TABLE (
  learning_field_id uuid,
  lf_code text,
  lf_title text,
  current_count int,
  target_count int,
  deficit int
)
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  WITH curr AS (
    SELECT cu.id AS curriculum_id
    FROM course_packages cp
    JOIN curricula cu ON cu.certification_id = cp.certification_id
    WHERE cp.id = p_package_id
    LIMIT 1
  ),
  lf_counts AS (
    SELECT
      lf.id AS learning_field_id,
      lf.code AS lf_code,
      lf.title AS lf_title,
      COALESCE(COUNT(eq.id) FILTER (WHERE eq.qc_status IN ('approved','tier1_passed')), 0)::int AS current_count
    FROM curr
    JOIN learning_fields lf ON lf.curriculum_id = curr.curriculum_id
    LEFT JOIN exam_questions eq
      ON eq.learning_field_id = lf.id
     AND eq.curriculum_id = curr.curriculum_id
    GROUP BY lf.id, lf.code, lf.title
  )
  SELECT
    learning_field_id,
    lf_code,
    lf_title,
    current_count,
    p_target_per_lf AS target_count,
    GREATEST(p_target_per_lf - current_count, 0)::int AS deficit
  FROM lf_counts
  WHERE current_count < p_target_per_lf
  ORDER BY deficit DESC, lf_code ASC;
$$;