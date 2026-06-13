INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module) VALUES
  ('kimi_reality_finding',      ARRAY['route','severity','kind','audit_mode','ms','model_in'], 'kimi_reality_auditor'),
  ('kimi_reality_audit_clean',  ARRAY['route','audit_mode','ms','model_in'],                    'kimi_reality_auditor')
ON CONFLICT (action_type) DO NOTHING;