-- A) Backfill products.active_package_id
WITH eligible AS (
  SELECT 
    p.id AS product_id,
    p.title AS product_title,
    p.certification_id,
    (SELECT cp.id FROM course_packages cp
      WHERE cp.certification_id = p.certification_id
      ORDER BY CASE cp.status
        WHEN 'published' THEN 1
        WHEN 'done'      THEN 2
        WHEN 'building'  THEN 3
        WHEN 'queued'    THEN 4
        ELSE 5
      END, cp.created_at DESC
      LIMIT 1) AS chosen_package_id
  FROM products p
  WHERE p.active_package_id IS NULL
    AND p.certification_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM product_prices pp 
      WHERE pp.product_id = p.id AND pp.active = true
    )
),
upd AS (
  UPDATE products p
     SET active_package_id = e.chosen_package_id,
         updated_at = now()
    FROM eligible e
   WHERE p.id = e.product_id
     AND e.chosen_package_id IS NOT NULL
  RETURNING p.id, p.title, p.active_package_id
)
INSERT INTO auto_heal_log (action_type, trigger_source, result_status, metadata, created_at)
SELECT 
  'backfill_products_active_package_id_v1',
  'pricing_audit_v1',
  'success',
  jsonb_build_object(
    'updated_count', (SELECT count(*) FROM upd),
    'rows', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'product_id', id, 'title', title, 'active_package_id', active_package_id
    )) FROM upd), '[]'::jsonb)
  ),
  now();

-- B) Pricing-Ladder Fix
UPDATE pricing_plans
   SET price_cents = 11900,
       updated_at = now()
 WHERE plan_key IN ('b2b_team_5_12m','b2b_studium_team_5_12m')
   AND is_active = true;

INSERT INTO auto_heal_log (action_type, trigger_source, result_status, metadata, created_at)
VALUES (
  'pricing_team_ladder_normalize_v1',
  'pricing_audit_v1',
  'success',
  jsonb_build_object(
    'reason', 'team_per_seat_was_above_b2c_single',
    'b2c_single_eur_per_seat', 24.90,
    'old_team_eur_per_seat', 29.80,
    'old_studium_team_eur_per_seat', 39.80,
    'new_team_eur_per_seat', 23.80,
    'new_studium_team_eur_per_seat', 23.80,
    'plans_changed', ARRAY['b2b_team_5_12m','b2b_studium_team_5_12m']
  ),
  now()
);

-- C) Auto-Link Trigger
CREATE OR REPLACE FUNCTION public.fn_products_auto_link_active_package()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chosen uuid;
  v_match_count int;
BEGIN
  IF NEW.active_package_id IS NOT NULL OR NEW.certification_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO v_match_count 
  FROM course_packages 
  WHERE certification_id = NEW.certification_id;

  IF v_match_count = 1 THEN
    SELECT id INTO v_chosen 
    FROM course_packages 
    WHERE certification_id = NEW.certification_id 
    LIMIT 1;

    IF v_chosen IS NOT NULL THEN
      NEW.active_package_id := v_chosen;
      INSERT INTO auto_heal_log (action_type, trigger_source, result_status, metadata, created_at)
      VALUES (
        'products_auto_link_active_package_trigger_v1',
        'trg_products_auto_link_active_package',
        'success',
        jsonb_build_object(
          'product_id', NEW.id,
          'product_title', NEW.title,
          'certification_id', NEW.certification_id,
          'linked_package_id', v_chosen,
          'tg_op', TG_OP
        ),
        now()
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_products_auto_link_active_package ON public.products;
CREATE TRIGGER trg_products_auto_link_active_package
  BEFORE INSERT OR UPDATE OF certification_id, active_package_id
  ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.fn_products_auto_link_active_package();