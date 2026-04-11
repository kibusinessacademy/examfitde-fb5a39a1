
-- ============================================================
-- fn_prebuild_validate_handbook
-- Pure postcondition gate for validate_handbook
-- No generation, no expansion, no mutation of handbook content
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_handbook(
  p_package_id uuid
)
RETURNS TABLE (
  status text,
  advanced boolean,
  reason text,
  meta jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_step_status text;
  v_generate_status text;
  v_expand_status text;
  v_pkg_status text;
  v_gen_last_error text;

  v_active_jobs int := 0;

  v_chapter_count int := 0;
  v_section_count int := 0;
  v_with_basis int := 0;
  v_with_expanded int := 0;
  v_with_any_content int := 0;
  v_empty_sections int := 0;

  v_failed_generate boolean := false;
  v_poison_blocked boolean := false;
  v_threshold_fail boolean := false;

  v_now timestamptz := now();
BEGIN
  -- 0) Package exists / resolve curriculum
  SELECT cp.curriculum_id, cp.status
  INTO v_curriculum_id, v_pkg_status
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN QUERY
    SELECT 'deferred'::text, false, 'NO_CURRICULUM_ID'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 1) Already done?
  SELECT ps.status
  INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key = 'validate_handbook';

  IF v_step_status IS NULL THEN
    RETURN QUERY
    SELECT 'noop'::text, false, 'STEP_NOT_FOUND'::text, '{}'::jsonb;
    RETURN;
  END IF;

  IF v_step_status = 'done' THEN
    RETURN QUERY
    SELECT 'noop'::text, false, 'ALREADY_DONE'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 2) Prereq: generate_handbook must be done/skipped if present
  SELECT ps.status, ps.last_error
  INTO v_generate_status, v_gen_last_error
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key = 'generate_handbook';

  IF v_generate_status IS NOT NULL
     AND v_generate_status NOT IN ('done', 'skipped') THEN
    RETURN QUERY
    SELECT
      'deferred'::text,
      false,
      'PREREQ_GENERATE_HANDBOOK_NOT_DONE'::text,
      jsonb_build_object(
        'generate_handbook_status', v_generate_status,
        'last_error', v_gen_last_error
      );
    RETURN;
  END IF;

  -- 3) Optional prereq visibility: expand_handbook (informational only)
  SELECT ps.status
  INTO v_expand_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key = 'expand_handbook';

  -- 4) Active jobs guard
  SELECT count(*)
  INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type IN (
      'package_generate_handbook',
      'package_validate_handbook',
      'package_expand_handbook'
    )
    AND jq.status IN (
      'pending', 'queued', 'claimed',
      'processing', 'running', 'batch_pending'
    );

  IF v_active_jobs > 0 THEN
    RETURN QUERY
    SELECT
      'deferred'::text,
      false,
      'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs', v_active_jobs);
    RETURN;
  END IF;

  -- 5) Poison / threshold / failed-step guard
  SELECT EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = p_package_id
      AND ps.step_key = 'generate_handbook'
      AND ps.status IN ('failed', 'blocked')
  ) INTO v_failed_generate;

  SELECT EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = p_package_id
      AND ps.step_key = 'generate_handbook'
      AND (
        ps.last_error ILIKE '%poison%'
        OR coalesce(ps.meta->>'blocked_reason', '') ILIKE '%poison%'
      )
  ) INTO v_poison_blocked;

  SELECT EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = p_package_id
      AND ps.step_key = 'generate_handbook'
      AND (
        ps.last_error ILIKE '%THRESHOLD_FAIL%'
        OR coalesce(ps.meta->>'blocked_reason', '') ILIKE '%THRESHOLD_FAIL%'
      )
  ) INTO v_threshold_fail;

  IF v_poison_blocked THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'POISON_LOOP_BLOCKED'::text,
      jsonb_build_object('generate_handbook_status', v_generate_status, 'package_status', v_pkg_status);
    RETURN;
  END IF;

  IF v_threshold_fail THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'THRESHOLD_FAIL_PRESENT'::text,
      jsonb_build_object('generate_handbook_status', v_generate_status, 'package_status', v_pkg_status);
    RETURN;
  END IF;

  IF v_failed_generate THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'GENERATE_HANDBOOK_FAILED'::text,
      jsonb_build_object('generate_handbook_status', v_generate_status, 'package_status', v_pkg_status);
    RETURN;
  END IF;

  -- 6) Structural handbook checks
  SELECT count(*)
  INTO v_chapter_count
  FROM handbook_chapters hc
  WHERE hc.curriculum_id = v_curriculum_id;

  SELECT
    count(*) AS total_sections,
    count(*) FILTER (WHERE hs.basis_content IS NOT NULL AND length(trim(hs.basis_content)) > 0) AS with_basis,
    count(*) FILTER (WHERE hs.expanded_content IS NOT NULL AND length(trim(hs.expanded_content)) > 0) AS with_expanded,
    count(*) FILTER (WHERE
      (hs.basis_content IS NOT NULL AND length(trim(hs.basis_content)) > 0)
      OR (hs.expanded_content IS NOT NULL AND length(trim(hs.expanded_content)) > 0)
    ) AS with_any_content,
    count(*) FILTER (WHERE
      coalesce(length(trim(hs.basis_content)), 0) = 0
      AND coalesce(length(trim(hs.expanded_content)), 0) = 0
    ) AS empty_sections
  INTO v_section_count, v_with_basis, v_with_expanded, v_with_any_content, v_empty_sections
  FROM handbook_sections hs
  JOIN handbook_chapters hc ON hc.id = hs.chapter_id
  WHERE hc.curriculum_id = v_curriculum_id;

  IF v_chapter_count = 0 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_HANDBOOK_CHAPTERS'::text,
      jsonb_build_object('curriculum_id', v_curriculum_id);
    RETURN;
  END IF;

  IF v_section_count = 0 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_HANDBOOK_SECTIONS'::text,
      jsonb_build_object('curriculum_id', v_curriculum_id, 'chapter_count', v_chapter_count);
    RETURN;
  END IF;

  -- Every section needs at least basis or expanded content
  IF v_with_any_content < v_section_count THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'HANDBOOK_SECTION_CONTENT_INCOMPLETE'::text,
      jsonb_build_object(
        'chapter_count', v_chapter_count,
        'section_count', v_section_count,
        'with_any_content', v_with_any_content,
        'empty_sections', v_empty_sections
      );
    RETURN;
  END IF;

  -- 7) PASS -> mark only validate_handbook done
  UPDATE package_steps
  SET
    status = 'done',
    finished_at = v_now,
    last_error = NULL,
    started_at = coalesce(started_at, v_now),
    meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
      'prebuild', true,
      'prebuild_fn', 'fn_prebuild_validate_handbook',
      'postcondition_verified', true,
      'checked_at', v_now::text,
      'chapter_count', v_chapter_count,
      'section_count', v_section_count,
      'with_basis', v_with_basis,
      'with_expanded', v_with_expanded,
      'with_any_content', v_with_any_content,
      'empty_sections', v_empty_sections,
      'prereq_generate_satisfied', coalesce(v_generate_status IN ('done', 'skipped'), true),
      'prereq_expand_visible', v_expand_status,
      'reason', 'PREBUILD_HANDBOOK_STRUCTURE_VALID'
    )
  WHERE package_id = p_package_id
    AND step_key = 'validate_handbook'
    AND status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object(
      'prebuild', true,
      'prebuild_fn', 'fn_prebuild_validate_handbook',
      'postcondition_verified', true,
      'chapter_count', v_chapter_count,
      'section_count', v_section_count,
      'with_basis', v_with_basis,
      'with_expanded', v_with_expanded,
      'with_any_content', v_with_any_content,
      'empty_sections', v_empty_sections
    );
