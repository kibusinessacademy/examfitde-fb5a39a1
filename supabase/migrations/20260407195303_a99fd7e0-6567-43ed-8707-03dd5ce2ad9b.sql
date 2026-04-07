
-- Cancel duplicate pending blueprint variant jobs for the affected package
UPDATE job_queue
SET status = 'cancelled', updated_at = now()
WHERE job_type = 'package_generate_blueprint_variants'
  AND package_id = '2e8da39f-60f8-44d9-8b70-e1176222ca55'
  AND status = 'pending';

-- Repair inventory: set materialized_count based on actual exam_question_variants
UPDATE blueprint_variant_inventory bvi
SET 
  materialized_count = sub.total,
  approved_count = sub.review_ready,
  status = CASE 
    WHEN sub.total >= bvi.target_count THEN 'ready'
    WHEN sub.total > 0 THEN 'partial'
    ELSE 'missing'
  END,
  updated_at = now()
FROM (
  SELECT eqv.blueprint_id, count(*) as total,
    count(*) filter (where eqv.status IN ('review','approved','promoted')) as review_ready
  FROM exam_question_variants eqv
  JOIN question_blueprints qb ON qb.id = eqv.blueprint_id
  WHERE qb.curriculum_id = 'e24f7b10-0740-4729-8abe-e10fe765f6db'
  GROUP BY eqv.blueprint_id
) sub
WHERE bvi.blueprint_id = sub.blueprint_id
  AND bvi.curriculum_id = 'e24f7b10-0740-4729-8abe-e10fe765f6db';
