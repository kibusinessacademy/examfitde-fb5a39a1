
-- 1) Register repair_exam_pool_quality as a valid step key
CREATE OR REPLACE FUNCTION public.trg_guard_step_key_ssot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ssot_keys text[] := ARRAY[
    'scaffold_learning_course','generate_glossary','fanout_learning_content',
    'generate_learning_content','finalize_learning_content','validate_learning_content',
    'auto_seed_exam_blueprints','validate_blueprints',
    'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
    'generate_exam_pool','validate_exam_pool',
    'repair_exam_pool_quality',
    'build_ai_tutor_index','validate_tutor_index',
    'generate_oral_exam','validate_oral_exam',
    'generate_lesson_minichecks','validate_lesson_minichecks',
    'generate_handbook','validate_handbook',
    'enqueue_handbook_expand','expand_handbook','validate_handbook_depth',
    'elite_harden','run_integrity_check','quality_council','auto_publish'
  ];
BEGIN
  IF NEW.step_key IS NOT NULL AND NOT (NEW.step_key = ANY(v_ssot_keys)) THEN
    RAISE EXCEPTION 'SSOT_STEP_KEY_REJECTED: "%" is not a registered pipeline step key.', NEW.step_key;
  END IF;
  RETURN NEW;
END;
$function$;

-- 2) Backfill empty titles from curriculum
UPDATE course_packages cp
SET title = c.title
FROM curricula c
WHERE cp.curriculum_id = c.id
  AND (cp.title IS NULL OR cp.title = '' OR cp.title = ' ');

-- 3) Trigger: auto-fill title from curriculum on INSERT if empty
CREATE OR REPLACE FUNCTION public.trg_backfill_package_title()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF (NEW.title IS NULL OR NEW.title = '' OR NEW.title = ' ') AND NEW.curriculum_id IS NOT NULL THEN
    SELECT c.title INTO NEW.title
    FROM curricula c
    WHERE c.id = NEW.curriculum_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_backfill_package_title ON course_packages;
CREATE TRIGGER trg_backfill_package_title
  BEFORE INSERT OR UPDATE ON course_packages
  FOR EACH ROW
  EXECUTE FUNCTION trg_backfill_package_title();
