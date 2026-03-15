
-- Fix duplicate: priority 3 was the old gpt-5-mini fallback, now redundant with primary.
-- Replace with gpt-4.1-mini (openai_primary from catalog) as cost-efficient fallback
UPDATE model_routing_rules
SET model = 'gpt-4.1-mini'
WHERE intent = 'exam_questions' AND priority = 3 AND model = 'gpt-5-mini';
