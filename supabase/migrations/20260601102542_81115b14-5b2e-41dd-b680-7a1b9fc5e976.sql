
-- B2B Org Reality QA — hard cleanup helper (service_role only)
CREATE OR REPLACE FUNCTION public.qa_b2b_reality_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_caller_role text := current_setting('request.jwt.claim.role', true);
  v_org_ids uuid[];
  v_lic_ids uuid[];
  v_user_ids uuid[];
  v_removed_orgs int := 0;
  v_removed_users int := 0;
BEGIN
  -- Only service_role may call this
  IF v_caller_role IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'SERVICE_ROLE_REQUIRED' USING ERRCODE = 'insufficient_privilege';
  END IF;

  -- Collect QA orgs by canonical names
  SELECT array_agg(id) INTO v_org_ids
  FROM public.organizations
  WHERE name IN ('QA Reality Org A','QA Reality Org B');

  -- Collect smoke users by email pattern
  SELECT array_agg(id) INTO v_user_ids
  FROM auth.users
  WHERE email LIKE 'qa+org-%@examfit-smoke.local';

  IF v_org_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO v_lic_ids
    FROM public.org_licenses WHERE org_id = ANY(v_org_ids);

    -- Bypass the last-owner trigger for cleanup
    PERFORM set_config('session_replication_role', 'replica', true);

    IF v_lic_ids IS NOT NULL THEN
      DELETE FROM public.org_license_seats   WHERE license_id = ANY(v_lic_ids);
      DELETE FROM public.org_license_invites WHERE license_id = ANY(v_lic_ids);
      DELETE FROM public.org_licenses        WHERE id          = ANY(v_lic_ids);
    END IF;
    DELETE FROM public.org_memberships WHERE org_id = ANY(v_org_ids);

    PERFORM set_config('session_replication_role', 'origin', true);

    GET DIAGNOSTICS v_removed_orgs = ROW_COUNT;
    DELETE FROM public.organizations WHERE id = ANY(v_org_ids);
  END IF;

  -- auth.users deletion stays in the edge function (uses admin API)

  RETURN jsonb_build_object(
    'ok', true,
    'org_count', COALESCE(array_length(v_org_ids,1),0),
    'user_count', COALESCE(array_length(v_user_ids,1),0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.qa_b2b_reality_cleanup() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.qa_b2b_reality_cleanup() TO service_role;
