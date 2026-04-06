
-- ══════════════════════════════════════════════════════════════
-- Dauermaßnahme 2: Mehrstufiges Gate für validate_exam_pool
-- ══════════════════════════════════════════════════════════════

-- 1. Extend snapshots
ALTER TABLE public.exam_pool_validation_snapshots
  ADD COLUMN IF NOT EXISTS gate_class text,
  ADD COLUMN IF NOT EXISTS repair_attempts_24h int DEFAULT 0;

-- 2. Central classification function
CREATE OR REPLACE FUNCTION public.fn_classify_exam_pool_gate(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_total_questions int := 0;
  v_approved_count int := 0;
  v_review_count int := 0;
  v_draft_count int := 0;
  v_pending_count int := 0;
  v_tier1_passed_count int := 0;
  v_rejected_count int := 0;
  v_tier1_failed_count int := 0;
  v_needs_revision_count int := 0;
  v_total_lfs int := 0;
  v_covered_lfs int := 0;
  v_lf_coverage_pct numeric := 0;
  v_total_competencies int := 0;
  v_covered_competencies int := 0;
  v_comp_coverage_pct numeric := 0;
  v_active_gen_jobs int := 0;
  v_active_repair_jobs int := 0;
  v_recent_repair_count int := 0;
  v_no_effect_repairs int := 0;
  v_has_blueprints boolean := false;
  v_consecutive_no_progress int := 0;
  v_reason_codes text[] := '{}';
  v_gate_status text;
  v_repair_action text;
  v_hard_fail boolean := false;
  v_coverage_eligible_count int := 0;
BEGIN
  -- Resolve curriculum via course_packages.certification_id
  SELECT cu.id INTO v_curriculum_id
  FROM course_packages cp
  JOIN curricula cu ON cu.certification_id = cp.certification_id
  WHERE cp.id = p_package_id
  LIMIT 1;

  IF v_curriculum_id IS NULL THEN
    RETURN jsonb_build_object(
      'gate_status', 'HARD_FAIL',
      'reason_codes', ARRAY['HARD_FAIL_NO_CURRICULUM'],
      'hard_fail', true, 'recommended_action', 'manual_review',
      'metrics', '{}'::jsonb
    );
  END IF;

  SELECT EXISTS(
    SELECT 1 FROM question_blueprints WHERE curriculum_id = v_curriculum_id AND status != 'deprecated' LIMIT 1
  ) INTO v_has_blueprints;

  IF NOT v_has_blueprints THEN
    RETURN jsonb_build_object(
      'gate_status', 'HARD_FAIL',
      'reason_codes', ARRAY['HARD_FAIL_NO_BLUEPRINTS'],
      'hard_fail', true, 'recommended_action', 'regenerate_blueprints',
      'metrics', '{}'::jsonb
    );
  END IF;

  -- QC counts
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE qc_status = 'approved'),
    COUNT(*) FILTER (WHERE qc_status IN ('pending_review','review')),
    COUNT(*) FILTER (WHERE qc_status = 'draft' OR qc_status IS NULL),
    COUNT(*) FILTER (WHERE qc_status = 'pending'),
    COUNT(*) FILTER (WHERE qc_status = 'tier1_passed'),
    COUNT(*) FILTER (WHERE qc_status = 'rejected'),
    COUNT(*) FILTER (WHERE qc_status = 'tier1_failed'),
    COUNT(*) FILTER (WHERE qc_status = 'needs_revision'),
    COUNT(*) FILTER (WHERE qc_status IN ('approved','tier1_passed'))
  INTO v_total_questions, v_approved_count, v_review_count, v_draft_count,
       v_pending_count, v_tier1_passed_count, v_rejected_count,
       v_tier1_failed_count, v_needs_revision_count, v_coverage_eligible_count
  FROM exam_questions WHERE curriculum_id = v_curriculum_id;

  -- LF coverage
  SELECT COUNT(*) INTO v_total_lfs FROM learning_fields WHERE curriculum_id = v_curriculum_id;
  SELECT COUNT(DISTINCT learning_field_id) INTO v_covered_lfs
  FROM exam_questions
  WHERE curriculum_id = v_curriculum_id AND learning_field_id IS NOT NULL
    AND qc_status IN ('approved','tier1_passed');
  IF v_total_lfs > 0 THEN v_lf_coverage_pct := round(v_covered_lfs * 100.0 / v_total_lfs, 1); END IF;

  -- Competency coverage
  SELECT COUNT(*) INTO v_total_competencies FROM competencies WHERE curriculum_id = v_curriculum_id;
  SELECT COUNT(DISTINCT competency_id) INTO v_covered_competencies
  FROM exam_questions
  WHERE curriculum_id = v_curriculum_id AND competency_id IS NOT NULL
    AND qc_status IN ('approved','tier1_passed');
  IF v_total_competencies > 0 THEN v_comp_coverage_pct := round(v_covered_competencies * 100.0 / v_total_competencies, 1); END IF;

  -- Active jobs
  SELECT
    COUNT(*) FILTER (WHERE job_type IN ('package_generate_exam_pool','generate_exam_pool_batch','pool_fill_lf_gaps','pool_fill_bloom_gaps')
                     AND status IN ('pending','queued','processing','running','batch_pending')),
    COUNT(*) FILTER (WHERE job_type IN ('package_repair_exam_pool_quality','repair_exam_pool_quality')
                     AND status IN ('pending','queued','processing','running','batch_pending'))
  INTO v_active_gen_jobs, v_active_repair_jobs
  FROM job_queue WHERE package_id = p_package_id;

  SELECT COUNT(*) INTO v_recent_repair_count
  FROM job_queue WHERE package_id = p_package_id
    AND job_type IN ('package_repair_exam_pool_quality','repair_exam_pool_quality')
    AND created_at > now() - interval '24 hours';

  -- No-effect repair detection (snapshots within 2h with near-zero delta)
  SELECT COUNT(*) INTO v_no_effect_repairs
  FROM (
    SELECT s1.id
    FROM exam_pool_validation_snapshots s1
    LEFT JOIN LATERAL (
      SELECT approved_count, missing_lf_coverage, missing_competency_coverage
      FROM exam_pool_validation_snapshots s2
      WHERE s2.package_id = p_package_id AND s2.created_at < s1.created_at
      ORDER BY s2.created_at DESC LIMIT 1
    ) s2 ON true
    WHERE s1.package_id = p_package_id
      AND s1.created_at > now() - interval '2 hours'
      AND s2.approved_count IS NOT NULL
      AND abs(COALESCE(s1.approved_count,0) - COALESCE(s2.approved_count,0)) < 2
      AND abs(COALESCE(s1.missing_lf_coverage,0) - COALESCE(s2.missing_lf_coverage,0)) < 1
      AND abs(COALESCE(s1.missing_competency_coverage,0) - COALESCE(s2.missing_competency_coverage,0)) < 1
  ) deltas;

  SELECT COALESCE((meta->>'consecutive_no_progress')::int, 0)
  INTO v_consecutive_no_progress
  FROM package_steps WHERE package_id = p_package_id AND step_key = 'validate_exam_pool';

  -- ══ CLASSIFICATION ══

  -- HARD_FAIL
  IF v_total_questions = 0 AND v_active_gen_jobs = 0 THEN
    v_gate_status := 'HARD_FAIL';
    v_reason_codes := array_append(v_reason_codes, 'HARD_FAIL_SSOT_MISSING');
    v_hard_fail := true;
  END IF;

  IF NOT v_hard_fail AND v_no_effect_repairs >= 3 AND v_active_repair_jobs = 0 THEN
    v_gate_status := 'HARD_FAIL';
    v_reason_codes := array_append(v_reason_codes, 'HARD_FAIL_REPAIR_EXHAUSTED');
    v_hard_fail := true;
  END IF;

  -- WAITING_FOR_MATERIALIZATION
  IF NOT v_hard_fail AND v_gate_status IS NULL THEN
    IF v_active_gen_jobs > 0 THEN
      v_gate_status := 'WAITING_FOR_MATERIALIZATION';
      v_reason_codes := array_append(v_reason_codes, 'UPSTREAM_GENERATION_ACTIVE');
    ELSIF v_active_repair_jobs > 0 THEN
      v_gate_status := 'WAITING_FOR_MATERIALIZATION';
      v_reason_codes := array_append(v_reason_codes, 'REPAIR_IN_PROGRESS');
    ELSIF v_pending_count > GREATEST(v_total_questions * 0.1, 20) THEN
      v_gate_status := 'WAITING_FOR_MATERIALIZATION';
      v_reason_codes := array_append(v_reason_codes, 'PENDING_QC_HIGH');
    ELSIF v_draft_count > GREATEST(v_total_questions * 0.15, 30) THEN
      v_gate_status := 'WAITING_FOR_MATERIALIZATION';
      v_reason_codes := array_append(v_reason_codes, 'DRAFT_RATIO_HIGH');
    END IF;
  END IF;

  -- PASS vs REPAIRABLE
  IF v_gate_status IS NULL AND NOT v_hard_fail THEN
    DECLARE
      v_min_q int := 50;
      v_is_pass boolean := true;
      v_unresolved_ratio numeric := 0;
    BEGIN
      v_unresolved_ratio := CASE WHEN v_coverage_eligible_count > 0
        THEN (v_tier1_failed_count + v_needs_revision_count)::numeric / v_coverage_eligible_count * 100
        ELSE 100 END;

      IF v_coverage_eligible_count < v_min_q THEN
        v_is_pass := false;
        v_reason_codes := array_append(v_reason_codes, 'REPAIR_INSUFFICIENT_QUESTIONS');
      END IF;
      IF v_lf_coverage_pct < 80 THEN
        v_is_pass := false;
        v_reason_codes := array_append(v_reason_codes, 'REPAIR_LF_COVERAGE');
      END IF;
      IF v_comp_coverage_pct < 70 THEN
        v_is_pass := false;
        v_reason_codes := array_append(v_reason_codes, 'REPAIR_COMPETENCY_COVERAGE');
      END IF;
      IF v_unresolved_ratio > 5.0 THEN
        v_is_pass := false;
        v_reason_codes := array_append(v_reason_codes, 'REPAIR_QC_RECONCILIATION');
      END IF;

      IF v_is_pass THEN
        v_gate_status := 'PASS';
        v_reason_codes := '{}';
      ELSE
        v_gate_status := 'REPAIRABLE';
      END IF;
    END;
  END IF;

  v_repair_action := CASE v_gate_status
    WHEN 'PASS' THEN 'mark_step_done'
    WHEN 'WAITING_FOR_MATERIALIZATION' THEN 'wait_and_requeue'
    WHEN 'REPAIRABLE' THEN 'enqueue_targeted_repair'
    WHEN 'HARD_FAIL' THEN 'block_manual_review'
    ELSE 'unknown'
  END;

  RETURN jsonb_build_object(
    'gate_status', v_gate_status,
    'reason_codes', v_reason_codes,
    'hard_fail', v_hard_fail,
    'recommended_action', v_repair_action,
    'has_active_upstream_jobs', (v_active_gen_jobs > 0),
    'has_active_repair_jobs', (v_active_repair_jobs > 0),
    'repair_attempts_24h', v_recent_repair_count,
    'no_effect_repairs_2h', v_no_effect_repairs,
    'consecutive_no_progress', v_consecutive_no_progress,
    'metrics', jsonb_build_object(
      'total_questions', v_total_questions,
      'approved_count', v_approved_count,
      'tier1_passed_count', v_tier1_passed_count,
      'coverage_eligible_count', v_coverage_eligible_count,
      'review_count', v_review_count,
      'draft_count', v_draft_count,
      'pending_count', v_pending_count,
      'rejected_count', v_rejected_count,
      'tier1_failed_count', v_tier1_failed_count,
      'needs_revision_count', v_needs_revision_count,
      'lf_coverage_pct', v_lf_coverage_pct,
      'competency_coverage_pct', v_comp_coverage_pct,
      'total_lfs', v_total_lfs,
      'covered_lfs', v_covered_lfs,
      'total_competencies', v_total_competencies,
      'covered_competencies', v_covered_competencies
    )
  );
