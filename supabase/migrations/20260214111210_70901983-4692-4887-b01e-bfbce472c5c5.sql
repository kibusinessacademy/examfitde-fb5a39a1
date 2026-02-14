
-- P0: ops_alerts RLS hardening + claim_next_queued_package EXECUTE
-- P1: Dedupe index for stall alerts
-- SSOT: get_ops_summary + get_ops_summary_admin RPCs

-- 1) Fix ops_alerts INSERT policy
DROP POLICY IF EXISTS "Service role can insert ops_alerts" ON public.ops_alerts;
CREATE POLICY "Only service role can insert ops_alerts"
  ON public.ops_alerts FOR INSERT
  WITH CHECK ((auth.jwt() ->> 'role') = 'service_role');

-- 2) Add UPDATE policy for admin acknowledge
CREATE POLICY "Admins can acknowledge ops_alerts"
  ON public.ops_alerts FOR UPDATE
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'))
  WITH CHECK (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- 3) Harden claim_next_queued_package EXECUTE
REVOKE ALL ON FUNCTION public.claim_next_queued_package() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_queued_package() FROM anon;
REVOKE ALL ON FUNCTION public.claim_next_queued_package() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_next_queued_package() TO service_role;

-- 4) Dedupe index
CREATE INDEX IF NOT EXISTS ops_alerts_open_idx
  ON public.ops_alerts (source, created_at DESC)
  WHERE acknowledged_at IS NULL;

-- 5) SSOT Ops Summary RPC
CREATE OR REPLACE FUNCTION public.get_ops_summary()
RETURNS TABLE (
  packages_queued bigint,
  packages_building bigint,
  packages_blocked bigint,
  packages_failed_24h bigint,
  active_slots bigint,
  frozen_curricula bigint,
  draft_curricula bigint,
  open_alerts bigint,
  last_package_started_at timestamptz,
  last_package_completed_at timestamptz
)
LANGUAGE sql SECURITY DEFINER SET search_path = public
AS $$
  WITH
  p AS (
    SELECT
      count(*) FILTER (WHERE status = 'queued')   AS queued,
      count(*) FILTER (WHERE status = 'building') AS building,
      count(*) FILTER (WHERE status = 'blocked')  AS blocked,
      count(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '24 hours') AS failed_24h,
      max(started_at) FILTER (WHERE status = 'building') AS last_started_at,
      max(updated_at) FILTER (WHERE status = 'done')     AS last_completed_at
    FROM public.course_packages
  ),
  c AS (
    SELECT
      count(*) FILTER (WHERE status = 'frozen') AS frozen,
      count(*) FILTER (WHERE status = 'draft')  AS draft
    FROM public.curricula
  ),
  a AS (
    SELECT count(*) AS open_alerts FROM public.ops_alerts WHERE acknowledged_at IS NULL
  )
  SELECT
    p.queued::bigint, p.building::bigint, p.blocked::bigint, p.failed_24h::bigint,
    p.building::bigint, c.frozen::bigint, c.draft::bigint, a.open_alerts::bigint,
    p.last_started_at, p.last_completed_at
  FROM p, c, a;
$$;

REVOKE ALL ON FUNCTION public.get_ops_summary() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ops_summary() FROM anon;
REVOKE ALL ON FUNCTION public.get_ops_summary() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.get_ops_summary() TO service_role;

-- 6) Admin-facing RPC
CREATE OR REPLACE FUNCTION public.get_ops_summary_admin()
RETURNS TABLE (
  packages_queued bigint, packages_building bigint, packages_blocked bigint,
  packages_failed_24h bigint, active_slots bigint, frozen_curricula bigint,
  draft_curricula bigint, open_alerts bigint,
  last_package_started_at timestamptz, last_package_completed_at timestamptz
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
  IF NOT public.is_admin(auth.uid()) THEN
    RAISE EXCEPTION 'not authorized';
  END IF;
  RETURN QUERY SELECT * FROM public.get_ops_summary();
END;
$$;

REVOKE ALL ON FUNCTION public.get_ops_summary_admin() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_ops_summary_admin() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_ops_summary_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ops_summary_admin() TO service_role;
