
-- Fix 1: fn_compute_minicheck_fingerprint — sha256() → digest(), add question_type + explanation dimensions
CREATE OR REPLACE FUNCTION public.fn_compute_minicheck_fingerprint(p_curriculum_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved_count int;
  v_total_count int;
  v_lesson_coverage_hash text;
  v_bloom_hash text;
  v_trap_count int;
  v_qtype_hash text;
  v_explanation_coverage int;
  v_fingerprint text;
BEGIN
  SELECT count(*) FILTER (WHERE status = 'approved'),
         count(*)
  INTO v_approved_count, v_total_count
  FROM minicheck_questions
  WHERE curriculum_id = p_curriculum_id;

  IF v_total_count = 0 THEN
    RETURN jsonb_build_object('fingerprint', null, 'reason', 'no_minichecks');
  END IF;

  -- Lesson coverage hash (approved only)
  SELECT md5(string_agg(lesson_id::text || ':' || cnt::text, ',' ORDER BY lesson_id))
  INTO v_lesson_coverage_hash
  FROM (
    SELECT lesson_id, count(*) as cnt
    FROM minicheck_questions
    WHERE curriculum_id = p_curriculum_id
      AND status = 'approved'
      AND lesson_id IS NOT NULL
    GROUP BY lesson_id
  ) sub;

  -- Bloom/cognitive distribution hash (approved only)
  SELECT md5(string_agg(coalesce(cognitive_level, 'null') || ':' || cnt::text, ',' ORDER BY cognitive_level))
  INTO v_bloom_hash
  FROM (
    SELECT cognitive_level, count(*) as cnt
    FROM minicheck_questions
    WHERE curriculum_id = p_curriculum_id
      AND status = 'approved'
    GROUP BY cognitive_level
  ) sub;

  -- Question type distribution hash (approved only)
  SELECT md5(string_agg(coalesce(question_type, 'null') || ':' || cnt::text, ',' ORDER BY question_type))
  INTO v_qtype_hash
  FROM (
    SELECT question_type, count(*) as cnt
    FROM minicheck_questions
    WHERE curriculum_id = p_curriculum_id
      AND status = 'approved'
    GROUP BY question_type
  ) sub;

  -- Trap coverage count
  SELECT count(*) INTO v_trap_count
  FROM minicheck_questions
  WHERE curriculum_id = p_curriculum_id
    AND status = 'approved'
    AND trap_tags IS NOT NULL
    AND trap_tags <> '{}';

  -- Explanation coverage: approved questions with non-empty explanation
  SELECT count(*) INTO v_explanation_coverage
  FROM minicheck_questions
  WHERE curriculum_id = p_curriculum_id
    AND status = 'approved'
    AND explanation IS NOT NULL
    AND length(trim(explanation)) >= 40;

  -- Compose fingerprint using pgcrypto digest
  v_fingerprint := encode(
    digest(
      convert_to(
        'mc:' || p_curriculum_id::text
        || ':approved:' || v_approved_count::text
        || ':total:' || v_total_count::text
        || ':lessons:' || coalesce(v_lesson_coverage_hash, 'none')
        || ':bloom:' || coalesce(v_bloom_hash, 'none')
        || ':qtype:' || coalesce(v_qtype_hash, 'none')
        || ':traps:' || v_trap_count::text
        || ':expl:' || v_explanation_coverage::text,
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  RETURN jsonb_build_object(
    'fingerprint', v_fingerprint,
    'approved_count', v_approved_count,
    'total_count', v_total_count,
    'trap_count', v_trap_count,
    'explanation_coverage', v_explanation_coverage
  );
END;
$$;

-- Fix 2: fn_is_step_bypass_eligible — full v2.1 hardening
CREATE OR REPLACE FUNCTION public.fn_is_step_bypass_eligible(
  p_package_id uuid,
  p_step_key text,
  p_current_fingerprint text,
  p_validator_version text,
  p_fingerprint_version text DEFAULT 'v1'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step record;
  v_prev_fp text;
  v_prev_validator_version text;
  v_prev_fp_version text;
  v_prev_passed boolean;
  v_validated_at timestamptz;
  v_active_jobs int;
  v_pkg_status text;
  v_upstream_newer boolean := false;
BEGIN
  -- 1. Load current step
  SELECT status, meta, updated_at
  INTO v_step
  FROM package_steps
  WHERE package_id = p_package_id AND step_key = p_step_key;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'step_not_found');
  END IF;

  -- 2. Extract previous validation state
  v_prev_fp := v_step.meta->>'artifact_fingerprint';
  v_prev_validator_version := coalesce(v_step.meta->>'validator_version', 'v0');
  v_prev_fp_version := coalesce(v_step.meta->>'fingerprint_version', 'v0');
  v_prev_passed := coalesce((v_step.meta->>'validation_passed')::boolean, false);
  v_validated_at := coalesce(
    (v_step.meta->>'validated_at')::timestamptz,
    (v_step.meta->>'bypassed_at')::timestamptz
  );

  -- Guard: previous must have passed
  IF NOT v_prev_passed THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_previous_pass');
  END IF;

  -- Guard: validator version must match
  IF v_prev_validator_version <> p_validator_version THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'validator_version_changed',
      'prev_version', v_prev_validator_version, 'current_version', p_validator_version);
  END IF;

  -- Guard: fingerprint version must match
  IF v_prev_fp_version <> p_fingerprint_version THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'fingerprint_version_changed',
      'prev_fp_version', v_prev_fp_version, 'current_fp_version', p_fingerprint_version);
  END IF;

  -- Guard: fingerprint must match
  IF v_prev_fp IS NULL OR v_prev_fp <> p_current_fingerprint THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'fingerprint_mismatch',
      'prev_fingerprint', coalesce(v_prev_fp, 'null'), 'current_fingerprint', p_current_fingerprint);
  END IF;

  -- Guard: package status — no bypass while blocked or quality_gate_failed
  SELECT status INTO v_pkg_status
  FROM course_packages
  WHERE id = p_package_id;

  IF v_pkg_status IN ('blocked', 'quality_gate_failed') THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'package_status_unstable',
      'package_status', v_pkg_status);
  END IF;

  -- Guard: no dirty/regen/rebuild flags
  IF coalesce((v_step.meta->>'regen_required')::boolean, false)
     OR coalesce((v_step.meta->>'content_dirty')::boolean, false)
     OR coalesce((v_step.meta->>'rebuild_forced')::boolean, false)
     OR coalesce((v_step.meta->>'force_revalidate')::boolean, false) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'invalidation_flag_set');
  END IF;

  -- Guard: step-specific active jobs (dynamic based on step_key)
  IF p_step_key = 'validate_handbook_depth' THEN
    SELECT count(*) INTO v_active_jobs
    FROM job_queue
    WHERE package_id = p_package_id
      AND job_type IN ('handbook_expand_section', 'package_generate_handbook', 'package_enqueue_handbook_expand')
      AND status IN ('pending', 'queued', 'processing');
  ELSIF p_step_key = 'validate_lesson_minichecks' THEN
    SELECT count(*) INTO v_active_jobs
    FROM job_queue
    WHERE package_id = p_package_id
      AND job_type IN ('package_generate_lesson_minichecks', 'package_validate_lesson_minichecks')
      AND status IN ('pending', 'queued', 'processing');
  ELSE
    -- Generic fallback: check any active jobs for this package
    SELECT count(*) INTO v_active_jobs
    FROM job_queue
    WHERE package_id = p_package_id
      AND status IN ('pending', 'queued', 'processing');
  END IF;

  IF v_active_jobs > 0 THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'active_related_jobs',
      'active_count', v_active_jobs, 'step_key', p_step_key);
  END IF;

  -- Guard: upstream steps not completed after last validation
  IF v_validated_at IS NOT NULL THEN
    IF p_step_key = 'validate_handbook_depth' THEN
      SELECT EXISTS(
        SELECT 1 FROM package_steps
        WHERE package_id = p_package_id
          AND step_key IN ('expand_handbook', 'generate_handbook')
          AND status = 'done'
          AND coalesce(
            (meta->>'completed_at')::timestamptz,
            updated_at
          ) > v_validated_at
      ) INTO v_upstream_newer;
    ELSIF p_step_key = 'validate_lesson_minichecks' THEN
      SELECT EXISTS(
        SELECT 1 FROM package_steps
        WHERE package_id = p_package_id
          AND step_key IN ('generate_lesson_minichecks')
          AND status = 'done'
          AND coalesce(
            (meta->>'completed_at')::timestamptz,
            updated_at
          ) > v_validated_at
      ) INTO v_upstream_newer;
    END IF;

    IF v_upstream_newer THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'upstream_step_newer_than_validation');
    END IF;
  END IF;

  -- All guards passed
  RETURN jsonb_build_object(
    'eligible', true,
    'reason', 'fingerprint_match',
    'artifact_fingerprint', p_current_fingerprint,
    'source_package_id', p_package_id,
    'validator_version', p_validator_version,
    'fingerprint_version', p_fingerprint_version
  );
END;
$$;
