-- Lane drilldown SSOT: per-package classification within a lane.
CREATE OR REPLACE FUNCTION public.admin_get_lane_drilldown(p_lane text DEFAULT NULL)
RETURNS TABLE(
  lane text,
  package_id uuid,
  package_title text,
  pkg_status text,
  job_id uuid,
  job_type text,
  job_status text,
  job_age_minutes int,
  is_bronze boolean,
  has_open_steps boolean,
  open_step_count int,
  classification text,
  reason text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT (public.has_role(auth.uid(),'admin'::app_role) OR auth.role()='service_role') THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  RETURN QUERY
  WITH jobs AS (
    SELECT
      COALESCE(j.lane, public.derive_job_lane(j.job_type)) AS lane,
      j.id AS job_id, j.package_id, j.job_type, j.status AS job_status, j.created_at
    FROM job_queue j
    WHERE j.status IN ('pending','processing','queued')
      AND (p_lane IS NULL OR COALESCE(j.lane, public.derive_job_lane(j.job_type)) = p_lane)
  ),
  enriched AS (
    SELECT
      j.*,
      cp.title AS package_title,
      cp.status AS pkg_status,
      COALESCE((cp.feature_flags->'bronze'->>'locked')::boolean,false) AS is_bronze,
      (
        SELECT COUNT(*)::int FROM course_package_build_steps s
        WHERE s.package_id = j.package_id
          AND s.status IN ('queued','pending_enqueue','failed','blocked')
      ) AS open_step_count
    FROM jobs j
    LEFT JOIN course_packages cp ON cp.id = j.package_id
  )
  SELECT
    e.lane,
    e.package_id,
    e.package_title,
    e.pkg_status,
    e.job_id,
    e.job_type,
    e.job_status,
    EXTRACT(EPOCH FROM (now() - e.created_at))::int / 60 AS job_age_minutes,
    e.is_bronze,
    (e.open_step_count > 0) AS has_open_steps,
    e.open_step_count,
    CASE
      WHEN e.pkg_status='published'                                   THEN 'complete_published'
      WHEN e.pkg_status IN ('requires_review','manual_review')        THEN 'manual_review'
      WHEN e.is_bronze                                                THEN 'bronze_locked'
      WHEN e.open_step_count > 0                                      THEN 'dag_waiting'
      WHEN e.created_at < now() - interval '30 minutes'               THEN 'true_zombie'
      ELSE 'fresh_pending'
    END AS classification,
    CASE
      WHEN e.pkg_status='published'                                   THEN 'Paket ist published — Job sollte gecancelt werden'
      WHEN e.pkg_status IN ('requires_review','manual_review')        THEN 'Wartet auf Admin-Review'
      WHEN e.is_bronze                                                THEN 'Bronze-Lock aktiv (feature_flags.bronze.locked)'
      WHEN e.open_step_count > 0                                      THEN format('Wartet bewusst auf %s offene DAG-Steps', e.open_step_count)
      WHEN e.created_at < now() - interval '30 minutes'               THEN 'Stalled >30min ohne offene Vorgänger — echter Zombie'
      ELSE 'Frisch eingereiht'
    END AS reason
  FROM enriched e
  ORDER BY e.created_at ASC;
END $$;

REVOKE ALL ON FUNCTION public.admin_get_lane_drilldown(text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lane_drilldown(text) TO authenticated, service_role;