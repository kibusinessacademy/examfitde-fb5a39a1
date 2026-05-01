-- Smoke-Test-Helper: triggert process_order_paid_fulfillment manuell auf einer bestehenden Order.
-- Ermöglicht Synthetic-Smoke (psql nur SELECT/INSERT) UND ist ein Idempotenz-Re-Run-Tool.
-- service_role + admin only.

CREATE OR REPLACE FUNCTION public.admin_smoke_replay_order_fulfillment(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order orders%ROWTYPE;
  v_caller uuid;
  v_invoice_count int;
  v_grant_count int;
BEGIN
  v_caller := auth.uid();
  -- service_role bypass: auth.uid() ist NULL
  IF v_caller IS NOT NULL AND NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'admin role required';
  END IF;

  SELECT * INTO v_order FROM orders WHERE id = p_order_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order % not found', p_order_id;
  END IF;

  IF v_order.status <> 'paid' THEN
    -- Force flip to paid: löst regulären Trigger
    UPDATE orders SET status = 'paid' WHERE id = p_order_id;
  ELSE
    -- bereits paid: harmlose update um Trigger erneut zu feuern (Idempotenz-Test)
    UPDATE orders SET status = 'paid', updated_at = now() WHERE id = p_order_id;
  END IF;

  SELECT COUNT(*) INTO v_invoice_count FROM invoices WHERE order_id = p_order_id;
  SELECT COUNT(*) INTO v_grant_count
    FROM learner_course_grants
   WHERE user_id = v_order.buyer_user_id
     AND created_at > now() - interval '5 minutes';

  RETURN jsonb_build_object(
    'order_id', p_order_id,
    'replayed', true,
    'invoice_count', v_invoice_count,
    'recent_grant_count', v_grant_count
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_smoke_replay_order_fulfillment(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_smoke_replay_order_fulfillment(uuid) TO service_role;
