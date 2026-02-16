
-- 1) Extend referral_invites with conversion tracking + expiry + fraud guard
ALTER TABLE public.referral_invites
  ADD COLUMN IF NOT EXISTS converted_at timestamptz,
  ADD COLUMN IF NOT EXISTS conversion_order_id uuid,
  ADD COLUMN IF NOT EXISTS expires_at timestamptz DEFAULT (now() + interval '30 days'),
  ADD COLUMN IF NOT EXISTS reward_type text DEFAULT 'pro_7_days',
  ADD COLUMN IF NOT EXISTS reward_detail jsonb DEFAULT '{}';

-- Index for fast lookup by invite_code
CREATE INDEX IF NOT EXISTS idx_referral_invites_code ON public.referral_invites(invite_code);

-- 2) Table for pending referral claims (written at signup, before conversion)
CREATE TABLE IF NOT EXISTS public.referral_claims (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL,
  referred_user_id uuid NOT NULL,
  invite_code text NOT NULL,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  converted_at timestamptz,
  conversion_order_id uuid,
  reward_granted boolean DEFAULT false,
  reward_type text,
  CONSTRAINT uq_referral_claims_referred UNIQUE(referred_user_id)
);

ALTER TABLE public.referral_claims ENABLE ROW LEVEL SECURITY;

-- Users can read their own claims (as referrer or referred)
CREATE POLICY "Users can view own referral claims"
  ON public.referral_claims FOR SELECT
  USING (auth.uid() = referrer_id OR auth.uid() = referred_user_id);

-- Service role inserts (no user insert policy needed, done via edge function)

-- 3) Function: claim a referral code (called after signup via edge function)
CREATE OR REPLACE FUNCTION public.claim_referral_code(
  p_invite_code text,
  p_referred_user_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite referral_invites%ROWTYPE;
  v_result jsonb;
BEGIN
  -- Find the invite
  SELECT * INTO v_invite
  FROM referral_invites
  WHERE invite_code = p_invite_code
    AND claimed_by IS NULL
    AND (expires_at IS NULL OR expires_at > now())
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Code ungültig oder abgelaufen');
  END IF;

  -- Self-referral guard
  IF v_invite.inviter_id = p_referred_user_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Eigen-Empfehlung nicht möglich');
  END IF;

  -- Check if user already claimed any referral
  IF EXISTS (SELECT 1 FROM referral_claims WHERE referred_user_id = p_referred_user_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Bereits eine Empfehlung eingelöst');
  END IF;

  -- Mark invite as claimed
  UPDATE referral_invites
  SET claimed_by = p_referred_user_id,
      claimed_at = now()
  WHERE id = v_invite.id;

  -- Create claim record
  INSERT INTO referral_claims (referrer_id, referred_user_id, invite_code, reward_type)
  VALUES (v_invite.inviter_id, p_referred_user_id, p_invite_code, COALESCE(v_invite.reward_type, 'pro_7_days'));

  RETURN jsonb_build_object(
    'ok', true,
    'referrer_id', v_invite.inviter_id,
    'reward_type', COALESCE(v_invite.reward_type, 'pro_7_days')
  );
END;
$$;

-- 4) Function: convert a referral after purchase
CREATE OR REPLACE FUNCTION public.convert_referral_on_purchase(
  p_buyer_user_id uuid,
  p_order_id uuid
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_claim referral_claims%ROWTYPE;
BEGIN
  -- Find uncoverted claim for this buyer
  SELECT * INTO v_claim
  FROM referral_claims
  WHERE referred_user_id = p_buyer_user_id
    AND converted_at IS NULL
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_pending_claim');
  END IF;

  -- Mark claim as converted
  UPDATE referral_claims
  SET converted_at = now(),
      conversion_order_id = p_order_id,
      reward_granted = true
  WHERE id = v_claim.id;

  -- Also update the original invite
  UPDATE referral_invites
  SET converted_at = now(),
      conversion_order_id = p_order_id,
      reward_granted = true
  WHERE invite_code = v_claim.invite_code;

  -- Grant reward to REFERRER: 7-day pro trial badge
  INSERT INTO user_badges (user_id, badge_key, badge_label, badge_icon, metadata)
  VALUES (
    v_claim.referrer_id,
    'referral_success',
    'Empfehlung erfolgreich',
    '🤝',
    jsonb_build_object('referred_user_id', p_buyer_user_id, 'order_id', p_order_id)
  )
  ON CONFLICT DO NOTHING;

  -- Grant reward to REFERRED: welcome badge
  INSERT INTO user_badges (user_id, badge_key, badge_label, badge_icon, metadata)
  VALUES (
    p_buyer_user_id,
    'referred_welcome',
    'Eingeladen & gestartet',
    '🎁',
    jsonb_build_object('referrer_id', v_claim.referrer_id)
  )
  ON CONFLICT DO NOTHING;

  RETURN jsonb_build_object(
    'ok', true,
    'referrer_id', v_claim.referrer_id,
    'reward_type', v_claim.reward_type
  );
END;
$$;
