
-- 1) Fix pricing healer schema drift: billing_interval → billing_type
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='product_prices' AND column_name='billing_type'
  ) THEN
    RAISE EXCEPTION 'SCHEMA_DRIFT: product_prices.billing_type missing';
  END IF;
END
$guard$;

CREATE OR REPLACE FUNCTION public.fn_backfill_default_pricing_for_building()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_default_price_cents int := 2490;
  v_currency text := 'EUR';
  v_pkg record;
  v_product_id uuid;
  v_price_id uuid;
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
      IF v_product_id IS NULL THEN
        v_skipped := v_skipped + 1;
        v_errors := v_errors || jsonb_build_object('package_id', v_pkg.id, 'reason', 'product_id_missing');
        CONTINUE;
      END IF;

      INSERT INTO product_prices (product_id, currency, amount_cents, billing_type, active)
      SELECT v_product_id, v_currency, v_default_price_cents, 'one_time', true
      WHERE NOT EXISTS (
        SELECT 1 FROM product_prices WHERE product_id = v_product_id AND active = true
      )
      RETURNING id INTO v_price_id;

      IF v_price_id IS NOT NULL THEN
        v_created_prices := v_created_prices + 1;
      ELSE
        v_skipped := v_skipped + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      v_errors := v_errors || jsonb_build_object('package_id', v_pkg.id, 'error', SQLERRM);
    END;
  END LOOP;

  INSERT INTO auto_heal_log (action_type, target_type, target_id, result_status, result_detail, metadata)
  VALUES (
    'pricing_backfill_building_pkgs', 'system', NULL,
    CASE WHEN jsonb_array_length(v_errors)=0 THEN 'success' ELSE 'partial' END,
    format('processed=%s created_prices=%s skipped=%s errors=%s',
           v_processed, v_created_prices, v_skipped, jsonb_array_length(v_errors)),
    jsonb_build_object('processed', v_processed, 'created_prices', v_created_prices,
                       'skipped', v_skipped, 'errors', v_errors)
  );

  RETURN jsonb_build_object('ok', true, 'processed', v_processed,
                            'created_prices', v_created_prices, 'skipped', v_skipped,
                            'errors', v_errors);
END;
$function$;

-- 2) Harmonize derive_job_lane with code SSOT
CREATE OR REPLACE FUNCTION public.derive_job_lane(p_job_type text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    -- CONTROL LANE: validators, council, integrity, tutor index, finalize, auto_publish, promote
    WHEN p_job_type LIKE 'package_validate_%' THEN 'control'
    WHEN p_job_type IN (
      'package_quality_council',
      'package_run_integrity_check',
      'package_build_ai_tutor_index',
      'package_finalize_learning_content',
      'package_auto_publish'
    ) THEN 'control'
    WHEN p_job_type LIKE '%promote%' THEN 'control'
    WHEN p_job_type LIKE '%finalize%' THEN 'control'

    -- RECOVERY LANE: repair / heal
    WHEN p_job_type LIKE '%repair%' THEN 'recovery'
    WHEN p_job_type LIKE '%heal%' THEN 'recovery'
    WHEN p_job_type = 'package_exam_rebalance' THEN 'recovery'
    WHEN p_job_type = 'package_elite_harden' THEN 'recovery'

    -- GENERATION LANE
    WHEN p_job_type LIKE '%generate%' THEN 'generation'
    WHEN p_job_type LIKE '%blueprint%' THEN 'generation'
    WHEN p_job_type LIKE '%oral_exam%' THEN 'generation'
    WHEN p_job_type LIKE '%exam_pool%' THEN 'generation'

    ELSE 'build'
  END;
$function$;

-- 3) Normalize lanes on existing open jobs
UPDATE public.job_queue jq
SET lane = public.derive_job_lane(jq.job_type),
    updated_at = now(),
    meta = COALESCE(meta, '{}'::jsonb) || jsonb_build_object(
      'lane_normalized_at', to_jsonb(now()),
      'lane_normalized_reason', 'lane_ssot_harmonization_v1'
    )
WHERE status IN ('pending','processing','queued')
  AND lane IS DISTINCT FROM public.derive_job_lane(job_type);

-- 4) Harden claim RPC: only service_role may execute
REVOKE EXECUTE ON FUNCTION public.claim_pending_jobs_by_types(text[], integer, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.claim_pending_jobs_by_types(text[], integer, text, text) FROM anon;
REVOKE EXECUTE ON FUNCTION public.claim_pending_jobs_by_types(text[], integer, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.claim_pending_jobs_by_types(text[], integer, text, text) TO service_role;
