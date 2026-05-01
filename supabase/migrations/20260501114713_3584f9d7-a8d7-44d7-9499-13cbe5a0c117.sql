-- =====================================================================
-- Phase 1 / Loop A: User-Backend-Foundation
-- - gdpr_deletion_requests (Art. 17)
-- - get_user_account_summary RPC (SSOT für /app/dashboard)
-- - fn_revoke_grant_on_refund Helper (für Stripe-Webhook in Loop B)
-- =====================================================================

-- 1) GDPR Deletion Requests (Art. 17 DSGVO)
CREATE TABLE IF NOT EXISTS public.gdpr_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_deletion_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','cancelled','completed','rejected')),
  reason text,
  confirmation_token text UNIQUE DEFAULT encode(gen_random_bytes(24),'hex'),
  confirmed_at timestamptz,
  cancelled_at timestamptz,
  completed_at timestamptz,
  rejection_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS uniq_gdpr_deletion_pending_per_user
  ON public.gdpr_deletion_requests (user_id) WHERE status IN ('pending','confirmed');

CREATE INDEX IF NOT EXISTS idx_gdpr_deletion_status ON public.gdpr_deletion_requests (status);
CREATE INDEX IF NOT EXISTS idx_gdpr_deletion_scheduled ON public.gdpr_deletion_requests (scheduled_deletion_at) WHERE status='confirmed';

ALTER TABLE public.gdpr_deletion_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view own deletion requests" ON public.gdpr_deletion_requests;
CREATE POLICY "Users can view own deletion requests"
  ON public.gdpr_deletion_requests FOR SELECT
  TO authenticated USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can create own deletion request" ON public.gdpr_deletion_requests;
CREATE POLICY "Users can create own deletion request"
  ON public.gdpr_deletion_requests FOR INSERT
  TO authenticated WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can cancel own pending deletion" ON public.gdpr_deletion_requests;
CREATE POLICY "Users can cancel own pending deletion"
  ON public.gdpr_deletion_requests FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id AND status IN ('pending','confirmed'))
  WITH CHECK (auth.uid() = user_id AND status IN ('pending','confirmed','cancelled'));

DROP POLICY IF EXISTS "Admins manage deletion requests" ON public.gdpr_deletion_requests;
CREATE POLICY "Admins manage deletion requests"
  ON public.gdpr_deletion_requests FOR ALL
  TO authenticated
  USING (public.has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- updated_at trigger
DROP TRIGGER IF EXISTS trg_gdpr_deletion_requests_updated_at ON public.gdpr_deletion_requests;
CREATE TRIGGER trg_gdpr_deletion_requests_updated_at
  BEFORE UPDATE ON public.gdpr_deletion_requests
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();


-- 2) SSOT Read-RPC für /app/dashboard
-- Liefert in einem Call: aktive Kurse, letzte Rechnung, aktive Lizenzen, offene DSGVO-Requests
CREATE OR REPLACE FUNCTION public.get_user_account_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '28000';
  END IF;

  SELECT jsonb_build_object(
    'user_id', v_user_id,
    'active_courses', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'grant_id', g.id,
        'curriculum_id', g.curriculum_id,
        'product_id', g.product_id,
        'package_id', cp.id,
        'package_title', cp.title,
        'package_slug', cp.canonical_slug,
        'status', g.status,
        'onboarding_status', g.onboarding_status,
        'granted_at', g.granted_at,
        'activated_at', g.activated_at
      ) ORDER BY g.granted_at DESC)
      FROM learner_course_grants g
      LEFT JOIN course_packages cp ON cp.curriculum_id = g.curriculum_id AND cp.status='published'
      WHERE g.user_id = v_user_id AND g.status IN ('active','granted')
    ), '[]'::jsonb),
    'invoice_count', (SELECT COUNT(*) FROM invoices i JOIN orders o ON o.id=i.order_id WHERE o.buyer_user_id = v_user_id),
    'latest_invoice', (
      SELECT jsonb_build_object(
        'id', i.id,
        'invoice_number', i.invoice_number,
        'issue_date', i.issue_date,
        'total_gross_cents', i.total_gross_cents,
        'pdf_url', i.pdf_url,
        'status', i.status
      )
      FROM invoices i JOIN orders o ON o.id=i.order_id
      WHERE o.buyer_user_id = v_user_id
      ORDER BY i.issue_date DESC NULLS LAST, i.created_at DESC
      LIMIT 1
    ),
    'license_packages_owned', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'package_id', lp.id,
        'product_id', lp.product_id,
        'quantity', lp.quantity,
        'seats_assigned', (SELECT COUNT(*) FROM license_seats s WHERE s.package_id=lp.id AND s.assigned_user_id IS NOT NULL),
        'purchased_at', lp.purchased_at,
        'expires_at', lp.expires_at,
        'status', lp.status,
        'stripe_invoice_url', lp.stripe_invoice_url
      ) ORDER BY lp.purchased_at DESC)
      FROM license_packages lp
      WHERE lp.buyer_user_id = v_user_id
    ), '[]'::jsonb),
    'pending_gdpr_request', (
      SELECT jsonb_build_object(
        'id', r.id,
        'status', r.status,
        'requested_at', r.requested_at,
        'scheduled_deletion_at', r.scheduled_deletion_at
      )
      FROM gdpr_deletion_requests r
      WHERE r.user_id = v_user_id AND r.status IN ('pending','confirmed')
      ORDER BY r.requested_at DESC
      LIMIT 1
    )
  ) INTO v_result;

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_account_summary() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_user_account_summary() TO authenticated;


