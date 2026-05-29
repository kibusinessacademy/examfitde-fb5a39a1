-- P1 Failed-Jobs 72h SSOT (Pipeline-Audit 2026-05-29)
-- Single SSOT view + admin-gated RPC, klassifiziert jedes failed-Job-Fail-Pattern
-- in einen normalisierten cluster_key. Erweitert P0 Ops Diagnostics (2026-05-24).
-- Kein Bulk-Requeue, kein Bypass — reine Beobachtung.

CREATE OR REPLACE VIEW public.v_failed_jobs_72h_clusters AS
WITH base AS (
  SELECT
    id, job_type, package_id, attempts, updated_at,
    COALESCE(last_error, error::text, '') AS err
  FROM public.job_queue
  WHERE status = 'failed' AND updated_at > now() - interval '72 hours'
),
classified AS (
  SELECT *,
    CASE
      WHEN err ~* 'QUALITY_THRESHOLD_NOT_MET'                THEN 'quality_threshold_not_met'
      WHEN err ~* 'GATE_FAIL: NO_MINICHECKS|PARKED_AWAITING_PRECONDITION.*generate_lesson_minichecks' THEN 'minicheck_producer_missing'
      WHEN err ~* 'REQUEUE_LOOP_KILLED'                      THEN 'deterministic_requeue_loop'
      WHEN err ~* 'STALE_LOCK_LOOP_HARD_KILL'                THEN 'stale_lock_loop_hard_kill'
      WHEN err ~* 'PRE_HEARTBEAT_KILL_TERMINAL'              THEN 'pre_heartbeat_kill'
      WHEN err ~* 'STALE_AFTER_HEARTBEAT'                    THEN 'stale_after_heartbeat'
      WHEN err ~* 'GHOST_FINALIZATION_BLOCKED'               THEN 'ghost_finalization_blocked'
      WHEN err ~* 'GOOGLE_AI_API_KEY not configured|API key not configured|API_KEY.*not configured' THEN 'missing_secret'
      WHEN err ~* 'invalid model ID|invalid_request_error'   THEN 'invalid_model_id'
      WHEN err ~* 'total_ai_budget_exhausted'                THEN 'ai_budget_exhausted'
      WHEN err ~* 'fn_emit_audit\(unknown'                   THEN 'audit_fn_signature_drift'
      WHEN err ~* 'PREREQ_INSUFFICIENT_BLUEPRINTS|PREREQ_'   THEN 'prereq_data_gap'
      WHEN err ~* 'Artifact missing'                         THEN 'artifact_missing_upstream'
      WHEN err ~* 'MAX_ATTEMPTS_EXHAUSTED'                   THEN 'max_attempts_exhausted'
      WHEN err ~* 'markStepDone verify MISMATCH'             THEN 'step_done_mismatch'
      WHEN err ~* 'Auto-healed.*Auto-healed'                 THEN 'heal_annotation_recursion'
      WHEN err ~* '^\s*$|^\(null\)$'                         THEN 'empty_last_error'
      ELSE 'unclassified'
    END AS cluster_key
  FROM base
)
SELECT * FROM classified;

REVOKE ALL ON public.v_failed_jobs_72h_clusters FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_failed_jobs_72h_clusters TO service_role;

-- Admin-gated RPC: Summary pro Cluster (counts + sample errors + top job_types)
CREATE OR REPLACE FUNCTION public.admin_get_failed_jobs_72h_clusters()
RETURNS TABLE(
  cluster_key text,
  n_failures bigint,
  n_distinct_packages bigint,
  n_distinct_job_types int,
  top_job_types jsonb,
  sample_error text,
  last_seen timestamptz,
  is_known_pattern boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;

  RETURN QUERY
  WITH agg AS (
    SELECT
      v.cluster_key,
      COUNT(*)                              AS n_failures,
      COUNT(DISTINCT v.package_id)          AS n_distinct_packages,
      COUNT(DISTINCT v.job_type)::int       AS n_distinct_job_types,
      MAX(v.updated_at)                     AS last_seen,
      (SELECT LEFT(err, 200) FROM public.v_failed_jobs_72h_clusters x
        WHERE x.cluster_key = v.cluster_key ORDER BY updated_at DESC LIMIT 1) AS sample_error,
      (SELECT jsonb_agg(jsonb_build_object('job_type', jt, 'n', cnt) ORDER BY cnt DESC)
         FROM (
           SELECT job_type AS jt, COUNT(*) AS cnt
           FROM public.v_failed_jobs_72h_clusters x
           WHERE x.cluster_key = v.cluster_key
           GROUP BY job_type ORDER BY cnt DESC LIMIT 5
         ) tj
      ) AS top_job_types
    FROM public.v_failed_jobs_72h_clusters v
    GROUP BY v.cluster_key
  )
  SELECT
    a.cluster_key,
    a.n_failures,
    a.n_distinct_packages,
    a.n_distinct_job_types,
    a.top_job_types,
    a.sample_error,
    a.last_seen,
    (a.cluster_key IN (
      'quality_threshold_not_met', 'stale_lock_loop_hard_kill',
      'deterministic_requeue_loop', 'pre_heartbeat_kill',
      'stale_after_heartbeat', 'ghost_finalization_blocked',
      'missing_secret', 'invalid_model_id', 'ai_budget_exhausted',
      'audit_fn_signature_drift', 'prereq_data_gap',
      'artifact_missing_upstream', 'max_attempts_exhausted',
      'step_done_mismatch', 'minicheck_producer_missing',
      'heal_annotation_recursion', 'empty_last_error'
    )) AS is_known_pattern
  FROM agg a
  ORDER BY a.n_failures DESC;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_failed_jobs_72h_clusters() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_failed_jobs_72h_clusters() TO service_role;

-- Per-cluster drill-down (für Cockpit-Detail-View)
CREATE OR REPLACE FUNCTION public.admin_get_failed_jobs_72h_by_cluster(_cluster_key text, _limit int DEFAULT 50)
RETURNS TABLE(
  id uuid, job_type text, package_id uuid, attempts int, updated_at timestamptz, last_error text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: admin role required';
  END IF;
  RETURN QUERY
  SELECT v.id, v.job_type, v.package_id, v.attempts, v.updated_at, LEFT(v.err, 500) AS last_error
  FROM public.v_failed_jobs_72h_clusters v
  WHERE v.cluster_key = _cluster_key
  ORDER BY v.updated_at DESC
  LIMIT GREATEST(1, LEAST(_limit, 500));
END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_failed_jobs_72h_by_cluster(text,int) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_failed_jobs_72h_by_cluster(text,int) TO service_role;

-- Audit-Snapshot (Pipeline-Audit baseline, optional)
DO $$
BEGIN
  BEGIN
    PERFORM public.fn_emit_audit(
      _action_type    => 'pipeline_audit_72h_snapshot',
      _target_type    => 'system',
      _target_id      => NULL,
      _result_status  => 'ok',
      _payload        => (SELECT jsonb_build_object(
                            'snapshot_at', now(),
                            'clusters', jsonb_agg(jsonb_build_object('cluster', cluster_key, 'n', n))
                          )
                          FROM (SELECT cluster_key, COUNT(*) AS n
                                FROM public.v_failed_jobs_72h_clusters
                                GROUP BY cluster_key) s),
      _trigger_source => 'pipeline_audit_migration',
      _error_message  => NULL
    );
  EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'audit emit failed (non-blocking): %', SQLERRM;
  END;
END $$;