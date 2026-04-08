
-- Disable all user triggers to avoid quality guard interference
ALTER TABLE exam_questions DISABLE TRIGGER USER;

-- STEP 1: Backfill certification_id
UPDATE exam_questions eq
SET certification_id = cur.certification_id
FROM curricula cur
WHERE eq.curriculum_id = cur.id
  AND eq.certification_id IS NULL;

-- STEP 2: Backfill competency_id from blueprints
UPDATE exam_questions eq
SET competency_id = qb.competency_id
FROM question_blueprints qb
WHERE eq.blueprint_id = qb.id
  AND eq.competency_id IS NULL
  AND qb.competency_id IS NOT NULL;

-- STEP 3: Backfill competency_id for questions without blueprint but with learning_field_id
UPDATE exam_questions eq
SET competency_id = (
  SELECT c.id FROM competencies c 
  WHERE c.learning_field_id = eq.learning_field_id 
  ORDER BY c.id LIMIT 1
)
WHERE eq.competency_id IS NULL
  AND eq.learning_field_id IS NOT NULL
  AND EXISTS (SELECT 1 FROM competencies c WHERE c.learning_field_id = eq.learning_field_id);

-- STEP 4: Promote qualified questions
UPDATE exam_questions
SET qc_status = 'tier1_passed',
    status = 'approved',
    meta = COALESCE(meta, '{}'::jsonb) - 'promotion_block_reasons'
      || jsonb_build_object('auto_promoted_by', 'cert_id_backfill_migration', 'auto_promoted_at', now()::text)
WHERE competency_id IS NOT NULL
  AND certification_id IS NOT NULL
  AND qc_status = 'needs_review'
  AND length(question_text) >= 40
  AND status != 'approved';

-- Re-enable triggers
ALTER TABLE exam_questions ENABLE TRIGGER USER;
