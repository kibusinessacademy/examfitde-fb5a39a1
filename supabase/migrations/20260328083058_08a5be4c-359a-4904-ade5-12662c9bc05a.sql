
-- PRUNE canonical hash duplicates: keep max 12 per hash per curriculum, reject excess
WITH ranked AS (
  SELECT id, curriculum_id, canonical_hash,
         ROW_NUMBER() OVER (PARTITION BY curriculum_id, canonical_hash ORDER BY created_at DESC) AS rn
  FROM exam_questions
  WHERE status = 'approved'
    AND canonical_hash IS NOT NULL
    AND curriculum_id IN (
      'e06a570a-d810-410d-873a-c87229465f41',
      '97a5a99f-05fb-4328-b298-72268a4b6f84',
      '2c01d31e-e7ed-4b82-b04e-d5094d1dc179',
      'e24f7b10-0740-4729-8abe-e10fe765f6db',
      '105dd602-ea07-478f-8593-fd149ec5b676',
      '604d730d-e008-468a-b4ef-a9477de06ef4',
      '2b9715cb-6cea-40ab-8a34-16cec0b1e74c',
      '63635f46-0186-49e7-80c1-67925dbdf638'
    )
),
to_reject AS (
  SELECT id FROM ranked WHERE rn > 12
)
UPDATE exam_questions
SET status = 'rejected',
    qc_status = 'rejected'
WHERE id IN (SELECT id FROM to_reject);

-- Log the pruning action
INSERT INTO auto_heal_log (action_type, trigger_source, target_type, result_status, result_detail, metadata)
VALUES (
  'canonical_density_prune',
  'elite_abnahme_forensik',
  'exam_questions',
  'success',
  'Pruned canonical hash duplicates >12 per bucket across 8 elite curricula',
  '{"affected_curricula": 8, "description": "Keep max 12 per canonical_hash, reject excess"}'::jsonb
);
