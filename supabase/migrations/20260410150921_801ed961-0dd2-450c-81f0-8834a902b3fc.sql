
-- 1. Extend org_licenses with subscription fields
ALTER TABLE public.org_licenses
  ADD COLUMN IF NOT EXISTS stripe_subscription_id text UNIQUE,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text,
  ADD COLUMN IF NOT EXISTS stripe_price_id text,
  ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
  ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
  ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'org_licenses' AND column_name = 'total_seats') THEN
    ALTER TABLE public.org_licenses ADD COLUMN total_seats int NOT NULL DEFAULT 0;
    UPDATE public.org_licenses SET total_seats = seat_count;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_org_licenses_stripe_sub ON public.org_licenses(stripe_subscription_id);
CREATE INDEX IF NOT EXISTS idx_org_licenses_stripe_cust ON public.org_licenses(stripe_customer_id);

-- 2. Extend org_license_seats
ALTER TABLE public.org_license_seats
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS assigned_by uuid,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

CREATE INDEX IF NOT EXISTS idx_org_license_seats_active ON public.org_license_seats(license_id, status) WHERE status = 'active';
CREATE UNIQUE INDEX IF NOT EXISTS idx_org_license_seats_unique_active ON public.org_license_seats(license_id, user_id) WHERE status = 'active';

-- 3. Create org_license_invites table
CREATE TABLE IF NOT EXISTS public.org_license_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id uuid NOT NULL,
  license_id uuid NOT NULL REFERENCES public.org_licenses(id) ON DELETE CASCADE,
  email text NOT NULL,
  role text NOT NULL DEFAULT 'member',
  status text NOT NULL DEFAULT 'pending',
  invite_token uuid NOT NULL DEFAULT gen_random_uuid(),
  invited_by uuid,
  accepted_by uuid,
  expires_at timestamptz NOT NULL DEFAULT (now() + interval '14 days'),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_org_license_invites_pending
  ON public.org_license_invites (license_id, lower(email))
  WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS idx_org_license_invites_token ON public.org_license_invites(invite_token) WHERE status = 'pending';

ALTER TABLE public.org_license_invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org members can view their org invites"
  ON public.org_license_invites FOR SELECT TO authenticated
  USING (
    org_id IN (SELECT org_id FROM public.org_memberships WHERE user_id = auth.uid() AND status = 'active')
  );

CREATE POLICY "Org admins can create invites"
  ON public.org_license_invites FOR INSERT TO authenticated
  WITH CHECK (
    org_id IN (
      SELECT org_id FROM public.org_memberships
      WHERE user_id = auth.uid() AND role IN ('owner', 'admin') AND status = 'active'
    )
  );

-- 4. assign_org_license_seat
CREATE OR REPLACE FUNCTION public.assign_org_license_seat(
  p_license_id uuid, p_user_id uuid, p_assigned_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_license public.org_licenses; v_used_count int;
BEGIN
  SELECT * INTO v_license FROM public.org_licenses WHERE id = p_license_id;
  IF v_license.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'LICENSE_NOT_FOUND'); END IF;
  IF v_license.status <> 'active' THEN RETURN jsonb_build_object('ok', false, 'error', 'LICENSE_NOT_ACTIVE'); END IF;
  IF v_license.current_period_end IS NOT NULL AND v_license.current_period_end <= now() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'LICENSE_EXPIRED');
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_license_seats WHERE license_id = p_license_id AND user_id = p_user_id AND status = 'active') THEN
    RETURN jsonb_build_object('ok', true, 'already_assigned', true);
  END IF;
  SELECT count(*) INTO v_used_count FROM public.org_license_seats WHERE license_id = p_license_id AND status = 'active';
  IF v_used_count >= v_license.total_seats THEN RETURN jsonb_build_object('ok', false, 'error', 'NO_SEATS_AVAILABLE'); END IF;
  INSERT INTO public.org_license_seats (license_id, user_id, assigned_by, status) VALUES (p_license_id, p_user_id, p_assigned_by, 'active');
  UPDATE public.org_licenses SET seats_used = (SELECT count(*) FROM public.org_license_seats WHERE license_id = p_license_id AND status = 'active') WHERE id = p_license_id;
  RETURN jsonb_build_object('ok', true, 'already_assigned', false);
END; $$;

-- 5. release_org_license_seat
CREATE OR REPLACE FUNCTION public.release_org_license_seat(
  p_license_id uuid, p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.org_license_seats SET status = 'released', released_at = now() WHERE license_id = p_license_id AND user_id = p_user_id AND status = 'active';
  UPDATE public.org_licenses SET seats_used = (SELECT count(*) FROM public.org_license_seats WHERE license_id = p_license_id AND status = 'active') WHERE id = p_license_id;
  RETURN jsonb_build_object('ok', true);
END; $$;

-- 6. create_org_license_invite
CREATE OR REPLACE FUNCTION public.create_org_license_invite(
  p_license_id uuid, p_org_id uuid, p_email text, p_role text DEFAULT 'member', p_invited_by uuid DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invite public.org_license_invites;
BEGIN
  INSERT INTO public.org_license_invites (license_id, org_id, email, role, invited_by)
  VALUES (p_license_id, p_org_id, lower(trim(p_email)), p_role, p_invited_by)
  RETURNING * INTO v_invite;
  RETURN jsonb_build_object('ok', true, 'invite_id', v_invite.id, 'invite_token', v_invite.invite_token, 'expires_at', v_invite.expires_at);
END; $$;

-- 7. accept_org_license_invite
CREATE OR REPLACE FUNCTION public.accept_org_license_invite(
  p_invite_token uuid, p_user_id uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_invite public.org_license_invites; v_assign_result jsonb;
BEGIN
  SELECT * INTO v_invite FROM public.org_license_invites WHERE invite_token = p_invite_token AND status = 'pending' AND expires_at > now();
  IF v_invite.id IS NULL THEN RETURN jsonb_build_object('ok', false, 'error', 'INVITE_INVALID_OR_EXPIRED'); END IF;
  v_assign_result := public.assign_org_license_seat(v_invite.license_id, p_user_id, v_invite.invited_by);
  IF NOT (v_assign_result->>'ok')::boolean THEN RETURN v_assign_result; END IF;
  UPDATE public.org_license_invites SET status = 'accepted', accepted_by = p_user_id, accepted_at = now(), updated_at = now() WHERE id = v_invite.id;
  INSERT INTO public.org_memberships (org_id, user_id, role, status) VALUES (v_invite.org_id, p_user_id, v_invite.role, 'active') ON CONFLICT DO NOTHING;
  RETURN jsonb_build_object('ok', true, 'license_id', v_invite.license_id, 'org_id', v_invite.org_id);
END; $$;

-- 8. Updated check_team_access
CREATE OR REPLACE FUNCTION public.check_team_access(p_user_id uuid, p_category text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.org_license_seats s
    JOIN public.org_licenses l ON l.id = s.license_id
    WHERE s.user_id = p_user_id AND s.status = 'active'
      AND l.category = p_category AND l.status = 'active'
      AND (l.current_period_end IS NULL OR l.current_period_end > now())
      AND (l.ends_at IS NULL OR l.ends_at > now())
  );
$$;
