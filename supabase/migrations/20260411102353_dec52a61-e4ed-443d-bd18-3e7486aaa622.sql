
CREATE OR REPLACE FUNCTION public.fn_prebuild_validate_handbook_depth(p_package_id uuid)
RETURNS TABLE (status text, advanced boolean, reason text, meta jsonb)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_curriculum_id     uuid;
  v_step_status       text;
  v_expand_status     text;
  v_active_jobs       int;
  v_section_count     int;
  v_expanded_count    int;
  v_scored_count      int;
  v_expand_coverage   numeric;
  v_avg_depth_score   numeric;
  v_scored_coverage   numeric;
  v_quality_tier      text;
  v_now               timestamptz := now();

  -- Thresholds aligned with Edge Function (ENHANCED tier minimum)
  C_MIN_EXPAND_COV    constant numeric := 50;
  C_MIN_DEPTH_SCORE   constant numeric := 40;
  C_MIN_SCORED_COV    constant numeric := 50;  -- at least 50% of sections must be scored
BEGIN
  -- 0) Already done?
  SELECT ps.status INTO v_step_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'validate_handbook_depth';

  IF v_step_status = 'done' THEN
    RETURN QUERY SELECT 'noop'::text, false, 'ALREADY_DONE'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 1) Resolve curriculum
  SELECT cp.curriculum_id INTO v_curriculum_id
  FROM course_packages cp WHERE cp.id = p_package_id;

  IF v_curriculum_id IS NULL THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'NO_CURRICULUM_ID'::text, '{}'::jsonb;
    RETURN;
  END IF;

  -- 2) Prereq: expand_handbook done/skipped
  SELECT ps.status INTO v_expand_status
  FROM package_steps ps
  WHERE ps.package_id = p_package_id AND ps.step_key = 'expand_handbook';

  IF v_expand_status IS NOT NULL AND v_expand_status NOT IN ('done', 'skipped') THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'PREREQ_EXPAND_NOT_DONE'::text,
      jsonb_build_object('expand_handbook_status', v_expand_status);
    RETURN;
  END IF;

  -- 3) Active jobs guard
  SELECT count(*) INTO v_active_jobs
  FROM job_queue jq
  WHERE jq.package_id = p_package_id
    AND jq.job_type IN ('package_expand_handbook', 'package_validate_handbook_depth')
    AND jq.status IN ('pending', 'queued', 'claimed', 'processing', 'running', 'batch_pending');

  IF v_active_jobs > 0 THEN
    RETURN QUERY SELECT 'deferred'::text, false, 'ACTIVE_JOBS_EXIST'::text,
      jsonb_build_object('active_jobs', v_active_jobs);
    RETURN;
  END IF;

  -- 4) Gather metrics
  SELECT
    count(*),
    count(*) FILTER (WHERE hs.expand_status = 'done' AND hs.expanded_content IS NOT NULL AND length(hs.expanded_content) > 0),
    count(*) FILTER (WHERE hs.quality_score IS NOT NULL AND hs.quality_score > 0),
    coalesce(avg(hs.quality_score) FILTER (WHERE hs.quality_score IS NOT NULL AND hs.quality_score > 0), 0)
  INTO v_section_count, v_expanded_count, v_scored_count, v_avg_depth_score
  FROM handbook_sections hs
  JOIN handbook_chapters hc ON hc.id = hs.chapter_id
  WHERE hc.curriculum_id = v_curriculum_id;

  IF v_section_count = 0 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_SECTIONS'::text, '{}'::jsonb;
    RETURN;
  END IF;

  v_expand_coverage := round((v_expanded_count::numeric / v_section_count) * 100, 1);
  v_scored_coverage := round((v_scored_count::numeric / v_section_count) * 100, 1);

  -- 5) NEW GUARD: No scored sections at all
  IF v_scored_count = 0 THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'NO_SCORED_SECTIONS'::text,
      jsonb_build_object(
        'section_count', v_section_count,
        'scored_sections', 0,
        'expanded_sections', v_expanded_count
      );
    RETURN;
  END IF;

  -- 6) NEW GUARD: Scored coverage too low (prevents biased small-sample pass)
  IF v_scored_coverage < C_MIN_SCORED_COV THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'SCORED_COVERAGE_INSUFFICIENT'::text,
      jsonb_build_object(
        'section_count', v_section_count,
        'scored_sections', v_scored_count,
        'scored_coverage_pct', v_scored_coverage,
        'min_scored_coverage_pct', C_MIN_SCORED_COV
      );
    RETURN;
  END IF;

  -- 7) Depth thresholds (aligned with Edge Function tiers)
  IF v_expand_coverage < C_MIN_EXPAND_COV OR v_avg_depth_score < C_MIN_DEPTH_SCORE THEN
    RETURN QUERY SELECT 'blocked'::text, false, 'DEPTH_THRESHOLD_NOT_MET'::text,
      jsonb_build_object(
        'expand_coverage_pct', v_expand_coverage, 'min_expand_coverage', C_MIN_EXPAND_COV,
        'avg_depth_score', round(v_avg_depth_score, 1), 'min_depth_score', C_MIN_DEPTH_SCORE,
        'scored_sections', v_scored_count, 'scored_coverage_pct', v_scored_coverage
      );
    RETURN;
  END IF;

  -- 8) Determine quality tier (mirrors Edge Function logic)
  IF v_expand_coverage >= 90 AND v_avg_depth_score >= 75 THEN
    v_quality_tier := 'elite';
  ELSIF v_expand_coverage >= 50 AND v_avg_depth_score >= 40 THEN
    v_quality_tier := 'enhanced';
  ELSE
    v_quality_tier := 'standard';
  END IF;

  -- 9) PASS → mark done
  UPDATE package_steps
  SET status = 'done', finished_at = v_now, last_error = NULL,
      started_at = coalesce(started_at, v_now),
      meta = coalesce(meta, '{}'::jsonb) || jsonb_build_object(
        'prebuild', true,
        'prebuild_fn', 'fn_prebuild_validate_handbook_depth',
        'postcondition_verified', true,
        'checked_at', v_now::text,
        'quality_tier', v_quality_tier,
        'section_count', v_section_count,
        'expanded_sections', v_expanded_count,
        'scored_sections', v_scored_count,
        'expand_coverage_pct', v_expand_coverage,
        'scored_coverage_pct', v_scored_coverage,
        'avg_depth_score', round(v_avg_depth_score, 1),
        'reason', 'PREBUILD_HANDBOOK_DEPTH_VALID'
      )
  WHERE package_id = p_package_id
    AND step_key = 'validate_handbook_depth'
    AND status != 'done';

  RETURN QUERY SELECT 'done'::text, true, 'POSTCONDITION_VERIFIED'::text,
    jsonb_build_object(
      'prebuild', true, 'quality_tier', v_quality_tier,
      'section_count', v_section_count, 'expanded_sections', v_expanded_count,
      'scored_sections', v_scored_count, 'expand_coverage_pct', v_expand_coverage,
      'scored_coverage_pct', v_scored_coverage, 'avg_depth_score', round(v_avg_depth_score, 1)
    );
END;
$$;
