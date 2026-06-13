
INSERT INTO public.ops_audit_contract(action_type, required_keys, owner_module) VALUES
  ('kimi_canary_invoked',  ARRAY['lane','task_type','model_in','status','ms'], 'vibeos_ai_gateway'),
  ('kimi_route_invoked',   ARRAY['lane','task_type','model','status'],          'vibeos_ai_gateway'),
  ('kimi_route_blocked',   ARRAY['reason','lane','task_type','model_in'],       'vibeos_ai_gateway'),
  ('kimi_route_fallback',  ARRAY['lane','task_type','model_in','fallback_to'],  'vibeos_ai_gateway')
ON CONFLICT (action_type) DO NOTHING;
