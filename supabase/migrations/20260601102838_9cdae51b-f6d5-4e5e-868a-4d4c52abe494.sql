
-- Update trigger to honour a per-session bypass flag for QA cleanup
CREATE OR REPLACE FUNCTION public.fn_org_membership_protect_last_owner()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_count int;
  v_attempted   text;
  v_org_id      uuid := OLD.org_id;
  v_user_id     uuid := OLD.user_id;
  v_bypass      text := current_setting('app.qa_b2b_cleanup_bypass', true);
BEGIN
  -- QA cleanup helper sets this session-local flag to skip the guard.
  IF v_bypass = 'true' THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF NOT (OLD.role = 'owner' AND OLD.status = 'active') THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF NEW.role = 'owner' AND NEW.status = 'active' THEN
      RETURN NEW;
    END IF;
    v_attempted := 'update_to_role_' || NEW.role || '_status_' || NEW.status;
  ELSIF TG_OP = 'DELETE' THEN
    v_attempted := 'delete';
  END IF;

  SELECT COUNT(*) INTO v_owner_count
  FROM public.org_memberships
  WHERE org_id = v_org_id
    AND role = 'owner'
    AND status = 'active'
    AND id <> OLD.id;

  IF v_owner_count = 0 THEN
    BEGIN
      PERFORM public.fn_emit_audit(
        _action_type   => 'org_last_owner_protected',
        _target_type   => 'org_membership',
        _target_id     => v_user_id::text,
        _result_status => 'blocked',
        _payload       => jsonb_build_object(
          'org_id', v_org_id,
          'user_id', v_user_id,
          'attempted_action', v_attempted
        ),
        _trigger_source => 'trg_org_membership_protect_last_owner',
        _error_message  => NULL
      );
    EXCEPTION WHEN OTHERS THEN NULL;
    END;
    RAISE EXCEPTION 'CANNOT_REMOVE_LAST_OWNER: org_id=% user_id=% attempted=%',
      v_org_id, v_user_id, v_attempted
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

-- Update cleanup helper to set the bypass flag instead of session_replication_role
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
  SELECT array_agg(id) INTO v_org_ids
  FROM public.organizations
  WHERE name IN ('QA Reality Org A','QA Reality Org B');

  SELECT COUNT(*) INTO v_user_count
  FROM auth.users
  WHERE email LIKE 'qa+org-%@examfit-smoke.local';

  IF v_org_ids IS NOT NULL THEN
    SELECT array_agg(id) INTO v_lic_ids
    FROM public.org_licenses WHERE org_id = ANY(v_org_ids);

    PERFORM set_config('app.qa_b2b_cleanup_bypass', 'true', true);

    IF v_lic_ids IS NOT NULL THEN
      DELETE FROM public.org_license_seats   WHERE license_id = ANY(v_lic_ids);
      DELETE FROM public.org_license_invites WHERE license_id = ANY(v_lic_ids);
      DELETE FROM public.org_licenses        WHERE id          = ANY(v_lic_ids);
    END IF;
    DELETE FROM public.org_memberships WHERE org_id = ANY(v_org_ids);
    DELETE FROM public.organizations    WHERE id    = ANY(v_org_ids);

    PERFORM set_config('app.qa_b2b_cleanup_bypass', 'false', true);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'org_count', COALESCE(array_length(v_org_ids,1),0),
    'user_count', v_user_count
  );
END;
$$;
