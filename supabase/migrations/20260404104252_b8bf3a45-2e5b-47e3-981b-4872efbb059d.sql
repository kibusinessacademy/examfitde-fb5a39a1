
-- certifications table
CREATE TABLE IF NOT EXISTS public.certifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  short_title text,
  track text NOT NULL CHECK (track IN ('AUSBILDUNG','STUDIUM','FORTBILDUNG','CERTIFICATION')),
  certification_type text NOT NULL,
  validation_profile text NOT NULL,
  provider text,
  provider_type text,
  level text,
  language text NOT NULL DEFAULT 'de',
  international boolean NOT NULL DEFAULT false,
  exam_modes text[] NOT NULL DEFAULT '{}',
  oral_exam_enabled boolean NOT NULL DEFAULT false,
  calculation_heavy boolean NOT NULL DEFAULT false,
  framework_heavy boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_certifications_track ON public.certifications(track);
CREATE INDEX IF NOT EXISTS idx_certifications_type ON public.certifications(certification_type);
CREATE INDEX IF NOT EXISTS idx_certifications_profile ON public.certifications(validation_profile);

ALTER TABLE public.certifications ENABLE ROW LEVEL SECURITY;
CREATE POLICY "certifications_read_authenticated" ON public.certifications FOR SELECT TO authenticated USING (true);

-- certification_profiles table
CREATE TABLE IF NOT EXISTS public.certification_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text NOT NULL UNIQUE,
  title text NOT NULL,
  validation_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  blueprint_defaults jsonb NOT NULL DEFAULT '{}'::jsonb,
  scoring_weights jsonb NOT NULL DEFAULT '{}'::jsonb,
  tutor_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.certification_profiles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "certification_profiles_read_authenticated" ON public.certification_profiles FOR SELECT TO authenticated USING (true);

-- certification_blueprint_templates table
CREATE TABLE IF NOT EXISTS public.certification_blueprint_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_key text NOT NULL,
  blueprint_type text NOT NULL,
  title text NOT NULL,
  description text,
  question_formats text[] NOT NULL DEFAULT '{}',
  trap_distribution jsonb NOT NULL DEFAULT '{}'::jsonb,
  difficulty_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  prompt_contract jsonb NOT NULL DEFAULT '{}'::jsonb,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(profile_key, blueprint_type, title)
);

ALTER TABLE public.certification_blueprint_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cert_blueprint_templates_read_authenticated" ON public.certification_blueprint_templates FOR SELECT TO authenticated USING (true);

-- Link curricula to certifications
ALTER TABLE public.curricula ADD COLUMN IF NOT EXISTS certification_id uuid REFERENCES public.certifications(id);
CREATE INDEX IF NOT EXISTS idx_curricula_certification_id ON public.curricula(certification_id);

-- Link course_packages to certifications
ALTER TABLE public.course_packages ADD COLUMN IF NOT EXISTS certification_id uuid REFERENCES public.certifications(id);
CREATE INDEX IF NOT EXISTS idx_course_packages_certification_id ON public.course_packages(certification_id);

-- Extend integrity_profile constraint to include new profiles
ALTER TABLE public.course_packages DROP CONSTRAINT IF EXISTS course_packages_integrity_profile_check;
ALTER TABLE public.course_packages ADD CONSTRAINT course_packages_integrity_profile_check
  CHECK (integrity_profile IS NULL OR integrity_profile IN (
    'AUSBILDUNG_VOLL','AUSBILDUNG_LIGHT','STUDIUM','WEITERBILDUNG',
    'IHK_AUFSTIEG','MEISTER','AEVO','FINANCE','CERT_TECH','SECURITY','PRIVACY'
  ));
