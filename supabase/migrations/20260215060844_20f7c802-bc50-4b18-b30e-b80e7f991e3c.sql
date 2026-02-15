
-- ══════════════════════════════════════════════════════════════
-- FIX A: SSOT Consolidation — Map get_active_pipeline_packages() to package_leases
-- This eliminates the split-brain between pipeline_active_packages and package_leases.
-- Both production-guardian and job-runner now read from the SAME source of truth.
-- ══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_active_pipeline_packages()
RETURNS SETOF uuid
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT package_id FROM public.package_leases
  WHERE lease_until > now()
  ORDER BY acquired_at;
$$;

-- Also create a step_heartbeat RPC for Fix B
CREATE OR REPLACE FUNCTION public.step_heartbeat(
  p_package_id uuid,
  p_step_key text
)
RETURNS void
LANGUAGE sql
SET search_path = public
AS $$
  UPDATE public.package_steps
  SET last_heartbeat_at = now()
  WHERE package_id = p_package_id
    AND step_key = p_step_key
    AND status IN ('running', 'enqueued');
$$;