END;
$$;

-- 3. Ops View
CREATE OR REPLACE VIEW public.ops_validate_exam_pool_status AS
WITH pkg_info AS (
  SELECT
    cp.id AS package_id,
    c.title AS course_title,
    cu.id AS curriculum_id,
    cp.status AS package_status,
    ps.status AS step_status,
    ps.attempts AS step_attempts,
    ps.last_error,
    ps.meta->>'guard_state' AS guard_state,
    ps.meta->>'stall_reason_code' AS stall_reason_code
  FROM course_packages cp
  JOIN courses c ON c.id = cp.course_id
  LEFT JOIN curricula cu ON cu.certification_id = cp.certification_id
  JOIN package_steps ps ON ps.package_id = cp.id AND ps.step_key = 'validate_exam_pool'
  WHERE cp.status IN ('building','blocked','quality_gate_failed')
    AND ps.status != 'skipped'
),
metrics AS (
  SELECT
    pi.package_id, pi.course_title, pi.package_status, pi.step_status,
    pi.step_attempts, pi.last_error, pi.guard_state, pi.stall_reason_code,
    COUNT(eq.id) AS total_questions,
    COUNT(eq.id) FILTER (WHERE eq.qc_status IN ('approved','tier1_passed')) AS approved_count,
    COUNT(eq.id) FILTER (WHERE eq.qc_status IN ('pending_review','review')) AS review_count,
    COUNT(eq.id) FILTER (WHERE eq.qc_status = 'draft' OR eq.qc_status IS NULL) AS draft_count,
    COUNT(eq.id) FILTER (WHERE eq.qc_status = 'pending') AS pending_count,
    COUNT(eq.id) FILTER (WHERE eq.qc_status IN ('tier1_failed','needs_revision')) AS failed_count,
    COUNT(eq.id) FILTER (WHERE eq.qc_status = 'rejected') AS rejected_count
  FROM pkg_info pi
  LEFT JOIN exam_questions eq ON eq.curriculum_id = pi.curriculum_id
  GROUP BY pi.package_id, pi.course_title, pi.package_status, pi.step_status,
           pi.step_attempts, pi.last_error, pi.guard_state, pi.stall_reason_code
),
active_jobs AS (
  SELECT
    jq.package_id,
    COUNT(*) FILTER (WHERE jq.job_type IN ('package_generate_exam_pool','generate_exam_pool_batch','pool_fill_lf_gaps','pool_fill_bloom_gaps')
                     AND jq.status IN ('pending','queued','processing','running')) AS active_gen_jobs,
    COUNT(*) FILTER (WHERE jq.job_type IN ('package_repair_exam_pool_quality','repair_exam_pool_quality')
                     AND jq.status IN ('pending','queued','processing','running')) AS active_repair_jobs,
    COUNT(*) FILTER (WHERE jq.job_type IN ('package_repair_exam_pool_quality','repair_exam_pool_quality')
                     AND jq.created_at > now() - interval '24 hours') AS repair_attempts_24h
  FROM job_queue jq
  WHERE jq.package_id IN (SELECT package_id FROM pkg_info)
  GROUP BY jq.package_id
)
SELECT
  m.package_id, m.course_title, m.package_status, m.step_status,
  CASE
    WHEN m.step_status = 'done' THEN 'PASS'
    WHEN COALESCE(aj.active_gen_jobs,0) > 0 OR COALESCE(aj.active_repair_jobs,0) > 0 THEN 'WAITING_FOR_MATERIALIZATION'
    WHEN m.approved_count >= 50 AND m.failed_count::numeric / GREATEST(m.approved_count,1) < 0.05 THEN 'PASS'
    WHEN COALESCE(aj.repair_attempts_24h,0) >= 3 AND COALESCE(aj.active_repair_jobs,0) = 0 THEN 'HARD_FAIL'
    WHEN m.step_status = 'failed' THEN 'REPAIRABLE'
    ELSE 'REPAIRABLE'
  END AS gate_status,
  m.total_questions, m.approved_count, m.review_count, m.draft_count,
  m.pending_count, m.failed_count, m.rejected_count,
  COALESCE(aj.active_gen_jobs,0) AS active_gen_jobs,
  COALESCE(aj.active_repair_jobs,0) AS active_repair_jobs,
  COALESCE(aj.repair_attempts_24h,0) AS repair_attempts_24h,
  m.guard_state, m.stall_reason_code, m.last_error,
  CASE
    WHEN m.step_status = 'done' THEN 'none'
    WHEN COALESCE(aj.active_gen_jobs,0) > 0 THEN 'wait_for_generation'
    WHEN COALESCE(aj.active_repair_jobs,0) > 0 THEN 'wait_for_repair'
    WHEN COALESCE(aj.repair_attempts_24h,0) >= 3 AND COALESCE(aj.active_repair_jobs,0) = 0 THEN 'manual_review_required'
    WHEN m.step_status = 'failed' THEN 'enqueue_targeted_repair'
    ELSE 'requeue_validation'
  END AS recommended_action
FROM metrics m
LEFT JOIN active_jobs aj ON aj.package_id = m.package_id
ORDER BY
  CASE WHEN m.step_status = 'failed' THEN 1 WHEN m.step_status = 'queued' THEN 2 ELSE 3 END,
  m.course_title;
