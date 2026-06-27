
-- 1) store_receipts lifecycle fields
ALTER TABLE public.store_receipts
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS status_reason text,
  ADD COLUMN IF NOT EXISTS last_store_event_id text,
  ADD COLUMN IF NOT EXISTS last_store_event_type text,
  ADD COLUMN IF NOT EXISTS last_store_event_at timestamptz,
  ADD COLUMN IF NOT EXISTS revoked_at timestamptz,
  ADD COLUMN IF NOT EXISTS refunded_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'store_receipts_status_check'
  ) THEN
    ALTER TABLE public.store_receipts
      ADD CONSTRAINT store_receipts_status_check
      CHECK (status IN ('active','expired','cancelled','refunded','revoked','pending','unknown'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS store_receipts_status_idx ON public.store_receipts(status);
CREATE INDEX IF NOT EXISTS store_receipts_last_event_at_idx ON public.store_receipts(last_store_event_at DESC);

-- 2) Append-only event log
CREATE TABLE IF NOT EXISTS public.store_receipt_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  platform text NOT NULL CHECK (platform IN ('ios','android')),
  store_event_id text NOT NULL,
  store_event_type text NOT NULL,
  normalized_event_type text NOT NULL,
  receipt_id uuid REFERENCES public.store_receipts(id) ON DELETE SET NULL,
  transaction_id text,
  purchase_token text,
  product_sku text,
  curriculum_id uuid,
  entitlement_id uuid,
  event_at timestamptz,
  processed_at timestamptz NOT NULL DEFAULT now(),
  processing_status text NOT NULL DEFAULT 'processed'
    CHECK (processing_status IN ('processed','ignored_stale','ignored_duplicate','unknown_receipt','unknown_sku','invalid_signature','unsupported_type','error')),
  error_code text,
  masked_payload_hash text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (platform, store_event_id)
);

CREATE INDEX IF NOT EXISTS store_receipt_events_receipt_idx ON public.store_receipt_events(receipt_id);
CREATE INDEX IF NOT EXISTS store_receipt_events_event_at_idx ON public.store_receipt_events(event_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS store_receipt_events_normalized_idx ON public.store_receipt_events(normalized_event_type);

GRANT SELECT ON public.store_receipt_events TO authenticated;
GRANT ALL ON public.store_receipt_events TO service_role;

ALTER TABLE public.store_receipt_events ENABLE ROW LEVEL SECURITY;

-- Admins read (uses has_role); service writes
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='store_receipt_events' AND policyname='store_receipt_events_admin_read') THEN
    CREATE POLICY store_receipt_events_admin_read ON public.store_receipt_events
      FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='store_receipt_events' AND policyname='store_receipt_events_service_all') THEN
    CREATE POLICY store_receipt_events_service_all ON public.store_receipt_events
      FOR ALL TO service_role USING (true) WITH CHECK (true);
  END IF;
END $$;

-- Append-only trigger: block UPDATE and DELETE
CREATE OR REPLACE FUNCTION public.fn_store_receipt_events_append_only()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'store_receipt_events is append-only';
END $$;

DROP TRIGGER IF EXISTS store_receipt_events_no_update ON public.store_receipt_events;
CREATE TRIGGER store_receipt_events_no_update
  BEFORE UPDATE OR DELETE ON public.store_receipt_events
  FOR EACH ROW EXECUTE FUNCTION public.fn_store_receipt_events_append_only();

-- 3) Lifecycle RPCs (SECURITY DEFINER, service-only callable)
CREATE OR REPLACE FUNCTION public.revoke_store_entitlement(
  p_receipt_id uuid,
  p_reason text,
  p_store_event_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entitlement_id uuid;
  v_now timestamptz := now();
BEGIN
  -- Restrict to service_role / edge functions
  IF current_setting('request.jwt.claim.role', true) NOT IN ('service_role') AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: service or admin only';
  END IF;

  SELECT entitlement_id INTO v_entitlement_id FROM public.store_receipts WHERE id = p_receipt_id;

  UPDATE public.store_receipts
     SET status = 'revoked',
         status_reason = COALESCE(p_reason, status_reason),
         revoked_at = v_now,
         last_store_event_id = COALESCE(p_store_event_id, last_store_event_id),
         last_store_event_at = v_now,
         updated_at = v_now
   WHERE id = p_receipt_id;

  IF v_entitlement_id IS NOT NULL THEN
    UPDATE public.entitlements
       SET status = 'revoked', updated_at = v_now
     WHERE id = v_entitlement_id AND status <> 'revoked';
  END IF;

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'entitlement_id', v_entitlement_id, 'action', 'revoke');
END $$;

CREATE OR REPLACE FUNCTION public.suspend_store_entitlement(
  p_receipt_id uuid,
  p_reason text,
  p_store_event_id text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entitlement_id uuid;
  v_now timestamptz := now();
BEGIN
  IF current_setting('request.jwt.claim.role', true) NOT IN ('service_role') AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: service or admin only';
  END IF;

  SELECT entitlement_id INTO v_entitlement_id FROM public.store_receipts WHERE id = p_receipt_id;

  UPDATE public.store_receipts
     SET status = 'expired',
         status_reason = COALESCE(p_reason, status_reason),
         last_store_event_id = COALESCE(p_store_event_id, last_store_event_id),
         last_store_event_at = v_now,
         updated_at = v_now
   WHERE id = p_receipt_id;

  IF v_entitlement_id IS NOT NULL THEN
    UPDATE public.entitlements
       SET status = 'expired', updated_at = v_now
     WHERE id = v_entitlement_id AND status NOT IN ('revoked','expired');
  END IF;

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'entitlement_id', v_entitlement_id, 'action', 'suspend');
END $$;

CREATE OR REPLACE FUNCTION public.restore_store_entitlement(
  p_receipt_id uuid,
  p_reason text,
  p_store_event_id text,
  p_new_expires_at timestamptz DEFAULT NULL
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_entitlement_id uuid;
  v_now timestamptz := now();
BEGIN
  IF current_setting('request.jwt.claim.role', true) NOT IN ('service_role') AND NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'forbidden: service or admin only';
  END IF;

  SELECT entitlement_id INTO v_entitlement_id FROM public.store_receipts WHERE id = p_receipt_id;

  UPDATE public.store_receipts
     SET status = 'active',
         status_reason = COALESCE(p_reason, status_reason),
         expires_at = COALESCE(p_new_expires_at, expires_at),
         last_store_event_id = COALESCE(p_store_event_id, last_store_event_id),
         last_store_event_at = v_now,
         updated_at = v_now
   WHERE id = p_receipt_id AND status <> 'revoked';

  IF v_entitlement_id IS NOT NULL THEN
    UPDATE public.entitlements
       SET status = 'active',
           valid_until = COALESCE(p_new_expires_at, valid_until),
           updated_at = v_now
     WHERE id = v_entitlement_id AND status <> 'revoked';
  END IF;

  RETURN jsonb_build_object('receipt_id', p_receipt_id, 'entitlement_id', v_entitlement_id, 'action', 'restore');
END $$;

REVOKE ALL ON FUNCTION public.revoke_store_entitlement(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.suspend_store_entitlement(uuid, text, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.restore_store_entitlement(uuid, text, text, timestamptz) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_store_entitlement(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.suspend_store_entitlement(uuid, text, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.restore_store_entitlement(uuid, text, text, timestamptz) TO service_role;
