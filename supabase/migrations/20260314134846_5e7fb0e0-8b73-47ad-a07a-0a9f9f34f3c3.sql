
-- 1. model_routing_rules: Haiku 3.5 → GPT-4o mini
UPDATE model_routing_rules
SET model = 'gpt-4o-mini', provider = 'openai'
WHERE model = 'claude-3-5-haiku-20241022' AND provider = 'anthropic';

-- 2. llm_provider_routing_policies: replace in provider_chain JSONB
UPDATE llm_provider_routing_policies
SET provider_chain = REPLACE(
  REPLACE(provider_chain::text, '"claude-3-5-haiku-20241022"', '"gpt-4o-mini"'),
  '"anthropic"', '"openai"'
)::jsonb
WHERE provider_chain::text LIKE '%claude-3-5-haiku-20241022%';
