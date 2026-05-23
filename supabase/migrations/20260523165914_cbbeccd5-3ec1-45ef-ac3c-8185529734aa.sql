INSERT INTO ops_audit_contract(action_type, required_keys, owner_module)
VALUES (
  'commerce_truth_bridge_consolidated_v1',
  ARRAY['before_sellable_and_deliverable','after_sellable_and_deliverable','source_truth','deprecated_truth'],
  'commerce'
)
ON CONFLICT (action_type) DO NOTHING;

CREATE OR REPLACE VIEW public.v_sellable_and_deliverable AS
SELECT
  cp.id AS course_package_id,
  cp.curriculum_id,
  cp.product_id,
  cp.status AS package_status,
  cp.is_published,
  csv.customer_safe AS delivery_ready,
  csv.delivery_blocking_reasons,
  (EXISTS (SELECT 1 FROM products pr
           WHERE pr.id = cp.product_id
             AND pr.status = 'active'::text
             AND pr.visibility = 'public'::text)) AS product_public,
  (EXISTS (SELECT 1 FROM product_prices pp
           WHERE pp.product_id = cp.product_id
             AND pp.active = true
             AND pp.stripe_price_id IS NOT NULL)) AS has_stripe_price,
  (
    cp.is_published = true
    AND COALESCE(csv.customer_safe, false) = true
    AND EXISTS (SELECT 1 FROM products pr
                WHERE pr.id = cp.product_id
                  AND pr.status = 'active'::text
                  AND pr.visibility = 'public'::text
                  AND pr.canonical_slug IS NOT NULL)
    AND EXISTS (SELECT 1 FROM product_prices pp
                WHERE pp.product_id = cp.product_id
                  AND pp.active = true
                  AND pp.stripe_price_id IS NOT NULL)
  ) AS is_sellable_and_deliverable
FROM course_packages cp
LEFT JOIN v_package_customer_safe_v1 csv ON csv.package_id = cp.id
WHERE cp.archived = false;

COMMENT ON VIEW public.v_sellable_and_deliverable IS
  'Commerce-Truth SSOT (2026-05-23 bridge consolidation). Source: v_package_customer_safe_v1 — NOT v_course_delivery_readiness.';

COMMENT ON VIEW public.v_course_delivery_readiness IS
  'DEPRECATED for commerce truth (2026-05-23). Diagnostic-only — do not use as checkout gate.';

DO $$
DECLARE
  v_after integer;
  v_affected uuid[];
BEGIN
  SELECT COUNT(*) INTO v_after FROM v_sellable_and_deliverable WHERE is_sellable_and_deliverable = true;
  SELECT array_agg(course_package_id) INTO v_affected FROM v_sellable_and_deliverable WHERE is_sellable_and_deliverable = true;

  PERFORM public.fn_emit_audit(
    _action_type   := 'commerce_truth_bridge_consolidated_v1',
    _target_type   := 'system',
    _target_id     := NULL,
    _result_status := 'success',
    _payload       := jsonb_build_object(
      'before_sellable_and_deliverable', 27,
      'after_sellable_and_deliverable',  v_after,
      'removed_blocker',                 'minichecks_unready',
      'source_truth',                    'v_package_customer_safe_v1',
      'deprecated_truth',                'v_course_delivery_readiness',
      'affected_packages_count',         COALESCE(array_length(v_affected,1),0),
      'affected_packages_sample',        to_jsonb(v_affected[1:10])
    ),
    _trigger_source := 'migration'
  );
END $$;