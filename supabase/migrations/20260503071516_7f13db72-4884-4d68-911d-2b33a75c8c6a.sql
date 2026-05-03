
-- ============================================================
-- 1) Backfill-Funktion: Default-Pricing für building/queued
-- ============================================================
CREATE OR REPLACE FUNCTION public.fn_backfill_default_pricing_for_building()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_default_price_cents int := 2490; -- 24.90 EUR
  v_default_months int := 12;
  v_currency text := 'EUR';
  v_pkg record;
  v_product_id uuid;
  v_price_id uuid;
  v_created_products int := 0;
  v_created_prices int := 0;
  v_skipped int := 0;
  v_processed int := 0;
  v_errors jsonb := '[]'::jsonb;
BEGIN
  FOR v_pkg IN
    SELECT cp.id, cp.title, cp.product_id, cp.package_key
    FROM course_packages cp
    WHERE cp.status IN ('building','queued')
      AND NOT EXISTS (
        SELECT 1 FROM product_prices pp
        WHERE pp.product_id = cp.product_id
          AND pp.active = true
          AND pp.stripe_price_id IS NOT NULL
      )
  LOOP
    v_processed := v_processed + 1;
    BEGIN
      v_product_id := v_pkg.product_id;

      -- Falls product_id fehlt → kein automatisches Anlegen, nur skip + audit
      IF v_product_id IS NULL THEN
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object(
          'package_id', v_pkg.id,
          'reason', 'product_id_missing'
        );
        CONTINUE;
      END IF;

      -- Stub-Preis (ohne stripe_price_id) anlegen, falls noch keiner existiert
      INSERT INTO product_prices (
        product_id, currency, amount_cents,
        billing_interval, active, valid_from
      )
      SELECT v_product_id, v_currency, v_default_price_cents,
             'one_time', true, now()
      WHERE NOT EXISTS (
        SELECT 1 FROM product_prices
        WHERE product_id = v_product_id AND active = true
      )
      RETURNING id INTO v_price_id;

      IF v_price_id IS NOT NULL THEN
        v_created_prices := v_created_prices + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;

    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object(
        'package_id', v_pkg.id,
        'error', SQLERRM
      );
    END;
  END LOOP;

  INSERT INTO auto_heal_log (
    action_type, target_type, target_id, result_status, result_detail, metadata
  ) VALUES (
    'pricing_backfill_building_pkgs', 'system', NULL,
    CASE WHEN jsonb_array_length(v_errors)=0 THEN 'success' ELSE 'partial' END,
    format('processed=%s created_prices=%s skipped=%s errors=%s',
           v_processed, v_created_prices, v_skipped, jsonb_array_length(v_errors)),
    jsonb_build_object(
      'processed', v_processed,
      'created_prices', v_created_prices,
      'skipped', v_skipped,
      'errors', v_errors
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'processed', v_processed,
    'created_prices', v_created_prices,
    'skipped', v_skipped,
    'errors', v_errors
  );
END;
$$;

REVOKE ALL ON FUNCTION public.fn_backfill_default_pricing_for_building() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fn_backfill_default_pricing_for_building() TO service_role;

-- ============================================================
-- 2) Admin-RPC: sofortige manuelle Ausführung
-- ============================================================
CREATE OR REPLACE FUNCTION public.admin_trigger_pricing_backfill_now()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_result jsonb;
BEGIN
  IF v_caller IS NULL OR NOT public.has_role(v_caller, 'admin') THEN
    RAISE EXCEPTION 'admin_only' USING ERRCODE = '42501';
  END IF;

  v_result := public.fn_backfill_default_pricing_for_building();

  INSERT INTO auto_heal_log (
    action_type, target_type, result_status, result_detail, metadata
  ) VALUES (
    'admin_trigger_pricing_backfill', 'system', 'success',
    format('triggered_by=%s', v_caller),
    jsonb_build_object('caller', v_caller, 'result', v_result)
  );

  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION public.admin_trigger_pricing_backfill_now() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.admin_trigger_pricing_backfill_now() TO authenticated;

-- ============================================================
-- 3) Stündlicher Cron
-- ============================================================
DO $$
BEGIN
  PERFORM cron.unschedule('pricing-backfill-building-pkgs-hourly');
EXCEPTION WHEN OTHERS THEN NULL;
END $$;

SELECT cron.schedule(
  'pricing-backfill-building-pkgs-hourly',
  '23 * * * *',
  $$ SELECT public.fn_backfill_default_pricing_for_building(); $$
);
