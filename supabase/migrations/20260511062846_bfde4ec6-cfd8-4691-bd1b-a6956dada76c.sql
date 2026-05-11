-- =========================================================================
-- WIP/Lease Health SSOT + Phantom-Cluster-Detection (Backend-only, Welle 5.3+)
-- =========================================================================

-- 1) SSOT-View: WIP/Lease Health Snapshot
CREATE OR REPLACE VIEW public.v_wip_lease_health_ssot AS
WITH
building_pkgs AS (
  SELECT id, track, build_progress, updated_at, last_progress_at
  FROM public.course_packages
  WHERE status = 'building'
),
active_leases AS (
  SELECT package_id, lease_until, acquired_at
  FROM public.package_leases
  WHERE lease_until > now()
),
expired_leases AS (
  SELECT package_id
  FROM public.package_leases
  WHERE lease_until <= now() AND lease_until > now() - interval '24 hours'
),
active_jobs_per_pkg AS (
  SELECT (payload->>'package_id')::uuid AS package_id, COUNT(*) AS job_count
  FROM public.job_queue
  WHERE status IN ('pending','processing','queued','running')
    AND payload ? 'package_id'
  GROUP BY 1
),
queued_tail AS (
  SELECT MAX(EXTRACT(EPOCH FROM (now() - created_at))/60)::int AS oldest_min
  FROM public.job_queue
  WHERE status IN ('pending','queued')
),
pulse_30m AS (
  SELECT COUNT(*) AS pulses
  FROM public.auto_heal_log
  WHERE action_type = 'auto_recovery_pulse_decide'
    AND created_at > now() - interval '30 minutes'
    AND result_status IN ('pulsed','ok')
),
demote_60m AS (
  SELECT COUNT(*) AS demotes
  FROM public.auto_heal_log
  WHERE action_type = 'phantom_building_demote'
    AND created_at > now() - interval '60 minutes'
)
SELECT
  (SELECT COUNT(*) FROM building_pkgs)::int AS building_count,
  (SELECT COUNT(*) FROM building_pkgs b
     WHERE NOT EXISTS (SELECT 1 FROM active_leases l WHERE l.package_id = b.id))::int AS building_without_lease,
  (SELECT COUNT(*) FROM building_pkgs b
     LEFT JOIN active_jobs_per_pkg j ON j.package_id = b.id
     WHERE COALESCE(j.job_count,0) = 0)::int AS building_without_jobs,
  (SELECT COUNT(*) FROM active_leases)::int AS active_leases,
  (SELECT COUNT(*) FROM expired_leases)::int AS recently_expired_leases,
  COALESCE((SELECT oldest_min FROM queued_tail), 0)::int AS queued_tail_oldest_min,
  COALESCE((SELECT pulses FROM pulse_30m), 0)::int AS recovery_pulse_30m,
  COALESCE((SELECT demotes FROM demote_60m), 0)::int AS phantom_demotes_60m,
  now() AS computed_at;

REVOKE ALL ON public.v_wip_lease_health_ssot FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_wip_lease_health_ssot TO service_role;

-- 2) Phantom-Cluster-Detection (re-growing clusters per track)
CREATE OR REPLACE VIEW public.v_phantom_cluster_detection AS
WITH no_lease_no_job AS (
  SELECT cp.id, cp.track, cp.build_progress, cp.updated_at
  FROM public.course_packages cp
  WHERE cp.status = 'building'
    AND NOT EXISTS (
      SELECT 1 FROM public.package_leases l
      WHERE l.package_id = cp.id AND l.lease_until > now()
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.job_queue j
      WHERE (j.payload->>'package_id')::uuid = cp.id
        AND j.status IN ('pending','processing','queued','running')
    )
)
SELECT
  COALESCE(track::text,'unknown') AS track,
  COUNT(*)::int AS phantom_count,
  MIN(updated_at) AS oldest_updated_at,
  MAX(updated_at) AS newest_updated_at,
  AVG(build_progress)::numeric(5,2) AS avg_progress,
  CASE
    WHEN COUNT(*) >= 5 THEN 'critical'
    WHEN COUNT(*) >= 3 THEN 'warning'
    ELSE 'info'
  END AS severity
FROM no_lease_no_job
GROUP BY COALESCE(track::text,'unknown')
HAVING COUNT(*) >= 1;

REVOKE ALL ON public.v_phantom_cluster_detection FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_phantom_cluster_detection TO service_role;

-- 3) Admin-gated RPC: WIP/Lease Health
CREATE OR REPLACE FUNCTION public.admin_get_wip_lease_health()
RETURNS TABLE (
  building_count int,
  building_without_lease int,
  building_without_jobs int,
  active_leases int,
  recently_expired_leases int,
  queued_tail_oldest_min int,
  recovery_pulse_30m int,
  phantom_demotes_60m int,
  computed_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    v.building_count, v.building_without_lease, v.building_without_jobs,
    v.active_leases, v.recently_expired_leases, v.queued_tail_oldest_min,
    v.recovery_pulse_30m, v.phantom_demotes_60m, v.computed_at
  FROM public.v_wip_lease_health_ssot v
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role);
$$;

REVOKE ALL ON FUNCTION public.admin_get_wip_lease_health() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_wip_lease_health() TO authenticated, service_role;

-- 4) Admin-gated RPC: Phantom Clusters
CREATE OR REPLACE FUNCTION public.admin_get_phantom_clusters()
RETURNS TABLE (
  track text,
  phantom_count int,
  oldest_updated_at timestamptz,
  newest_updated_at timestamptz,
  avg_progress numeric,
  severity text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT track, phantom_count, oldest_updated_at, newest_updated_at, avg_progress, severity
  FROM public.v_phantom_cluster_detection
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY phantom_count DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_phantom_clusters() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_phantom_clusters() TO authenticated, service_role;

-- 5) Audit-Insert
INSERT INTO public.auto_heal_log (action_type, target_type, result_status, metadata)
VALUES (
  'wip_lease_health_ssot_deployed',
  'system',
  'deployed',
  jsonb_build_object(
    'wave', '5.3+',
    'views', jsonb_build_array('v_wip_lease_health_ssot','v_phantom_cluster_detection'),
    'rpcs', jsonb_build_array('admin_get_wip_lease_health','admin_get_phantom_clusters'),
    'ui_pending', true,
    'deployed_at', now()
  )
);

-- Smoke (read-only):
--   SELECT * FROM public.v_wip_lease_health_ssot;
--   SELECT * FROM public.v_phantom_cluster_detection;
-- Rollback:
--   DROP FUNCTION public.admin_get_wip_lease_health();
--   DROP FUNCTION public.admin_get_phantom_clusters();
--   DROP VIEW public.v_phantom_cluster_detection;
--   DROP VIEW public.v_wip_lease_health_ssot;