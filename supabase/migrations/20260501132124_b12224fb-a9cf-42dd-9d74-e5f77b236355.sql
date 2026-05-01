-- Fix: order_items.product_id FK from store_products → products
-- Forensik: order_items=0 rows, store_products=3 rows ohne curriculum_id, products=427 rows
-- Fulfillment-Code (process_order_paid_fulfillment) joined gegen products, FK war fehlerhaft

ALTER TABLE public.order_items 
  DROP CONSTRAINT IF EXISTS order_items_product_id_fkey;

ALTER TABLE public.order_items 
  ADD CONSTRAINT order_items_product_id_fkey 
  FOREIGN KEY (product_id) REFERENCES public.products(id) ON DELETE SET NULL;

-- Audit-Log
INSERT INTO public.auto_heal_log (action_type, target_type, target_id, result_status, metadata)
VALUES (
  'schema_drift_fix',
  'system',
  'order_items_product_id_fkey',
  'success',
  jsonb_build_object(
    'before_fk_target', 'public.store_products',
    'after_fk_target', 'public.products',
    'rows_affected', 0,
    'detected_during', 'e2e_smoke_hybrid_v1',
    'reason', 'process_order_paid_fulfillment joined against products but FK pointed to store_products'
  )
);