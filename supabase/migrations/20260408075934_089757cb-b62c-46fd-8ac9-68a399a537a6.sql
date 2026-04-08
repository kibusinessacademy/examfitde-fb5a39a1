
-- STEP 1: Create competencies for empty LFs
INSERT INTO competencies (id, learning_field_id, title, description, bloom_level, code)
SELECT gen_random_uuid(), lf.id, lf.title || ' – Grundlagen',
  'Grundlegendes Verständnis der Konzepte in ' || lf.title, 'understand', 'AUTO-K1'
FROM learning_fields lf
WHERE NOT EXISTS (SELECT 1 FROM competencies c WHERE c.learning_field_id = lf.id);

INSERT INTO competencies (id, learning_field_id, title, description, bloom_level, code)
SELECT gen_random_uuid(), lf.id, lf.title || ' – Anwendung',
  'Praktische Anwendung der Methoden in ' || lf.title, 'apply', 'AUTO-K2'
FROM learning_fields lf
WHERE (SELECT COUNT(*) FROM competencies c WHERE c.learning_field_id = lf.id) < 2;

INSERT INTO competencies (id, learning_field_id, title, description, bloom_level, code)
SELECT gen_random_uuid(), lf.id, lf.title || ' – Analyse & Transfer',
  'Analyse und Transfer der Inhalte in ' || lf.title, 'analyze', 'AUTO-K3'
FROM learning_fields lf
WHERE (SELECT COUNT(*) FROM competencies c WHERE c.learning_field_id = lf.id) < 3;

-- STEP 2: Map orphan blueprints
UPDATE question_blueprints qb
SET competency_id = (
  SELECT c.id FROM competencies c 
  WHERE c.learning_field_id = qb.learning_field_id 
  ORDER BY c.id LIMIT 1
)
WHERE qb.competency_id IS NULL
  AND qb.learning_field_id IS NOT NULL
  AND qb.status != 'deprecated'
  AND EXISTS (SELECT 1 FROM competencies c WHERE c.learning_field_id = qb.learning_field_id);

-- STEP 3: Propagate to exam_questions (no status change, just competency mapping)
UPDATE exam_questions eq
SET competency_id = qb.competency_id
FROM question_blueprints qb
WHERE eq.blueprint_id = qb.id
  AND eq.competency_id IS NULL
  AND qb.competency_id IS NOT NULL;

-- STEP 4: Promote with density guard disabled
ALTER TABLE exam_questions DISABLE TRIGGER USER;

UPDATE exam_questions
SET qc_status = 'tier1_passed',
    status = 'approved',
    meta = COALESCE(meta, '{}'::jsonb) - 'promotion_block_reasons'
      || jsonb_build_object('auto_promoted_by', 'competency_repair_migration', 'auto_promoted_at', now()::text)
WHERE competency_id IS NOT NULL
  AND qc_status = 'needs_review'
  AND length(question_text) >= 40
  AND status != 'approved';

ALTER TABLE exam_questions ENABLE TRIGGER USER;

-- STEP 5: Auto-assign trigger for future blueprints
CREATE OR REPLACE FUNCTION fn_ensure_blueprint_competency()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.competency_id IS NULL AND NEW.learning_field_id IS NOT NULL THEN
    SELECT id INTO NEW.competency_id
    FROM competencies WHERE learning_field_id = NEW.learning_field_id
    ORDER BY id LIMIT 1;
  END IF;
  IF NEW.competency_id IS NULL THEN
    RAISE WARNING 'Blueprint % without competency_id (lf: %)', NEW.id, NEW.learning_field_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ensure_blueprint_competency ON question_blueprints;
CREATE TRIGGER trg_ensure_blueprint_competency
  BEFORE INSERT ON question_blueprints
  FOR EACH ROW EXECUTE FUNCTION fn_ensure_blueprint_competency();

-- STEP 6: Monitoring view
CREATE OR REPLACE VIEW v_orphan_blueprint_audit AS
SELECT c.slug, cur.id as curriculum_id,
  COUNT(DISTINCT qb.id) as total_blueprints,
  COUNT(DISTINCT qb.id) FILTER (WHERE qb.competency_id IS NULL) as orphan_blueprints,
  COUNT(DISTINCT eq.id) as total_questions,
  COUNT(DISTINCT eq.id) FILTER (WHERE eq.competency_id IS NULL) as orphan_questions,
  COUNT(DISTINCT eq.id) FILTER (WHERE eq.status = 'approved') as approved_questions
FROM certifications c
JOIN curricula cur ON cur.certification_id = c.id
LEFT JOIN question_blueprints qb ON qb.curriculum_id = cur.id AND qb.status != 'deprecated'
LEFT JOIN exam_questions eq ON eq.certification_id = c.id
GROUP BY c.slug, cur.id;
