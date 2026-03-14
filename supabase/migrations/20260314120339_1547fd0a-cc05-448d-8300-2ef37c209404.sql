
-- Update existing DB routing rules from Haiku 4.5 to Haiku 3.5
UPDATE public.model_routing_rules
SET model = 'claude-3-5-haiku-20241022', updated_at = now()
WHERE model = 'claude-haiku-4-5-20251001' AND provider = 'anthropic';
