
CREATE OR REPLACE FUNCTION public.update_org_member_role(
  p_org_id uuid, p_user_id uuid, p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_old_role text;
  v_only_owner boolean;
BEGIN
  IF v_caller IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED');
  END IF;
  IF NOT public.is_org_member_with_role(v_caller, p_org_id, ARRAY['owner','admin']) THEN
    RETURN jsonb_build_object('ok',false,'error','FORBIDDEN');
  END IF;
  IF p_new_role NOT IN ('owner','admin','manager','learner') THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_ROLE');
  END IF;

  SELECT role INTO v_old_role FROM public.org_memberships
    WHERE org_id = p_org_id AND user_id = p_user_id FOR UPDATE;
  IF v_old_role IS NULL THEN
    RETURN jsonb_build_object('ok',false,'error','MEMBER_NOT_FOUND');
  END IF;
  IF v_old_role = p_new_role THEN
    RETURN jsonb_build_object('ok',true,'noop',true);
  END IF;

  IF v_old_role = 'owner' AND p_new_role <> 'owner' THEN
    SELECT (COUNT(*) <= 1) INTO v_only_owner FROM public.org_memberships
      WHERE org_id = p_org_id AND role = 'owner' AND status = 'active';
    IF v_only_owner THEN
      RETURN jsonb_build_object('ok',false,'error','CANNOT_REMOVE_LAST_OWNER');
    END IF;
  END IF;

  IF p_new_role = 'owner' AND NOT public.is_org_member_with_role(v_caller, p_org_id, ARRAY['owner']) THEN
    RETURN jsonb_build_object('ok',false,'error','ONLY_OWNER_CAN_PROMOTE_TO_OWNER');
  END IF;

  UPDATE public.org_memberships
     SET role = p_new_role, updated_at = now()
   WHERE org_id = p_org_id AND user_id = p_user_id;

  -- Correct fn_emit_audit call (named args, matches the live signature)
  PERFORM public.fn_emit_audit(
    _action_type    => 'org_member_role_changed',
    _target_type    => 'org_membership',
    _target_id      => p_user_id::text,
    _result_status  => 'ok',
    _payload        => jsonb_build_object(
      'org_id',     p_org_id,
      'user_id',    p_user_id,
      'old_role',   v_old_role,
      'new_role',   p_new_role,
      'changed_by', v_caller
    ),
    _trigger_source => 'update_org_member_role',
    _error_message  => NULL
  );

  RETURN jsonb_build_object('ok',true,'old_role',v_old_role,'new_role',p_new_role);
END;
$$;
