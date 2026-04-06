-- Fix: Add all 16 legacy step_keys that exist in DB but were missing from trigger whitelist.
-- All 16 are status='skipped' across 309 packages — but the trigger must allow UPDATEs on these rows.

CREATE OR REPLACE FUNCTION public.trg_guard_step_key_ssot()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ssot_keys text[] := ARRAY[
    -- ── Active pipeline steps (FULL_STEP_ORDER) ──
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
    'elite_harden','run_integrity_check','quality_council','auto_publish',
    -- ── Legacy step keys (skipped, kept for backward compat) ──
    'council_review','generate_curriculum','generate_exam_questions',
    'generate_handbook_content','generate_lesson_content','generate_lessons',
    'generate_modules','generate_oral_exam_content','generate_tutor_index',
    'launch_marketing','post_launch_monitor','setup_course_package',
    'setup_storefront','validate_exam_questions','validate_handbook_content',
    'validate_oral_exam_content'
  ];
BEGIN
  IF NEW.step_key IS NOT NULL AND NOT (NEW.step_key = ANY(v_ssot_keys)) THEN
    RAISE EXCEPTION 'SSOT_STEP_KEY_REJECTED: "%" is not a registered pipeline step key.', NEW.step_key;
  END IF;
  RETURN NEW;
END;
$function$;