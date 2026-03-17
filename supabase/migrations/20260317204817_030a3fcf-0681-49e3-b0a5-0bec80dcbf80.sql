-- Update routing policies to GPT-5.4 mini as primary, gpt-4o-mini as fallback
-- Content generation routes: GPT-5.4 mini primary (better accuracy, fewer retries)
UPDATE llm_provider_routing_policies
SET provider_chain = '[{"provider":"openai","model":"gpt-5.4-mini"},{"provider":"openai","model":"gpt-4o-mini"}]'::jsonb,
    updated_at = now()
WHERE route_key IN (
  'route.learning_content',
  'route.exam_pool',
  'route.handbook',
  'route.validation',
  'route.oral_exam',
  'route.campaign_generation',
  'route.bundle_generation',
  'route.curriculum_enrichment',
  'route.exam_blueprint'
);

-- Lightweight routes: GPT-5.4 nano primary
UPDATE llm_provider_routing_policies
SET provider_chain = '[{"provider":"openai","model":"gpt-5.4-nano"},{"provider":"openai","model":"gpt-4o-mini"}]'::jsonb,
    updated_at = now()
WHERE route_key IN (
  'route.glossary_generation',
  'route.minicheck',
  'route.minichecks'
);