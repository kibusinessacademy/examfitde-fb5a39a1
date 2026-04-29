
-- =========================================================================
-- Heal-Cockpit Diagnostik-Korrektur v2
-- =========================================================================
-- Root cause: Diagnostik filterte auf status='done', aber job_queue
-- verwendet status='completed'. Folge: alle Lanes zeigten Phantom-Stillstand
-- (done_6h=0, last_done_at=NULL) trotz aktiver Worker.
--
-- Fix: Status-Filter umstellen auf 'completed', Spaltenname klar als
-- 'completed_6h' relabeln. Außerdem admin_requeue_stale_control_jobs um
-- Vorbedingungs-Check erweitern, damit nicht blind requeued wird wenn
-- der required_package_step noch nicht done ist.
-- =========================================================================

-- 1) View v_admin_lane_health: 'done' -> 'completed', Spalte umbenennen
DROP VIEW IF EXISTS public.v_admin_lane_health CASCADE;

CREATE VIEW public.v_admin_lane_health AS
WITH active AS (
  SELECT
    COALESCE(lane, 'unknown')::text AS lane,
    COUNT(*) FILTER (WHERE status = 'pending')::int    AS pending_cnt,
    COUNT(*) FILTER (WHERE status = 'processing')::int AS processing_cnt,
    COUNT(*) FILTER (WHERE status = 'queued')::int     AS queued_cnt,
    MAX(EXTRACT(EPOCH FROM (now() - created_at)))
      FILTER (WHERE status IN ('pending','queued'))::int AS oldest_pending_sec
  FROM public.job_queue
  WHERE status IN ('pending','processing','queued')
  GROUP BY COALESCE(lane, 'unknown')
),
completed_stats AS (
  SELECT
    COALESCE(lane, 'unknown')::text AS lane,
    MAX(completed_at) AS last_completed_at,
    COUNT(*) FILTER (WHERE completed_at >= now() - interval '6 hours')::int AS completed_6h
  FROM public.job_queue
  WHERE status = 'completed'
  GROUP BY COALESCE(lane, 'unknown')
)
SELECT
  a.lane,
  a.pending_cnt,
  a.processing_cnt,
  a.queued_cnt,
  c.last_completed_at,
  COALESCE(c.completed_6h, 0) AS completed_6h,
  a.oldest_pending_sec
FROM active a
LEFT JOIN completed_stats c USING (lane);

-- 2) admin_get_lane_health (RETURNS SETOF v_admin_lane_health)
CREATE OR REPLACE FUNCTION public.admin_get_lane_health()
RETURNS SETOF public.v_admin_lane_health
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT * FROM public.v_admin_lane_health
  WHERE public.has_role(auth.uid(), 'admin'::app_role);
$$;

-- 3) admin_get_blocked_packages_detail: failed_jobs_24h zählt completed_at korrekt
--    (war schon korrekt für 'failed' Status — keine Änderung nötig).
--    Nur Klarstellung im Header-Kommentar.

-- 4) admin_requeue_stale_control_jobs: Pre-Check ob required_package_step done ist.
--    Wenn nicht done → action='skipped_prereq_not_done', kein Requeue.
DROP FUNCTION IF EXISTS public.admin_requeue_stale_control_jobs(integer, integer, boolean);

CREATE OR REPLACE FUNCTION public.admin_requeue_stale_control_jobs(
  p_min_age_minutes integer DEFAULT 60,
  p_limit integer DEFAULT 50,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  job_id uuid,
  job_type text,
  package_id uuid,
  old_status text,
  new_status text,
  required_step text,
  required_step_status text,
  action text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin only';
  END IF;

  -- Build candidate set with prereq diagnostics
  RETURN QUERY
  WITH candidates AS (
    SELECT j.id, j.job_type, j.package_id, j.status,
           pso.required_package_step AS req_step
    FROM public.job_queue j
    LEFT JOIN public.pipeline_step_order pso ON pso.job_type = j.job_type
    WHERE j.lane = 'control'
      AND j.status IN ('pending','queued')
      AND j.created_at < now() - make_interval(mins => GREATEST(p_min_age_minutes, 1))
    ORDER BY j.created_at ASC
    LIMIT GREATEST(p_limit, 1)
  ),
  enriched AS (
    SELECT c.*,
           ps.status::text AS req_step_status
    FROM candidates c
    LEFT JOIN public.package_steps ps
      ON ps.package_id = c.package_id AND ps.step_key = c.req_step
  ),
  acted AS (
    SELECT
      e.*,
      CASE
        WHEN p_dry_run THEN 'dry_run'
        WHEN e.req_step IS NOT NULL AND e.req_step_status NOT IN ('done','skipped') THEN 'skipped_prereq_not_done'
        ELSE 'requeued'
      END AS act
    FROM enriched e
  ),
  applied AS (
    UPDATE public.job_queue jq
    SET status = 'pending',
        started_at = NULL,
        locked_at = NULL,
        locked_by = NULL,
        meta = COALESCE(jq.meta, '{}'::jsonb) || jsonb_build_object(
                  'admin_requeued_at', now(),
                  'admin_requeue_source', 'admin_requeue_stale_control_jobs'
               )
    FROM acted a
    WHERE jq.id = a.id AND a.act = 'requeued'
    RETURNING jq.id
  )
  SELECT a.id, a.job_type, a.package_id, a.status,
         CASE WHEN a.act = 'requeued' THEN 'pending' ELSE a.status END,
         a.req_step, a.req_step_status, a.act
  FROM acted a;
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_requeue_stale_control_jobs(integer,integer,boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_lane_health() TO authenticated;
GRANT SELECT ON public.v_admin_lane_health TO authenticated;
