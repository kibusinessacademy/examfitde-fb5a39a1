-- ============================================================================
-- SSOT-Trigger Hardening: granulare Idempotenz + deterministische ON CONFLICT
-- ============================================================================
-- Fixes:
--  1) Granulares Self-Healing: invoice/payment/ledger werden unabhängig geprüft
--  2) Explizite ON CONFLICT-Targets statt blind DO NOTHING
--  3) Stabile UNIQUE-Constraints (kein COALESCE-Hack mehr)
--  4) Trigger-Transition war bereits korrekt (kein Re-Fire bei paid->paid)
-- ============================================================================

-- ----------------------------------------------------------------------------
-- 1. invoice_items: stabile UNIQUE-Indexe (kein COALESCE-Workaround)
-- ----------------------------------------------------------------------------
DROP INDEX IF EXISTS public.invoice_items_invoice_product_uidx;

CREATE UNIQUE INDEX IF NOT EXISTS invoice_items_invoice_product_uidx
  ON public.invoice_items (invoice_id, product_id)
  WHERE product_id IS NOT NULL;

-- Fallback für NULL-product_id: dedupliziere per description
CREATE UNIQUE INDEX IF NOT EXISTS invoice_items_invoice_desc_null_uidx
  ON public.invoice_items (invoice_id, description)
  WHERE product_id IS NULL;

-- ----------------------------------------------------------------------------
-- 2. payments: UNIQUE auf (order_id, stripe_payment_intent_id)
--    payments.stripe_event_id_key bleibt für webhook-event-dedup
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS payments_order_pi_uidx
  ON public.payments (order_id, stripe_payment_intent_id)
  WHERE stripe_payment_intent_id IS NOT NULL;

-- Falls payment_intent NULL: nur EIN payment pro order erlauben
CREATE UNIQUE INDEX IF NOT EXISTS payments_order_null_pi_uidx
  ON public.payments (order_id)
  WHERE stripe_payment_intent_id IS NULL;

-- ----------------------------------------------------------------------------
-- 3. ledger_entries: deterministisches Dedup-Ziel
--    (event_type, order_id, account) — eine Buchungszeile pro Konto je Order
-- ----------------------------------------------------------------------------
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_order_account_uidx
  ON public.ledger_entries (event_type, order_id, account)
  WHERE order_id IS NOT NULL;

