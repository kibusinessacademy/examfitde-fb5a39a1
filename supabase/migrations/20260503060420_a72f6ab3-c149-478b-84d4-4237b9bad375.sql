CREATE OR REPLACE FUNCTION public.admin_get_building_progress_48h()
RETURNS TABLE(
  package_id uuid,
  title text,
  build_progress numeric,
  current_step text,
  steps_done_48h bigint,
  jobs_done_48h bigint,
  last_progress_at timestamptz,
  pkg_updated_at timestamptz,
  has_progress boolean
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH building AS (
    SELECT id, title, build_progress, current_step, updated_at
    FROM public.course_packages WHERE status = 'building'
  ),
  sp AS (
    SELECT package_id,
      count(*) FILTER (WHERE status='done' AND COALESCE(finished_at, updated_at) > now() - interval '48 hours') AS done_48h,
      max(COALESCE(finished_at, updated_at)) FILTER (WHERE status='done') AS last_done_at
    FROM public.package_steps WHERE package_id IN (SELECT id FROM building) GROUP BY package_id
  ),
  jp AS (
    SELECT package_id,
      count(*) FILTER (WHERE status='done' AND completed_at > now() - interval '48 hours') AS jobs_done_48h,
      max(completed_at) FILTER (WHERE status='done') AS last_job_done
    FROM public.job_queue WHERE package_id IN (SELECT id FROM building) GROUP BY package_id
  )
  SELECT
    b.id, b.title, b.build_progress, b.current_step,
    COALESCE(sp.done_48h, 0)::bigint AS steps_done_48h,
    COALESCE(jp.jobs_done_48h, 0)::bigint AS jobs_done_48h,
    GREATEST(COALESCE(sp.last_done_at,'1970-01-01'::timestamptz),
             COALESCE(jp.last_job_done,'1970-01-01'::timestamptz)) AS last_progress_at,
    b.updated_at,
    (COALESCE(sp.done_48h,0) > 0 OR COALESCE(jp.jobs_done_48h,0) > 0) AS has_progress
  FROM building b
  LEFT JOIN sp ON sp.package_id = b.id
  LEFT JOIN jp ON jp.package_id = b.id
  WHERE public.has_role(auth.uid(), 'admin'::public.app_role)
  ORDER BY has_progress ASC, last_progress_at DESC;
$$;

REVOKE ALL ON FUNCTION public.admin_get_building_progress_48h() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_get_building_progress_48h() TO authenticated;