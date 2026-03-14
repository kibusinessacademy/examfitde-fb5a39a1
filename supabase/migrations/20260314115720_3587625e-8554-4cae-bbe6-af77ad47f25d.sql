
-- Add A/B test weight column to model_routing_rules
ALTER TABLE public.model_routing_rules
  ADD COLUMN IF NOT EXISTS ab_weight int NOT NULL DEFAULT 100;

COMMENT ON COLUMN public.model_routing_rules.ab_weight IS 'Traffic weight 0-100 for A/B testing. Routes with same intent+priority split traffic proportionally.';

-- Seed A/B test: Gemini 2.5 Flash at 50% for volumenstarke Intents
-- These run alongside existing Haiku rules (which get ab_weight=100 by default)
INSERT INTO public.model_routing_rules (intent, provider, model, priority, is_fallback, enabled, ab_weight, notes)
VALUES
  ('learning_content', 'google', 'gemini-2.5-flash', 1, false, true, 50, 'A/B test: Gemini Flash vs Haiku for learning_content'),
  ('minicheck',        'google', 'gemini-2.5-flash', 1, false, true, 50, 'A/B test: Gemini Flash vs Haiku for minicheck'),
  ('exam_questions',   'google', 'gemini-2.5-flash', 1, false, true, 50, 'A/B test: Gemini Flash vs Haiku for exam_questions'),
  ('summary',          'google', 'gemini-2.5-flash', 1, false, true, 50, 'A/B test: Gemini Flash vs Haiku for summary'),
  ('blooms_classify',  'google', 'gemini-2.5-flash', 1, false, true, 50, 'A/B test: Gemini Flash vs Haiku for blooms_classify')
ON CONFLICT DO NOTHING;
