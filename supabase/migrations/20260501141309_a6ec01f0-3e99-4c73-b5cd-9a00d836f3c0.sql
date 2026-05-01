-- 1) orders: 4 nullable Stripe-Felder
ALTER TABLE public.orders
  ADD COLUMN IF NOT EXISTS stripe_fee_cents integer,
  ADD COLUMN IF NOT EXISTS stripe_invoice_id text,
  ADD COLUMN IF NOT EXISTS stripe_invoice_pdf_url text,
  ADD COLUMN IF NOT EXISTS stripe_customer_id text;

CREATE UNIQUE INDEX IF NOT EXISTS orders_stripe_invoice_id_uidx
  ON public.orders (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

-- 2) process_order_paid_fulfillment: erweitern um invoice/items/payment/ledger
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
  v_existing_invoice_id UUID;
  v_invoice_id UUID;
  v_invoice_number TEXT;
  v_payment_id UUID;
  v_tax_rate NUMERIC(5,2) := 19.00;
BEGIN
  SELECT id, buyer_user_id, learner_user_id, billing_email, billing_name, billing_address,
         status, currency, country, subtotal_cents, tax_cents, total_cents,
         stripe_checkout_session_id, stripe_payment_intent_id,
         stripe_fee_cents, stripe_invoice_id, stripe_invoice_pdf_url, stripe_customer_id
    INTO v_order FROM public.orders WHERE id = p_order_id;
  IF v_order IS NULL OR v_order.status <> 'paid' THEN RETURN; END IF;

  -- Resolve product/curriculum from first order_item (FK on products)
  SELECT p.curriculum_id, p.id INTO v_curriculum_id, v_product_id
  FROM public.order_items oi
  JOIN public.products p ON p.id = oi.product_id
  WHERE oi.order_id = p_order_id AND p.curriculum_id IS NOT NULL
  ORDER BY oi.created_at ASC LIMIT 1;

  -- Loop C Bridge: grant access (idempotent)
  IF v_curriculum_id IS NOT NULL AND COALESCE(v_order.learner_user_id, v_order.buyer_user_id) IS NOT NULL THEN
    PERFORM public.grant_learner_course_access(
      COALESCE(v_order.learner_user_id, v_order.buyer_user_id),
      v_curriculum_id, v_product_id, 'order', v_order.id,
      jsonb_build_object('stripe_session', v_order.stripe_checkout_session_id,
                         'stripe_payment_intent', v_order.stripe_payment_intent_id)
    );
  END IF;

  -- Idempotency: skip invoice/payment/ledger if invoice already exists for this order
  SELECT id INTO v_existing_invoice_id FROM public.invoices WHERE order_id = p_order_id LIMIT 1;
  IF v_existing_invoice_id IS NOT NULL THEN
    -- Backfill PDF URL + stripe_invoice_id if not yet set and now available
    UPDATE public.invoices
    SET pdf_url = COALESCE(pdf_url, v_order.stripe_invoice_pdf_url),
        stripe_invoice_id = COALESCE(stripe_invoice_id, v_order.stripe_invoice_id)
    WHERE id = v_existing_invoice_id;
    -- still try CRM activity
  ELSE
    -- Create invoice
    SELECT public.generate_invoice_number() INTO v_invoice_number;
    IF v_invoice_number IS NULL THEN
      v_invoice_number := 'EF-' || extract(epoch from now())::bigint::text;
    END IF;

    INSERT INTO public.invoices (
      order_id, invoice_number, issue_date, pdf_url, stripe_invoice_id,
      status, total_net_cents, total_tax_cents, total_gross_cents, tax_rate
    ) VALUES (
      v_order.id, v_invoice_number, CURRENT_DATE,
      v_order.stripe_invoice_pdf_url, v_order.stripe_invoice_id,
      'paid',
      COALESCE(v_order.subtotal_cents, 0),
      COALESCE(v_order.tax_cents, 0),
      COALESCE(v_order.total_cents, 0),
      v_tax_rate
    )
    RETURNING id INTO v_invoice_id;

    -- Mirror order_items into invoice_items
    INSERT INTO public.invoice_items (
      invoice_id, order_id, product_id, description, quantity,
      unit_price_cents, tax_rate, tax_amount_cents, total_cents
    )
    SELECT v_invoice_id, oi.order_id, oi.product_id,
           oi.description, oi.quantity,
           oi.unit_amount_gross_cents, oi.tax_rate,
           oi.tax_amount_cents,
           oi.unit_amount_gross_cents * oi.quantity
    FROM public.order_items oi
    WHERE oi.order_id = p_order_id
    ON CONFLICT (invoice_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid)) DO NOTHING;

    -- Payment row (idempotent via UNIQUE on stripe_payment_intent_id if any)
    INSERT INTO public.payments (
      order_id, stripe_payment_intent_id, amount_cents, fee_cents, net_cents,
      currency, payment_status, paid_at
    ) VALUES (
      v_order.id, v_order.stripe_payment_intent_id,
      COALESCE(v_order.total_cents, 0),
      COALESCE(v_order.stripe_fee_cents, 0),
      COALESCE(v_order.total_cents, 0) - COALESCE(v_order.stripe_fee_cents, 0),
      COALESCE(v_order.currency, 'eur'),
      'succeeded', now()
    )
    ON CONFLICT DO NOTHING
    RETURNING id INTO v_payment_id;

    -- Ledger: revenue + tax (+ fee if any)
    INSERT INTO public.ledger_entries (
      event_type, order_id, payment_id, invoice_id, account, amount_cents, currency,
      tax_rate, country, description, stripe_event_id
    ) VALUES
      ('sale', v_order.id, v_payment_id, v_invoice_id, 'revenue',
       COALESCE(v_order.subtotal_cents, 0), COALESCE(v_order.currency, 'eur'),
       v_tax_rate, COALESCE(v_order.country, 'DE'),
       'Order ' || v_order.id::text, NULL),
      ('sale', v_order.id, v_payment_id, v_invoice_id, 'tax',
       COALESCE(v_order.tax_cents, 0), COALESCE(v_order.currency, 'eur'),
       v_tax_rate, COALESCE(v_order.country, 'DE'),
       'VAT for order ' || v_order.id::text, NULL)
    ON CONFLICT DO NOTHING;

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
      ON CONFLICT DO NOTHING;
    END IF;
  END IF;

  -- CRM activity (best-effort)
  BEGIN
    INSERT INTO public.crm_activities(contact_id, activity_type, subject, body)
    SELECT c.id, 'order_fulfilled', 'Order fulfilled & enrolled',
           'Order ' || v_order.id::text || ' paid; learner enrolled in curriculum ' || COALESCE(v_curriculum_id::text, 'n/a')
    FROM public.crm_contacts c
    WHERE LOWER(c.email) = LOWER(COALESCE(v_order.billing_email, '')) LIMIT 1;
  EXCEPTION WHEN OTHERS THEN NULL;
  END;

  -- Audit
  BEGIN
    INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
    VALUES ('order_paid_fulfillment_v3', 'order', v_order.id, 'success',
            jsonb_build_object(
              'order_id', v_order.id,
              'curriculum_id', v_curriculum_id,
              'product_id', v_product_id,
              'invoice_existed', v_existing_invoice_id IS NOT NULL,
              'new_invoice_id', v_invoice_id,
              'has_stripe_pdf', v_order.stripe_invoice_pdf_url IS NOT NULL
            ));
  EXCEPTION WHEN OTHERS THEN NULL;
  END;
END $function$;