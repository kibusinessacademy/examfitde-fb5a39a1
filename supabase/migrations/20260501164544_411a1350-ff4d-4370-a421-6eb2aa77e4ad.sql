-- Fix: Bundle-Käufe → Grant pro distinct (curriculum_id, product_id) statt nur erstes Item
-- Behält idempotent-Verhalten von grant_learner_course_access bei.
CREATE OR REPLACE FUNCTION public.process_order_paid_fulfillment(p_order_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_first_curriculum_id UUID;
  v_first_product_id UUID;
  v_invoice_id UUID;
  v_invoice_existed BOOLEAN := false;
  v_invoice_number TEXT;
  v_payment_id UUID;
  v_payment_existed BOOLEAN := false;
  v_tax_rate NUMERIC(5,2) := 19.00;
  v_ledger_inserted INT := 0;
  v_grant_row RECORD;
  v_learner_user_id UUID;
BEGIN
  SELECT id, buyer_user_id, learner_user_id, billing_email, billing_name, billing_address,
         status, currency, country, subtotal_cents, tax_cents, total_cents,
         stripe_checkout_session_id, stripe_payment_intent_id,
         stripe_fee_cents, stripe_invoice_id, stripe_invoice_pdf_url, stripe_customer_id
    INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL OR v_order.status <> 'paid' THEN RETURN; END IF;

  v_learner_user_id := COALESCE(v_order.learner_user_id, v_order.buyer_user_id);

  -- ==========================================================================
  -- GRANTS: pro distinct (curriculum_id, product_id) aus order_items
  --   Fix für Bundle-Bug: vorher LIMIT 1 → nur erstes Item bekam Grant.
  --   grant_learner_course_access ist intern idempotent.
  -- ==========================================================================
  IF v_learner_user_id IS NOT NULL THEN
    FOR v_grant_row IN
      SELECT DISTINCT p.curriculum_id, p.id AS product_id
      FROM public.order_items oi
      JOIN public.products p ON p.id = oi.product_id
      WHERE oi.order_id = p_order_id
        AND p.curriculum_id IS NOT NULL
    LOOP
      PERFORM public.grant_learner_course_access(
        v_learner_user_id,
        v_grant_row.curriculum_id,
        v_grant_row.product_id,
        'order',
        v_order.id,
        jsonb_build_object('stripe_session', v_order.stripe_checkout_session_id,
                           'stripe_payment_intent', v_order.stripe_payment_intent_id)
      );
    END LOOP;
  END IF;

  -- Erstes (curriculum_id, product_id) für Legacy-Felder unten ggf. weiterverwenden
  SELECT p.curriculum_id, p.id INTO v_first_curriculum_id, v_first_product_id
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id AND p.curriculum_id IS NOT NULL
  ORDER BY oi.created_at ASC LIMIT 1;

  -- ==========================================================================
  -- INVOICE: granular — wenn fehlt, anlegen; wenn da, Stripe-Mirror nachziehen
  -- ==========================================================================
  SELECT id INTO v_invoice_id FROM public.invoices WHERE order_id = p_order_id LIMIT 1;
  v_invoice_existed := v_invoice_id IS NOT NULL;

  IF NOT v_invoice_existed THEN
    SELECT public.generate_invoice_number() INTO v_invoice_number;
    IF v_invoice_number IS NULL THEN
      v_invoice_number := 'EF-' || extract(epoch from now())::bigint::text;
    END IF;

    INSERT INTO public.invoices (
      order_id, invoice_number, issue_date, pdf_url, stripe_invoice_id,
      status, total_net_cents, total_tax_cents, total_gross_cents, tax_rate
    ) VALUES (
      v_order.id, v_invoice_number, CURRENT_DATE,
      v_order.stripe_invoice_pdf_url, v_order.stripe_invoice_id, 'paid',
      COALESCE(v_order.subtotal_cents, 0), COALESCE(v_order.tax_cents, 0),
      COALESCE(v_order.total_cents, 0), v_tax_rate
    )
    RETURNING id INTO v_invoice_id;
  ELSE
    UPDATE public.invoices
    SET pdf_url = COALESCE(pdf_url, v_order.stripe_invoice_pdf_url),
        stripe_invoice_id = COALESCE(stripe_invoice_id, v_order.stripe_invoice_id)
    WHERE id = v_invoice_id;
  END IF;

  -- ==========================================================================
  -- INVOICE_ITEMS / PAYMENTS / LEDGER: unverändert vom Original übernommen
  -- ==========================================================================
  -- Fall A: product_id IS NOT NULL
  INSERT INTO public.invoice_items (
    invoice_id, order_item_id, product_id, description, quantity,
    unit_amount_net_cents, unit_amount_gross_cents, tax_rate, tax_amount_cents
  )
  SELECT v_invoice_id, oi.id, oi.product_id, oi.description, oi.quantity,
         oi.unit_amount_net_cents, oi.unit_amount_gross_cents, oi.tax_rate, oi.tax_amount_cents
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
  ON CONFLICT (invoice_id, order_item_id) DO NOTHING;

  -- Fall B: product_id IS NULL (Custom-Items)
  INSERT INTO public.invoice_items (
    invoice_id, order_item_id, product_id, description, quantity,
    unit_amount_net_cents, unit_amount_gross_cents, tax_rate, tax_amount_cents
  )
  SELECT v_invoice_id, oi.id, NULL, oi.description, oi.quantity,
         oi.unit_amount_net_cents, oi.unit_amount_gross_cents, oi.tax_rate, oi.tax_amount_cents
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id AND oi.product_id IS NULL
  ON CONFLICT (invoice_id, order_item_id) DO NOTHING;

  -- ==========================================================================
  -- PAYMENT
  -- ==========================================================================
  SELECT id INTO v_payment_id FROM public.payments WHERE order_id = p_order_id LIMIT 1;
  v_payment_existed := v_payment_id IS NOT NULL;

  IF NOT v_payment_existed AND v_order.stripe_payment_intent_id IS NOT NULL THEN
    INSERT INTO public.payments (
      order_id, stripe_payment_intent_id, amount_cents, fee_cents,
      net_cents, currency, payment_status, paid_at
    ) VALUES (
      v_order.id, v_order.stripe_payment_intent_id,
      COALESCE(v_order.total_cents, 0), COALESCE(v_order.stripe_fee_cents, 0),
      COALESCE(v_order.total_cents, 0) - COALESCE(v_order.stripe_fee_cents, 0),
      COALESCE(v_order.currency, 'eur'), 'succeeded', now()
    )
    ON CONFLICT (stripe_payment_intent_id) DO NOTHING
    RETURNING id INTO v_payment_id;
    IF v_payment_id IS NULL THEN
      SELECT id INTO v_payment_id FROM public.payments WHERE order_id = p_order_id LIMIT 1;
    END IF;
  END IF;

  -- ==========================================================================
  -- LEDGER (idempotent via process_payment_to_ledger)
  -- ==========================================================================
  IF v_payment_id IS NOT NULL THEN
    BEGIN
      PERFORM public.process_payment_to_ledger(v_payment_id);
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING '[process_order_paid_fulfillment] ledger failed for payment %: %', v_payment_id, SQLERRM;
    END;
  END IF;
END $function$;