END;
$$;

-- ============================================================
-- fn_prebuild_validate_handbook_depth
-- Pure depth gate — aligned with real validator thresholds
-- ENHANCED: expand_coverage >= 50% AND avg_depth_score >= 40
-- No content generation, no expansion, no scoring
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_handbook_depth(
  p_package_id uuid
)
RETURNS TABLE (
  status text,
  advanced boolean,
  reason text,
  meta jsonb
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_curriculum_id uuid;
  v_step_status text;
  v_expand_step_status text;
  v_validate_hb_status text;
  v_pkg_status text;

  v_active_jobs int := 0;

  v_section_count int := 0;
  v_expanded_count int := 0;
  v_expand_coverage numeric := 0;
  v_avg_depth_score numeric := 0;
  v_scored_count int := 0;

  -- Aligned with real validator (package-validate-handbook-depth)
  -- ENHANCED thresholds: minimum to pass
  v_min_expand_coverage numeric := 50;  -- ENHANCED_EXPAND_COVERAGE
  v_min_depth_score numeric := 40;       -- ENHANCED_DEPTH_SCORE

  v_poison_blocked boolean := false;
  v_threshold_fail boolean := false;

  v_now timestamptz := now();
BEGIN
  -- 0) Resolve package
  SELECT cp.curriculum_id, cp.status
  INTO v_curriculum_id, v_pkg_status
  FROM course_packages cp
  WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_CURRICULUM_ID'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 1) Already done?
  SELECT ps.status
  INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key = 'validate_handbook_depth';

  IF v_step_status IS NULL THEN
    RETURN QUERY SELECT 'noop'::text, false, 'STEP_NOT_FOUND'::text, '{}'::jsonb;
    RETURN;
  END IF;

  IF v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 2) Prereq: expand_handbook must be done/skipped if present
  SELECT ps.status
  INTO v_expand_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key = 'expand_handbook';

  IF v_expand_step_status IS NOT NULL
     AND v_expand_step_status NOT IN ('done', 'skipped') THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'PREREQ_EXPAND_HANDBOOK_NOT_DONE'::text,
      jsonb_build_object('expand_handbook_status', v_expand_step_status);
    RETURN;
  END IF;

  -- 2b) Prereq: validate_handbook must be done
  SELECT ps.status
  INTO v_validate_hb_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id
    AND ps.step_key = 'validate_handbook';

  IF v_validate_hb_status IS NOT NULL
     AND v_validate_hb_status NOT IN ('done', 'skipped') THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'PREREQ_VALIDATE_HANDBOOK_NOT_DONE'::text,
      jsonb_build_object('validate_handbook_status', v_validate_hb_status);
    RETURN;
  END IF;

  -- 3) Active jobs guard
  SELECT count(*)
  INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type IN (
      'package_expand_handbook',
      'package_validate_handbook_depth'
    )
    AND jq.status IN (
      'pending', 'queued', 'claimed',
      'processing', 'running', 'batch_pending'
    );

  IF v_active_jobs > 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs', v_active_jobs);
    RETURN;
  END IF;

  -- 4) Poison / threshold guard on expand_handbook
  SELECT EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = p_package_id
      AND ps.step_key IN ('expand_handbook', 'validate_handbook_depth')
      AND (
        ps.last_error ILIKE '%poison%'
        OR coalesce(ps.meta->>'blocked_reason', '') ILIKE '%poison%'
      )
  ) INTO v_poison_blocked;

  SELECT EXISTS (
    SELECT 1 FROM package_steps ps
    WHERE ps.package_id = p_package_id
      AND ps.step_key IN ('expand_handbook', 'validate_handbook_depth')
      AND (
        ps.last_error ILIKE '%THRESHOLD_FAIL%'
        OR coalesce(ps.meta->>'blocked_reason', '') ILIKE '%THRESHOLD_FAIL%'
      )
  ) INTO v_threshold_fail;

  IF v_poison_blocked THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'POISON_LOOP_BLOCKED'::text,
      jsonb_build_object('package_status', v_pkg_status);
    RETURN;
  END IF;

  IF v_threshold_fail THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'THRESHOLD_FAIL_PRESENT'::text,
      jsonb_build_object('package_status', v_pkg_status);
    RETURN;
  END IF;

  -- 5) Depth metrics — aligned with real validator logic
  -- Real validator: expand_status = 'done' AND expanded_content IS NOT NULL
  -- Real validator: quality_score > 0 for scoring
  SELECT
    count(*) AS total,
    count(*) FILTER (
      WHERE hs.expand_status = 'done'
        AND hs.expanded_content IS NOT NULL
        AND length(hs.expanded_content) > 0
    ) AS expanded,
    count(*) FILTER (
      WHERE hs.quality_score IS NOT NULL
        AND hs.quality_score > 0
    ) AS scored,
    coalesce(
      avg(hs.quality_score) FILTER (
        WHERE hs.quality_score IS NOT NULL
          AND hs.quality_score > 0
      ), 0
    ) AS avg_score
  INTO v_section_count, v_expanded_count, v_scored_count, v_avg_depth_score
  FROM handbook_sections hs
  JOIN handbook_chapters hc ON hc.id = hs.chapter_id
  WHERE hc.curriculum_id = v_curriculum_id;

  IF v_section_count = 0 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_HANDBOOK_SECTIONS'::text, '{}'::jsonb;
    RETURN;
  END IF;

  v_expand_coverage := round((v_expanded_count::numeric / v_section_count) * 100, 1);
  v_avg_depth_score := round(v_avg_depth_score, 1);

  -- Gate check: must meet ENHANCED minimum
  IF v_expand_coverage < v_min_expand_coverage THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'EXPAND_COVERAGE_INSUFFICIENT'::text,
      jsonb_build_object(
        'section_count', v_section_count,
        'expanded_count', v_expanded_count,
        'expand_coverage_pct', v_expand_coverage,
        'min_coverage_pct', v_min_expand_coverage
      );
    RETURN;
  END IF;

  IF v_avg_depth_score < v_min_depth_score THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'DEPTH_SCORE_INSUFFICIENT'::text,
      jsonb_build_object(
        'avg_depth_score', v_avg_depth_score,
        'min_depth_score', v_min_depth_score,
        'scored_sections', v_scored_count
      );
    RETURN;
  END IF;

  -- 6) Determine quality tier (matches real validator logic)
  DECLARE
    v_quality_tier text := 'standard';
  BEGIN
    IF v_expand_coverage >= 90 AND v_avg_depth_score >= 75 THEN
      v_quality_tier := 'elite';
    ELSIF v_expand_coverage >= 50 AND v_avg_depth_score >= 40 THEN
      v_quality_tier := 'enhanced';
    END IF;

    -- 7) PASS -> mark only validate_handbook_depth done
    UPDATE package_steps
    SET
      status = 'done',
      finished_at = v_now,
      last_error = NULL,
      started_at = coalesce(started_at, v_now),
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true,
        'prebuild_fn', 'fn_prebuild_validate_handbook_depth',
        'postcondition_verified', true,
        'checked_at', v_now::text,
        'quality_tier', v_quality_tier,
        'section_count', v_section_count,
        'expanded_count', v_expanded_count,
        'expand_coverage_pct', v_expand_coverage,
        'avg_depth_score', v_avg_depth_score,
        'scored_sections', v_scored_count,
        'reason', 'PREBUILD_HANDBOOK_DEPTH_VALID'
      )
    WHERE package_id = p_package_id
      AND step_key = 'validate_handbook_depth'
      AND status != 'done';

    RETURN QUERY SELECT 'done'::text, true, 'POSTCONDITION_VERIFIED'::text,
      jsonb_build_object(
        'prebuild', true,
        'prebuild_fn', 'fn_prebuild_validate_handbook_depth',
        'postcondition_verified', true,
        'quality_tier', v_quality_tier,
        'section_count', v_section_count,
        'expanded_count', v_expanded_count,
        'expand_coverage_pct', v_expand_coverage,
        'avg_depth_score', v_avg_depth_score,
        'scored_sections', v_scored_count
      );
  END;
END;
$$;
