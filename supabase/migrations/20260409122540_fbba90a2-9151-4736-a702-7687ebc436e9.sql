
-- ═══════════════════════════════════════════════════════════════
-- fn_is_step_finalizable: DB-level SSOT for step finalization
-- Mirrors the TS isStepFinalizable logic from stuck-scan-helpers
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.fn_is_step_finalizable(
  p_package_id uuid,
  p_step_key text,
  p_min_age_minutes int DEFAULT 5
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step record;
  v_meta jsonb;
  v_has_completion boolean := false;
  v_has_needs_regen boolean := false;
  v_age_ms bigint;
  v_min_age_ms bigint;
  v_ref_time timestamptz;
  v_genuinely_active int := 0;
  v_terminal int := 0;
  v_job_type text;
  v_reason text;
  v_job record;
  -- Terminal loop detection constants (mirror TS)
  v_terminal_patterns text[] := ARRAY[
    'STALE_LOCK_RECOVERY','STALE_LOCK_LOOP_COOLDOWN','STALE_LOCK_EXHAUSTED',
    'LOOP_KILLED','ZOMBIE_TERMINAL_FAIL','LOCK_CHURN'
  ];
BEGIN
  -- Load step
  SELECT * INTO v_step
  FROM package_steps
  WHERE package_id = p_package_id AND step_key = p_step_key;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'finalizable', false,
      'reason_code', 'step_not_found',
      'reason_detail', p_step_key,
      'has_completion_signal', false,
      'genuinely_active_jobs', 0,
      'terminal_jobs', 0,
      'min_age_passed', false
    );
  END IF;

  v_meta := COALESCE(v_step.meta, '{}'::jsonb);

  -- 1. Completion signal check
  v_has_completion := (v_meta->>'batch_complete')::boolean IS TRUE
                   OR (v_meta->>'ok')::boolean IS TRUE;

  IF NOT v_has_completion THEN
    RETURN jsonb_build_object(
      'finalizable', false,
      'reason_code', 'no_completion_signal',
      'reason_detail', null,
      'has_completion_signal', false,
      'genuinely_active_jobs', 0,
      'terminal_jobs', 0,
      'min_age_passed', false
    );
  END IF;

  -- 2. needs_regen check
  v_has_needs_regen := COALESCE((v_meta->>'needs_regen')::int, 0) > 0;
  IF v_has_needs_regen THEN
    RETURN jsonb_build_object(
      'finalizable', false,
      'reason_code', 'needs_regen',
      'reason_detail', v_meta->>'needs_regen',
      'has_completion_signal', true,
      'genuinely_active_jobs', 0,
      'terminal_jobs', 0,
      'min_age_passed', false
    );
  END IF;

  -- 3. Age check
  v_min_age_ms := p_min_age_minutes * 60 * 1000;
  v_ref_time := COALESCE(v_step.started_at, v_step.updated_at);
  IF v_ref_time IS NOT NULL THEN
    v_age_ms := EXTRACT(EPOCH FROM (now() - v_ref_time)) * 1000;
    IF v_age_ms < v_min_age_ms THEN
      RETURN jsonb_build_object(
        'finalizable', false,
        'reason_code', 'too_young',
        'reason_detail', (v_age_ms / 1000)::text || 's',
        'has_completion_signal', true,
        'genuinely_active_jobs', 0,
        'terminal_jobs', 0,
        'min_age_passed', false
      );
    END IF;
  END IF;

  -- 4. Job liveness: determine job_type from step_key mapping
  -- Use the STEP_TO_JOB_TYPE map (simplified lookup)
  SELECT CASE p_step_key
    WHEN 'generate_blueprint' THEN 'generate_blueprint'
    WHEN 'validate_blueprints' THEN 'validate_blueprints'
    WHEN 'generate_exam_pool' THEN 'generate_exam_pool'
    WHEN 'validate_exam_pool' THEN 'validate_exam_pool'
    WHEN 'generate_lesson_shells' THEN 'generate_lesson_shells'
    WHEN 'generate_learning_content' THEN 'generate_learning_content'
    WHEN 'validate_learning_content' THEN 'validate_learning_content'
    WHEN 'generate_lesson_minichecks' THEN 'generate_lesson_minichecks'
    WHEN 'validate_lesson_minichecks' THEN 'validate_lesson_minichecks'
    WHEN 'expand_handbook' THEN 'expand_handbook'
    WHEN 'validate_handbook' THEN 'validate_handbook'
    WHEN 'validate_handbook_depth' THEN 'validate_handbook_depth'
    WHEN 'generate_oral_exam' THEN 'generate_oral_exam'
    WHEN 'validate_oral_exam' THEN 'validate_oral_exam'
    WHEN 'build_tutor_index' THEN 'build_tutor_index'
    WHEN 'validate_tutor_index' THEN 'validate_tutor_index'
    WHEN 'generate_glossary' THEN 'generate_glossary'
    WHEN 'elite_hardening' THEN 'elite_hardening'
    WHEN 'scaffold_learning_course' THEN 'scaffold_learning_course'
    ELSE p_step_key
  END INTO v_job_type;

  -- Count genuinely active vs terminal jobs
  FOR v_job IN
    SELECT id, attempts, last_error, status
    FROM job_queue
    WHERE package_id = p_package_id
      AND job_type = v_job_type
      AND status IN ('pending', 'processing')
  LOOP
    -- Terminal loop detection (mirrors TS isTerminalRetryLoop)
    IF COALESCE(v_job.attempts, 0) >= 10 THEN
      v_terminal := v_terminal + 1;
    ELSIF COALESCE(v_job.attempts, 0) >= 8
          AND COALESCE(v_job.last_error, '') LIKE 'HTTP 5%' THEN
      v_terminal := v_terminal + 1;
    ELSIF COALESCE(v_job.attempts, 0) >= 4 THEN
      -- Check known terminal patterns
      IF EXISTS (
        SELECT 1 FROM unnest(v_terminal_patterns) p
        WHERE COALESCE(v_job.last_error, '') LIKE '%' || p || '%'
      ) THEN
        v_terminal := v_terminal + 1;
      ELSE
        v_genuinely_active := v_genuinely_active + 1;
      END IF;
    ELSE
      v_genuinely_active := v_genuinely_active + 1;
    END IF;
  END LOOP;

  IF v_genuinely_active > 0 THEN
    RETURN jsonb_build_object(
      'finalizable', false,
      'reason_code', 'genuinely_active_jobs',
      'reason_detail', v_genuinely_active::text,
      'has_completion_signal', true,
      'genuinely_active_jobs', v_genuinely_active,
      'terminal_jobs', v_terminal,
      'min_age_passed', true
    );
  END IF;

  -- All conditions met
  RETURN jsonb_build_object(
    'finalizable', true,
    'reason_code', 'all_conditions_met',
    'reason_detail', null,
    'has_completion_signal', true,
    'genuinely_active_jobs', 0,
    'terminal_jobs', v_terminal,
    'min_age_passed', true
  );
