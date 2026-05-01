-- Loop B Step 1: Idempotency anchors for Stripe webhook (no new tables)
-- 1) UNIQUE on invoices.stripe_invoice_id → enables upsert on invoice.paid
CREATE UNIQUE INDEX IF NOT EXISTS invoices_stripe_invoice_id_uidx
  ON public.invoices (stripe_invoice_id)
  WHERE stripe_invoice_id IS NOT NULL;

-- 2) UNIQUE on ledger_entries (stripe_event_id, account, event_type) → idempotent refund inserts
--    (sale entries already use composite suffixes like '_tax', '_rev'; refund will use same pattern)
CREATE UNIQUE INDEX IF NOT EXISTS ledger_entries_event_account_uidx
  ON public.ledger_entries (stripe_event_id, account, event_type)
  WHERE stripe_event_id IS NOT NULL;

-- 3) Index on invoice_items.invoice_id already exists; add UNIQUE on (invoice_id, product_id) for upsert
--    Drop first if exists with diff signature, then create
CREATE UNIQUE INDEX IF NOT EXISTS invoice_items_invoice_product_uidx
  ON public.invoice_items (invoice_id, COALESCE(product_id, '00000000-0000-0000-0000-000000000000'::uuid));