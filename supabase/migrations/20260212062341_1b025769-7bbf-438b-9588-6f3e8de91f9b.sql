
-- Course Studio v2: Ergänzende Indizes & Constraints
-- (Tabellen existieren bereits aus vorheriger Migration)

-- Indizes für course_packages
CREATE INDEX IF NOT EXISTS idx_course_packages_certification_id
  ON public.course_packages(certification_id);
CREATE INDEX IF NOT EXISTS idx_course_packages_course_id
  ON public.course_packages(course_id);

-- Indizes für course_package_build_steps
CREATE INDEX IF NOT EXISTS idx_course_package_build_steps_package_id
  ON public.course_package_build_steps(package_id);
CREATE INDEX IF NOT EXISTS idx_course_package_build_steps_step_key
  ON public.course_package_build_steps(step_key);

-- Unique constraint: jeder Step nur 1x pro Package
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_course_package_step'
  ) THEN
    ALTER TABLE public.course_package_build_steps
      ADD CONSTRAINT uq_course_package_step UNIQUE (package_id, step_key);
  END IF;
END $$;

-- Indizes für council_sessions
CREATE INDEX IF NOT EXISTS idx_council_sessions_package_id
  ON public.council_sessions(package_id);
CREATE INDEX IF NOT EXISTS idx_council_sessions_council_type
  ON public.council_sessions(council_type);
