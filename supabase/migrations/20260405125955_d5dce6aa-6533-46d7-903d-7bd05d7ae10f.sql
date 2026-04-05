
-- ============================================================
-- 1. Replace fn_is_step_bypass_eligible with hardened v2
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_is_step_bypass_eligible(
  p_package_id uuid,
  p_step_key text,
  p_current_fingerprint text,
  p_validator_version text,
  p_fingerprint_version text DEFAULT 'v1'
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step record;
  v_prev_fp text;
  v_prev_version text;
  v_prev_fp_version text;
  v_prev_passed boolean;
  v_active_jobs int;
  v_validated_at timestamptz;
  v_upstream_newer boolean;
  v_pkg_status text;
  v_pkg_rebuild boolean;
BEGIN
  -- 1. Load current step
  SELECT status, meta
  INTO v_step
  FROM package_steps
  WHERE package_id = p_package_id AND step_key = p_step_key;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'step_not_found');
  END IF;

  -- 2. Check previous validation state from meta
  v_prev_fp := (v_step.meta->>'artifact_fingerprint');
  v_prev_version := coalesce(v_step.meta->>'validator_version', 'v0');
  v_prev_fp_version := coalesce(v_step.meta->>'fingerprint_version', 'v0');
  v_prev_passed := coalesce((v_step.meta->>'validation_passed')::boolean, false);
  v_validated_at := (v_step.meta->>'validated_at')::timestamptz;

  -- Guard: previous must have passed
  IF NOT v_prev_passed THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_previous_pass');
  END IF;

  -- Guard: validator version must match
  IF v_prev_version <> p_validator_version THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'validator_version_changed',
      'prev_version', v_prev_version, 'current_version', p_validator_version);
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

  -- Guard: no active related jobs (step-specific)
  -- FIX: use 'processing' instead of 'running' (actual queue status)
  IF p_step_key = 'validate_handbook_depth' THEN
    SELECT count(*) INTO v_active_jobs
    FROM job_queue
    WHERE package_id = p_package_id
      AND job_type IN ('handbook_expand_section', 'package_generate_handbook', 'package_enqueue_handbook_expand')
      AND status IN ('pending', 'processing', 'queued');
  ELSIF p_step_key = 'validate_lesson_minichecks' THEN
    SELECT count(*) INTO v_active_jobs
    FROM job_queue
    WHERE package_id = p_package_id
      AND job_type IN ('package_generate_lesson_minichecks', 'upgrade_minichecks_v1', 'lesson_generate_content')
      AND status IN ('pending', 'processing', 'queued');
  ELSE
    -- Generic fallback: check any active jobs for this package
    SELECT count(*) INTO v_active_jobs
    FROM job_queue
    WHERE package_id = p_package_id
      AND status IN ('pending', 'processing', 'queued');
  END IF;

  IF v_active_jobs > 0 THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'active_related_jobs',
      'active_count', v_active_jobs);
  END IF;

  -- Guard: no regen/rebuild/dirty flags in step meta
  IF coalesce((v_step.meta->>'regen_required')::boolean, false)
     OR coalesce((v_step.meta->>'content_dirty')::boolean, false)
     OR coalesce((v_step.meta->>'rebuild_forced')::boolean, false) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'invalidation_flag_set');
  END IF;

  -- Guard: check package-level rebuild/dirty status
  SELECT status INTO v_pkg_status
  FROM course_packages
  WHERE id = p_package_id;

  IF v_pkg_status IN ('rebuild_queued', 'repair_queued') THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'package_rebuild_pending',
      'package_status', v_pkg_status);
  END IF;

  -- Guard: check if upstream steps completed after last validation
  IF v_validated_at IS NOT NULL THEN
    IF p_step_key = 'validate_handbook_depth' THEN
      SELECT EXISTS (
        SELECT 1 FROM package_steps
        WHERE package_id = p_package_id
          AND step_key IN ('expand_handbook', 'generate_handbook')
          AND status = 'done'
          AND (meta->>'completed_at')::timestamptz > v_validated_at
      ) INTO v_upstream_newer;
    ELSIF p_step_key = 'validate_lesson_minichecks' THEN
      SELECT EXISTS (
        SELECT 1 FROM package_steps
        WHERE package_id = p_package_id
          AND step_key IN ('generate_lesson_minichecks', 'generate_learning_content')
          AND status = 'done'
          AND (meta->>'completed_at')::timestamptz > v_validated_at
      ) INTO v_upstream_newer;
    ELSE
      v_upstream_newer := false;
    END IF;

    IF v_upstream_newer THEN
      RETURN jsonb_build_object('eligible', false, 'reason', 'upstream_completed_after_validation');
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

-- ============================================================
-- 2. Create fn_compute_minicheck_fingerprint for Pattern E
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_compute_minicheck_fingerprint(
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_approved_count int;
  v_total_count int;
  v_lesson_coverage_hash text;
  v_bloom_hash text;
  v_trap_count int;
  v_fingerprint text;
BEGIN
  -- Count approved and total minichecks
  SELECT count(*) FILTER (WHERE status = 'approved'),
         count(*)
  INTO v_approved_count, v_total_count
  FROM minicheck_questions
  WHERE curriculum_id = p_curriculum_id;

  IF v_total_count = 0 THEN
    RETURN jsonb_build_object('fingerprint', null, 'reason', 'no_minichecks');
  END IF;

  -- Hash of lesson_id distribution (approved only)
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

  -- Hash of bloom/cognitive distribution (approved only)
  SELECT md5(string_agg(coalesce(cognitive_level, 'null') || ':' || cnt::text, ',' ORDER BY cognitive_level))
  INTO v_bloom_hash
  FROM (
    SELECT cognitive_level, count(*) as cnt
    FROM minicheck_questions
    WHERE curriculum_id = p_curriculum_id
      AND status = 'approved'
    GROUP BY cognitive_level
  ) sub;

  -- Trap coverage count
  SELECT count(*) INTO v_trap_count
  FROM minicheck_questions
  WHERE curriculum_id = p_curriculum_id
    AND status = 'approved'
    AND trap_tags IS NOT NULL
    AND trap_tags <> '{}';

  -- Compose fingerprint from all structural dimensions
  v_fingerprint := encode(
    sha256(
      convert_to(
        'mc:' || p_curriculum_id::text
        || ':approved:' || v_approved_count::text
        || ':total:' || v_total_count::text
        || ':lessons:' || coalesce(v_lesson_coverage_hash, 'none')
        || ':bloom:' || coalesce(v_bloom_hash, 'none')
        || ':traps:' || v_trap_count::text,
        'UTF8'
      )
    ),
    'hex'
  );

  RETURN jsonb_build_object(
    'fingerprint', v_fingerprint,
    'approved_count', v_approved_count,
    'total_count', v_total_count,
    'trap_count', v_trap_count
  );
END;
$$;