END;
$$;

-- ═══════════════════════════════════════════════════════
-- ops_step_finalizability: View for Admin UI / forensics
-- ═══════════════════════════════════════════════════════

CREATE OR REPLACE VIEW public.ops_step_finalizability AS
SELECT
  ps.package_id,
  ps.step_key,
  ps.status AS step_status,
  ps.started_at,
  ps.updated_at,
  (ps.meta->>'batch_complete')::boolean AS has_batch_complete,
  (ps.meta->>'ok')::boolean AS has_meta_ok,
  COALESCE((ps.meta->>'needs_regen')::int, 0) AS needs_regen_count,
  EXTRACT(EPOCH FROM (now() - COALESCE(ps.started_at, ps.updated_at))) AS age_seconds,
  (SELECT count(*) FROM job_queue jq
   WHERE jq.package_id = ps.package_id
     AND jq.status IN ('pending', 'processing')
     AND jq.job_type = ps.step_key
  ) AS active_job_count,
  r.finalizable,
  r.reason_code,
  r.reason_detail,
  r.genuinely_active_jobs,
  r.terminal_jobs
FROM package_steps ps
CROSS JOIN LATERAL (
  SELECT
    (fn_is_step_finalizable(ps.package_id, ps.step_key))::jsonb AS result
) sub
CROSS JOIN LATERAL (
  SELECT
    (sub.result->>'finalizable')::boolean AS finalizable,
    sub.result->>'reason_code' AS reason_code,
    sub.result->>'reason_detail' AS reason_detail,
    (sub.result->>'genuinely_active_jobs')::int AS genuinely_active_jobs,
    (sub.result->>'terminal_jobs')::int AS terminal_jobs
) r
WHERE ps.status NOT IN ('done', 'skipped', 'failed');
