-- Currency-Heal
UPDATE public.product_prices SET currency = lower(currency) WHERE currency <> lower(currency);

-- Lookup-Tabelle
CREATE TABLE IF NOT EXISTS public.pricing_tier_stripe_map (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  billing_type TEXT NOT NULL DEFAULT 'one_time',
  stripe_price_id TEXT NOT NULL,
  stripe_product_id TEXT NOT NULL,
  tier_label TEXT NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT pricing_tier_stripe_map_currency_lower_chk CHECK (currency = lower(currency)),
  CONSTRAINT pricing_tier_stripe_map_unique_tier UNIQUE (amount_cents, currency, billing_type)
);
ALTER TABLE public.pricing_tier_stripe_map ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS pricing_tier_stripe_map_admin_select ON public.pricing_tier_stripe_map;
CREATE POLICY pricing_tier_stripe_map_admin_select ON public.pricing_tier_stripe_map
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON public.pricing_tier_stripe_map FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.pricing_tier_stripe_map TO authenticated;

INSERT INTO public.pricing_tier_stripe_map
  (amount_cents, currency, billing_type, stripe_price_id, stripe_product_id, tier_label, notes)
VALUES
  (2490, 'eur', 'one_time', 'price_1TKgFDDxqdaWCpJ6cquKeCog', 'prod_UJIqaKAx185ofq',
   'Bundle 24,90€', 'Bundle-only SSOT (src/config/pricing.ts BUNDLE_STRIPE_PRICE_ID)')
ON CONFLICT (amount_cents, currency, billing_type) DO NOTHING;

-- Audit-Tabelle
CREATE TABLE IF NOT EXISTS public.stripe_price_sync_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  product_price_id UUID NOT NULL,
  action TEXT NOT NULL,
  before_stripe_price_id TEXT,
  after_stripe_price_id TEXT,
  amount_cents INTEGER,
  currency TEXT,
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  triggered_by UUID,
  trigger_source TEXT NOT NULL DEFAULT 'admin_rpc',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.stripe_price_sync_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS stripe_price_sync_audit_admin_select ON public.stripe_price_sync_audit;
CREATE POLICY stripe_price_sync_audit_admin_select ON public.stripe_price_sync_audit
  FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));
REVOKE ALL ON public.stripe_price_sync_audit FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.stripe_price_sync_audit TO authenticated;
CREATE INDEX IF NOT EXISTS idx_stripe_price_sync_audit_price_id
  ON public.stripe_price_sync_audit(product_price_id, created_at DESC);

-- Preview-View
CREATE OR REPLACE VIEW public.v_stripe_price_sync_preview AS
SELECT
  pp.id AS product_price_id,
  pp.product_id,
  pr.title AS product_title,
  pp.amount_cents,
  pp.currency,
  pp.billing_type,
  pp.access_months,
  pp.stripe_price_id AS current_stripe_price_id,
  m.stripe_price_id AS suggested_stripe_price_id,
  m.tier_label AS suggested_tier_label,
  CASE
    WHEN pp.stripe_price_id IS NOT NULL THEN 'noop_already_synced'
    WHEN m.stripe_price_id IS NOT NULL THEN 'mapped_from_lookup'
    ELSE 'manual_review_needed'
  END AS action_needed,
  CASE
    WHEN pp.stripe_price_id IS NOT NULL THEN 'already has stripe_price_id'
    WHEN m.stripe_price_id IS NOT NULL
      THEN format('tier match: %s cents %s %s -> %s', pp.amount_cents, pp.currency, pp.billing_type, m.tier_label)
    ELSE format('no tier mapping for %s cents %s %s', pp.amount_cents, pp.currency, pp.billing_type)
  END AS reason
FROM public.product_prices pp
JOIN public.products pr ON pr.id = pp.product_id
LEFT JOIN public.pricing_tier_stripe_map m
  ON m.amount_cents = pp.amount_cents AND m.currency = pp.currency
 AND m.billing_type = pp.billing_type AND m.is_active = true
WHERE pp.active = true;

REVOKE ALL ON public.v_stripe_price_sync_preview FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.v_stripe_price_sync_preview TO authenticated;

-- Apply-RPC
CREATE OR REPLACE FUNCTION public.admin_stripe_price_sync_apply(p_dry_run BOOLEAN DEFAULT true)
RETURNS TABLE(action TEXT, count_rows INTEGER, detail JSONB)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_caller UUID := auth.uid();
  v_mapped_count INTEGER := 0;
  v_review_count INTEGER := 0;
  v_already_count INTEGER := 0;
  v_mapped_ids UUID[];
  v_review_ids UUID[];
