-- Fix wrong Haiku model ID in DB routing
UPDATE model_routing_rules 
SET model = 'claude-haiku-4-5-20251001', updated_at = now()
WHERE model = 'claude-4-5-haiku-20250929';

UPDATE llm_provider_routing_policies
SET provider_chain = replace(provider_chain::text, 'claude-4-5-haiku-20250929', 'claude-haiku-4-5-20251001')::jsonb
WHERE provider_chain::text LIKE '%claude-4-5-haiku-20250929%';

-- Clear cooldowns for the wrong model
DELETE FROM llm_provider_cooldowns 
WHERE model LIKE '%claude-4-5-haiku%' OR model LIKE '%haiku-20250929%';

-- Reset stuck lesson jobs
UPDATE job_queue 
SET status = 'pending', last_error = NULL, attempts = 0, updated_at = now()
WHERE job_type = 'lesson_generate_content' AND status IN ('pending','processing');