-- 3) Refund Helper für Loop B Stripe-Webhook
-- Idempotent: revoked Grants bleiben revoked
CREATE OR REPLACE FUNCTION public.fn_revoke_grant_on_refund(
  p_stripe_payment_intent_id text,
  p_refund_id text,
  p_reason text DEFAULT 'stripe_refund'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order_id uuid;
  v_buyer_user_id uuid;
  v_revoked_grants int := 0;
  v_revoked_entitlements int := 0;
BEGIN
  IF p_stripe_payment_intent_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'missing_payment_intent');
  END IF;

  -- Find the order
  SELECT id, buyer_user_id INTO v_order_id, v_buyer_user_id
  FROM orders
  WHERE stripe_payment_intent_id = p_stripe_payment_intent_id
  LIMIT 1;

  IF v_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'order_not_found', 'pi', p_stripe_payment_intent_id);
  END IF;

  -- Revoke grants (idempotent)
  WITH upd AS (
    UPDATE learner_course_grants
    SET status = 'refunded',
        metadata = COALESCE(metadata,'{}'::jsonb) || jsonb_build_object(
          'refund_id', p_refund_id,
          'refunded_at', now(),
          'refund_reason', p_reason
        ),
        updated_at = now()
    WHERE order_id = v_order_id AND status NOT IN ('refunded','revoked')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_revoked_grants FROM upd;

  -- Set entitlement valid_until to now (soft revoke; preserves history)
  WITH upd2 AS (
    UPDATE entitlements
    SET valid_until = LEAST(COALESCE(valid_until, now()), now()),
        metadata_json = COALESCE(metadata_json,'{}'::jsonb) || jsonb_build_object(
          'refund_id', p_refund_id,
          'refunded_at', now()
        )
    WHERE source_ref = v_order_id::text
      AND (valid_until IS NULL OR valid_until > now())
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_revoked_entitlements FROM upd2;

  -- Audit
  INSERT INTO admin_actions(action, scope, payload, affected_ids)
  VALUES (
    'gdpr_or_refund.grant_revoked_on_refund',
    'order',
    jsonb_build_object(
      'order_id', v_order_id,
      'buyer_user_id', v_buyer_user_id,
      'stripe_payment_intent_id', p_stripe_payment_intent_id,
      'refund_id', p_refund_id,
      'reason', p_reason,
      'revoked_grants', v_revoked_grants,
      'revoked_entitlements', v_revoked_entitlements
    ),
    ARRAY[v_order_id]
  );

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'revoked_grants', v_revoked_grants,
    'revoked_entitlements', v_revoked_entitlements
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_revoke_grant_on_refund(text, text, text) FROM PUBLIC, anon, authenticated;
-- service_role only (called by Stripe webhook edge function)


-- 4) Helper: User-eigene DSGVO-Request erstellen (atomic, einzigartig pro user)
CREATE OR REPLACE FUNCTION public.request_gdpr_deletion(p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_existing uuid;
  v_new_id uuid;
  v_token text;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '28000';
  END IF;

  SELECT id INTO v_existing
  FROM gdpr_deletion_requests
  WHERE user_id = v_user_id AND status IN ('pending','confirmed')
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'request_id', v_existing, 'already_pending', true);
  END IF;

  INSERT INTO gdpr_deletion_requests(user_id, reason)
  VALUES (v_user_id, p_reason)
  RETURNING id, confirmation_token INTO v_new_id, v_token;

  INSERT INTO admin_actions(user_id, action, scope, payload, affected_ids)
  VALUES (
    v_user_id,
    'gdpr.deletion_requested',
    'user',
    jsonb_build_object('request_id', v_new_id, 'reason', p_reason),
    ARRAY[v_new_id]
  );

  RETURN jsonb_build_object('ok', true, 'request_id', v_new_id, 'confirmation_token', v_token);
END;
$$;

REVOKE ALL ON FUNCTION public.request_gdpr_deletion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_gdpr_deletion(text) TO authenticated;


-- 5) Helper: User cancelt eigene Anfrage
CREATE OR REPLACE FUNCTION public.cancel_gdpr_deletion(p_request_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid := auth.uid();
  v_updated int;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'auth required' USING ERRCODE = '28000';
  END IF;

  WITH upd AS (
    UPDATE gdpr_deletion_requests
    SET status='cancelled', cancelled_at=now()
    WHERE id = p_request_id
      AND user_id = v_user_id
      AND status IN ('pending','confirmed')
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_updated FROM upd;

  IF v_updated > 0 THEN
    INSERT INTO admin_actions(user_id, action, scope, payload, affected_ids)
    VALUES (v_user_id, 'gdpr.deletion_cancelled', 'user',
            jsonb_build_object('request_id', p_request_id), ARRAY[p_request_id]);
  END IF;

  RETURN jsonb_build_object('ok', v_updated > 0);
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_gdpr_deletion(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cancel_gdpr_deletion(uuid) TO authenticated;