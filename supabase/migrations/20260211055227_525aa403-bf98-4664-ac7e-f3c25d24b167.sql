
-- ============================
-- 1) Billing recipient fields on license_packages
-- ============================
ALTER TABLE public.license_packages
ADD COLUMN IF NOT EXISTS billing_email text,
ADD COLUMN IF NOT EXISTS billing_name text,
ADD COLUMN IF NOT EXISTS billing_company text,
ADD COLUMN IF NOT EXISTS billing_vat_id text,
ADD COLUMN IF NOT EXISTS billing_address jsonb,
ADD COLUMN IF NOT EXISTS stripe_customer_id text,
ADD COLUMN IF NOT EXISTS stripe_invoice_id text,
ADD COLUMN IF NOT EXISTS stripe_invoice_url text,
ADD COLUMN IF NOT EXISTS buyer_is_licensee boolean NOT NULL DEFAULT true,
ADD COLUMN IF NOT EXISTS delivery_status text NOT NULL DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS delivery_log jsonb NOT NULL DEFAULT '[]'::jsonb;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chk_delivery_status') THEN
    ALTER TABLE public.license_packages
    ADD CONSTRAINT chk_delivery_status CHECK (delivery_status IN ('pending','sent','failed'));
  END IF;
END;
$$;

-- ============================
-- 2) Seat claim hardening fields
-- ============================
ALTER TABLE public.license_seats
ADD COLUMN IF NOT EXISTS invite_email_hash text,
ADD COLUMN IF NOT EXISTS invite_expires_at timestamptz,
ADD COLUMN IF NOT EXISTS claimed_by_ip text,
ADD COLUMN IF NOT EXISTS claimed_user_agent text;

CREATE INDEX IF NOT EXISTS idx_license_seats_invite_email_hash
  ON public.license_seats(invite_email_hash);

-- ============================
-- 3) Email hash helper using extensions.digest
-- ============================
CREATE OR REPLACE FUNCTION public.hash_email(p_email text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT encode(extensions.digest(lower(trim(coalesce(p_email,'')))::bytea, 'sha256'), 'hex');
$$;

-- ============================
-- 4) Seat immutability trigger
-- ============================
CREATE OR REPLACE FUNCTION public.prevent_seat_reassignment()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.assigned_user_id IS NOT NULL THEN
    IF NEW.assigned_user_id IS DISTINCT FROM OLD.assigned_user_id THEN
      RAISE EXCEPTION 'Seat is immutable: assigned_user_id cannot be changed';
    END IF;
    IF NEW.invite_code IS DISTINCT FROM OLD.invite_code THEN
      RAISE EXCEPTION 'Seat is immutable: invite_code cannot be changed after claim';
    END IF;
    IF NEW.invite_email IS DISTINCT FROM OLD.invite_email THEN
      RAISE EXCEPTION 'Seat is immutable: invite_email cannot be changed after claim';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_seat_reassignment ON public.license_seats;
CREATE TRIGGER trg_prevent_seat_reassignment
BEFORE UPDATE ON public.license_seats
FOR EACH ROW
EXECUTE FUNCTION public.prevent_seat_reassignment();

-- ============================
-- 5) Tighten RLS
-- ============================
DROP POLICY IF EXISTS "Buyers can update their seats" ON public.license_seats;

CREATE POLICY "Buyers can update unassigned seats"
ON public.license_seats
FOR UPDATE
USING (
  auth.uid() IN (SELECT buyer_user_id FROM public.license_packages WHERE id = package_id)
)
WITH CHECK (
  auth.uid() IN (SELECT buyer_user_id FROM public.license_packages WHERE id = package_id)
  AND assigned_user_id IS NULL
);

DROP POLICY IF EXISTS "Buyers can view their package seats" ON public.license_seats;
CREATE POLICY "Buyers can view their package seats"
ON public.license_seats
FOR SELECT
USING (
  auth.uid() IN (SELECT buyer_user_id FROM public.license_packages WHERE id = package_id)
);

-- ============================
-- 6) Secure claim function
-- ============================
CREATE OR REPLACE FUNCTION public.claim_license_seat(p_invite_code text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_email text;
  v_email_hash text;
  v_seat public.license_seats%ROWTYPE;
  v_pack public.license_packages%ROWTYPE;
  v_prod public.store_products%ROWTYPE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  v_email := coalesce((auth.jwt() ->> 'email'), '');
  v_email_hash := public.hash_email(v_email);

  SELECT * INTO v_seat
  FROM public.license_seats
  WHERE invite_code = upper(p_invite_code)
  FOR UPDATE;

  IF v_seat.id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  SELECT * INTO v_pack
  FROM public.license_packages
  WHERE id = v_seat.package_id;

  IF v_pack.status <> 'active' OR v_pack.expires_at <= now() THEN
    RAISE EXCEPTION 'Package expired or inactive';
  END IF;

  IF v_seat.assigned_user_id IS NOT NULL THEN
    RAISE EXCEPTION 'Invite already claimed';
  END IF;

  IF v_seat.invite_expires_at IS NOT NULL AND v_seat.invite_expires_at <= now() THEN
    RAISE EXCEPTION 'Invite expired';
  END IF;

  IF v_seat.invite_email_hash IS NOT NULL AND v_seat.invite_email_hash <> v_email_hash THEN
    RAISE EXCEPTION 'Invite is bound to a different email';
  END IF;

  UPDATE public.license_seats
  SET assigned_user_id = v_user_id,
      assigned_at = now()
  WHERE id = v_seat.id;

  SELECT * INTO v_prod FROM public.store_products WHERE id = v_pack.product_id;

  INSERT INTO public.entitlements (
    user_id, seat_id, curriculum_id,
    has_learning_course, has_exam_trainer, has_ai_tutor, has_oral_trainer,
    valid_until
  )
  VALUES (
    v_user_id, v_seat.id, v_pack.curriculum_id,
    v_prod.includes_learning_course, v_prod.includes_exam_trainer,
    v_prod.includes_ai_tutor, v_prod.includes_oral_trainer,
    v_pack.expires_at
  );

  RETURN v_seat.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.claim_license_seat(text) TO authenticated;
