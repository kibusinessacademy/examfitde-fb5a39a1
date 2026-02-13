
-- ====================================================================
-- TRACK SYSTEM: certification_type + track + feature_flags
-- ====================================================================

-- 1) Enum types
DO $$ BEGIN
  CREATE TYPE public.certification_type AS ENUM (
    'ausbildung',
    'fortbildung_ihk',
    'fortbildung_hwk',
    'sachkunde',
    'branchenzertifikat',
    'projektmanagement'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.product_track AS ENUM (
    'AUSBILDUNG_VOLL',
    'EXAM_FIRST'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- 2) Add track columns to course_packages
ALTER TABLE public.course_packages
  ADD COLUMN IF NOT EXISTS certification_type public.certification_type DEFAULT 'ausbildung',
  ADD COLUMN IF NOT EXISTS track public.product_track DEFAULT 'AUSBILDUNG_VOLL',
  ADD COLUMN IF NOT EXISTS feature_flags jsonb DEFAULT '{
    "has_learning_course": true,
    "has_practice_course_h5p": true,
    "has_minichecks": true,
    "has_exam_trainer": true,
    "has_exam_simulation": true,
    "has_oral_exam_trainer": true,
    "has_ai_tutor": true,
    "has_handbook": true
  }'::jsonb;

-- 3) Add track columns to curricula
ALTER TABLE public.curricula
  ADD COLUMN IF NOT EXISTS certification_type public.certification_type DEFAULT 'ausbildung',
  ADD COLUMN IF NOT EXISTS track public.product_track DEFAULT 'AUSBILDUNG_VOLL';

-- 4) Set defaults: all existing packages = Ausbildung (full track)
UPDATE public.course_packages
SET certification_type = 'ausbildung',
    track = 'AUSBILDUNG_VOLL',
    feature_flags = '{
      "has_learning_course": true,
      "has_practice_course_h5p": true,
      "has_minichecks": true,
      "has_exam_trainer": true,
      "has_exam_simulation": true,
      "has_oral_exam_trainer": true,
      "has_ai_tutor": true,
      "has_handbook": true
    }'::jsonb
WHERE track IS NULL OR certification_type IS NULL;

-- 5) Function to derive default feature_flags from track + certification_type
CREATE OR REPLACE FUNCTION public.derive_feature_flags(
  p_track public.product_track,
  p_cert_type public.certification_type
) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE
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
      'has_handbook', true
    );
  ELSE
    -- EXAM_FIRST: only exam + simulation mandatory, rest optional
    RETURN jsonb_build_object(
      'has_learning_course', false,
      'has_practice_course_h5p', false,
      'has_minichecks', false,
      'has_exam_trainer', true,
      'has_exam_simulation', true,
      'has_oral_exam_trainer', false,
      'has_ai_tutor', false,
      'has_handbook', false
    );
  END IF;
END;
$$;

-- 6) Trigger: auto-set track + feature_flags on insert if not provided
CREATE OR REPLACE FUNCTION public.auto_set_track_defaults()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- Derive track from certification_type
  IF NEW.track IS NULL THEN
    IF NEW.certification_type = 'ausbildung' THEN
      NEW.track := 'AUSBILDUNG_VOLL';
    ELSE
      NEW.track := 'EXAM_FIRST';
    END IF;
  END IF;

  -- Derive feature_flags if not custom-set
  IF NEW.feature_flags IS NULL OR NEW.feature_flags = '{}'::jsonb THEN
    NEW.feature_flags := public.derive_feature_flags(NEW.track, NEW.certification_type);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_auto_set_track_defaults ON public.course_packages;
CREATE TRIGGER trg_auto_set_track_defaults
  BEFORE INSERT ON public.course_packages
  FOR EACH ROW EXECUTE FUNCTION public.auto_set_track_defaults();

-- 7) Get pipeline steps for a track (used by build system)
CREATE OR REPLACE FUNCTION public.get_track_pipeline_steps(p_package_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_flags jsonb;
  v_steps jsonb := '[]'::jsonb;
BEGIN
  SELECT feature_flags INTO v_flags
  FROM public.course_packages WHERE id = p_package_id;

  IF v_flags IS NULL THEN RETURN '[]'::jsonb; END IF;

  -- Always: scaffold if has_learning_course
  IF (v_flags->>'has_learning_course')::boolean THEN
    v_steps := v_steps || '["scaffold_learning_course"]'::jsonb;
  END IF;

  -- Always: exam
  IF (v_flags->>'has_exam_trainer')::boolean THEN
    v_steps := v_steps || '["generate_exam_pool"]'::jsonb;
  END IF;

  -- Oral
  IF (v_flags->>'has_oral_exam_trainer')::boolean THEN
    v_steps := v_steps || '["generate_oral_exam"]'::jsonb;
  END IF;

  -- Tutor
  IF (v_flags->>'has_ai_tutor')::boolean THEN
    v_steps := v_steps || '["build_ai_tutor_index"]'::jsonb;
  END IF;

  -- Handbook
  IF (v_flags->>'has_handbook')::boolean THEN
    v_steps := v_steps || '["generate_handbook"]'::jsonb;
  END IF;

  -- Always: integrity + publish
  v_steps := v_steps || '["run_integrity_check", "auto_publish"]'::jsonb;

  RETURN v_steps;
END;
$$;

-- 8) Track-aware coverage stats
CREATE OR REPLACE FUNCTION public.get_track_summary()
RETURNS jsonb
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  v_result jsonb;
BEGIN
  SELECT jsonb_build_object(
    'ausbildung_voll', (SELECT jsonb_build_object(
      'total', COUNT(*),
      'published', COUNT(*) FILTER (WHERE status = 'published'),
      'building', COUNT(*) FILTER (WHERE status = 'building'),
      'draft', COUNT(*) FILTER (WHERE status IN ('draft', 'planning'))
    ) FROM course_packages WHERE track = 'AUSBILDUNG_VOLL'),
    'exam_first', (SELECT jsonb_build_object(
      'total', COUNT(*),
      'published', COUNT(*) FILTER (WHERE status = 'published'),
      'building', COUNT(*) FILTER (WHERE status = 'building'),
      'draft', COUNT(*) FILTER (WHERE status IN ('draft', 'planning'))
    ) FROM course_packages WHERE track = 'EXAM_FIRST'),
    'by_cert_type', (
      SELECT jsonb_object_agg(ct, cnt)
      FROM (
        SELECT certification_type::text AS ct, COUNT(*) AS cnt
        FROM course_packages
        GROUP BY certification_type
      ) sub
    )
  ) INTO v_result;
  RETURN v_result;
END;
$$;

-- 9) Index for fast filtering
CREATE INDEX IF NOT EXISTS idx_course_packages_track ON public.course_packages(track);
CREATE INDEX IF NOT EXISTS idx_course_packages_cert_type ON public.course_packages(certification_type);
