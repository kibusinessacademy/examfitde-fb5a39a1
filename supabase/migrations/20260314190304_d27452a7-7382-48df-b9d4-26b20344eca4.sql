
-- v15: Primary → gpt-5-mini, Fallback → claude-3-5-haiku-20241022

-- Re-enable anthropic entries with pinned haiku as fallback
UPDATE public.model_routing_rules
SET enabled = true, model = 'claude-3-5-haiku-20241022', provider = 'anthropic'
WHERE provider = 'anthropic';

-- Update primary from gpt-4o-mini to gpt-5-mini
UPDATE public.model_routing_rules
SET model = 'gpt-5-mini'
WHERE model = 'gpt-4o-mini' AND is_fallback = false;

-- Sync load-balancer policies
UPDATE public.llm_provider_routing_policies
SET provider_chain = REPLACE(provider_chain::text, 'gpt-4o-mini', 'gpt-5-mini')::jsonb
WHERE provider_chain::text LIKE '%gpt-4o-mini%';
