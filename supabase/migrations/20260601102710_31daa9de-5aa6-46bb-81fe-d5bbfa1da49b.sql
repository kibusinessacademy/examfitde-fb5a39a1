
CREATE OR REPLACE FUNCTION public.qa_b2b_reality_cleanup()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  v_org_ids uuid[];
  v_lic_ids uuid[];
  v_user_count int := 0;
BEGIN
  -- Access control is enforced by REVOKE/GRANT (service_role only).
  SELECT array_agg(id) INTO v_org_ids
  FROM public.organizations
  WHERE name IN ('QA Reality Org A','QA Reality Org B');

  SELECT COUNT(*) INTO v_user_count
  FROM auth.users
  WHERE email LIKE 'qa+org-%@examfit-smoke.local';

  IF v_org_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO v_lic_ids
    FROM public.org_licenses WHERE org_id = ANY(v_org_ids);

    PERFORM set_config('session_replication_role', 'replica', true);

    IF v_lic_ids IS NOT NULL THEN
      DELETE FROM public.org_license_seats   WHERE license_id = ANY(v_lic_ids);
      DELETE FROM public.org_license_invites WHERE license_id = ANY(v_lic_ids);
      DELETE FROM public.org_licenses        WHERE id          = ANY(v_lic_ids);
    END IF;
    DELETE FROM public.org_memberships WHERE org_id = ANY(v_org_ids);
    DELETE FROM public.organizations    WHERE id    = ANY(v_org_ids);

    PERFORM set_config('session_replication_role', 'origin', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'org_count', COALESCE(array_length(v_org_ids,1),0),
    'user_count', v_user_count
  );
END;
$$;
