
-- ============================================================
-- SSOT Threshold Function + Unified DB Guard + Reconcile Views
-- Mirrors artifact-thresholds.ts v1
-- ============================================================

-- 1. Central threshold function
CREATE OR REPLACE FUNCTION public.get_artifact_threshold(
  p_step_key TEXT,
  p_artifact TEXT,
  p_context JSONB DEFAULT '{}'::jsonb
)
RETURNS INTEGER
LANGUAGE plpgsql IMMUTABLE
AS $$
DECLARE
  v_lf_count INTEGER;
  v_comp_count INTEGER;
  v_chapter_count INTEGER;
  v_section_count INTEGER;
  v_exam_target INTEGER;
BEGIN
  v_lf_count := COALESCE((p_context->>'learningFieldCount')::int, 1);
  v_comp_count := COALESCE((p_context->>'competencyCount')::int, 5);
  v_chapter_count := COALESCE((p_context->>'chapterCount')::int, 1);
  v_section_count := COALESCE((p_context->>'sectionCount')::int, 1);
  v_exam_target := COALESCE((p_context->>'examTarget')::int, 1000);

  CASE p_step_key
    WHEN 'scaffold_learning_course' THEN
      IF p_artifact = 'modules' THEN RETURN GREATEST(1, v_lf_count);
      ELSIF p_artifact = 'lessons' THEN RETURN GREATEST(5, v_comp_count);
      END IF;
    WHEN 'auto_seed_exam_blueprints' THEN
      RETURN GREATEST(3, GREATEST(10, v_lf_count * 2));
    WHEN 'generate_exam_pool' THEN
      RETURN GREATEST(50, (v_exam_target * 5) / 100);
    WHEN 'generate_handbook' THEN
      RETURN GREATEST(1, v_chapter_count);
    WHEN 'expand_handbook' THEN
      RETURN GREATEST(1, CEIL(v_section_count * 0.8)::int);
    WHEN 'generate_glossary' THEN RETURN 10;
    WHEN 'generate_oral_exam' THEN RETURN 10;
    WHEN 'generate_lesson_minichecks' THEN RETURN 5;
    WHEN 'build_ai_tutor_index' THEN RETURN 1;
    WHEN 'run_integrity_check' THEN RETURN 2;
    WHEN 'validate_blueprints' THEN RETURN 10;
    WHEN 'validate_oral_exam' THEN RETURN 10;
    WHEN 'validate_exam_pool' THEN RETURN 50;
    WHEN 'validate_lesson_minichecks' THEN RETURN 1;
    WHEN 'validate_handbook' THEN RETURN 3;
    WHEN 'validate_tutor_index' THEN RETURN 1;
    WHEN 'validate_learning_content' THEN RETURN 1;
    ELSE RETURN 0;
  END CASE;
  RETURN 0;
END;
$$;

-- 2. Drop old individual guard functions/triggers
DO $$
DECLARE
  fn_name TEXT;
BEGIN
  FOR fn_name IN
    SELECT routine_name FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name LIKE 'guard_%_step_done'
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_%s ON public.package_steps', fn_name);
    EXECUTE format('DROP FUNCTION IF EXISTS public.%s() CASCADE', fn_name);
  END LOOP;
END $$;

-- 3. Unified threshold-aware guard trigger
CREATE OR REPLACE FUNCTION public.guard_step_done_thresholds()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  v_curriculum_id UUID;
  v_course_id UUID;
  v_actual INTEGER;
  v_threshold INTEGER;
  v_lf_count INTEGER;
  v_comp_count INTEGER;
  v_chapter_count INTEGER;
  v_chapter_ids UUID[];
  v_mod_ids UUID[];
  v_beruf_id UUID;
  v_report JSONB;
  v_version TEXT;
  v_key_count INTEGER;
