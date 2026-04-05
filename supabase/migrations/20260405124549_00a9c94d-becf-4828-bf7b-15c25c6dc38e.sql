
-- =============================================================
-- Generic Artifact-Fingerprint Bypass System (Pattern A)
-- Reusable for any validator step; handbook_depth is first consumer.
-- =============================================================

-- 1. Compute handbook-depth fingerprint from SSOT data
CREATE OR REPLACE FUNCTION public.fn_compute_handbook_depth_fingerprint(
  p_curriculum_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chapter_data jsonb;
  v_chapter_count int;
  v_total_sections int;
  v_expanded_sections int;
  v_raw text;
  v_fingerprint text;
BEGIN
  -- Build per-chapter digest: id, section_count, expanded_count, content_hash
  SELECT
    jsonb_agg(sub ORDER BY sub.chapter_id),
    coalesce(sum((sub.section_count)::int), 0),
    coalesce(sum((sub.expanded_count)::int), 0)
  INTO v_chapter_data, v_total_sections, v_expanded_sections
  FROM (
    SELECT
      hc.id AS chapter_id,
      count(hs.id) AS section_count,
      count(hs.id) FILTER (WHERE hs.expand_status = 'done' AND hs.expanded_content IS NOT NULL) AS expanded_count,
      md5(string_agg(
        coalesce(left(hs.basis_content, 200), '') || '|' || coalesce(left(hs.expanded_content, 200), ''),
        '||' ORDER BY hs.sort_order, hs.id
      )) AS content_hash
    FROM handbook_chapters hc
    LEFT JOIN handbook_sections hs ON hs.chapter_id = hc.id
    WHERE hc.curriculum_id = p_curriculum_id
    GROUP BY hc.id
  ) sub;

  v_chapter_count := coalesce(jsonb_array_length(v_chapter_data), 0);

  -- Build deterministic raw string for hashing
  v_raw := p_curriculum_id::text || '|' ||
           v_chapter_count::text || '|' ||
           v_total_sections::text || '|' ||
           v_expanded_sections::text || '|' ||
           coalesce(v_chapter_data::text, '[]');

  v_fingerprint := md5(v_raw);

  RETURN jsonb_build_object(
    'fingerprint', v_fingerprint,
    'chapter_count', v_chapter_count,
    'total_sections', v_total_sections,
    'expanded_sections', v_expanded_sections,
    'computed_at', now()
  );
END;
$$;

-- 2. Generic bypass eligibility check
CREATE OR REPLACE FUNCTION public.fn_is_step_bypass_eligible(
  p_package_id uuid,
  p_step_key text,
  p_current_fingerprint text,
  p_validator_version text DEFAULT 'v1'
)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_step record;
  v_prev_fp text;
  v_prev_version text;
  v_prev_passed boolean;
  v_active_jobs int;
  v_reason text;
  v_source_package_id uuid;
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
  v_prev_passed := coalesce((v_step.meta->>'validation_passed')::boolean, false);

  -- Guard: previous must have passed
  IF NOT v_prev_passed THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'no_previous_pass');
  END IF;

  -- Guard: validator version must match
  IF v_prev_version <> p_validator_version THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'validator_version_changed',
      'prev_version', v_prev_version, 'current_version', p_validator_version);
  END IF;

  -- Guard: fingerprint must match
  IF v_prev_fp IS NULL OR v_prev_fp <> p_current_fingerprint THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'fingerprint_mismatch',
      'prev_fingerprint', coalesce(v_prev_fp, 'null'), 'current_fingerprint', p_current_fingerprint);
  END IF;

  -- Guard: no active related jobs (handbook expand, handbook generate)
  SELECT count(*) INTO v_active_jobs
  FROM job_queue
  WHERE package_id = p_package_id
    AND job_type IN ('handbook_expand_section', 'package_generate_handbook', 'package_enqueue_handbook_expand')
    AND status IN ('pending', 'running', 'queued');

  IF v_active_jobs > 0 THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'active_handbook_jobs',
      'active_count', v_active_jobs);
  END IF;

  -- Guard: no regen/rebuild/dirty flags in meta
  IF coalesce((v_step.meta->>'regen_required')::boolean, false)
     OR coalesce((v_step.meta->>'content_dirty')::boolean, false)
     OR coalesce((v_step.meta->>'rebuild_forced')::boolean, false) THEN
    RETURN jsonb_build_object('eligible', false, 'reason', 'invalidation_flag_set');
  END IF;

  -- All guards passed
  RETURN jsonb_build_object(
    'eligible', true,
    'reason', 'fingerprint_match',
    'artifact_fingerprint', p_current_fingerprint,
    'source_package_id', p_package_id,
    'validator_version', p_validator_version
  );
END;
$$;
