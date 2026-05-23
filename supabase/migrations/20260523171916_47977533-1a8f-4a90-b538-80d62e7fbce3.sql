INSERT INTO ops_audit_contract(action_type, required_keys, owner_module)
VALUES (
  'commerce_catalog_orphan_archived_v1',
  ARRAY['orphan_product_id','orphan_slug','kept_product_id','kept_package_id','reason'],
  'commerce'
)
ON CONFLICT (action_type) DO NOTHING;