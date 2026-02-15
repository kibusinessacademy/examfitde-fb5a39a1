
-- Add deepseek to provider_status if not exists
INSERT INTO public.provider_status (provider, is_healthy, priority, max_concurrency, current_load)
VALUES ('deepseek', true, 4, 5, 0)
ON CONFLICT (provider) DO NOTHING;

-- Ensure google exists with correct priority
INSERT INTO public.provider_status (provider, is_healthy, priority, max_concurrency, current_load)
VALUES ('google', true, 3, 8, 0)
ON CONFLICT (provider) DO NOTHING;

-- Create provider_intent_affinity table for routing weights
CREATE TABLE IF NOT EXISTS public.provider_intent_affinity (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL,
  intent text NOT NULL,
  weight numeric NOT NULL DEFAULT 0.5,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, intent)
);

ALTER TABLE public.provider_intent_affinity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role full access on provider_intent_affinity"
  ON public.provider_intent_affinity
  FOR ALL
  USING (true)
  WITH CHECK (true);

-- Seed intent affinities
INSERT INTO public.provider_intent_affinity (provider, intent, weight)
VALUES
  ('openai', 'exam_generation', 0.9),
  ('openai', 'scoring', 0.9),
  ('openai', 'structured_json', 0.95),
  ('anthropic', 'didactic_text', 0.9),
  ('anthropic', 'quality_validation', 0.85),
  ('anthropic', 'tutor_coaching', 0.9),
  ('google', 'bulk_content', 0.9),
  ('google', 'seo_generation', 0.85),
  ('google', 'handbook_generation', 0.85),
  ('deepseek', 'extraction', 0.85),
  ('deepseek', 'seo_generation', 0.8),
  ('deepseek', 'marketing_copy', 0.8)
ON CONFLICT (provider, intent) DO NOTHING;
