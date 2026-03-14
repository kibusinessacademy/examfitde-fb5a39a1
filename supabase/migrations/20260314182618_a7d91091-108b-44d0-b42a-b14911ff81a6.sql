
-- v14: Replace Anthropic fallback with gpt-5-mini (Anthropic 404)
UPDATE public.model_routing_rules
SET provider = 'openai', model = 'gpt-5-mini'
WHERE model = 'claude-3-5-haiku-20241022' AND enabled = true;

-- Also disable any remaining anthropic entries
UPDATE public.model_routing_rules
SET enabled = false
WHERE provider = 'anthropic';

-- Update load-balancer policies
UPDATE public.llm_provider_routing_policies
SET provider_chain = REPLACE(provider_chain::text, 'claude-3-5-haiku-20241022', 'gpt-5-mini')::jsonb
WHERE provider_chain::text LIKE '%claude-3-5-haiku%';
