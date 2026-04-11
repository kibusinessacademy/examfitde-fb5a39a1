
-- 1. Auto-link minicheck_questions to lessons via competency
CREATE OR REPLACE FUNCTION fn_auto_link_minicheck_lesson()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_lesson_id uuid;
BEGIN
  IF NEW.lesson_id IS NULL AND NEW.competency_id IS NOT NULL THEN
    SELECT id INTO v_lesson_id
    FROM lessons
    WHERE competency_id = NEW.competency_id
    ORDER BY sort_order ASC, created_at ASC
    LIMIT 1;
    
    IF v_lesson_id IS NOT NULL THEN
      NEW.lesson_id := v_lesson_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_minicheck_lesson ON minicheck_questions;
CREATE TRIGGER trg_auto_link_minicheck_lesson
  BEFORE INSERT ON minicheck_questions
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_link_minicheck_lesson();

-- 2. Auto-link handbook_sections to competencies via learning_field
CREATE OR REPLACE FUNCTION fn_auto_link_handbook_competency()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_comp_id uuid;
BEGIN
  IF NEW.competency_id IS NULL AND NEW.learning_field_id IS NOT NULL THEN
    SELECT id INTO v_comp_id
    FROM competencies
    WHERE learning_field_id = NEW.learning_field_id
    ORDER BY sort_order ASC, created_at ASC
    LIMIT 1;
    
    IF v_comp_id IS NOT NULL THEN
      NEW.competency_id := v_comp_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_link_handbook_competency ON handbook_sections;
CREATE TRIGGER trg_auto_link_handbook_competency
  BEFORE INSERT ON handbook_sections
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_link_handbook_competency();

-- 3. Auto-create product when package transitions to building
CREATE OR REPLACE FUNCTION fn_auto_create_product_for_package()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_product_id uuid;
BEGIN
  IF NEW.product_id IS NULL 
     AND NEW.status IN ('building', 'blocked', 'published')
     AND NEW.curriculum_id IS NOT NULL THEN
    
    INSERT INTO products (
      id, title, certification_id, curriculum_id, active_package_id,
      product_type, status, visibility, slug
    ) VALUES (
      gen_random_uuid(),
      COALESCE(NEW.title, 'Untitled'),
      NEW.certification_id,
      NEW.curriculum_id,
      NEW.id,
      CASE 
        WHEN NEW.track IN ('EXAM_FIRST', 'EXAM_FIRST_PLUS') THEN 'exam_trainer'
        ELSE 'course'
      END,
      'draft',
      'private',
      lower(regexp_replace(regexp_replace(COALESCE(NEW.title, 'pkg'), '[^a-zA-Z0-9äöüÄÖÜß\s-]', '', 'g'), '\s+', '-', 'g'))
        || '-' || left(NEW.id::text, 8)
    )
    RETURNING id INTO v_product_id;
    
    NEW.product_id := v_product_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_create_product_for_package ON course_packages;
CREATE TRIGGER trg_auto_create_product_for_package
  BEFORE INSERT OR UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION fn_auto_create_product_for_package();
