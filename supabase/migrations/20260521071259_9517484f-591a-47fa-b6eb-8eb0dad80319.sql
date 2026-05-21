INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('shop_coverage_backfill_v1',
   ARRAY['course_id','curriculum_id','product_id','price_id','stripe_product_id','stripe_price_id','amount_cents','currency'],
   'shop'),
  ('pillar_skeleton_inserted_v1',
   ARRAY['certification_catalog_id','slug','page_type','source'],
   'seo')
ON CONFLICT (action_type) DO UPDATE
SET required_keys = EXCLUDED.required_keys,
    owner_module = EXCLUDED.owner_module,
    updated_at = now();