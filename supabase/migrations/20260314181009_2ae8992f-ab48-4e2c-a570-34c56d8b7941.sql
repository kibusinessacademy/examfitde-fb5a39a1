
-- v13b: Update the existing priority-2 slot for exam_questions to Haiku
UPDATE public.model_routing_rules
SET provider = 'anthropic',
    model = 'claude-3-5-haiku-latest',
    enabled = true
WHERE intent = 'exam_questions' AND priority = 2;
