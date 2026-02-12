
-- =============================================
-- Course Studio v2: Package-based orchestration
-- =============================================

-- 1. course_packages – the central package object
CREATE TABLE public.course_packages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  certification_id uuid REFERENCES public.curricula(id),
  course_id uuid REFERENCES public.courses(id),
  title text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'planning'
    CHECK (status IN ('planning','council_review','building','qa','published','failed')),
  components jsonb NOT NULL DEFAULT '{"learning_course":true,"exam_trainer":true,"oral_exam":true,"ai_tutor":true,"handbook":true}'::jsonb,
  council_approved boolean NOT NULL DEFAULT false,
  council_approved_at timestamptz,
  council_approved_by uuid,
  build_progress numeric NOT NULL DEFAULT 0,
  integrity_passed boolean NOT NULL DEFAULT false,
  integrity_report jsonb,
  published_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.course_packages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage course_packages"
  ON public.course_packages FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

-- 2. course_package_build_steps – granular build tracking
CREATE TABLE public.course_package_build_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  step_key text NOT NULL,
  step_label text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','done','failed','skipped')),
  started_at timestamptz,
  finished_at timestamptz,
  duration_ms int,
  log jsonb,
  error_message text,
  retry_count int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.course_package_build_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage build_steps"
  ON public.course_package_build_steps FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE INDEX idx_build_steps_package ON public.course_package_build_steps(package_id, sort_order);

-- 3. council_sessions – council deliberation tracking  
CREATE TABLE public.council_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id uuid NOT NULL REFERENCES public.course_packages(id) ON DELETE CASCADE,
  council_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','running','completed','failed')),
  discussion jsonb,
  decision text CHECK (decision IN ('approve','changes_required','rejected')),
  recommendations jsonb,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.council_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage council_sessions"
  ON public.council_sessions FOR ALL
  USING (EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND role = 'admin'));

CREATE INDEX idx_council_sessions_package ON public.council_sessions(package_id);

-- Trigger for updated_at on course_packages
CREATE TRIGGER update_course_packages_updated_at
  BEFORE UPDATE ON public.course_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
