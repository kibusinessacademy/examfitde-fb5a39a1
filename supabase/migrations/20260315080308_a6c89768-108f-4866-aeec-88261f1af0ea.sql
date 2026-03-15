-- SYSTEMIC FIX: Add Anthropic cross-provider fallback to ALL OpenAI-only intents
-- This prevents death spirals when OpenAI rate-limits

-- For each all-OpenAI intent, shift existing priority 2 → 3, insert Anthropic at 2
-- Skip embeddings and images (provider-locked)

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN 
    SELECT intent
    FROM model_routing_rules
    WHERE enabled = true
    GROUP BY intent
    HAVING NOT 'anthropic' = ANY(array_agg(DISTINCT provider))
      AND intent NOT IN ('embeddings', 'images')
  LOOP
    -- Shift existing priority 2+ up by 1
    UPDATE model_routing_rules
    SET priority = priority + 1, updated_at = now()
    WHERE intent = r.intent AND priority >= 2;

    -- Insert Anthropic at priority 2
    INSERT INTO model_routing_rules (intent, provider, model, priority, is_fallback, enabled, ab_weight, notes)
    VALUES (r.intent, 'anthropic', 'claude-haiku-4-5-20251001', 2, true, true, 100, 
            'Systemic fix: cross-provider escape to prevent OpenAI death spiral');

    -- Add GPT-5.2 as final strong fallback if not already present
    IF NOT EXISTS (
      SELECT 1 FROM model_routing_rules 
      WHERE intent = r.intent AND model = 'gpt-5.2'
    ) THEN
      INSERT INTO model_routing_rules (intent, provider, model, priority, is_fallback, enabled, ab_weight, notes)
      VALUES (r.intent, 'openai', 'gpt-5.2', 
              (SELECT COALESCE(MAX(priority), 3) + 1 FROM model_routing_rules WHERE intent = r.intent),
              true, true, 100, 'Strong fallback tier');
    END IF;
  END LOOP;
END $$;