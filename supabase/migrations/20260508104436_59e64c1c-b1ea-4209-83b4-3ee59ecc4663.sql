
CREATE OR REPLACE VIEW public.v_release_snapshot_drift AS
WITH latest AS (
  SELECT DISTINCT ON (package_id) *
    FROM public.package_release_audit_snapshots
   ORDER BY package_id, snapshot_date DESC
)
SELECT
  vc.package_id,
  vc.course_title,
  vc.track::text AS track,
  vc.package_status,
  s.snapshot_date,
  s.deficiency_codes  AS snapshot_codes,
  vc.deficiency_codes AS live_codes,
  -- stale = code in snapshot, not in live (i.e. snapshot says deficient, reality says ok)
  ARRAY(SELECT unnest(s.deficiency_codes) EXCEPT SELECT unnest(vc.deficiency_codes)) AS stale_codes,
  -- new   = code in live, not in snapshot (i.e. regression since snapshot)
  ARRAY(SELECT unnest(vc.deficiency_codes) EXCEPT SELECT unnest(s.deficiency_codes)) AS new_codes,
  s.handbook_chapters AS snap_handbook,  vc.handbook_chapters AS live_handbook,
  s.tutor_indices     AS snap_tutor,     vc.tutor_indices     AS live_tutor,
  s.oral_blueprints   AS snap_oral,      vc.oral_blueprints   AS live_oral,
  -- priority: high if stale on hard signals, regression critical
  CASE
    WHEN ARRAY(SELECT unnest(vc.deficiency_codes) EXCEPT SELECT unnest(s.deficiency_codes))
         && ARRAY['NO_HANDBOOK','NO_TUTOR','NO_ORAL','LF_COVERAGE_GAP'] THEN 'critical'
    WHEN ARRAY(SELECT unnest(s.deficiency_codes) EXCEPT SELECT unnest(vc.deficiency_codes))
         && ARRAY['NO_HANDBOOK','NO_TUTOR','NO_ORAL','LF_COVERAGE_GAP'] THEN 'high'
    WHEN s.deficiency_codes IS DISTINCT FROM vc.deficiency_codes THEN 'low'
    ELSE 'none'
  END AS drift_priority,
  (s.deficiency_codes IS DISTINCT FROM vc.deficiency_codes) AS has_drift
FROM public.v_package_release_classification vc
LEFT JOIN latest s ON s.package_id = vc.package_id;

REVOKE ALL ON public.v_release_snapshot_drift FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_release_snapshot_drift TO service_role;

-- RPC: filtered drift (admin only)
CREATE OR REPLACE FUNCTION public.admin_get_release_snapshot_drift(
  p_only_drift boolean DEFAULT true,
  p_limit int DEFAULT 200
)
RETURNS TABLE(
  package_id uuid,
  course_title text,
  track text,
  package_status text,
  snapshot_date date,
  snapshot_codes text[],
  live_codes text[],
  stale_codes text[],
  new_codes text[],
  snap_handbook int, live_handbook int,
  snap_tutor int,    live_tutor int,
  snap_oral int,     live_oral int,
  drift_priority text,
  has_drift boolean
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT package_id, course_title, track, package_status, snapshot_date,
         snapshot_codes, live_codes, stale_codes, new_codes,
         snap_handbook, live_handbook, snap_tutor, live_tutor, snap_oral, live_oral,
         drift_priority, has_drift
    FROM public.v_release_snapshot_drift
   WHERE (NOT p_only_drift) OR has_drift
     AND (public.has_role(auth.uid(),'admin') OR auth.role() = 'service_role')
   ORDER BY CASE drift_priority WHEN 'critical' THEN 0 WHEN 'high' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
            course_title
   LIMIT p_limit;
$$;

REVOKE ALL ON FUNCTION public.admin_get_release_snapshot_drift(boolean,int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_release_snapshot_drift(boolean,int) TO authenticated, service_role;

-- Summary RPC
CREATE OR REPLACE FUNCTION public.admin_get_release_snapshot_drift_summary()
RETURNS jsonb
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN NOT (public.has_role(auth.uid(),'admin') OR auth.role()='service_role') THEN
      jsonb_build_object('error','forbidden')
    ELSE jsonb_build_object(
      'total', (SELECT COUNT(*) FROM public.v_release_snapshot_drift),
      'with_drift', (SELECT COUNT(*) FROM public.v_release_snapshot_drift WHERE has_drift),
      'by_priority', (
        SELECT jsonb_object_agg(drift_priority, c)
          FROM (SELECT drift_priority, COUNT(*) AS c
                  FROM public.v_release_snapshot_drift
                 WHERE has_drift
                 GROUP BY drift_priority) t
      ),
      'stale_no_handbook', (SELECT COUNT(*) FROM public.v_release_snapshot_drift WHERE 'NO_HANDBOOK'=ANY(stale_codes)),
      'stale_no_tutor',    (SELECT COUNT(*) FROM public.v_release_snapshot_drift WHERE 'NO_TUTOR'=ANY(stale_codes)),
      'stale_no_oral',     (SELECT COUNT(*) FROM public.v_release_snapshot_drift WHERE 'NO_ORAL'=ANY(stale_codes)),
      'latest_snapshot',   (SELECT MAX(snapshot_date) FROM public.package_release_audit_snapshots),
      'generated_at', now()
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.admin_get_release_snapshot_drift_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_get_release_snapshot_drift_summary() TO authenticated, service_role;