BEGIN
  IF NEW.status IS DISTINCT FROM 'done' OR OLD.status = 'done' THEN
    RETURN NEW;
  END IF;

  SELECT course_id, curriculum_id INTO v_course_id, v_curriculum_id
  FROM public.course_packages WHERE id = NEW.package_id;
  IF NOT FOUND THEN RETURN NEW; END IF;

  -- scaffold_learning_course
  IF NEW.step_key = 'scaffold_learning_course' AND v_course_id IS NOT NULL THEN
    SELECT count(*) INTO v_actual FROM public.modules WHERE course_id = v_course_id;
    SELECT count(*) INTO v_lf_count FROM public.learning_fields WHERE curriculum_id = v_curriculum_id;
    v_threshold := public.get_artifact_threshold('scaffold_learning_course', 'modules',
      jsonb_build_object('learningFieldCount', v_lf_count));
    IF v_actual < v_threshold THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_THRESHOLD:scaffold:modules:%s/%s', v_actual, v_threshold);
      RETURN NEW;
    END IF;
    SELECT array_agg(id) INTO v_mod_ids FROM public.modules WHERE course_id = v_course_id;
    IF v_mod_ids IS NOT NULL THEN
      SELECT count(*) INTO v_actual FROM public.lessons WHERE module_id = ANY(v_mod_ids);
    ELSE v_actual := 0; END IF;
    SELECT count(*) INTO v_comp_count FROM public.competencies c
      JOIN public.learning_fields lf ON c.learning_field_id = lf.id WHERE lf.curriculum_id = v_curriculum_id;
    v_threshold := public.get_artifact_threshold('scaffold_learning_course', 'lessons',
      jsonb_build_object('competencyCount', v_comp_count));
    IF v_actual < v_threshold THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_THRESHOLD:scaffold:lessons:%s/%s', v_actual, v_threshold);
      RETURN NEW;
    END IF;
  END IF;

  -- auto_seed_exam_blueprints
  IF NEW.step_key = 'auto_seed_exam_blueprints' AND v_curriculum_id IS NOT NULL THEN
    SELECT count(*) INTO v_actual FROM public.question_blueprints WHERE curriculum_id = v_curriculum_id;
    SELECT count(*) INTO v_lf_count FROM public.learning_fields WHERE curriculum_id = v_curriculum_id;
    v_threshold := public.get_artifact_threshold('auto_seed_exam_blueprints', 'question_blueprints',
      jsonb_build_object('learningFieldCount', v_lf_count));
    IF v_actual < v_threshold THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_THRESHOLD:blueprints:count:%s/%s', v_actual, v_threshold);
      RETURN NEW;
    END IF;
  END IF;

  -- generate_exam_pool (default exam_target=1000 since course_packages has no meta column)
  IF NEW.step_key = 'generate_exam_pool' AND v_curriculum_id IS NOT NULL THEN
    SELECT count(*) INTO v_actual FROM public.exam_questions
      WHERE curriculum_id = v_curriculum_id AND status != 'rejected';
    v_threshold := public.get_artifact_threshold('generate_exam_pool', 'exam_questions',
      jsonb_build_object('examTarget', 1000));
    IF v_actual < v_threshold THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_THRESHOLD:exam_pool:count:%s/%s', v_actual, v_threshold);
      RETURN NEW;
    END IF;
  END IF;

  -- generate_oral_exam
  IF NEW.step_key = 'generate_oral_exam' AND v_curriculum_id IS NOT NULL THEN
    SELECT count(*) INTO v_actual FROM public.oral_exam_blueprints WHERE curriculum_id = v_curriculum_id;
    v_threshold := public.get_artifact_threshold('generate_oral_exam', 'oral_exam_blueprints');
    IF v_actual < v_threshold THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_THRESHOLD:oral_exam:blueprints:%s/%s', v_actual, v_threshold);
      RETURN NEW;
    END IF;
  END IF;

  -- generate_lesson_minichecks
  IF NEW.step_key = 'generate_lesson_minichecks' AND v_curriculum_id IS NOT NULL THEN
    SELECT count(*) INTO v_actual FROM public.minicheck_questions WHERE curriculum_id = v_curriculum_id;
    v_threshold := public.get_artifact_threshold('generate_lesson_minichecks', 'minicheck_questions');
    IF v_actual < v_threshold THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_THRESHOLD:minichecks:count:%s/%s', v_actual, v_threshold);
      RETURN NEW;
    END IF;
  END IF;

  -- generate_handbook
  IF NEW.step_key = 'generate_handbook' AND v_curriculum_id IS NOT NULL THEN
    SELECT array_agg(id) INTO v_chapter_ids FROM public.handbook_chapters WHERE curriculum_id = v_curriculum_id;
    v_chapter_count := COALESCE(array_length(v_chapter_ids, 1), 0);
    IF v_chapter_ids IS NOT NULL THEN
      SELECT count(*) INTO v_actual FROM public.handbook_sections WHERE chapter_id = ANY(v_chapter_ids);
    ELSE v_actual := 0; END IF;
    v_threshold := public.get_artifact_threshold('generate_handbook', 'handbook_sections',
      jsonb_build_object('chapterCount', v_chapter_count));
    IF v_actual < v_threshold THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_THRESHOLD:handbook:sections:%s/%s', v_actual, v_threshold);
      RETURN NEW;
    END IF;
  END IF;

  -- build_ai_tutor_index
  IF NEW.step_key = 'build_ai_tutor_index' THEN
    SELECT count(*) INTO v_actual FROM public.ai_tutor_context_index WHERE package_id = NEW.package_id;
    v_threshold := public.get_artifact_threshold('build_ai_tutor_index', 'ai_tutor_context_index');
    IF v_actual < v_threshold THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_THRESHOLD:tutor_index:count:%s/%s', v_actual, v_threshold);
      RETURN NEW;
    END IF;
  END IF;

  -- run_integrity_check
  IF NEW.step_key = 'run_integrity_check' THEN
    SELECT integrity_report, integrity_report_version INTO v_report, v_version
    FROM public.course_packages WHERE id = NEW.package_id;
    IF v_report IS NULL OR v_version IS NULL THEN
      NEW.status := 'failed';
      NEW.last_error := 'GUARD_THRESHOLD:integrity:report_missing';
      RETURN NEW;
    END IF;
    SELECT count(*) INTO v_key_count FROM jsonb_object_keys(v_report);
    v_threshold := public.get_artifact_threshold('run_integrity_check', 'integrity_report_keys');
    IF v_key_count < v_threshold THEN
      NEW.status := 'failed';
      NEW.last_error := format('GUARD_THRESHOLD:integrity:report_keys:%s/%s', v_key_count, v_threshold);
      RETURN NEW;
    END IF;
  END IF;

  -- generate_glossary
  IF NEW.step_key = 'generate_glossary' AND v_curriculum_id IS NOT NULL THEN
    SELECT beruf_id INTO v_beruf_id FROM public.curricula WHERE id = v_curriculum_id;
    IF v_beruf_id IS NOT NULL THEN
      SELECT count(*) INTO v_actual FROM public.profession_glossaries WHERE beruf_id = v_beruf_id;
      v_threshold := public.get_artifact_threshold('generate_glossary', 'glossary_entries');
      IF v_actual < v_threshold THEN
        NEW.status := 'failed';
        NEW.last_error := format('GUARD_THRESHOLD:glossary:entries:%s/%s', v_actual, v_threshold);
        RETURN NEW;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_step_done_thresholds ON public.package_steps;
