
-- ============================================================
-- STEP 1: Auto-fill trigger for exam_questions
-- Ensures all FK fields are always populated
-- ============================================================

CREATE OR REPLACE FUNCTION fn_exam_question_auto_fill()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_cert_id uuid;
  v_comp_id uuid;
  v_lf_id uuid;
  v_exam_part text;
  v_bp_ctx text;
BEGIN
  -- 1. Derive certification_id from curriculum_id
  IF NEW.certification_id IS NULL AND NEW.curriculum_id IS NOT NULL THEN
    SELECT certification_id INTO v_cert_id
    FROM curricula WHERE id = NEW.curriculum_id;
    IF v_cert_id IS NOT NULL THEN
      NEW.certification_id := v_cert_id;
    END IF;
  END IF;

  -- 2. Derive competency_id and learning_field_id from blueprint
  IF NEW.blueprint_id IS NOT NULL THEN
    IF NEW.competency_id IS NULL OR NEW.learning_field_id IS NULL THEN
      SELECT competency_id, learning_field_id 
      INTO v_comp_id, v_lf_id
      FROM question_blueprints WHERE id = NEW.blueprint_id;
      
      IF NEW.competency_id IS NULL AND v_comp_id IS NOT NULL THEN
        NEW.competency_id := v_comp_id;
      END IF;
      IF NEW.learning_field_id IS NULL AND v_lf_id IS NOT NULL THEN
        NEW.learning_field_id := v_lf_id;
      END IF;
    END IF;
  END IF;

  -- 3. Derive learning_field_id from competency_id
  IF NEW.learning_field_id IS NULL AND NEW.competency_id IS NOT NULL THEN
    SELECT learning_field_id INTO v_lf_id
    FROM competencies WHERE id = NEW.competency_id;
    IF v_lf_id IS NOT NULL THEN
      NEW.learning_field_id := v_lf_id;
    END IF;
  END IF;

  -- 4. Derive curriculum_id from certification_id if missing
  IF NEW.curriculum_id IS NULL AND NEW.certification_id IS NOT NULL THEN
    SELECT id INTO NEW.curriculum_id
    FROM curricula WHERE certification_id = NEW.certification_id
    ORDER BY id LIMIT 1;
  END IF;

  -- 5. Derive exam_part from blueprint context or default
  IF NEW.exam_part IS NULL THEN
    IF NEW.blueprint_id IS NOT NULL THEN
      SELECT exam_context_type INTO v_bp_ctx
      FROM question_blueprints WHERE id = NEW.blueprint_id;
      
      IF v_bp_ctx IN ('case_study', 'strategic_decision', 'multi_step_case') THEN
        NEW.exam_part := 'teil_2';
      ELSE
        NEW.exam_part := 'teil_1';
      END IF;
    ELSE
      NEW.exam_part := 'teil_1';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_exam_question_auto_fill ON exam_questions;
CREATE TRIGGER trg_exam_question_auto_fill
  BEFORE INSERT OR UPDATE ON exam_questions
  FOR EACH ROW
  EXECUTE FUNCTION fn_exam_question_auto_fill();

-- ============================================================
-- STEP 2: Auto-fill trigger for question_blueprints
-- Ensures learning_field_id is derived from competency
-- ============================================================

CREATE OR REPLACE FUNCTION fn_blueprint_auto_fill()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Derive learning_field_id from competency_id
  IF NEW.learning_field_id IS NULL AND NEW.competency_id IS NOT NULL THEN
    SELECT learning_field_id INTO NEW.learning_field_id
    FROM competencies WHERE id = NEW.competency_id;
  END IF;

  -- Derive competency_id from learning_field_id (first competency)
  IF NEW.competency_id IS NULL AND NEW.learning_field_id IS NOT NULL THEN
    SELECT id INTO NEW.competency_id
    FROM competencies WHERE learning_field_id = NEW.learning_field_id
    ORDER BY id LIMIT 1;
  END IF;

  RETURN NEW;
END;
$$;

-- Keep existing trigger, add this one with higher priority
DROP TRIGGER IF EXISTS trg_blueprint_auto_fill ON question_blueprints;
CREATE TRIGGER trg_blueprint_auto_fill
  BEFORE INSERT OR UPDATE ON question_blueprints
  FOR EACH ROW
  EXECUTE FUNCTION fn_blueprint_auto_fill();

-- ============================================================
-- STEP 3: Backfill existing data (with triggers disabled to avoid loops)
-- ============================================================

ALTER TABLE exam_questions DISABLE TRIGGER USER;

-- 3a. Backfill exam_part from blueprint context
UPDATE exam_questions eq
SET exam_part = CASE 
  WHEN qb.exam_context_type IN ('case_study', 'strategic_decision', 'multi_step_case') THEN 'teil_2'
  ELSE 'teil_1'
END
FROM question_blueprints qb
WHERE eq.blueprint_id = qb.id
  AND eq.exam_part IS NULL;

-- 3b. Default remaining NULL exam_parts to teil_1
UPDATE exam_questions
SET exam_part = 'teil_1'
WHERE exam_part IS NULL;

-- 3c. Delete orphan questions (no valid certification via curriculum)
DELETE FROM exam_questions
WHERE certification_id IS NULL
  AND curriculum_id IN (
    SELECT eq.curriculum_id FROM exam_questions eq
    LEFT JOIN curricula cur ON cur.id = eq.curriculum_id
    WHERE eq.certification_id IS NULL AND cur.certification_id IS NULL
  );

ALTER TABLE exam_questions ENABLE TRIGGER USER;

-- ============================================================
-- STEP 4: Monitoring view for data integrity
-- ============================================================

CREATE OR REPLACE VIEW v_data_integrity_audit AS
SELECT 
  c.slug,
  COUNT(*) as total_questions,
  COUNT(*) FILTER (WHERE eq.status = 'approved') as approved,
  COUNT(*) FILTER (WHERE eq.certification_id IS NULL) as null_certification,
  COUNT(*) FILTER (WHERE eq.curriculum_id IS NULL) as null_curriculum,
  COUNT(*) FILTER (WHERE eq.competency_id IS NULL) as null_competency,
  COUNT(*) FILTER (WHERE eq.learning_field_id IS NULL) as null_learning_field,
  COUNT(*) FILTER (WHERE eq.blueprint_id IS NULL) as null_blueprint,
  COUNT(*) FILTER (WHERE eq.exam_part IS NULL) as null_exam_part,
  COUNT(*) FILTER (WHERE eq.cognitive_level IS NULL) as null_cognitive_level,
  COUNT(*) FILTER (WHERE eq.difficulty IS NULL) as null_difficulty,
  CASE WHEN COUNT(*) FILTER (WHERE eq.certification_id IS NULL OR eq.curriculum_id IS NULL OR eq.competency_id IS NULL OR eq.learning_field_id IS NULL) = 0
    THEN 'CLEAN' ELSE 'DRIFT_DETECTED' END as integrity_status
FROM exam_questions eq
LEFT JOIN certifications c ON c.id = eq.certification_id
GROUP BY c.slug
ORDER BY COUNT(*) FILTER (WHERE eq.certification_id IS NULL OR eq.competency_id IS NULL) DESC;
