
-- Step 1: Update primary model
UPDATE model_routing_rules
SET model = 'gpt-5-mini'
WHERE intent = 'exam_questions' AND priority = 1;

-- Step 2: Shift priority 3 → 4 first, then 2 → 3 (reverse order avoids unique constraint)
UPDATE model_routing_rules
SET priority = 4
WHERE intent = 'exam_questions' AND priority = 3;

UPDATE model_routing_rules
SET priority = 3
WHERE intent = 'exam_questions' AND priority = 2;

-- Step 3: Insert Anthropic at priority 2
INSERT INTO model_routing_rules (intent, provider, model, priority, is_fallback, enabled, ab_weight)
VALUES ('exam_questions', 'anthropic', 'claude-haiku-4-5-20251001', 2, true, true, 100);
