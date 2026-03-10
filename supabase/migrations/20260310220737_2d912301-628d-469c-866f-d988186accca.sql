-- Switch lesson generator routing from Sonnet to Haiku 4.5
UPDATE model_routing_rules 
SET model = 'claude-4-5-haiku-20250929', updated_at = now()
WHERE provider = 'anthropic' 
  AND model = 'claude-sonnet-4-5-20250929'
  AND intent IN ('learning_content', 'minicheck');

-- Also update any routing policies for these workloads
UPDATE llm_provider_routing_policies
SET provider_chain = jsonb_set(
  provider_chain,
  '{0,model}',
  '"claude-4-5-haiku-20250929"'
)
WHERE workload_key IN ('learning_content', 'minicheck')
  AND provider_chain->0->>'provider' = 'anthropic'
  AND provider_chain->0->>'model' = 'claude-sonnet-4-5-20250929';