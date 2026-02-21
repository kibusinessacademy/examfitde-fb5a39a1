
-- =============================================
-- EXAM-FIRST PIVOT: Default product = Prüfungsfragen + AI-Tutor + Oral-Exam
-- Learning Course + Handbook = future expansion
-- =============================================

-- 1) Update derive_feature_flags: EXAM_FIRST now includes oral + ai_tutor
CREATE OR REPLACE FUNCTION public.derive_feature_flags(
  p_track public.product_track,
  p_cert_type public.certification_type
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
SET search_path = public
AS $$
BEGIN
  IF p_track = 'AUSBILDUNG_VOLL' THEN
    RETURN jsonb_build_object(
      'has_learning_course', true,
      'has_practice_course_h5p', true,
      'has_minichecks', true,
      'has_exam_trainer', true,
      'has_exam_simulation', true,
      'has_oral_exam_trainer', true,
      'has_ai_tutor', true,
      'has_handbook', true,
      'ai_tutor_mode', 'full'
    );
  ELSE
    -- EXAM_FIRST: Prüfungsfragen + AI-Tutor + Oral-Exam-Trainer
    RETURN jsonb_build_object(
      'has_learning_course', false,
      'has_practice_course_h5p', false,
      'has_minichecks', false,
      'has_exam_trainer', true,
      'has_exam_simulation', true,
      'has_oral_exam_trainer', true,
      'has_ai_tutor', true,
      'has_handbook', false,
      'ai_tutor_mode', 'limited_exam'
    );
  END IF;
END;
$$;

-- 2) Update auto_set_track_defaults: Default track = EXAM_FIRST
CREATE OR REPLACE FUNCTION public.auto_set_track_defaults()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  -- Default track is now EXAM_FIRST (was AUSBILDUNG_VOLL)
  IF NEW.track IS NULL THEN
    NEW.track := 'EXAM_FIRST';
  END IF;

  -- Derive feature_flags if not custom-set
  IF NEW.feature_flags IS NULL OR NEW.feature_flags = '{}'::jsonb THEN
    NEW.feature_flags := public.derive_feature_flags(NEW.track, COALESCE(NEW.certification_type, 'ausbildung'));
  END IF;

  RETURN NEW;
END;
$$;

-- 3) Update column defaults on course_packages
ALTER TABLE public.course_packages
  ALTER COLUMN track SET DEFAULT 'EXAM_FIRST',
  ALTER COLUMN feature_flags SET DEFAULT '{
    "has_learning_course": false,
    "has_practice_course_h5p": false,
    "has_minichecks": false,
    "has_exam_trainer": true,
    "has_exam_simulation": true,
    "has_oral_exam_trainer": true,
    "has_ai_tutor": true,
    "has_handbook": false,
    "ai_tutor_mode": "limited_exam"
  }'::jsonb;

-- 4) Update existing packages that are still in draft/planning/queued to EXAM_FIRST
UPDATE public.course_packages
SET track = 'EXAM_FIRST',
    feature_flags = jsonb_build_object(
      'has_learning_course', false,
      'has_practice_course_h5p', false,
      'has_minichecks', false,
      'has_exam_trainer', true,
      'has_exam_simulation', true,
      'has_oral_exam_trainer', true,
      'has_ai_tutor', true,
      'has_handbook', false,
      'ai_tutor_mode', 'limited_exam'
    )
WHERE status IN ('draft', 'planning', 'queued', 'extracting', 'normalizing')
  AND track = 'AUSBILDUNG_VOLL';

-- 5) Update get_track_pipeline_steps to include glossary+validation steps
CREATE OR REPLACE FUNCTION public.get_track_pipeline_steps(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
  v_flags jsonb;
  v_steps jsonb := '[]'::jsonb;
BEGIN
  SELECT feature_flags INTO v_flags
  FROM public.course_packages WHERE id = p_package_id;

  IF v_flags IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Learning course (scaffold + glossary + content + validate)
  IF (v_flags->>'has_learning_course')::boolean THEN
    v_steps := v_steps || '["scaffold_learning_course","generate_glossary","generate_learning_content","validate_learning_content"]'::jsonb;
  END IF;

  -- Exam (blueprints + validate + pool + validate)
  IF (v_flags->>'has_exam_trainer')::boolean THEN
    v_steps := v_steps || '["auto_seed_exam_blueprints","validate_blueprints","generate_exam_pool","validate_exam_pool"]'::jsonb;
  END IF;

  -- Oral exam
  IF (v_flags->>'has_oral_exam_trainer')::boolean THEN
    v_steps := v_steps || '["generate_oral_exam","validate_oral_exam"]'::jsonb;
  END IF;

  -- AI Tutor
  IF (v_flags->>'has_ai_tutor')::boolean THEN
    v_steps := v_steps || '["build_ai_tutor_index","validate_tutor_index"]'::jsonb;
  END IF;

  -- Handbook
  IF (v_flags->>'has_handbook')::boolean THEN
    v_steps := v_steps || '["generate_handbook","validate_handbook"]'::jsonb;
  END IF;

  -- Always: integrity + council + publish
  v_steps := v_steps || '["run_integrity_check","quality_council","auto_publish"]'::jsonb;

  RETURN v_steps;
END;
$$;
