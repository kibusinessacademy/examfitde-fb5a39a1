-- Tail-Hänger Drilldown SSOT
CREATE OR REPLACE VIEW public.v_tail_hanger_drilldown_ssot AS
WITH tail_pkgs AS (
  SELECT cp.id AS package_id, cp.package_key, cp.track,
    COALESCE((cp.feature_flags->'bronze'->>'locked')::bool, false) AS bronze_locked,
    cp.gate_class, cp.build_progress
  FROM course_packages cp
  WHERE cp.status='building'
    AND NOT EXISTS (
      SELECT 1 FROM job_queue jq
      WHERE jq.package_id=cp.id AND jq.status IN ('pending','processing')
    )
),
first_blocker AS (
  SELECT DISTINCT ON (t.package_id)
    t.package_id, t.package_key, t.track, t.bronze_locked, t.gate_class, t.build_progress,
    ps.step_key::text AS first_blocking_step,
    ps.status::text AS first_blocking_status,
    ps.attempts AS step_attempts,
    ps.updated_at AS step_updated_at,
    COALESCE(ps.meta->>'last_error', ps.meta->>'error', ps.meta->>'fail_reason', ps.meta->>'reason') AS step_error,
    (ps.meta->>'council_score')::int AS council_score
  FROM tail_pkgs t
  LEFT JOIN package_steps ps
    ON ps.package_id=t.package_id
   AND ps.status::text NOT IN ('done','skipped')
  ORDER BY t.package_id,
    array_position(ARRAY[
      'validate_exam_pool','repair_exam_pool_quality','build_ai_tutor_index',
      'validate_tutor_index','elite_harden','run_integrity_check',
      'quality_council','auto_publish'
    ]::text[], ps.step_key::text) NULLS LAST
)
SELECT
  fb.*,
  (SELECT count(*) FROM exam_questions eq WHERE eq.package_id=fb.package_id AND eq.status='approved') AS approved_questions,
  CASE
    WHEN fb.first_blocking_step IS NULL THEN 'ghost_building_no_open_step'
    WHEN fb.first_blocking_status='queued' AND fb.bronze_locked AND fb.first_blocking_step IN ('run_integrity_check','quality_council','auto_publish')
      THEN 'bronze_locked_tail_needs_repair_or_unlock'
    WHEN fb.first_blocking_status='queued' THEN 'enqueue_drift_needs_nudge'
    WHEN fb.first_blocking_status='failed' AND fb.first_blocking_step='quality_council'
      AND fb.step_error ILIKE 'Quality gate failed: score=7%' THEN 'council_bronze_score_needs_bronze_path'
    WHEN fb.first_blocking_status='failed' AND fb.first_blocking_step='quality_council' THEN 'council_real_failure_needs_repair'
    WHEN fb.first_blocking_status='failed' AND fb.first_blocking_step='auto_publish' THEN 'auto_publish_failed_needs_requeue'
    WHEN fb.first_blocking_status='blocked' THEN 'dag_blocked_needs_predecessor_heal'
    ELSE 'unclassified'
  END AS recommended_action,
  CASE
    WHEN fb.first_blocking_step IS NULL THEN 'admin_force_publish_or_demote'
    WHEN fb.first_blocking_status='queued' AND fb.bronze_locked THEN 'admin_bronze_targeted_repair_dispatch'
    WHEN fb.first_blocking_status='queued' THEN 'admin_nudge_atomic_trigger'
    WHEN fb.first_blocking_status='failed' AND fb.first_blocking_step='quality_council'
      AND fb.step_error ILIKE 'Quality gate failed: score=7%' THEN 'admin_promote_to_bronze_or_repair'
    WHEN fb.first_blocking_status='failed' THEN 'admin_retry_failed_step'
    WHEN fb.first_blocking_status='blocked' THEN 'admin_heal_pending_enqueue_drift'
    ELSE 'manual_review'
  END AS suggested_rpc
FROM first_blocker fb;

-- Lock view: only admins via RPC
REVOKE ALL ON public.v_tail_hanger_drilldown_ssot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_tail_hanger_drilldown_ssot TO service_role;

-- Admin RPC: aggregated top blockers
CREATE OR REPLACE FUNCTION public.admin_get_tail_hanger_diagnostics()
RETURNS TABLE(
  recommended_action text,
  suggested_rpc text,
  first_blocking_step text,
  first_blocking_status text,
  bronze_locked boolean,
  pkg_count bigint,
  exam_first_count bigint,
  exam_first_plus_count bigint,
  other_track_count bigint,
  min_approved_q int,
  max_approved_q int,
  oldest_step_age_min int,
  sample_packages text[]
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    recommended_action,
    suggested_rpc,
    first_blocking_step,
    first_blocking_status,
    bronze_locked,
    count(*)::bigint AS pkg_count,
    count(*) FILTER (WHERE track='EXAM_FIRST')::bigint AS exam_first_count,
    count(*) FILTER (WHERE track='EXAM_FIRST_PLUS')::bigint AS exam_first_plus_count,
    count(*) FILTER (WHERE track NOT IN ('EXAM_FIRST','EXAM_FIRST_PLUS'))::bigint AS other_track_count,
    min(approved_questions)::int AS min_approved_q,
    max(approved_questions)::int AS max_approved_q,
    EXTRACT(EPOCH FROM (now() - min(step_updated_at)))::int / 60 AS oldest_step_age_min,
    (array_agg(package_key ORDER BY step_updated_at NULLS LAST))[1:5] AS sample_packages
  FROM public.v_tail_hanger_drilldown_ssot
  WHERE public.has_role(auth.uid(), 'admin'::app_role)
  GROUP BY 1,2,3,4,5
  ORDER BY pkg_count DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_tail_hanger_diagnostics() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_tail_hanger_diagnostics() TO authenticated, service_role;

-- Audit
INSERT INTO auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'welle_5_3_tail_hanger_drilldown_deployed',
  'system',
  'success',
  jsonb_build_object(
    'view', 'v_tail_hanger_drilldown_ssot',
    'rpc', 'admin_get_tail_hanger_diagnostics',
    'classifies', ARRAY['ghost_building_no_open_step','bronze_locked_tail_needs_repair_or_unlock','enqueue_drift_needs_nudge','council_bronze_score_needs_bronze_path','council_real_failure_needs_repair','auto_publish_failed_needs_requeue','dag_blocked_needs_predecessor_heal']
  )
);