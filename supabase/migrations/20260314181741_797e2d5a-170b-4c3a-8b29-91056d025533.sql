
-- Fix: claude-3-5-haiku-latest → claude-3-5-haiku-20241022 (pinned snapshot)
-- The "-latest" alias returns 404 on the direct Anthropic API
UPDATE public.model_routing_rules
SET model = 'claude-3-5-haiku-20241022'
WHERE model = 'claude-3-5-haiku-latest';

-- Also fix in provider routing policies
UPDATE public.llm_provider_routing_policies
SET provider_chain = REPLACE(provider_chain::text, 'claude-3-5-haiku-latest', 'claude-3-5-haiku-20241022')::jsonb
WHERE provider_chain::text LIKE '%claude-3-5-haiku-latest%';
