
-- Step 1: Fix cognitive_level from blueprint (cast enum to text)
UPDATE exam_questions eq
SET cognitive_level = qb.cognitive_level::text
FROM question_blueprints qb
WHERE eq.blueprint_id = qb.id
  AND eq.curriculum_id = '47e1c73e-e5f9-4042-906f-90da2c63b98a'
  AND eq.cognitive_level != qb.cognitive_level::text;

-- Step 2: Bloom-based difficulty rebalancing using deterministic row assignment
WITH ranked AS (
  SELECT id, cognitive_level,
    ROW_NUMBER() OVER (PARTITION BY cognitive_level ORDER BY id) as rn,
    COUNT(*) OVER (PARTITION BY cognitive_level) as total
  FROM exam_questions
  WHERE curriculum_id = '47e1c73e-e5f9-4042-906f-90da2c63b98a'
),
new_diff AS (
  SELECT id,
    CASE
      WHEN cognitive_level = 'understand' AND (rn::float / total) <= 0.60 THEN 'easy'::question_difficulty
      WHEN cognitive_level = 'understand' AND (rn::float / total) <= 0.95 THEN 'medium'::question_difficulty
      WHEN cognitive_level = 'understand' THEN 'hard'::question_difficulty
      WHEN cognitive_level = 'apply' AND (rn::float / total) <= 0.05 THEN 'easy'::question_difficulty
      WHEN cognitive_level = 'apply' AND (rn::float / total) <= 0.55 THEN 'medium'::question_difficulty
      WHEN cognitive_level = 'apply' AND (rn::float / total) <= 0.90 THEN 'hard'::question_difficulty
      WHEN cognitive_level = 'apply' THEN 'very_hard'::question_difficulty
      WHEN cognitive_level = 'analyze' AND (rn::float / total) <= 0.20 THEN 'medium'::question_difficulty
      WHEN cognitive_level = 'analyze' AND (rn::float / total) <= 0.75 THEN 'hard'::question_difficulty
      WHEN cognitive_level = 'analyze' THEN 'very_hard'::question_difficulty
      WHEN cognitive_level = 'evaluate' AND (rn::float / total) <= 0.10 THEN 'medium'::question_difficulty
      WHEN cognitive_level = 'evaluate' AND (rn::float / total) <= 0.50 THEN 'hard'::question_difficulty
      WHEN cognitive_level = 'evaluate' THEN 'very_hard'::question_difficulty
      WHEN cognitive_level = 'remember' AND (rn::float / total) <= 0.60 THEN 'easy'::question_difficulty
      WHEN cognitive_level = 'remember' AND (rn::float / total) <= 0.90 THEN 'medium'::question_difficulty
      WHEN cognitive_level = 'remember' THEN 'hard'::question_difficulty
      ELSE 'medium'::question_difficulty
    END as new_difficulty
  FROM ranked
)
UPDATE exam_questions eq
SET difficulty = nd.new_difficulty
FROM new_diff nd
WHERE eq.id = nd.id;