CREATE TRIGGER trg_guard_step_done_thresholds
  BEFORE UPDATE ON public.package_steps
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_step_done_thresholds();

-- 4. Threshold-aware reconcile views

-- Drop old views if they exist
DROP VIEW IF EXISTS public.ops_step_done_below_threshold;
DROP VIEW IF EXISTS public.ops_guard_threshold_rejections;
DROP VIEW IF EXISTS public.ops_step_done_artifact_missing;
DROP VIEW IF EXISTS public.ops_artifact_present_step_not_done;
DROP VIEW IF EXISTS public.ops_guard_rejections;

-- View: steps marked done but below SSOT threshold
CREATE OR REPLACE VIEW public.ops_step_done_below_threshold AS
WITH bp_check AS (
  SELECT ps.package_id, ps.step_key, ps.updated_at,
    (SELECT count(*) FROM public.question_blueprints WHERE curriculum_id = cp.curriculum_id) AS actual,
    public.get_artifact_threshold('auto_seed_exam_blueprints', 'question_blueprints',
      jsonb_build_object('learningFieldCount',
        (SELECT count(*) FROM public.learning_fields WHERE curriculum_id = cp.curriculum_id)
      )) AS threshold
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE ps.status = 'done' AND ps.step_key = 'auto_seed_exam_blueprints' AND cp.curriculum_id IS NOT NULL
),
eq_check AS (
  SELECT ps.package_id, ps.step_key, ps.updated_at,
    (SELECT count(*) FROM public.exam_questions WHERE curriculum_id = cp.curriculum_id AND status != 'rejected') AS actual,
    public.get_artifact_threshold('generate_exam_pool', 'exam_questions') AS threshold
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE ps.status = 'done' AND ps.step_key = 'generate_exam_pool' AND cp.curriculum_id IS NOT NULL
),
oe_check AS (
  SELECT ps.package_id, ps.step_key, ps.updated_at,
    (SELECT count(*) FROM public.oral_exam_blueprints WHERE curriculum_id = cp.curriculum_id) AS actual,
    public.get_artifact_threshold('generate_oral_exam', 'oral_exam_blueprints') AS threshold
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE ps.status = 'done' AND ps.step_key = 'generate_oral_exam' AND cp.curriculum_id IS NOT NULL
),
mc_check AS (
  SELECT ps.package_id, ps.step_key, ps.updated_at,
    (SELECT count(*) FROM public.minicheck_questions WHERE curriculum_id = cp.curriculum_id) AS actual,
    public.get_artifact_threshold('generate_lesson_minichecks', 'minicheck_questions') AS threshold
  FROM public.package_steps ps
  JOIN public.course_packages cp ON cp.id = ps.package_id
  WHERE ps.status = 'done' AND ps.step_key = 'generate_lesson_minichecks' AND cp.curriculum_id IS NOT NULL
),
ti_check AS (
  SELECT ps.package_id, ps.step_key, ps.updated_at,
    (SELECT count(*) FROM public.ai_tutor_context_index WHERE package_id = ps.package_id) AS actual,
    public.get_artifact_threshold('build_ai_tutor_index', 'ai_tutor_context_index') AS threshold
  FROM public.package_steps ps
  WHERE ps.status = 'done' AND ps.step_key = 'build_ai_tutor_index'
)
SELECT package_id, step_key, actual, threshold, updated_at,
  'DRIFT:done_below_threshold' AS drift_type
FROM (
  SELECT * FROM bp_check UNION ALL
  SELECT * FROM eq_check UNION ALL
  SELECT * FROM oe_check UNION ALL
  SELECT * FROM mc_check UNION ALL
  SELECT * FROM ti_check
) combined
WHERE actual < threshold;

-- View: guard rejections
CREATE OR REPLACE VIEW public.ops_guard_threshold_rejections AS
SELECT package_id, step_key, status, last_error, updated_at
FROM public.package_steps
WHERE status = 'failed' AND last_error LIKE 'GUARD_THRESHOLD:%'
ORDER BY updated_at DESC;

-- Revoke anon/authenticated access
REVOKE SELECT ON public.ops_step_done_below_threshold FROM anon, authenticated;
REVOKE SELECT ON public.ops_guard_threshold_rejections FROM anon, authenticated;
