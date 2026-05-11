DROP VIEW IF EXISTS public.v_wip_lease_health_ssot CASCADE;
DROP VIEW IF EXISTS public.v_phantom_cluster_detection CASCADE;

CREATE VIEW public.v_wip_lease_health_ssot AS
WITH
building_pkgs AS (
  SELECT id, build_progress FROM public.course_packages WHERE status = 'building'
),
processing_pkgs AS (
  SELECT DISTINCT (payload->>'package_id')::uuid AS package_id
  FROM public.job_queue WHERE status = 'processing' AND payload ? 'package_id'
),
active_jobs_per_pkg AS (
  SELECT (payload->>'package_id')::uuid AS package_id, COUNT(*) AS job_count
  FROM public.job_queue
  WHERE status IN ('pending','processing','queued','running') AND payload ? 'package_id'
  GROUP BY 1
),
queued_tail AS (
  SELECT MAX(EXTRACT(EPOCH FROM (now() - GREATEST(created_at, COALESCE(run_after, created_at))))/60)::int AS oldest_min
  FROM public.job_queue
  WHERE status IN ('pending','queued') AND COALESCE(run_after, created_at) <= now()
),
pulse_30m AS (
  SELECT COUNT(*) AS pulses FROM public.auto_heal_log
  WHERE action_type = 'auto_recovery_pulse_decide'
    AND created_at > now() - interval '30 minutes'
    AND result_status = 'success' AND metadata->>'decision' = 'pulsed'
),
demote_60m AS (
  SELECT COUNT(*) AS demotes FROM public.auto_heal_log
  WHERE action_type = 'phantom_building_demote' AND created_at > now() - interval '60 minutes'
)
SELECT
  (SELECT COUNT(*) FROM building_pkgs)::int AS building_count,
  (SELECT COUNT(*) FROM building_pkgs b WHERE NOT EXISTS (SELECT 1 FROM processing_pkgs p WHERE p.package_id = b.id))::int AS building_without_processing,
  (SELECT COUNT(*) FROM building_pkgs b LEFT JOIN active_jobs_per_pkg j ON j.package_id = b.id WHERE COALESCE(j.job_count,0) = 0)::int AS building_without_jobs,
  (SELECT COUNT(*) FROM processing_pkgs)::int AS processing_jobs_distinct_pkgs,
  (SELECT COUNT(*) FROM public.job_queue WHERE status='processing')::int AS processing_jobs_total,
  COALESCE((SELECT oldest_min FROM queued_tail), 0)::int AS queued_tail_oldest_min,
  COALESCE((SELECT pulses FROM pulse_30m), 0)::int AS recovery_pulse_30m,
  COALESCE((SELECT demotes FROM demote_60m), 0)::int AS phantom_demotes_60m,
  now() AS computed_at;

REVOKE ALL ON public.v_wip_lease_health_ssot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_wip_lease_health_ssot TO service_role;

CREATE VIEW public.v_phantom_cluster_detection AS
WITH no_processing_no_job AS (
  SELECT cp.id, cp.track, cp.build_progress, cp.updated_at
  FROM public.course_packages cp
  WHERE cp.status = 'building'
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue j
      WHERE (j.payload->>'package_id')::uuid = cp.id
        AND j.status IN ('pending','processing','queued','running')
        AND COALESCE(j.run_after, j.created_at) <= now() + interval '15 minutes'
    )
)
SELECT
  COALESCE(track::text,'unknown') AS track,
  COUNT(*)::int AS phantom_count,
  MIN(updated_at) AS oldest_updated_at,
  MAX(updated_at) AS newest_updated_at,
  AVG(build_progress)::numeric(5,2) AS avg_progress,
  CASE WHEN COUNT(*) >= 5 THEN 'critical' WHEN COUNT(*) >= 3 THEN 'warning' ELSE 'info' END AS severity
FROM no_processing_no_job
GROUP BY COALESCE(track::text,'unknown')
HAVING COUNT(*) >= 1;

REVOKE ALL ON public.v_phantom_cluster_detection FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_phantom_cluster_detection TO service_role;

DROP FUNCTION IF EXISTS public.admin_get_wip_lease_health();
CREATE FUNCTION public.admin_get_wip_lease_health()
RETURNS TABLE (
  building_count int, building_without_processing int, building_without_jobs int,
  processing_jobs_distinct_pkgs int, processing_jobs_total int,
  queued_tail_oldest_min int, recovery_pulse_30m int, phantom_demotes_60m int,
  computed_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT v.building_count, v.building_without_processing, v.building_without_jobs,
         v.processing_jobs_distinct_pkgs, v.processing_jobs_total,
         v.queued_tail_oldest_min, v.recovery_pulse_30m, v.phantom_demotes_60m, v.computed_at
  FROM public.v_wip_lease_health_ssot v
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$$;
REVOKE ALL ON FUNCTION public.admin_get_wip_lease_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_wip_lease_health() TO authenticated, service_role;

DROP FUNCTION IF EXISTS public.admin_get_phantom_clusters();
CREATE FUNCTION public.admin_get_phantom_clusters()
RETURNS TABLE (
  track text, phantom_count int, oldest_updated_at timestamptz,
  newest_updated_at timestamptz, avg_progress numeric, severity text
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT track, phantom_count, oldest_updated_at, newest_updated_at, avg_progress, severity
  FROM public.v_phantom_cluster_detection
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY phantom_count DESC;
$$;
REVOKE ALL ON FUNCTION public.admin_get_phantom_clusters() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_phantom_clusters() TO authenticated, service_role;

INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'wip_lease_health_ssot_recalibrated_v2', 'system', 'recalibrated',
  jsonb_build_object(
    'fixes', jsonb_build_array(
      'lease_source: package_leases (legacy, 0 rows) -> job_queue.processing',
      'pulse_filter: result_status IN(pulsed,ok) -> result_status=success AND metadata.decision=pulsed',
      'tail_time_basis: created_at -> GREATEST(created_at, run_after) + filter run_after<=now()',
      'phantom_cluster: same lease/job heuristic, +15min run_after grace'
    ),
    'driftless_baseline_at', now()
  )
);