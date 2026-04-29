-- Patch fn_classify_exam_pool_gate: prefer cp.curriculum_id (direct FK) over certification_id JOIN
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
  -- ✅ FIX: Resolve curriculum — prefer direct FK, fallback to certification_id JOIN
  SELECT COALESCE(
    cp.curriculum_id,
    (SELECT cu.id FROM curricula cu 
       WHERE cu.certification_id = cp.certification_id LIMIT 1)
  )
  INTO v_curriculum_id
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  -- Verify the resolved curriculum actually exists in curricula table
  IF v_curriculum_id IS NOT NULL THEN
    PERFORM 1 FROM curricula WHERE id = v_curriculum_id;
    IF NOT FOUND THEN
      v_curriculum_id := NULL;
    END IF;
  END IF;

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

  -- LF skew detection
  IF v_coverage_eligible > 0 AND v_covered_lfs > 0 THEN
    SELECT max_share, dominant_lf
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
    ) sub;
  END IF;

  -- Competency coverage
  SELECT COUNT(*) INTO v_total_competencies
  FROM competencies co
  JOIN learning_fields lf ON lf.id = co.learning_field_id
  WHERE lf.curriculum_id = v_curriculum_id;

  SELECT COUNT(DISTINCT eq.competency_id) INTO v_covered_competencies
  FROM exam_questions eq
  WHERE eq.curriculum_id = v_curriculum_id
    AND eq.qc_status IN ('approved','tier1_passed')
    AND eq.competency_id IS NOT NULL;

  IF v_total_competencies > 0 THEN
    v_comp_coverage_pct := round((v_covered_competencies::numeric * 100.0) / v_total_competencies, 1);
  END IF;

  -- Active jobs
  SELECT
    COUNT(*) FILTER (WHERE job_type IN ('package_generate_exam_pool','package_auto_seed_exam_blueprints')),
    COUNT(*) FILTER (WHERE job_type IN ('package_repair_exam_pool_competency_coverage','package_repair_exam_pool_quality')),
    COUNT(*) FILTER (WHERE job_type = 'pool_fill_lf_gaps')
  INTO v_active_gen_jobs, v_active_repair_jobs, v_active_lf_repair_jobs
  FROM job_queue
  WHERE package_id = p_package_id AND status IN ('pending','processing');

  -- Recent repairs
  SELECT COUNT(*) INTO v_recent_repair_count
  FROM job_queue
  WHERE package_id = p_package_id
    AND job_type LIKE 'package_repair_exam_pool%'
    AND created_at > now() - interval '24 hours';

  -- Decide gate
  v_unresolved_ratio := CASE WHEN v_total_questions > 0
    THEN (v_review_count + v_draft_count)::numeric / v_total_questions ELSE 0 END;

  IF v_total_questions = 0 AND v_active_gen_jobs > 0 THEN
    v_gate_status := 'WAITING_GENERATION';
    v_repair_action := 'wait';
  ELSIF v_total_questions = 0 THEN
    v_gate_status := 'NEEDS_GENERATION';
    v_repair_action := 'enqueue_generate_exam_pool';
    v_reason_codes := array_append(v_reason_codes, 'NO_QUESTIONS');
  ELSIF v_total_lfs >= 1 AND v_lf_coverage_pct < v_lf_coverage_threshold AND v_coverage_eligible >= v_min_questions_for_lf_eval THEN
    v_gate_status := 'NEEDS_REPAIR';
    v_repair_action := 'repair_lf_coverage';
    v_reason_codes := array_append(v_reason_codes, 'LF_COVERAGE_GAP');
    v_is_pass := false;
  ELSIF v_total_competencies > 0 AND v_comp_coverage_pct < 70 AND v_coverage_eligible >= 30 THEN
    v_gate_status := 'NEEDS_REPAIR';
    v_repair_action := 'repair_competency_coverage';
    v_reason_codes := array_append(v_reason_codes, 'COMPETENCY_COVERAGE_GAP');
    v_is_pass := false;
  ELSIF v_unresolved_ratio > 0.3 THEN
    v_gate_status := 'WAITING_QC';
    v_repair_action := 'wait_qc';
    v_reason_codes := array_append(v_reason_codes, 'HIGH_UNRESOLVED_RATIO');
  ELSE
    v_gate_status := 'PASS';
    v_repair_action := 'none';
    v_is_pass := true;
  END IF;

  RETURN jsonb_build_object(
    'gate_status', v_gate_status,
    'reason_codes', v_reason_codes,
    'hard_fail', v_hard_fail,
    'is_pass', v_is_pass,
    'recommended_action', v_repair_action,
    'curriculum_id', v_curriculum_id,
    'has_active_upstream_jobs', (v_active_gen_jobs > 0),
    'has_active_repair_jobs', (v_active_repair_jobs + v_active_lf_repair_jobs > 0),
    'repair_attempts_24h', v_recent_repair_count,
    'no_effect_repairs_2h', v_no_effect_repairs,
    'consecutive_no_progress', v_consecutive_no_progress,
    'metrics', jsonb_build_object(
      'total_questions', v_total_questions,
      'approved', v_approved_count,
      'tier1_passed', v_tier1_passed_count,
      'review', v_review_count,
      'draft', v_draft_count,
      'pending', v_pending_count,
      'rejected', v_rejected_count,
      'tier1_failed', v_tier1_failed_count,
      'needs_revision', v_needs_revision_count,
      'coverage_eligible', v_coverage_eligible,
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

-- Re-queue the 2 affected packages now that the validator is fixed
UPDATE package_steps
SET status='queued', attempts=0, last_error=NULL, started_at=NULL, finished_at=NULL, updated_at=now()
WHERE package_id IN ('d2000000-0010-4000-8000-000000000001','091fb5ed-3bea-5e0b-840e-e07845a5ebc5')
  AND step_key='validate_exam_pool'
  AND status='failed';

UPDATE course_packages
SET status='building', blocked_reason=NULL, blocked_at=NULL, blocked_by=NULL, last_error=NULL, updated_at=now()
WHERE id IN ('d2000000-0010-4000-8000-000000000001','091fb5ed-3bea-5e0b-840e-e07845a5ebc5')
  AND status='blocked';
