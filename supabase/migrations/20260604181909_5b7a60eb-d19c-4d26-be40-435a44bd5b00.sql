-- B2B Org Console: token-scoped invite preview (security definer)
-- Closes a gap where invitees could never see invite details pre-login because
-- org_license_invites RLS is strict-admin-only by design.

CREATE OR REPLACE FUNCTION public.get_org_invite_preview(p_token uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row record;
  v_masked_email text;
  v_local text;
  v_domain text;
BEGIN
  IF p_token IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVALID_TOKEN');
  END IF;

  SELECT
    i.email,
    i.role,
    i.org_id,
    i.status,
    i.expires_at,
    o.name        AS org_name,
    p.title       AS product_title
  INTO v_row
  FROM public.org_license_invites i
  LEFT JOIN public.organizations o  ON o.id = i.org_id
  LEFT JOIN public.org_licenses  ol ON ol.id = i.license_id
  LEFT JOIN public.products      p  ON p.id  = ol.product_id
  WHERE i.invite_token = p_token
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NOT_FOUND');
  END IF;

  -- Mask the email so the token alone doesn't disclose the full recipient address
  -- (token is shared via email; mild defense-in-depth if token leaks via referer/log).
  v_local  := split_part(v_row.email, '@', 1);
  v_domain := split_part(v_row.email, '@', 2);
  v_masked_email := CASE
    WHEN length(v_local) <= 2 THEN left(v_local, 1) || '***@' || v_domain
    ELSE left(v_local, 2) || repeat('*', greatest(length(v_local) - 2, 1)) || '@' || v_domain
  END;

  RETURN jsonb_build_object(
    'ok', true,
    'email_masked',   v_masked_email,
    'role',           v_row.role,
    'org_id',         v_row.org_id,
    'org_name',       v_row.org_name,
    'product_title',  v_row.product_title,
    'status',         v_row.status,
    'expires_at',     v_row.expires_at,
    'is_expired',     (v_row.expires_at < now()),
    'is_accepted',    (v_row.status = 'accepted'),
    'is_revoked',     (v_row.status = 'revoked')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_org_invite_preview(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_org_invite_preview(uuid) TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.get_org_invite_preview(uuid) IS
  'B2B Org Console: token-scoped, masked invite preview for pre-login invite landing page. Token acts as bearer secret. Reads org_license_invites + organizations + products via SECURITY DEFINER (RLS bypass intended).';
