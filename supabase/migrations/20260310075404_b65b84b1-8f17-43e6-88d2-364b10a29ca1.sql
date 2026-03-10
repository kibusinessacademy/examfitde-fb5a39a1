
-- Fix 1: Update model_routing_rules for handbook to Elite models
UPDATE model_routing_rules
SET model = 'google/gemini-2.5-pro', provider = 'lovable', is_fallback = false, updated_at = now()
WHERE intent = 'handbook' AND priority = 1;

UPDATE model_routing_rules
SET model = 'openai/gpt-5', provider = 'lovable', is_fallback = true, updated_at = now()
WHERE intent = 'handbook' AND priority = 2;

-- Add Flash as last resort (priority 3) if not exists
INSERT INTO model_routing_rules (intent, provider, model, is_fallback, priority)
SELECT 'handbook', 'lovable', 'google/gemini-2.5-flash', true, 3
WHERE NOT EXISTS (SELECT 1 FROM model_routing_rules WHERE intent = 'handbook' AND priority = 3);

-- Fix 2: Add load balancer policy for handbook
INSERT INTO llm_provider_routing_policies (route_key, workload_key, provider_chain, fallback_mode, is_enabled, meta)
VALUES (
  'route.handbook',
  'handbook',
  '[{"role": "elite_primary", "model": "google/gemini-2.5-pro", "provider": "lovable", "timeout_ms": 70000}, {"role": "elite_backup", "model": "openai/gpt-5", "provider": "lovable", "timeout_ms": 70000}, {"role": "rescue_fast", "model": "google/gemini-2.5-flash", "provider": "lovable", "timeout_ms": 40000}]'::jsonb,
  'sequential',
  true,
  '{"note": "Elite v8: handbook needs Pro/GPT-5 for long-form quality"}'::jsonb
)
ON CONFLICT DO NOTHING;

-- Fix 3: Reset generate_handbook step to queued so it retries with new routing
UPDATE package_steps
SET status = 'queued', started_at = NULL, updated_at = now(),
    meta = jsonb_set(COALESCE(meta, '{}'::jsonb), '{elite_routing_fix}', '"v8_pro_primary"')
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_handbook'
  AND status != 'done';
