-- ============================================================
-- Paywall: Anon-fähige Assignment-Engine (P0-2)
-- ============================================================
-- Ziel: experiment_assignments können auch für anonyme Visitor
-- Cookie/Local-ID erzeugt werden, ohne Auth.
-- SSOT-konform: Sticky pro (experiment_id, visitor_id) ODER
-- (experiment_id, user_id). Login-Migration: visitor → user.
-- ============================================================

-- 1) visitor_id Spalte (nullable, Cookie-ID/UUID vom Client)
ALTER TABLE public.experiment_assignments
  ADD COLUMN IF NOT EXISTS visitor_id text;

-- user_id nullable machen (anon-Pfad)
ALTER TABLE public.experiment_assignments
  ALTER COLUMN user_id DROP NOT NULL;

-- Sicherstellen: mindestens einer von user_id/visitor_id gesetzt
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'experiment_assignments_subject_chk'
  ) THEN
    ALTER TABLE public.experiment_assignments
      ADD CONSTRAINT experiment_assignments_subject_chk
      CHECK (user_id IS NOT NULL OR visitor_id IS NOT NULL);
  END IF;
END$$;

-- Sticky-UNIQUE für anon: (experiment_id, visitor_id) wenn visitor_id gesetzt
CREATE UNIQUE INDEX IF NOT EXISTS experiment_assignments_anon_uq
  ON public.experiment_assignments (experiment_id, visitor_id)
  WHERE visitor_id IS NOT NULL AND user_id IS NULL;

-- Sticky-UNIQUE für user: (experiment_id, user_id)
CREATE UNIQUE INDEX IF NOT EXISTS experiment_assignments_user_uq
  ON public.experiment_assignments (experiment_id, user_id)
  WHERE user_id IS NOT NULL;

-- 2) RLS: anon darf SELECT nicht (PII), aber INSERT geht nur über RPC (security definer)
ALTER TABLE public.experiment_assignments ENABLE ROW LEVEL SECURITY;

-- Drop alte broad-policies falls vorhanden, neu setzen
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_policies WHERE tablename='experiment_assignments' AND policyname='ea_user_select_own') THEN
    DROP POLICY ea_user_select_own ON public.experiment_assignments;
  END IF;
END$$;

CREATE POLICY ea_user_select_own ON public.experiment_assignments
  FOR SELECT USING (user_id = auth.uid());