-- ----------------------------------------------------------------------------
-- 4. process_order_paid_fulfillment: granulares Self-Healing
-- ----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.process_order_paid_fulfillment(p_order_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_order RECORD;
  v_curriculum_id UUID;
  v_product_id UUID;
  v_invoice_id UUID;
  v_invoice_existed BOOLEAN := false;
  v_invoice_number TEXT;
  v_payment_id UUID;
  v_payment_existed BOOLEAN := false;
  v_tax_rate NUMERIC(5,2) := 19.00;
  v_ledger_inserted INT := 0;
BEGIN
  SELECT id, buyer_user_id, learner_user_id, billing_email, billing_name, billing_address,
         status, currency, country, subtotal_cents, tax_cents, total_cents,
         stripe_checkout_session_id, stripe_payment_intent_id,
         stripe_fee_cents, stripe_invoice_id, stripe_invoice_pdf_url, stripe_customer_id
    INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL OR v_order.status <> 'paid' THEN RETURN; END IF;

  -- Curriculum/Product aus order_items ableiten
  SELECT p.curriculum_id, p.id INTO v_curriculum_id, v_product_id
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id AND p.curriculum_id IS NOT NULL
  ORDER BY oi.created_at ASC LIMIT 1;

  -- Grant: idempotent in grant_learner_course_access selbst
  IF v_curriculum_id IS NOT NULL AND COALESCE(v_order.learner_user_id, v_order.buyer_user_id) IS NOT NULL THEN
    PERFORM public.grant_learner_course_access(
      COALESCE(v_order.learner_user_id, v_order.buyer_user_id),
      v_curriculum_id, v_product_id, 'order', v_order.id,
      jsonb_build_object('stripe_session', v_order.stripe_checkout_session_id,
                         'stripe_payment_intent', v_order.stripe_payment_intent_id)
    );
  END IF;

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
    -- Stripe-Daten nachziehen (nur befüllen, nicht überschreiben)
    UPDATE public.invoices
    SET pdf_url = COALESCE(pdf_url, v_order.stripe_invoice_pdf_url),
        stripe_invoice_id = COALESCE(stripe_invoice_id, v_order.stripe_invoice_id)
    WHERE id = v_invoice_id;
  END IF;

  -- ==========================================================================
  -- INVOICE_ITEMS: granular pro order_item — deterministisches Conflict-Target
  -- ==========================================================================
  -- Fall A: product_id IS NOT NULL
  INSERT INTO public.invoice_items (
    invoice_id, order_id, product_id, description, quantity,
    unit_price_cents, tax_rate, tax_amount_cents, total_cents
  )
  SELECT v_invoice_id, oi.order_id, oi.product_id, oi.description, oi.quantity,
         oi.unit_amount_gross_cents, oi.tax_rate, oi.tax_amount_cents,
         oi.unit_amount_gross_cents * oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id AND oi.product_id IS NOT NULL
  ON CONFLICT (invoice_id, product_id) WHERE product_id IS NOT NULL DO NOTHING;

  -- Fall B: product_id IS NULL (Fallback dedupe per description)
  INSERT INTO public.invoice_items (
    invoice_id, order_id, product_id, description, quantity,
    unit_price_cents, tax_rate, tax_amount_cents, total_cents
  )
  SELECT v_invoice_id, oi.order_id, NULL, oi.description, oi.quantity,
         oi.unit_amount_gross_cents, oi.tax_rate, oi.tax_amount_cents,
         oi.unit_amount_gross_cents * oi.quantity
  FROM public.order_items oi
  WHERE oi.order_id = p_order_id AND oi.product_id IS NULL
  ON CONFLICT (invoice_id, description) WHERE product_id IS NULL DO NOTHING;

  -- ==========================================================================
  -- PAYMENT: granular — explizites Conflict-Target
  -- ==========================================================================
  SELECT id INTO v_payment_id
  FROM public.payments
  WHERE order_id = p_order_id
    AND COALESCE(stripe_payment_intent_id, '') = COALESCE(v_order.stripe_payment_intent_id, '')
  LIMIT 1;
  v_payment_existed := v_payment_id IS NOT NULL;

  IF NOT v_payment_existed THEN
    IF v_order.stripe_payment_intent_id IS NOT NULL THEN
      INSERT INTO public.payments (
        order_id, stripe_payment_intent_id, amount_cents, fee_cents, net_cents,
        currency, payment_status, paid_at
      ) VALUES (
        v_order.id, v_order.stripe_payment_intent_id,
        COALESCE(v_order.total_cents, 0),
        COALESCE(v_order.stripe_fee_cents, 0),
        COALESCE(v_order.total_cents, 0) - COALESCE(v_order.stripe_fee_cents, 0),
        COALESCE(v_order.currency, 'eur'), 'succeeded', now()
      )
      ON CONFLICT (order_id, stripe_payment_intent_id) WHERE stripe_payment_intent_id IS NOT NULL
      DO NOTHING
      RETURNING id INTO v_payment_id;
    ELSE
      INSERT INTO public.payments (
        order_id, stripe_payment_intent_id, amount_cents, fee_cents, net_cents,
        currency, payment_status, paid_at
      ) VALUES (
        v_order.id, NULL,
        COALESCE(v_order.total_cents, 0),
        COALESCE(v_order.stripe_fee_cents, 0),
        COALESCE(v_order.total_cents, 0) - COALESCE(v_order.stripe_fee_cents, 0),
        COALESCE(v_order.currency, 'eur'), 'succeeded', now()
      )
      ON CONFLICT (order_id) WHERE stripe_payment_intent_id IS NULL
      DO NOTHING
      RETURNING id INTO v_payment_id;
    END IF;

    -- Falls ON CONFLICT gegriffen hat: payment_id nachladen
    IF v_payment_id IS NULL THEN
      SELECT id INTO v_payment_id FROM public.payments
      WHERE order_id = p_order_id
        AND COALESCE(stripe_payment_intent_id, '') = COALESCE(v_order.stripe_payment_intent_id, '')
      LIMIT 1;
    END IF;
  ELSE
    -- Fee nachträglich aktualisieren falls leer und jetzt verfügbar
    UPDATE public.payments
    SET fee_cents = COALESCE(NULLIF(fee_cents, 0), v_order.stripe_fee_cents, 0),
        net_cents = COALESCE(amount_cents, 0) - COALESCE(NULLIF(fee_cents, 0), v_order.stripe_fee_cents, 0)
    WHERE id = v_payment_id
      AND (fee_cents = 0 OR fee_cents IS NULL)
      AND COALESCE(v_order.stripe_fee_cents, 0) > 0;
  END IF;

  -- ==========================================================================
  -- LEDGER: granular — pro (event_type, order_id, account) deterministisch
  -- ==========================================================================
  INSERT INTO public.ledger_entries (
    event_type, order_id, payment_id, invoice_id, account, amount_cents, currency,
    tax_rate, country, description, stripe_event_id
  ) VALUES
    ('sale', v_order.id, v_payment_id, v_invoice_id, 'revenue',
     COALESCE(v_order.subtotal_cents, 0), COALESCE(v_order.currency, 'eur'),
     v_tax_rate, COALESCE(v_order.country, 'DE'),
     'Order ' || v_order.id::text, NULL)
  ON CONFLICT (event_type, order_id, account) WHERE order_id IS NOT NULL DO NOTHING;
  GET DIAGNOSTICS v_ledger_inserted = ROW_COUNT;

  INSERT INTO public.ledger_entries (
    event_type, order_id, payment_id, invoice_id, account, amount_cents, currency,
    tax_rate, country, description, stripe_event_id
  ) VALUES
    ('sale', v_order.id, v_payment_id, v_invoice_id, 'tax_payable',
     COALESCE(v_order.tax_cents, 0), COALESCE(v_order.currency, 'eur'),
     v_tax_rate, COALESCE(v_order.country, 'DE'),
     'VAT for order ' || v_order.id::text, NULL)
  ON CONFLICT (event_type, order_id, account) WHERE order_id IS NOT NULL DO NOTHING;

  IF COALESCE(v_order.stripe_fee_cents, 0) > 0 THEN
    INSERT INTO public.ledger_entries (
      event_type, order_id, payment_id, invoice_id, account, amount_cents, currency,
      tax_rate, country, description, stripe_event_id
    ) VALUES (
      'fee', v_order.id, v_payment_id, NULL, 'stripe_fees',
      -v_order.stripe_fee_cents, COALESCE(v_order.currency, 'eur'),
      0, COALESCE(v_order.country, 'DE'),
      'Stripe fee for order ' || v_order.id::text, NULL
    )
    ON CONFLICT (event_type, order_id, account) WHERE order_id IS NOT NULL DO NOTHING;
  END IF;

  -- CRM (best-effort)
  BEGIN
    INSERT INTO public.crm_activities(contact_id, activity_type, subject, body)
    SELECT c.id, 'order_fulfilled', 'Order fulfilled & enrolled',
           'Order ' || v_order.id::text || ' paid; learner enrolled in curriculum ' || COALESCE(v_curriculum_id::text, 'n/a')
    FROM public.crm_contacts c
    WHERE LOWER(c.email) = LOWER(COALESCE(v_order.billing_email, '')) LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Audit (mit Self-Heal-Telemetrie)
  BEGIN
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    VALUES ('order_paid_fulfillment_v4', 'order', v_order.id, 'success',
            jsonb_build_object(
              'order_id', v_order.id,
              'curriculum_id', v_curriculum_id,
              'product_id', v_product_id,
              'invoice_existed', v_invoice_existed,
              'payment_existed', v_payment_existed,
              'invoice_id', v_invoice_id,
              'payment_id', v_payment_id,
              'has_stripe_pdf', v_order.stripe_invoice_pdf_url IS NOT NULL,
              'has_stripe_fee', COALESCE(v_order.stripe_fee_cents, 0) > 0
            ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $function$;