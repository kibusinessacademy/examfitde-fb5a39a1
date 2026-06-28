
CREATE OR REPLACE VIEW public.v_sellable_recovery_candidates AS
WITH ranked_pkg AS (
  SELECT cp.curriculum_id, cp.id AS package_id, cp.status,
         ROW_NUMBER() OVER (PARTITION BY cp.curriculum_id ORDER BY cp.updated_at DESC NULLS LAST, cp.id) AS rn
  FROM public.course_packages cp
  WHERE cp.status <> 'published'
)
SELECT
  p.id AS product_id,
  p.title AS product_title,
  p.curriculum_id,
  (SELECT COUNT(*) FROM public.course_packages cp WHERE cp.curriculum_id = p.curriculum_id) AS pkg_total,
  (SELECT COUNT(*) FROM public.course_packages cp WHERE cp.curriculum_id = p.curriculum_id AND cp.status = 'published') AS pkg_published,
  (SELECT rp.package_id FROM ranked_pkg rp WHERE rp.curriculum_id = p.curriculum_id AND rp.rn = 1) AS recoverable_package_id
FROM public.products p
JOIN public.product_prices pp ON pp.product_id = p.id AND pp.active = true
WHERE p.status = 'active'
  AND p.visibility = 'public'
  AND p.curriculum_id IS NOT NULL
GROUP BY p.id, p.title, p.curriculum_id;

GRANT SELECT ON public.v_sellable_recovery_candidates TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.fn_sell_drift_prevent_priced_orphan()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_product RECORD;
  v_pub_pkg_count int;
BEGIN
  IF NEW.active IS DISTINCT FROM true THEN RETURN NEW; END IF;

  SELECT id, visibility, status, curriculum_id INTO v_product
  FROM public.products WHERE id = NEW.product_id;

  IF v_product IS NULL OR v_product.visibility <> 'public' OR v_product.status <> 'active'
     OR v_product.curriculum_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT COUNT(*) INTO v_pub_pkg_count
  FROM public.course_packages
  WHERE curriculum_id = v_product.curriculum_id AND status = 'published';

  IF v_pub_pkg_count = 0 THEN
    INSERT INTO public.auto_heal_log (action_type, target_id, target_type, input_params, result_status, result_detail, trigger_source)
    VALUES (
      'sell_drift_prevent_priced_orphan',
      v_product.id,
      'product',
      jsonb_build_object('product_id', v_product.id, 'curriculum_id', v_product.curriculum_id, 'price_id', NEW.id),
      'observed',
      'priced public product has no published course package on curriculum',
      'trg_product_prices_sell_drift'
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_product_prices_sell_drift ON public.product_prices;
CREATE TRIGGER trg_product_prices_sell_drift
AFTER INSERT OR UPDATE OF active, product_id ON public.product_prices
FOR EACH ROW EXECUTE FUNCTION public.fn_sell_drift_prevent_priced_orphan();
