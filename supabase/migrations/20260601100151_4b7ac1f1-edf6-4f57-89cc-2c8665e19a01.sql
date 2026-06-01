
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('org_member_role_changed', ARRAY['org_id','user_id','old_role','new_role'], 'org_console')
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE FUNCTION public.list_org_members(p_org_id uuid)
RETURNS TABLE (
  membership_id uuid, user_id uuid, email text, full_name text, avatar_url text,
  role text, status text, joined_at timestamptz, source_type text, seats_count bigint
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    m.id, m.user_id, p.email, p.full_name, p.avatar_url,
    m.role, m.status, m.joined_at, m.source_type,
    COALESCE((
      SELECT COUNT(*) FROM public.org_license_seats s
      JOIN public.org_licenses l ON l.id = s.license_id
      WHERE s.user_id = m.user_id AND l.org_id = m.org_id AND s.status = 'active'
    ), 0)
  FROM public.org_memberships m
  LEFT JOIN public.profiles p ON p.user_id = m.user_id
  WHERE m.org_id = p_org_id
    AND public.is_org_member_with_role(auth.uid(), p_org_id, ARRAY['owner','admin','manager'])
  ORDER BY
    CASE m.role WHEN 'owner' THEN 1 WHEN 'admin' THEN 2 WHEN 'manager' THEN 3 ELSE 4 END,
    m.joined_at DESC NULLS LAST;
$$;
REVOKE ALL ON FUNCTION public.list_org_members(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_org_members(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_org_invites(p_org_id uuid)
RETURNS TABLE (
  id uuid, license_id uuid, email text, role text, status text, invite_token uuid,
  invited_by uuid, invited_by_email text, expires_at timestamptz, accepted_at timestamptz,
  created_at timestamptz, product_title text
)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    i.id, i.license_id, i.email, i.role, i.status, i.invite_token,
    i.invited_by, inv.email, i.expires_at, i.accepted_at, i.created_at, pr.title
  FROM public.org_license_invites i
  LEFT JOIN public.profiles inv ON inv.user_id = i.invited_by
  LEFT JOIN public.org_licenses l ON l.id = i.license_id
  LEFT JOIN public.products pr ON pr.id = l.product_id
  WHERE i.org_id = p_org_id
    AND public.is_org_member_with_role(auth.uid(), p_org_id, ARRAY['owner','admin','manager'])
  ORDER BY i.created_at DESC LIMIT 200;
$$;
REVOKE ALL ON FUNCTION public.list_org_invites(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_org_invites(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_org_member_role(p_org_id uuid, p_user_id uuid, p_new_role text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_old_role text;
  v_only_owner boolean;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
  IF NOT public.is_org_member_with_role(v_caller, p_org_id, ARRAY['owner','admin']) THEN
    RETURN jsonb_build_object('ok',false,'error','FORBIDDEN');
  END IF;
  IF p_new_role NOT IN ('owner','admin','manager','learner') THEN
    RETURN jsonb_build_object('ok',false,'error','INVALID_ROLE');
  END IF;
  SELECT role INTO v_old_role FROM public.org_memberships
    WHERE org_id = p_org_id AND user_id = p_user_id FOR UPDATE;
  IF v_old_role IS NULL THEN RETURN jsonb_build_object('ok',false,'error','MEMBER_NOT_FOUND'); END IF;
  IF v_old_role = p_new_role THEN RETURN jsonb_build_object('ok',true,'noop',true); END IF;
  IF v_old_role = 'owner' AND p_new_role <> 'owner' THEN
    SELECT (COUNT(*) <= 1) INTO v_only_owner FROM public.org_memberships
      WHERE org_id = p_org_id AND role = 'owner' AND status = 'active';
    IF v_only_owner THEN RETURN jsonb_build_object('ok',false,'error','CANNOT_REMOVE_LAST_OWNER'); END IF;
  END IF;
  IF p_new_role = 'owner' AND NOT public.is_org_member_with_role(v_caller, p_org_id, ARRAY['owner']) THEN
    RETURN jsonb_build_object('ok',false,'error','ONLY_OWNER_CAN_PROMOTE_TO_OWNER');
  END IF;
  UPDATE public.org_memberships SET role = p_new_role, updated_at = now()
    WHERE org_id = p_org_id AND user_id = p_user_id;
  PERFORM public.fn_emit_audit(
    'org_member_role_changed',
    jsonb_build_object('org_id',p_org_id,'user_id',p_user_id,'old_role',v_old_role,'new_role',p_new_role,'changed_by',v_caller),
    'org_membership', p_user_id::text, 'ok'
  );
  RETURN jsonb_build_object('ok',true,'old_role',v_old_role,'new_role',p_new_role);
END;
$$;
REVOKE ALL ON FUNCTION public.update_org_member_role(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_org_member_role(uuid, uuid, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.revoke_org_invite(p_invite_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_org_id uuid;
  v_status text;
BEGIN
  IF v_caller IS NULL THEN RETURN jsonb_build_object('ok',false,'error','NOT_AUTHENTICATED'); END IF;
  SELECT org_id, status INTO v_org_id, v_status FROM public.org_license_invites
    WHERE id = p_invite_id FOR UPDATE;
  IF v_org_id IS NULL THEN RETURN jsonb_build_object('ok',false,'error','INVITE_NOT_FOUND'); END IF;
  IF NOT public.is_org_member_with_role(v_caller, v_org_id, ARRAY['owner','admin','manager']) THEN
    RETURN jsonb_build_object('ok',false,'error','FORBIDDEN');
  END IF;
  IF v_status <> 'pending' THEN RETURN jsonb_build_object('ok',false,'error','INVITE_NOT_PENDING','status',v_status); END IF;
  UPDATE public.org_license_invites SET status = 'revoked', updated_at = now() WHERE id = p_invite_id;
  RETURN jsonb_build_object('ok',true);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_org_invite(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_org_invite(uuid) TO authenticated;
