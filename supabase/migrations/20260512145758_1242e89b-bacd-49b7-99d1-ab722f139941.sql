CREATE OR REPLACE FUNCTION public.admin_drain_bronze_review_required_v1_adhoc(
  p_limit int DEFAULT 10,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE(
  package_id uuid, title text, drain_class text,
  action_taken text, skip_reason text, job_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  PERFORM set_config('role', 'service_role', true);
  RETURN QUERY
  SELECT * FROM public.admin_drain_bronze_review_required_v1(p_limit, p_dry_run);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_drain_bronze_review_required_v1_adhoc(int, boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_drain_bronze_review_required_v1_adhoc(int, boolean) TO service_role;