
-- ══════════════════════════════════════════════════════════════
-- P0 HARDENING: Seat SSOT + Role Checks + can_access_product fix
-- ══════════════════════════════════════════════════════════════

-- ── FIX 1: assign_org_seat — COUNT-based seat check + role guard ──
CREATE OR REPLACE FUNCTION public.assign_org_seat(p_license_id uuid, p_user_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_license public.org_licenses%ROWTYPE;
  v_existing_id uuid;
  v_active_count integer;
  v_caller_role text;
BEGIN
  -- Role check: caller must be owner/admin/manager of the org
  SELECT om.role INTO v_caller_role
  FROM public.org_memberships om
  JOIN public.org_licenses ol ON ol.org_id = om.org_id
  WHERE ol.id = p_license_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner','admin','manager')
    AND om.status = 'active'
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authorized to manage seats');
  END IF;

  SELECT * INTO v_license FROM public.org_licenses WHERE id = p_license_id FOR UPDATE;
  IF v_license IS NULL THEN RETURN json_build_object('success', false, 'message', 'License not found'); END IF;
  IF v_license.status <> 'active' THEN RETURN json_build_object('success', false, 'message', 'License is not active'); END IF;
  IF v_license.ends_at IS NOT NULL AND v_license.ends_at < now() THEN RETURN json_build_object('success', false, 'message', 'License expired'); END IF;

  -- SSOT: count actual active seats instead of trusting seats_used
  SELECT COUNT(*) INTO v_active_count
  FROM public.org_license_seats
  WHERE license_id = p_license_id AND released_at IS NULL;

  IF v_active_count >= v_license.seat_count THEN
    RETURN json_build_object('success', false, 'message', 'All seats occupied');
  END IF;

  SELECT id INTO v_existing_id FROM public.org_license_seats WHERE license_id = p_license_id AND user_id = p_user_id AND released_at IS NULL;
  IF v_existing_id IS NOT NULL THEN RETURN json_build_object('success', false, 'message', 'User already has seat'); END IF;

  INSERT INTO public.org_license_seats (license_id, user_id, claimed_at) VALUES (p_license_id, p_user_id, now());
  -- seats_used is updated by trigger trg_sync_seats_used (no manual increment)

  RETURN json_build_object('success', true, 'message', 'Seat assigned',
    'seats_used', v_active_count + 1, 'seats_available', v_license.seat_count - v_active_count - 1);
END;
$$;
REVOKE ALL ON FUNCTION public.assign_org_seat FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_org_seat TO authenticated;

-- ── FIX 2: revoke_org_seat — role guard + let trigger handle seats_used ──
CREATE OR REPLACE FUNCTION public.revoke_org_seat(p_license_id uuid, p_user_id uuid)
RETURNS json LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_seat_id uuid;
  v_license public.org_licenses%ROWTYPE;
  v_caller_role text;
  v_active_count integer;
BEGIN
  -- Role check
  SELECT om.role INTO v_caller_role
  FROM public.org_memberships om
  JOIN public.org_licenses ol ON ol.org_id = om.org_id
  WHERE ol.id = p_license_id
    AND om.user_id = auth.uid()
    AND om.role IN ('owner','admin','manager')
    AND om.status = 'active'
  LIMIT 1;

  IF v_caller_role IS NULL THEN
    RETURN json_build_object('success', false, 'message', 'Not authorized to manage seats');
  END IF;

  SELECT * INTO v_license FROM public.org_licenses WHERE id = p_license_id FOR UPDATE;
  IF v_license IS NULL THEN RETURN json_build_object('success', false, 'message', 'License not found'); END IF;

  SELECT id INTO v_seat_id FROM public.org_license_seats WHERE license_id = p_license_id AND user_id = p_user_id AND released_at IS NULL;
  IF v_seat_id IS NULL THEN RETURN json_build_object('success', false, 'message', 'No active seat'); END IF;

  UPDATE public.org_license_seats SET released_at = now() WHERE id = v_seat_id;
  -- seats_used updated by trigger

  SELECT COUNT(*) INTO v_active_count
  FROM public.org_license_seats
  WHERE license_id = p_license_id AND released_at IS NULL;

  RETURN json_build_object('success', true, 'message', 'Seat revoked',
    'seats_used', v_active_count, 'seats_available', v_license.seat_count - v_active_count);
END;
$$;
REVOKE ALL ON FUNCTION public.revoke_org_seat FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.revoke_org_seat TO authenticated;

-- ── FIX 3: can_access_product — use org_license_seats (not org_license_assignments) ──
CREATE OR REPLACE FUNCTION public.can_access_product(
  p_user_id uuid,
  p_product_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    -- Path A: Direct entitlement (user_id or learner_identity)
    SELECT 1
    FROM public.entitlements e
    WHERE e.product_id = p_product_id
      AND e.valid_from <= now()
      AND (e.valid_until IS NULL OR e.valid_until >= now())
      AND (
        e.user_id = p_user_id
        OR e.learner_identity_id IN (
          SELECT li.id FROM public.learner_identities li WHERE li.user_id = p_user_id
        )
      )

    UNION ALL

    -- Path B: Org license via actual seat assignment (SSOT)
    SELECT 1
    FROM public.org_license_seats ols
    JOIN public.org_licenses ol ON ol.id = ols.license_id
    WHERE ols.user_id = p_user_id
      AND ols.released_at IS NULL
      AND ol.product_id = p_product_id
      AND ol.status = 'active'
      AND (ol.ends_at IS NULL OR ol.ends_at > now())

    LIMIT 1
  );
$$;

REVOKE ALL ON FUNCTION public.can_access_product(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_access_product(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_access_product(uuid, uuid) TO service_role;
