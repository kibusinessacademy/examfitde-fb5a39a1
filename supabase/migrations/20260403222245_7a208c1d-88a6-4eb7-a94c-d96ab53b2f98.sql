
-- Fix 1: RPC
CREATE OR REPLACE FUNCTION public.pipeline_write_lesson_content_v2(
  p_lesson_id uuid,
  p_content jsonb,
  p_source text DEFAULT 'unknown'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF COALESCE((p_content->>'_placeholder')::boolean, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'COUNCIL_REQUIRED: pipeline_write_lesson_content_v2 accepts placeholder-only content.';
  END IF;
  PERFORM set_config('council.publish_bypass', 'true', true);
  UPDATE public.lessons
  SET content = p_content, status = 'placeholder'
  WHERE id = p_lesson_id;
  INSERT INTO public.admin_actions (action, payload)
  VALUES ('pipeline_write_v2', jsonb_build_object('lesson_id', p_lesson_id, 'source', p_source, 'at', now()));
  PERFORM set_config('council.publish_bypass', 'false', true);
END;
$$;

-- Fix 2: Step key guard with new variant steps
CREATE OR REPLACE FUNCTION public.trg_guard_step_key_ssot()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  v_ssot_keys text[] := ARRAY[
    'scaffold_learning_course','generate_glossary','fanout_learning_content',
    'generate_learning_content','finalize_learning_content','validate_learning_content',
    'auto_seed_exam_blueprints','validate_blueprints',
    'generate_blueprint_variants','validate_blueprint_variants','promote_blueprint_variants',
    'generate_exam_pool','validate_exam_pool',
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
$$;

-- Fix 3: Direct insert of missing steps (ON CONFLICT safe)
INSERT INTO public.package_steps (package_id, step_key, status, meta, created_at, updated_at)
VALUES
  ('a0b0c0d0-0010-4000-8000-000000000001', 'generate_blueprint_variants', 'queued', '{"seeded_by":"migration_backfill"}'::jsonb, now(), now()),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'validate_blueprint_variants', 'queued', '{"seeded_by":"migration_backfill"}'::jsonb, now(), now()),
  ('a0b0c0d0-0010-4000-8000-000000000001', 'promote_blueprint_variants', 'queued', '{"seeded_by":"migration_backfill"}'::jsonb, now(), now())
ON CONFLICT (package_id, step_key) DO NOTHING;