-- 3) Anon-fähige Assignment-RPC
CREATE OR REPLACE FUNCTION public.assign_paywall_variant_anon(
  p_visitor_id text,
  p_experiment_key text,
  p_platform text DEFAULT 'web'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_experiment record;
  v_existing record;
  v_variant record;
  v_rand float;
  v_cumulative float := 0;
  v_total_weight integer;
  v_actual record;
BEGIN
  IF p_visitor_id IS NULL OR length(p_visitor_id) < 8 THEN
    RETURN jsonb_build_object('error', 'invalid_visitor_id');
  END IF;

  SELECT * INTO v_experiment
  FROM public.paywall_experiments
  WHERE experiment_key = p_experiment_key AND status = 'active'
  LIMIT 1;

  IF v_experiment IS NULL THEN
    RETURN jsonb_build_object('error', 'experiment_not_found');
  END IF;

  -- Sticky: existing assignment für diesen Visitor?
  SELECT ea.*, pv.variant_key, pv.price_cents, pv.currency,
         pv.layout, pv.trigger_context, pv.urgency_type,
         pv.headline, pv.subheadline, pv.cta_text,
         pv.features_json, pv.stripe_price_id,
         pv.apple_sku, pv.google_sku, pv.is_control,
         pv.web_price_cents, pv.ios_price_cents, pv.android_price_cents
  INTO v_existing
  FROM public.experiment_assignments ea
  JOIN public.paywall_variants pv ON pv.id = ea.variant_id
  WHERE ea.experiment_id = v_experiment.id
    AND ea.visitor_id = p_visitor_id
    AND ea.user_id IS NULL;

  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object(
      'variant_key', v_existing.variant_key,
      'price_cents', v_existing.price_cents,
      'currency', v_existing.currency,
      'layout', v_existing.layout,
      'trigger_context', v_existing.trigger_context,
      'urgency_type', v_existing.urgency_type,
      'headline', v_existing.headline,
      'subheadline', v_existing.subheadline,
      'cta_text', v_existing.cta_text,
      'features_json', v_existing.features_json,
      'stripe_price_id', v_existing.stripe_price_id,
      'apple_sku', v_existing.apple_sku,
      'google_sku', v_existing.google_sku,
      'is_control', v_existing.is_control,
      'web_price_cents', v_existing.web_price_cents,
      'ios_price_cents', v_existing.ios_price_cents,
      'android_price_cents', v_existing.android_price_cents,
      'assigned', false
    );
  END IF;

  -- Weighted random
  SELECT SUM(weight) INTO v_total_weight
  FROM public.paywall_variants WHERE experiment_id = v_experiment.id;

  IF v_total_weight IS NULL OR v_total_weight = 0 THEN
    RETURN jsonb_build_object('error', 'no_variants');
  END IF;

  v_rand := random() * v_total_weight;

  FOR v_variant IN
    SELECT * FROM public.paywall_variants
    WHERE experiment_id = v_experiment.id
    ORDER BY id
  LOOP
    v_cumulative := v_cumulative + v_variant.weight;
    IF v_rand <= v_cumulative THEN
      EXIT;
    END IF;
  END LOOP;

  -- Insert anon assignment (sticky via partial unique idx)
  INSERT INTO public.experiment_assignments
    (experiment_id, visitor_id, user_id, variant_id, variant, platform, assigned_at)
  VALUES
    (v_experiment.id, p_visitor_id, NULL, v_variant.id, v_variant.variant_key, p_platform, now())
  ON CONFLICT (experiment_id, visitor_id) WHERE visitor_id IS NOT NULL AND user_id IS NULL
  DO NOTHING;

  -- Re-read (race-safe)
  SELECT ea.*, pv.* INTO v_actual
  FROM public.experiment_assignments ea
  JOIN public.paywall_variants pv ON pv.id = ea.variant_id
  WHERE ea.experiment_id = v_experiment.id
    AND ea.visitor_id = p_visitor_id
    AND ea.user_id IS NULL;

  RETURN jsonb_build_object(
    'variant_key', v_actual.variant_key,
    'price_cents', v_actual.price_cents,
    'currency', v_actual.currency,
    'layout', v_actual.layout,
    'trigger_context', v_actual.trigger_context,
    'urgency_type', v_actual.urgency_type,
    'headline', v_actual.headline,
    'subheadline', v_actual.subheadline,
    'cta_text', v_actual.cta_text,
    'features_json', v_actual.features_json,
    'stripe_price_id', v_actual.stripe_price_id,
    'apple_sku', v_actual.apple_sku,
    'google_sku', v_actual.google_sku,
    'is_control', v_actual.is_control,
    'web_price_cents', v_actual.web_price_cents,
    'ios_price_cents', v_actual.ios_price_cents,
    'android_price_cents', v_actual.android_price_cents,
    'assigned', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.assign_paywall_variant_anon(text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.assign_paywall_variant_anon(text, text, text) TO service_role;

-- 4) Helper: aktive Experimente für ein Package (via products.active_package_id)
CREATE OR REPLACE FUNCTION public.get_active_paywall_experiment_for_package(
  p_package_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT jsonb_build_object(
    'experiment_id', pe.id,
    'experiment_key', pe.experiment_key,
    'product_id', pe.target_product_id
  )
  FROM public.paywall_experiments pe
  JOIN public.products p ON p.id = pe.target_product_id
  WHERE pe.status = 'active'
    AND p.active_package_id = p_package_id
    AND (pe.start_at IS NULL OR pe.start_at <= now())
    AND (pe.end_at IS NULL OR pe.end_at > now())
  ORDER BY pe.created_at DESC
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_active_paywall_experiment_for_package(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_active_paywall_experiment_for_package(uuid) TO anon, authenticated, service_role;