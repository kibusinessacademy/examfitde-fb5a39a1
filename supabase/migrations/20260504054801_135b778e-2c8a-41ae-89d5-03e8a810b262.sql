
CREATE OR REPLACE VIEW public.v_ops_queue_claimability AS
WITH pending AS (
  SELECT
    jq.id,
    jq.job_type,
    jq.worker_pool,
    COALESCE(jq.lane, public.derive_job_lane(jq.job_type)) AS lane,
    jq.status,
    COALESCE(jq.package_id, NULLIF(jq.payload->>'package_id','')::uuid) AS resolved_package_id,
    replace(jq.job_type, 'package_', '') AS step_key,
    jq.run_after,
    jq.locked_at,
    jq.created_at,
    jq.last_error,
    jq.last_error_code,
    jq.meta
  FROM public.job_queue jq
  WHERE jq.status IN ('pending','processing','queued')
)
SELECT
  p.id, p.job_type, p.worker_pool, p.lane, p.status,
  p.resolved_package_id, p.step_key, p.run_after, p.locked_at, p.created_at,
  p.last_error, p.last_error_code,
  cp.status AS package_status,
  ps.status AS step_status,
  CASE
    WHEN p.status='processing' AND p.locked_at < now() - interval '10 minutes'
      THEN 'stale_processing'
    WHEN cp.id IS NOT NULL AND cp.status <> 'building'
      THEN 'package_not_building'
    WHEN ps.status IN ('done','skipped')
      THEN 'phantom_step_done'
    WHEN p.job_type LIKE 'package_%' AND p.resolved_package_id IS NOT NULL
         AND EXISTS (
           SELECT 1
           FROM public.step_dag_edges dag
           JOIN public.package_steps dep
             ON dep.package_id = p.resolved_package_id
            AND dep.step_key = dag.depends_on
           WHERE dag.step_key = p.step_key
             AND dep.status NOT IN ('done','skipped')
         )
      THEN 'dag_blocked'
    WHEN p.job_type='package_auto_publish'
         AND (COALESCE(p.last_error,'') ILIKE '%pricing%'
              OR p.meta::text ILIKE '%pricing%')
      THEN 'pricing_blocked'
    WHEN COALESCE(p.last_error,'') ILIKE '%column%'
      OR COALESCE(p.last_error,'') ILIKE '%schema%'
      THEN 'schema_drift_blocked'
    ELSE 'claimable_by_rpc_filters'
  END AS claimability_status
FROM pending p
LEFT JOIN public.course_packages cp ON cp.id = p.resolved_package_id
LEFT JOIN public.package_steps ps
       ON ps.package_id = p.resolved_package_id AND ps.step_key = p.step_key;

REVOKE ALL ON public.v_ops_queue_claimability FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_ops_queue_claimability TO service_role;

CREATE OR REPLACE FUNCTION public.admin_get_queue_claimability_summary()
RETURNS TABLE(
  lane text,
  claimability_status text,
  job_count integer,
  oldest_age_sec integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;
  RETURN QUERY
  SELECT
    v.lane,
    v.claimability_status,
    COUNT(*)::int AS job_count,
    COALESCE(MAX(EXTRACT(EPOCH FROM (now() - v.created_at)))::int, 0) AS oldest_age_sec
  FROM public.v_ops_queue_claimability v
  GROUP BY v.lane, v.claimability_status
  ORDER BY v.lane, v.claimability_status;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.admin_get_queue_claimability_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_queue_claimability_summary() TO authenticated, service_role;
