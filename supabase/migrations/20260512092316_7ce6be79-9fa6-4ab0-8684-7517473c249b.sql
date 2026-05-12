CREATE OR REPLACE FUNCTION public.admin_get_publish_blocker_patterns()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_b1 jsonb; v_b2 jsonb; v_b3 jsonb; v_b4 jsonb; v_b5 jsonb;
BEGIN
  IF NOT public.has_role(auth.uid(),'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  -- 1. coverage_met_integrity_false
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.coverage DESC), '[]'::jsonb) INTO v_b1
  FROM (
    SELECT cp.id, cp.title, cp.track::text AS track, cp.status::text AS status,
           cov.competency_question_coverage_pct AS coverage,
           thr.min_competency_question_coverage_pct AS min_coverage,
           cp.integrity_passed,
           ps.status::text AS integrity_step
    FROM course_packages cp
    LEFT JOIN LATERAL public.fn_compute_package_coverage(cp.id) cov ON true
    LEFT JOIN LATERAL public.fn_track_min_coverage_thresholds(cp.track::text) thr ON true
    LEFT JOIN package_steps ps ON ps.package_id=cp.id AND ps.step_key='run_integrity_check'
    WHERE cp.status='building'
      AND cov.competency_question_coverage_pct >= thr.min_competency_question_coverage_pct
      AND COALESCE(cp.integrity_passed,false)=false
  ) t;

  -- 2. queued_tail_without_job
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_b2
  FROM (
    SELECT cp.id, cp.title, cp.track::text AS track,
           ps.step_key, ps.status::text AS step_status,
           public.fn_is_bronze_locked(cp.id) AS bronze_locked
    FROM course_packages cp
    JOIN package_steps ps ON ps.package_id=cp.id
    WHERE cp.status='building'
      AND ps.step_key IN ('run_integrity_check','quality_council','auto_publish')
      AND ps.status='queued'
      AND NOT EXISTS (
        SELECT 1 FROM job_queue jq
        WHERE jq.package_id=cp.id
          AND jq.job_type='package_'||ps.step_key
          AND jq.status IN ('pending','queued','processing'))
    ORDER BY ps.step_key, cp.updated_at
  ) t;

  -- 3. auto_publish_integrity_blocked
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.updated_at DESC), '[]'::jsonb) INTO v_b3
  FROM (
    SELECT cp.id, cp.title, cp.track::text AS track,
           cp.integrity_passed, jq.status::text AS job_status,
           jq.last_error, jq.updated_at
    FROM job_queue jq
    JOIN course_packages cp ON cp.id=jq.package_id
    WHERE jq.job_type='package_auto_publish'
      AND jq.updated_at > now() - interval '24 hours'
      AND jq.last_error ILIKE '%integrity_passed=false%'
  ) t;

  -- 4. council_artifact_missing
  SELECT COALESCE(jsonb_agg(to_jsonb(t)), '[]'::jsonb) INTO v_b4
  FROM (
    SELECT cp.id, cp.title, cp.track::text AS track,
           cp.council_approved,
           ps.status::text AS step_status,
           ps.meta->>'status' AS verdict,
           (ps.meta->>'score')::numeric AS score
    FROM course_packages cp
    JOIN package_steps ps ON ps.package_id=cp.id AND ps.step_key='quality_council'
    WHERE ps.status='done'
      AND COALESCE(cp.council_approved,false)=false
      AND (ps.meta->>'score') ~ '^[0-9.]+$'
      AND (ps.meta->>'score')::numeric >= 75
  ) t;

  -- 5. coverage_gap_below_threshold
  SELECT COALESCE(jsonb_agg(to_jsonb(t) ORDER BY t.gap_pp DESC), '[]'::jsonb) INTO v_b5
  FROM (
    SELECT cp.id, cp.title, cp.track::text AS track,
           cov.competency_question_coverage_pct AS coverage,
           thr.min_competency_question_coverage_pct AS min_coverage,
           (thr.min_competency_question_coverage_pct - cov.competency_question_coverage_pct) AS gap_pp
    FROM course_packages cp
    LEFT JOIN LATERAL public.fn_compute_package_coverage(cp.id) cov ON true
    LEFT JOIN LATERAL public.fn_track_min_coverage_thresholds(cp.track::text) thr ON true
    WHERE cp.status='building'
      AND cov.competency_question_coverage_pct < thr.min_competency_question_coverage_pct
  ) t;

  RETURN jsonb_build_object(
    'generated_at', now(),
    'buckets', jsonb_build_object(
      'coverage_met_integrity_false', v_b1,
      'queued_tail_without_job',       v_b2,
      'auto_publish_integrity_blocked',v_b3,
      'council_artifact_missing',      v_b4,
      'coverage_gap_below_threshold',  v_b5
    ),
    'counts', jsonb_build_object(
      'coverage_met_integrity_false',  jsonb_array_length(v_b1),
      'queued_tail_without_job',       jsonb_array_length(v_b2),
      'auto_publish_integrity_blocked',jsonb_array_length(v_b3),
      'council_artifact_missing',      jsonb_array_length(v_b4),
      'coverage_gap_below_threshold',  jsonb_array_length(v_b5)
    )
  );
END $$;

REVOKE ALL ON FUNCTION public.admin_get_publish_blocker_patterns() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_publish_blocker_patterns() TO authenticated, service_role;