
-- 1. Unique constraint on org_memberships to support ON CONFLICT
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_memberships_org_user
ON public.org_memberships (org_id, user_id);

-- 2. Unique constraint on stripe_subscription_id for idempotent webhook handling
CREATE UNIQUE INDEX IF NOT EXISTS uq_org_licenses_stripe_sub
ON public.org_licenses (stripe_subscription_id)
WHERE stripe_subscription_id IS NOT NULL;

-- 3. Sync seat_count = total_seats (keep backward compat, total_seats is canonical)
UPDATE public.org_licenses SET seat_count = total_seats WHERE seat_count <> total_seats;

-- 4. Trigger to keep seat_count in sync with total_seats
CREATE OR REPLACE FUNCTION public.fn_sync_seat_count()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.total_seats IS DISTINCT FROM OLD.total_seats THEN
    NEW.seat_count := NEW.total_seats;
  ELSIF NEW.seat_count IS DISTINCT FROM OLD.seat_count THEN
    NEW.total_seats := NEW.seat_count;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_seat_count ON public.org_licenses;
CREATE TRIGGER trg_sync_seat_count
BEFORE UPDATE ON public.org_licenses
FOR EACH ROW
EXECUTE FUNCTION public.fn_sync_seat_count();

-- 5. Hardened assign_org_license_seat with FOR UPDATE locking
CREATE OR REPLACE FUNCTION public.assign_org_license_seat(
  p_license_id uuid,
  p_user_id uuid,
  p_assigned_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_license public.org_licenses;
  v_used_count int;
BEGIN
  -- Lock the license row to prevent concurrent over-assignment
  SELECT *
  INTO v_license
  FROM public.org_licenses
  WHERE id = p_license_id
  FOR UPDATE;

  IF v_license.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LICENSE_NOT_FOUND');
  END IF;

  IF v_license.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LICENSE_NOT_ACTIVE');
  END IF;

  IF v_license.current_period_end IS NOT NULL AND v_license.current_period_end <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LICENSE_EXPIRED');
  END IF;

  -- Check for existing active assignment (idempotent)
  IF EXISTS (
    SELECT 1 FROM public.org_license_seats
    WHERE license_id = p_license_id AND user_id = p_user_id AND status = 'active'
  ) THEN
    RETURN jsonb_build_object('ok', true, 'already_assigned', true);
  END IF;

  -- Count active seats
  SELECT count(*)
  INTO v_used_count
  FROM public.org_license_seats
  WHERE license_id = p_license_id AND status = 'active';

  IF v_used_count >= v_license.total_seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_SEATS_AVAILABLE');
  END IF;

  INSERT INTO public.org_license_seats (license_id, user_id, assigned_by, status)
  VALUES (p_license_id, p_user_id, p_assigned_by, 'active');

  -- Update cached counter
  UPDATE public.org_licenses
  SET seats_used = v_used_count + 1
  WHERE id = p_license_id;

  RETURN jsonb_build_object('ok', true, 'already_assigned', false);
END;
$$;

-- 6. Hardened release_org_license_seat
CREATE OR REPLACE FUNCTION public.release_org_license_seat(
  p_license_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_count int;
BEGIN
  UPDATE public.org_license_seats
  SET status = 'released', released_at = now()
  WHERE license_id = p_license_id AND user_id = p_user_id AND status = 'active';

  SELECT count(*) INTO v_new_count
  FROM public.org_license_seats
  WHERE license_id = p_license_id AND status = 'active';

  UPDATE public.org_licenses
  SET seats_used = v_new_count
  WHERE id = p_license_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

-- 7. Hardened create_org_license_invite with capacity check (active seats + pending invites <= total_seats)
CREATE OR REPLACE FUNCTION public.create_org_license_invite(
  p_license_id uuid,
  p_org_id uuid,
  p_email text,
  p_role text DEFAULT 'member',
  p_invited_by uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_license public.org_licenses;
  v_active_seats int;
  v_pending_invites int;
  v_invite public.org_license_invites;
BEGIN
  -- Lock license row
  SELECT * INTO v_license
  FROM public.org_licenses
  WHERE id = p_license_id
  FOR UPDATE;

  IF v_license.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LICENSE_NOT_FOUND');
  END IF;

  IF v_license.status <> 'active' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LICENSE_NOT_ACTIVE');
  END IF;

  -- Count active seats
  SELECT count(*) INTO v_active_seats
  FROM public.org_license_seats
  WHERE license_id = p_license_id AND status = 'active';

  -- Count pending (non-expired) invites
  SELECT count(*) INTO v_pending_invites
  FROM public.org_license_invites
  WHERE license_id = p_license_id AND status = 'pending' AND expires_at > now();

  IF (v_active_seats + v_pending_invites) >= v_license.total_seats THEN
    RETURN jsonb_build_object('ok', false, 'error', 'NO_CAPACITY', 'active_seats', v_active_seats, 'pending_invites', v_pending_invites, 'total_seats', v_license.total_seats);
  END IF;

  INSERT INTO public.org_license_invites (license_id, org_id, email, role, invited_by)
  VALUES (p_license_id, p_org_id, lower(trim(p_email)), p_role, p_invited_by)
  RETURNING * INTO v_invite;

  RETURN jsonb_build_object('ok', true, 'invite_id', v_invite.id, 'invite_token', v_invite.invite_token);
END;
$$;

-- 8. Hardened accept_org_license_invite
CREATE OR REPLACE FUNCTION public.accept_org_license_invite(
  p_invite_token uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.org_license_invites;
  v_assign_result jsonb;
BEGIN
  SELECT * INTO v_invite
  FROM public.org_license_invites
  WHERE invite_token = p_invite_token
    AND status = 'pending'
    AND expires_at > now();

  IF v_invite.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'INVITE_INVALID_OR_EXPIRED');
  END IF;

  -- Assign seat (this handles locking and capacity internally)
  v_assign_result := public.assign_org_license_seat(v_invite.license_id, p_user_id, v_invite.invited_by);

  IF NOT (v_assign_result->>'ok')::boolean THEN
    RETURN v_assign_result;
  END IF;

  -- Mark invite as accepted
  UPDATE public.org_license_invites
  SET status = 'accepted', accepted_by = p_user_id, accepted_at = now(), updated_at = now()
  WHERE id = v_invite.id;

  -- Add user to org membership (idempotent)
  INSERT INTO public.org_memberships (org_id, user_id, role, status)
  VALUES (v_invite.org_id, p_user_id, v_invite.role, 'active')
  ON CONFLICT (org_id, user_id) DO NOTHING;

  RETURN jsonb_build_object('ok', true, 'license_id', v_invite.license_id, 'org_id', v_invite.org_id);
END;
$$;
