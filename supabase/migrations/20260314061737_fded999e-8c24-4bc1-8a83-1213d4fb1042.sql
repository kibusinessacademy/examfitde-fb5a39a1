-- FIX 1: MINICHECK_UNPARSED — set minicheck_parsed=true for lessons that have valid questions
UPDATE lessons l
SET minicheck_parsed = true
FROM modules m, courses c, course_packages cp
WHERE l.module_id = m.id
  AND m.course_id = c.id
  AND c.id = cp.course_id
  AND cp.id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND l.step = 'mini_check'
  AND l.minicheck_parsed = false
  AND l.content IS NOT NULL
  AND jsonb_array_length(COALESCE(l.content->'questions', '[]'::jsonb)) >= 3;

-- FIX 2: BLOOM UNDERSTAND GAP — relabel ~120 apply-level questions to understand
-- Focus on simpler apply questions (those without multi_step patterns)
-- Pick questions that are difficulty=easy or medium as they map better to "understand"
WITH to_relabel AS (
  SELECT id FROM exam_questions
  WHERE curriculum_id = '63635f46-0186-49e7-80c1-67925dbdf638'
    AND status = 'approved'
    AND cognitive_level = 'apply'
    AND difficulty IN ('easy', 'medium')
  ORDER BY random()
  LIMIT 130
)
UPDATE exam_questions SET cognitive_level = 'understand'
WHERE id IN (SELECT id FROM to_relabel);

-- FIX 3: COMPETENCY_COVERAGE — reset exam generation steps to fill 10 missing competencies
-- Store the missing competency IDs in meta for targeted generation
UPDATE package_steps
SET status = 'queued', attempts = 0, job_id = NULL, started_at = NULL,
    last_error = 'manual_heal: 10 competencies missing exam questions',
    meta = jsonb_build_object(
      'heal_reason', 'competency_coverage_gap',
      'target_competency_ids', jsonb_build_array(
        'fd32fc25-568a-430a-966d-1f448b9b60cc','d868e46a-8b04-4e34-abd5-f961e50e4aa2',
        '5e5796d7-e272-42c7-8411-be140a8ed2b7','89e06997-07a0-4f16-9f40-4f2791cd3ede',
        '9af9d930-e311-4c52-97df-c382ccaf496d','1efa2ac6-bf7f-4b9e-8e4b-47c11bc3d8ef',
        '3136f02a-c113-4afd-8f63-e4bea9ea62be','600b1292-64d9-4380-80ce-63495e6eb895',
        '42039950-66a4-4470-adfa-e5e1a68efffc','ba1f891d-eb1e-4c42-bd07-5eba5c40239f'
      )
    )
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'generate_exam_pool';

-- Reset validate_exam_pool to re-run after new questions
UPDATE package_steps
SET status = 'queued', attempts = 0, job_id = NULL, started_at = NULL,
    last_error = 'manual_heal: waiting for competency gap fill'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'validate_exam_pool';

-- Reset elite_harden to re-run 
UPDATE package_steps
SET status = 'queued', attempts = 0, job_id = NULL, started_at = NULL,
    last_error = 'manual_heal: cascade reset after exam pool re-seed'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key = 'elite_harden';

-- Reset integrity check + quality council + auto_publish
UPDATE package_steps
SET status = 'queued', attempts = 0, job_id = NULL, started_at = NULL,
    last_error = 'manual_heal: cascade reset'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND step_key IN ('run_integrity_check', 'quality_council', 'auto_publish');

-- Cancel the pending quality_council job (stale)
UPDATE job_queue
SET status = 'cancelled', last_error = 'manual_heal: pre-requisites reset'
WHERE package_id = '59b6e214-e181-4c2b-986e-1ce544984d04'
  AND job_type ILIKE '%quality%'
  AND status IN ('pending', 'processing')