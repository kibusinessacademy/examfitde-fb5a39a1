
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES (
  'pillar_orphan_classification',
  ARRAY['pillar_id','slug','decision']::text[],
  'seo.pillar_orphan_resolution'
)
ON CONFLICT (action_type) DO UPDATE SET
  required_keys = EXCLUDED.required_keys,
  owner_module  = EXCLUDED.owner_module;
