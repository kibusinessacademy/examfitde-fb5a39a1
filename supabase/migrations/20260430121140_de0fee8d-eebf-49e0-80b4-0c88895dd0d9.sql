
DO $$
DECLARE
  v_dup RECORD;
  v_archived_count int := 0;
BEGIN
  FOR v_dup IN
    WITH dups(cert_id, canonical_id, duplicate_id) AS (VALUES
      ('31822205-9ac0-4963-81dd-fbacd3214758'::uuid, '8426831d-792d-491f-8a06-a7adbeb6d239'::uuid, 'b6d0d97c-8e90-4356-9f9b-5c0aee14b8be'::uuid),
      ('37ad59fa-990b-4949-bbc8-7f1383c15927'::uuid, 'c5019c1c-1a78-4c3a-8656-e43fd0806156'::uuid, '5cb2a784-0e56-4169-8ae8-bd9fdec97d5a'::uuid),
      ('e4cf6878-3ddb-430b-8496-d670dffe9749'::uuid, 'dfbf8d45-85df-4dc6-8be2-fa550786ca8b'::uuid, '39ed7e14-239c-4095-af1d-ae15bf38b7df'::uuid),
      ('79bf3e0e-e519-42f6-9939-9cad49e785f6'::uuid, 'e13f3e0c-cfb4-4d5c-bf23-6af894141d1d'::uuid, '9aeb5460-956b-4ce5-8dfd-393f381dbab6'::uuid)
    )
    SELECT * FROM dups
  LOOP
    IF NOT EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id = v_dup.canonical_id AND pp.active = true) THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM product_prices pp WHERE pp.product_id = v_dup.duplicate_id AND pp.active = true) THEN CONTINUE; END IF;

    UPDATE products
       SET status = 'archived',
           slug = slug || '__archived_' || substr(id::text, 1, 8),
           updated_at = now()
     WHERE id = v_dup.duplicate_id AND status <> 'archived';

    IF FOUND THEN
      v_archived_count := v_archived_count + 1;
      INSERT INTO auto_heal_log (action_type, trigger_source, target_type, target_id, result_status, metadata)
      VALUES (
        'pricing_merge_duplicate_product','pricing_audit_v1','product',v_dup.duplicate_id::text,'success',
        jsonb_build_object(
          'certification_id', v_dup.cert_id,
          'canonical_product_id', v_dup.canonical_id,
          'archived_product_id', v_dup.duplicate_id,
          'rule', 'keep product with active price; archive priceless duplicate'
        )
      );
    END IF;
  END LOOP;
  RAISE NOTICE 'Archived % duplicate products', v_archived_count;
END $$;

CREATE OR REPLACE VIEW v_pricing_backfill_dryrun AS
WITH base AS (
  SELECT
    cp.id AS package_id,
    cp.title AS package_title,
    cp.status AS package_status,
    c.id AS certification_id,
    c.title AS certification_title,
    (SELECT count(*) FROM products p WHERE p.certification_id = c.id AND p.status <> 'archived') AS product_count,
    (SELECT p.id FROM products p WHERE p.certification_id = c.id AND p.status <> 'archived' ORDER BY (CASE WHEN p.status='active' THEN 0 ELSE 1 END), p.created_at LIMIT 1) AS existing_product_id,
    (SELECT pp.id FROM products p JOIN product_prices pp ON pp.product_id = p.id WHERE p.certification_id = c.id AND p.status <> 'archived' AND pp.active = true ORDER BY pp.created_at DESC LIMIT 1) AS existing_active_price_id,
    (SELECT pp.amount_cents FROM products p JOIN product_prices pp ON pp.product_id = p.id WHERE p.certification_id = c.id AND p.status <> 'archived' AND pp.active = true ORDER BY pp.created_at DESC LIMIT 1) AS existing_active_price_cents
  FROM course_packages cp
  JOIN certifications c ON c.id = cp.certification_id
  WHERE cp.status = 'published'
),
classified AS (
  SELECT
    b.*,
    o.forced_tier,
    o.forced_price_cents,
    o.note AS override_note,
    cls.tier_key    AS cls_tier,
    cls.price_cents AS cls_price,
    cls.confidence  AS cls_conf,
    cls.reason      AS cls_reason
  FROM base b
  LEFT JOIN product_pricing_overrides o ON o.package_id = b.package_id
  LEFT JOIN LATERAL classify_package_pricing_tier(b.package_title) cls ON TRUE
)
SELECT
  package_id,
  package_title,
  package_status,
  certification_id,
  certification_title,
  COALESCE(forced_tier, cls_tier)        AS suggested_tier,
  COALESCE(forced_price_cents, cls_price) AS suggested_price_cents,
  CASE WHEN forced_tier IS NOT NULL THEN 'override' ELSE cls_conf END   AS confidence,
  CASE WHEN forced_tier IS NOT NULL THEN 'manual override' ELSE cls_reason END AS reason,
  forced_tier,
  forced_price_cents,
  override_note,
  product_count,
  existing_product_id,
  existing_active_price_id,
  existing_active_price_cents,
  CASE
    WHEN existing_active_price_id IS NOT NULL AND product_count = 1 THEN 'none'
    WHEN existing_active_price_id IS NOT NULL AND product_count > 1 THEN 'merge_duplicate_products'
    WHEN existing_product_id IS NOT NULL AND existing_active_price_id IS NULL THEN 'create_price_only'
    WHEN existing_product_id IS NULL THEN 'create_product_and_price'
    ELSE 'manual_review'
  END AS action_needed
FROM classified;
