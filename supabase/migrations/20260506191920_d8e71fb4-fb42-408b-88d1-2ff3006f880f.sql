CREATE OR REPLACE FUNCTION public.admin_get_pricing_package_detail(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_pkg record;
  v_prices jsonb;
  v_runs jsonb;
  v_jobs jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.has_role(v_uid,'admin'::public.app_role) THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE='42501';
  END IF;

  SELECT cp.id, cp.title, cp.status, cp.blocked_reason, cp.product_id, cp.track_slug,
         public.fn_package_has_active_stripe_price(cp.id) AS has_active_stripe_price
  INTO v_pkg FROM course_packages cp WHERE cp.id = p_package_id;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok',false,'error','package_not_found'); END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(p) ORDER BY p.created_at DESC), '[]'::jsonb)
  INTO v_prices
  FROM (
    SELECT pp.id, pp.amount_cents, pp.currency, pp.billing_type, pp.access_months,
           pp.active, pp.stripe_price_id, pp.created_at, pp.updated_at
    FROM product_prices pp
    WHERE pp.product_id = v_pkg.product_id
  ) p;

  SELECT COALESCE(jsonb_agg(row_to_json(r) ORDER BY r.created_at DESC), '[]'::jsonb)
  INTO v_runs
  FROM (
    SELECT ahl.id, ahl.created_at, ahl.result_status,
           ahl.metadata->>'reason' AS reason,
           ahl.metadata->>'blocked_before' AS blocked_before,
           (ahl.metadata->>'ready_before')::boolean AS ready_before,
           (ahl.metadata->>'ready_after')::boolean AS ready_after,
           (ahl.metadata->>'inserted_price')::boolean AS inserted_price,
           (ahl.metadata->>'updated_price')::boolean AS updated_price,
           (ahl.metadata->>'job_enqueued')::boolean AS job_enqueued,
           ahl.metadata->>'input_reason' AS input_reason
    FROM auto_heal_log ahl
    WHERE ahl.action_type='pricing_default_repair'
      AND ahl.target_id = p_package_id::text
    LIMIT 20
  ) r;

  SELECT COALESCE(jsonb_agg(row_to_json(j) ORDER BY j.created_at DESC), '[]'::jsonb)
  INTO v_jobs
  FROM (
    SELECT jq.id, jq.job_type, jq.status, jq.created_at,
           jq.payload->>'enqueue_source' AS enqueue_source
    FROM job_queue jq
    WHERE jq.package_id = p_package_id
      AND jq.job_type = 'package_auto_publish'
    ORDER BY jq.created_at DESC
    LIMIT 5
  ) j;

  RETURN jsonb_build_object(
    'ok', true,
    'generated_at', now(),
    'package', row_to_json(v_pkg),
    'prices', v_prices,
    'heal_runs', v_runs,
    'auto_publish_jobs', v_jobs
  );
END $function$;

REVOKE ALL ON FUNCTION public.admin_get_pricing_package_detail(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.admin_get_pricing_package_detail(uuid) TO authenticated, service_role;