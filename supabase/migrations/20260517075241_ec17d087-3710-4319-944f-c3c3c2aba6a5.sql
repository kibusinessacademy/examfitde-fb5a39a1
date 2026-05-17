INSERT INTO public.ops_audit_contract (action_type, required_keys, owner_module)
VALUES ('deprecated_edge_function_called', ARRAY['fn']::text[], 'naming-migration-a4')
ON CONFLICT (action_type) DO NOTHING;