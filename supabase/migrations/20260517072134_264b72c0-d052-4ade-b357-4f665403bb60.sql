
INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES
  ('test_fixture_created',
   ARRAY['fixture_kind','target_table','correlation_id']::text[],
   'test-fixture-contract'),
  ('test_fixture_cleanup',
   ARRAY['fixture_kind','correlation_id','removed_count']::text[],
   'test-fixture-contract'),
  ('test_fixture_schema_drift',
   ARRAY['fixture_kind','target_table','expected','actual']::text[],
   'test-fixture-contract')
ON CONFLICT (action_type) DO UPDATE
  SET required_keys = EXCLUDED.required_keys,
      owner_module  = EXCLUDED.owner_module,
      updated_at    = now();
