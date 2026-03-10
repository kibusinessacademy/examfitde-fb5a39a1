-- Truncate all active cooldowns
DELETE FROM llm_provider_cooldowns WHERE until_at > now();

-- Cap any future cooldowns in routing policies
UPDATE llm_provider_routing_policies 
SET provider_chain = replace(provider_chain::text, '"cooldown_seconds":300', '"cooldown_seconds":120')::jsonb
WHERE provider_chain::text LIKE '%"cooldown_seconds":300%';