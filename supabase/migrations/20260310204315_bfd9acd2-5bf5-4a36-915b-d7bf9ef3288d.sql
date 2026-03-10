
-- Purge ALL Gemini/Google routes from DB routing rules
-- Replace with Anthropic primary + OpenAI fallback (matching hardcoded table)
-- This is the ROOT CAUSE of ops_empty_response failures

-- Step 1: Delete all Google/Gemini entries
DELETE FROM public.model_routing_rules 
WHERE provider = 'lovable' AND model ILIKE '%gemini%';

DELETE FROM public.model_routing_rules 
WHERE provider = 'lovable' AND model ILIKE '%google%';

DELETE FROM public.model_routing_rules 
WHERE provider = 'google';

-- Step 2: Ensure correct Anthropic + OpenAI routes exist for all intents
-- (upsert pattern: delete existing anthropic/openai, re-insert clean)
DELETE FROM public.model_routing_rules 
WHERE intent NOT IN ('embeddings', 'images');

-- Step 3: Insert clean routes for all non-special intents
INSERT INTO public.model_routing_rules (intent, provider, model, priority, is_fallback, enabled)
VALUES
  ('learning_content', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('learning_content', 'lovable', 'openai/gpt-5', 2, true, true),
  ('learning_course', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('learning_course', 'lovable', 'openai/gpt-5', 2, true, true),
  ('exam_questions', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('exam_questions', 'lovable', 'openai/gpt-5', 2, true, true),
  ('oral_exam', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('oral_exam', 'lovable', 'openai/gpt-5', 2, true, true),
  ('handbook', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('handbook', 'lovable', 'openai/gpt-5', 2, true, true),
  ('minicheck', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('minicheck', 'lovable', 'openai/gpt-5', 2, true, true),
  ('seo_content', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('seo_content', 'lovable', 'openai/gpt-5', 2, true, true),
  ('council_review', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('council_review', 'lovable', 'openai/gpt-5', 2, true, true),
  ('council_proposer', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('council_proposer', 'lovable', 'openai/gpt-5', 2, true, true),
  ('council_validator', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('council_validator', 'lovable', 'openai/gpt-5', 2, true, true),
  ('quality_audit', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('quality_audit', 'lovable', 'openai/gpt-5', 2, true, true),
  ('support', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('support', 'lovable', 'openai/gpt-5', 2, true, true),
  ('summary', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('summary', 'lovable', 'openai/gpt-5', 2, true, true),
  ('repair', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('repair', 'lovable', 'openai/gpt-5', 2, true, true),
  ('repair_content', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('repair_content', 'lovable', 'openai/gpt-5', 2, true, true),
  ('blooms_classify', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('blooms_classify', 'lovable', 'openai/gpt-5', 2, true, true),
  ('curriculum_import', 'anthropic', 'claude-sonnet-4-5-20250929', 1, false, true),
  ('curriculum_import', 'lovable', 'openai/gpt-5', 2, true, true);
