-- Verbesserte Cancel-Reason-Breakdown: bevorzugt meta.reason_code
CREATE OR REPLACE FUNCTION public.admin_get_cancel_reason_breakdown(p_hours integer DEFAULT 24)
RETURNS TABLE (job_type text, reason_code text, cnt bigint, pct numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  WITH base AS (
    SELECT
      jq.job_type,
      COALESCE(
        NULLIF(jq.meta->>'reason_code', ''),
        NULLIF(SUBSTRING(COALESCE(jq.last_error, '') FROM '^([A-Z_][A-Z0-9_]+)'), ''),
        'UNCLASSIFIED'
      ) AS reason_code
    FROM public.job_queue jq
    WHERE jq.status = 'cancelled'
      AND COALESCE(jq.completed_at, jq.updated_at) >= now() - make_interval(hours => GREATEST(p_hours, 1))
      AND public.has_role(auth.uid(), 'admin'::app_role)
  ),
  agg AS (SELECT job_type, reason_code, COUNT(*)::bigint AS cnt FROM base GROUP BY job_type, reason_code),
  total AS (SELECT NULLIF(SUM(cnt), 0) AS t FROM agg)
  SELECT a.job_type, a.reason_code, a.cnt,
         ROUND((a.cnt::numeric / COALESCE((SELECT t FROM total), 1)) * 100, 1) AS pct
  FROM agg a ORDER BY a.cnt DESC LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_cancel_reason_breakdown(integer) TO authenticated;

-- Korrigierte Blocked-Pakete-Detail: package_steps statt course_package_build_steps
CREATE OR REPLACE FUNCTION public.admin_get_blocked_packages_detail()
RETURNS TABLE (package_id uuid, title text, blocked_at timestamptz,
               last_step text, last_error text, failed_jobs_24h int)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    cp.id, cp.title, cp.updated_at,
    (SELECT ps.step_key FROM public.package_steps ps
      WHERE ps.package_id = cp.id ORDER BY ps.updated_at DESC NULLS LAST LIMIT 1),
    (SELECT jq.last_error FROM public.job_queue jq
      WHERE jq.package_id = cp.id AND jq.last_error IS NOT NULL
      ORDER BY jq.updated_at DESC NULLS LAST LIMIT 1),
    (SELECT COUNT(*)::int FROM public.job_queue jq2
      WHERE jq2.package_id = cp.id AND jq2.status = 'failed'
        AND COALESCE(jq2.completed_at, jq2.updated_at) >= now() - interval '24 hours')
  FROM public.course_packages cp
  WHERE cp.status = 'blocked'
    AND public.has_role(auth.uid(), 'admin'::app_role)
  ORDER BY cp.updated_at DESC LIMIT 100;
$$;
GRANT EXECUTE ON FUNCTION public.admin_get_blocked_packages_detail() TO authenticated;

-- NEU: Control-Lane Stale-Job-Requeue mit Dry-Run
CREATE OR REPLACE FUNCTION public.admin_requeue_stale_control_jobs(
  p_min_age_minutes integer DEFAULT 60,
  p_limit integer DEFAULT 50,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE (
  job_id uuid, job_type text, package_id uuid,
  old_status text, new_status text, action text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  IF p_dry_run THEN
    RETURN QUERY
    SELECT j.id, j.job_type, j.package_id, j.status, j.status,
           'dry_run_stale_control_job'::text
    FROM public.job_queue j
    WHERE j.lane = 'control'
      AND j.status IN ('pending','queued')
      AND j.created_at < now() - make_interval(mins => GREATEST(p_min_age_minutes, 1))
    ORDER BY j.created_at ASC
    LIMIT GREATEST(p_limit, 1);
    RETURN;
  END IF;

  RETURN QUERY
  WITH picked AS (
    SELECT j.id FROM public.job_queue j
    WHERE j.lane = 'control'
      AND j.status IN ('pending','queued')
      AND j.created_at < now() - make_interval(mins => GREATEST(p_min_age_minutes, 1))
    ORDER BY j.created_at ASC
    LIMIT GREATEST(p_limit, 1)
    FOR UPDATE SKIP LOCKED
  ),
  upd AS (
    UPDATE public.job_queue j
    SET status = 'pending',
        started_at = NULL,
        locked_at = NULL,
        locked_by = NULL,
        updated_at = now(),
        meta = COALESCE(j.meta, '{}'::jsonb) || jsonb_build_object(
          'admin_requeued_at', now(),
          'admin_requeue_reason', 'stale_control_lane_nudge'
        )
    FROM picked p
    WHERE j.id = p.id
    RETURNING j.id, j.job_type, j.package_id
  )
  SELECT u.id, u.job_type, u.package_id,
         'stale'::text, 'pending'::text, 'requeued_stale_control_job'::text
  FROM upd u;
END;
$$;
GRANT EXECUTE ON FUNCTION public.admin_requeue_stale_control_jobs(integer, integer, boolean) TO authenticated;