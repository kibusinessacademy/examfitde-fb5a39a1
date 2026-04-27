-- ===========================================================================
-- COCKPIT-TRIAGE: Failed-Cluster, Blocker-Split, Hollow-Forensik, Track-Normalize
-- ===========================================================================

-- 1) Failed-Jobs nach error_class clustern (24h Fenster)
CREATE OR REPLACE FUNCTION public.admin_get_failed_clusters(
  p_window_hours int DEFAULT 24
) RETURNS TABLE (
  job_type text,
  last_error_code text,
  error_class text,
  jobs bigint,
  packages bigint,
  oldest_failed_at timestamptz,
  newest_failed_at timestamptz,
  sample_error text
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    j.job_type,
    coalesce(j.last_error_code, 'UNKNOWN') AS last_error_code,
    coalesce(j.meta->>'error_class', 'UNCLASSIFIED') AS error_class,
    count(*)::bigint AS jobs,
    count(distinct j.package_id)::bigint AS packages,
    min(j.updated_at) AS oldest_failed_at,
    max(j.updated_at) AS newest_failed_at,
    (array_agg(left(coalesce(j.last_error, j.error, ''), 200) ORDER BY j.updated_at DESC))[1] AS sample_error
  FROM public.job_queue j
  WHERE j.status = 'failed'
    AND j.updated_at > now() - make_interval(hours => p_window_hours)
    AND public.is_admin(auth.uid())
  GROUP BY 1,2,3
  ORDER BY jobs DESC
  LIMIT 100;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_failed_clusters(int) TO authenticated;

-- 2) Blocked Packages nach Ursache + Track splitten
CREATE OR REPLACE FUNCTION public.admin_get_blocked_packages_split()
RETURNS TABLE (
  primary_blocker text,
  package_track text,
  packages bigint,
  sample_package_ids uuid[],
  oldest_blocked_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    coalesce(r.primary_blocker, 'UNKNOWN') AS primary_blocker,
    coalesce(r.package_track, 'UNCLASSIFIED') AS package_track,
    count(*)::bigint AS packages,
    (array_agg(r.package_id ORDER BY r.updated_at ASC))[1:5] AS sample_package_ids,
    min(r.updated_at) AS oldest_blocked_at
  FROM public.v_admin_publish_readiness r
  WHERE r.package_status = 'blocked'
    AND public.is_admin(auth.uid())
  GROUP BY 1,2
  ORDER BY packages DESC;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_blocked_packages_split() TO authenticated;

-- 3) Hollow-Published Forensik
CREATE OR REPLACE FUNCTION public.admin_get_hollow_published_packages()
RETURNS TABLE (
  package_id uuid,
  course_title text,
  package_track text,
  package_status text,
  is_published boolean,
  primary_blocker text,
  hard_fail_reasons jsonb,
  integrity_passed boolean,
  updated_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    r.package_id,
    r.course_title,
    r.package_track,
    r.package_status,
    r.is_published,
    r.primary_blocker,
    r.hard_fail_reasons,
    r.integrity_passed,
    r.updated_at
  FROM public.v_admin_publish_readiness r
  WHERE public.is_admin(auth.uid())
    AND (
      r.primary_blocker ILIKE '%HOLLOW%'
      OR r.integrity_report::text ILIKE '%hollow_published_auto_quarantine%'
      OR r.hard_fail_reasons::text ILIKE '%hollow%'
    )
  ORDER BY r.is_published DESC NULLS LAST, r.updated_at DESC
  LIMIT 200;
$$;

GRANT EXECUTE ON FUNCTION public.admin_get_hollow_published_packages() TO authenticated;

-- 4) Track-Normalisierung für EXAM_FIRST (und EXAM_FIRST_PLUS optional)
--    Setzt nicht-applicable package_steps auf 'skipped' statt sie zu reparieren.
--    Track-Awareness via track_step_applicability SSOT.
CREATE OR REPLACE FUNCTION public.admin_normalize_track_steps(
  p_dry_run boolean DEFAULT true,
  p_tracks text[] DEFAULT ARRAY['EXAM_FIRST']::text[],
  p_max_packages int DEFAULT 50
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_candidates jsonb;
  v_skipped_count int := 0;
  v_packages_touched int := 0;
BEGIN
  IF NOT public.is_admin(v_uid) THEN
    RAISE EXCEPTION 'permission denied: admin only';
  END IF;

  -- Kandidaten: Steps, die laut track_step_applicability für den Track NICHT applicable sind,
  -- aber aktuell nicht 'skipped' sind.
  WITH cand AS (
    SELECT
      ps.id AS step_id,
      ps.package_id,
      ps.step_key,
      ps.status::text AS current_status,
      r.package_track
    FROM public.package_steps ps
    JOIN public.v_admin_publish_readiness r ON r.package_id = ps.package_id
    JOIN public.track_step_applicability tsa
      ON tsa.track = r.package_track
     AND tsa.step_key = ps.step_key
    WHERE r.package_track = ANY(p_tracks)
      AND tsa.applicable = false
      AND ps.status::text NOT IN ('skipped', 'done')
    ORDER BY ps.package_id, ps.step_key
    LIMIT (p_max_packages * 30)
  )
  SELECT jsonb_build_object(
    'total_candidates', count(*),
    'distinct_packages', count(distinct package_id),
    'by_step', jsonb_object_agg(step_key, cnt)
  ) INTO v_candidates
  FROM (
    SELECT step_key, count(*) AS cnt, package_id FROM cand GROUP BY step_key, package_id
  ) g, LATERAL (SELECT count(*) FROM cand) total;

  IF p_dry_run THEN
    INSERT INTO public.admin_actions (user_id, action, target_type, target_id, payload)
    VALUES (v_uid, 'admin_normalize_track_steps:dry_run', 'system', null,
            jsonb_build_object('tracks', p_tracks, 'candidates', v_candidates));
    RETURN jsonb_build_object('dry_run', true, 'candidates', v_candidates);
  END IF;

  -- Execute: nicht-applicable Steps auf skipped + Marker in meta
  WITH to_skip AS (
    SELECT
      ps.id AS step_id,
      ps.package_id,
      ps.step_key
    FROM public.package_steps ps
    JOIN public.v_admin_publish_readiness r ON r.package_id = ps.package_id
    JOIN public.track_step_applicability tsa
      ON tsa.track = r.package_track
     AND tsa.step_key = ps.step_key
    WHERE r.package_track = ANY(p_tracks)
      AND tsa.applicable = false
      AND ps.status::text NOT IN ('skipped', 'done')
    LIMIT (p_max_packages * 30)
  ),
  upd AS (
    UPDATE public.package_steps ps
    SET status = 'skipped',
        meta = coalesce(ps.meta, '{}'::jsonb) || jsonb_build_object(
          'track_normalized', true,
          'normalize_reason', 'TRACK_NOT_APPLICABLE',
          'normalized_at', now()
        ),
        updated_at = now()
    FROM to_skip s
    WHERE ps.id = s.step_id
    RETURNING ps.package_id
  )
  SELECT count(*), count(distinct package_id) INTO v_skipped_count, v_packages_touched FROM upd;

  INSERT INTO public.admin_actions (user_id, action, target_type, target_id, payload)
  VALUES (v_uid, 'admin_normalize_track_steps:execute', 'system', null,
          jsonb_build_object('tracks', p_tracks,
                             'skipped_steps', v_skipped_count,
                             'packages_touched', v_packages_touched));

  RETURN jsonb_build_object(
    'dry_run', false,
    'skipped_steps', v_skipped_count,
    'packages_touched', v_packages_touched,
    'tracks', p_tracks
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_normalize_track_steps(boolean, text[], int) TO authenticated;