BEGIN
  IF NOT public.has_role(v_caller, 'admin'::app_role) THEN
    RAISE EXCEPTION 'forbidden: admin only';
  END IF;

  SELECT array_agg(product_price_id), COUNT(*)::int INTO v_mapped_ids, v_mapped_count
  FROM public.v_stripe_price_sync_preview WHERE action_needed = 'mapped_from_lookup';

  SELECT array_agg(product_price_id), COUNT(*)::int INTO v_review_ids, v_review_count
  FROM public.v_stripe_price_sync_preview WHERE action_needed = 'manual_review_needed';

  SELECT COUNT(*)::int INTO v_already_count
  FROM public.v_stripe_price_sync_preview WHERE action_needed = 'noop_already_synced';

  IF v_review_ids IS NOT NULL THEN
    INSERT INTO public.stripe_price_sync_audit
      (product_price_id, action, amount_cents, currency, reason, triggered_by, trigger_source, metadata)
    SELECT v.product_price_id, 'manual_review_needed', v.amount_cents, v.currency, v.reason, v_caller,
           CASE WHEN p_dry_run THEN 'admin_rpc_dryrun' ELSE 'admin_rpc_apply' END,
           jsonb_build_object('product_title', v.product_title, 'billing_type', v.billing_type)
    FROM public.v_stripe_price_sync_preview v
    WHERE v.product_price_id = ANY(v_review_ids)
      AND NOT EXISTS (
        SELECT 1 FROM public.stripe_price_sync_audit a
        WHERE a.product_price_id = v.product_price_id
          AND a.action = 'manual_review_needed'
          AND a.created_at > now() - interval '1 hour'
      );
  END IF;

  IF p_dry_run THEN
    RETURN QUERY SELECT 'dry_run_summary'::text, v_mapped_count + v_review_count + v_already_count,
      jsonb_build_object('would_map', v_mapped_count, 'manual_review', v_review_count, 'already_synced', v_already_count);
    RETURN;
  END IF;

  IF v_mapped_ids IS NOT NULL THEN
    WITH updated AS (
      UPDATE public.product_prices pp
         SET stripe_price_id = m.stripe_price_id, updated_at = now()
        FROM public.pricing_tier_stripe_map m
       WHERE pp.id = ANY(v_mapped_ids) AND pp.stripe_price_id IS NULL
         AND m.amount_cents = pp.amount_cents AND m.currency = pp.currency
         AND m.billing_type = pp.billing_type AND m.is_active = true
      RETURNING pp.id, pp.amount_cents, pp.currency, m.stripe_price_id, m.tier_label
    )
    INSERT INTO public.stripe_price_sync_audit
      (product_price_id, action, after_stripe_price_id, amount_cents, currency, reason,
       triggered_by, trigger_source, metadata)
    SELECT u.id, 'mapped_from_lookup', u.stripe_price_id, u.amount_cents, u.currency,
           format('mapped via tier: %s', u.tier_label), v_caller, 'admin_rpc_apply',
           jsonb_build_object('tier_label', u.tier_label)
    FROM updated u;
  END IF;

  RETURN QUERY SELECT 'apply_summary'::text, v_mapped_count + v_review_count + v_already_count,
    jsonb_build_object('mapped', v_mapped_count, 'manual_review', v_review_count, 'already_synced', v_already_count);
END;
$$;
REVOKE ALL ON FUNCTION public.admin_stripe_price_sync_apply(boolean) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_stripe_price_sync_apply(boolean) TO authenticated;

-- Permanent-Fix-Backlog (created_by explizit als NIL UUID = system)
INSERT INTO public.heal_permanent_fix_tasks
  (pattern_key, cluster, title, description, priority, status, created_by)
SELECT
  'exam_pool_503_empty_loop_v1',
  'pipeline_external_dependency',
  'generate_exam_pool: Guard + Backoff für 503 / empty-loop',
  E'**Symptom:** generate_exam_pool schlägt mit HTTP 503 fehl und/oder läuft in eine "empty-loop"-Schleife (wiederholte Generierungsversuche ohne Pool-Wachstum).\n\n**Root-Cause-Hypothesen:**\n1. Externe AI-Abhängigkeit (LLM-Gateway) zeitweise nicht erreichbar -> 503.\n2. Prerequisites unvollständig: Step wird zu früh enqueued, bevor Curriculum/Blueprint-Daten konsistent sind -> leere Generierung -> "empty-loop".\n3. Fehlende Fail-Fast: Worker retried unbegrenzt statt nach NO_PROGRESS abzubrechen.\n\n**Empfohlene Fixes (SYSTEM_RULES Regel 8 Fail-Fast + Regel 9 Auto-Heal):**\n- **Pre-Flight-Guard**: Vor enqueue prüfen, ob Curriculum-Items + Blueprint-Coverage > Schwellwert vorhanden. Sonst NO_EFFECT zurück + audit.\n- **Externe Verfügbarkeit**: Health-Probe gegen LLM-Gateway vor Job-Start; bei 5xx -> Job in queued zurück mit run_after = now()+5min, max 3 Retries.\n- **Empty-Loop-Detector**: Nach jedem Run die Pool-Größe vergleichen (before vs after). Wenn 2 aufeinanderfolgende Runs Δ=0 -> cancel + status=blocked + Permanent-Fix-Task statt unendlich retryen.\n- **Logging**: Jeden 503/empty-loop in auto_heal_log mit action_type=''generate_exam_pool_failure'', reason_code (HTTP_503/EMPTY_DELTA/PREREQ_MISSING).\n- **Optional**: Exponential-Backoff (1min -> 5min -> 30min) bevor Permanent-Fix-Task entsteht.',
  'high',
  'open',
  '00000000-0000-0000-0000-000000000000'::uuid
WHERE NOT EXISTS (
  SELECT 1 FROM public.heal_permanent_fix_tasks WHERE pattern_key = 'exam_pool_503_empty_loop_v1'
);

COMMENT ON TABLE public.pricing_tier_stripe_map IS 'Tier-Lookup amount_cents+currency+billing_type -> bestehende Stripe-Price-ID. Bundle-only SSOT-konform.';
COMMENT ON FUNCTION public.admin_stripe_price_sync_apply(boolean) IS 'Admin-only. Default Dry-Run. Mappt nur aus pricing_tier_stripe_map. Sonderfälle als manual_review_needed in stripe_price_sync_audit.';